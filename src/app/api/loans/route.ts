import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { parsePhpToCentavos } from "@/lib/money";
import { calculateOutstandingCentavos } from "@/lib/ledger";
import { createLoanDraftSchema, idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const where = session.role === "OWNER" ? {} : { OR: [{ borrowerId: session.memberId }, { lenderId: session.memberId }] };
  const loans = await prisma.loan.findMany({
    where,
    include: {
      borrower: { select: { id: true, memberUid: true, displayName: true } },
      lender: { select: { id: true, memberUid: true, displayName: true } },
      payments: { include: { reversals: { select: { amountCentavos: true, status: true } } }, orderBy: { createdAt: "desc" } },
      approvals: { select: { memberId: true, kind: true, termsVersion: true, payloadHash: true, decision: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ loans: loans.map((loan) => {
    const outstanding = calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((payment) => ({
      id: payment.id, amountCentavos: payment.amountCentavos, status: payment.status,
      reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos, status: reversal.status })),
    })));
    return {
      id: loan.id, publicCode: loan.publicCode, borrower: loan.borrower, lender: loan.lender,
      category: loan.category, description: loan.description, principalCentavos: loan.principalCentavos.toString(),
      outstandingCentavos: outstanding.toString(), currency: loan.currency, repaymentTerms: loan.repaymentTerms,
      dueAt: loan.dueAt?.toISOString() ?? null, status: loan.status, termsVersion: loan.termsVersion,
      createdAt: loan.createdAt.toISOString(),
      myTermsAccepted: loan.approvals.some((a) => a.memberId === session.memberId && a.kind === "LOAN_TERMS" && a.termsVersion === loan.termsVersion && a.payloadHash === loan.termsHash && a.decision === "ACCEPTED"),
      otherPartyAccepted: loan.approvals.some((a) => a.memberId !== session.memberId && a.kind === "LOAN_TERMS" && a.termsVersion === loan.termsVersion && a.payloadHash === loan.termsHash && a.decision === "ACCEPTED"),
      payments: loan.payments.map((payment) => ({
        id: payment.id, amountCentavos: payment.amountCentavos.toString(), method: payment.method, createdByMemberId: payment.createdByMemberId,
        status: payment.status, paidAt: payment.paidAt?.toISOString() ?? null, reference: payment.reference,
        createdAt: payment.createdAt.toISOString(), reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos.toString(), status: reversal.status })),
      })),
    };
  }) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = createLoanDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Loan details are invalid. Check the member IDs, category, amount, description, terms, and due date." }, { status: 400 });
  let principalCentavos: bigint;
  try { principalCentavos = parsePhpToCentavos(parsed.data.amountPhp); } catch { return NextResponse.json({ error: "Enter a valid positive PHP amount." }, { status: 400 }); }
  if (principalCentavos <= 0n) return NextResponse.json({ error: "Loan amount must be greater than zero." }, { status: 400 });
  const [borrower, lender] = await Promise.all([
    prisma.member.findFirst({ where: { id: parsed.data.borrowerId, disabledAt: null }, select: { id: true } }),
    prisma.member.findFirst({ where: { id: parsed.data.lenderId, disabledAt: null }, select: { id: true } }),
  ]);
  if (!borrower || !lender) return NextResponse.json({ error: "Borrower and lender must be active members." }, { status: 400 });
  const terms = { borrowerId: borrower.id, lenderId: lender.id, category: parsed.data.category, description: parsed.data.description, principalCentavos: principalCentavos.toString(), currency: "PHP", repaymentTerms: parsed.data.repaymentTerms, dueAt: parsed.data.dueAt ?? null, termsVersion: 1 };
  const termsHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
  const publicCode = `PT-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    const loan = await prisma.$transaction(async (tx) => {
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true } });
      if (prior) {
        if (prior.entityType !== "LOAN") throw new Error("IDEMPOTENCY_CONFLICT");
        return tx.loan.findUniqueOrThrow({ where: { id: prior.entityId } });
      }
      const created = await tx.loan.create({ data: {
        publicCode, borrowerId: borrower.id, lenderId: lender.id, category: parsed.data.category,
        description: parsed.data.description, principalCentavos, repaymentTerms: parsed.data.repaymentTerms,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, status: "DRAFT", termsVersion: 1, termsHash,
      } });
      await appendAuditEntry(tx, { entityType: "LOAN", entityId: created.id, eventType: "LOAN_DRAFT_CREATED", actorMemberId: session.memberId, idempotencyKey, payload: { publicCode, ...terms, termsHash } });
      return created;
    });
    return NextResponse.json({ loan: { id: loan.id, publicCode: loan.publicCode, status: loan.status, termsHash: loan.termsHash, principalCentavos: loan.principalCentavos.toString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This idempotency key was already used for a different operation." }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This request conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
