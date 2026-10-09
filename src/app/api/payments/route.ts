import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parsePhpToCentavos } from "@/lib/money";
import { calculateOutstandingCentavos } from "@/lib/ledger";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema, proposePaymentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = proposePaymentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payment details are invalid." }, { status: 400 });
  let amountCentavos: bigint;
  try { amountCentavos = parsePhpToCentavos(parsed.data.amountPhp); } catch { return NextResponse.json({ error: "Enter a valid positive PHP amount." }, { status: 400 }); }
  if (amountCentavos <= 0n) return NextResponse.json({ error: "Payment amount must be greater than zero." }, { status: 400 });

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true } });
      if (prior) {
        if (prior.entityType !== "PAYMENT") throw new Error("IDEMPOTENCY_CONFLICT");
        return tx.payment.findUniqueOrThrow({ where: { id: prior.entityId } });
      }
      const loan = await tx.loan.findUnique({ where: { id: parsed.data.loanId }, include: { payments: { include: { reversals: true } } } });
      if (!loan) throw new Error("LOAN_NOT_FOUND");
      if (loan.status !== "ACTIVE") throw new Error("LOAN_NOT_ACTIVE");
      if (session.memberId !== loan.borrowerId && session.memberId !== loan.lenderId) throw new Error("NOT_PARTY");
      const outstanding = calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((item) => ({ id: item.id, amountCentavos: item.amountCentavos, status: item.status, reversals: item.reversals.map((r) => ({ amountCentavos: r.amountCentavos, status: r.status })) })));
      if (amountCentavos > outstanding) throw new Error("PAYMENT_EXCEEDS_BALANCE");
      const created = await tx.payment.create({ data: {
        loanId: loan.id, amountCentavos, method: parsed.data.method, status: "AWAITING_ACKNOWLEDGMENT",
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null, reference: parsed.data.reference || null,
        note: parsed.data.note || null, createdByMemberId: session.memberId,
      } });
      await appendAuditEntry(tx, { entityType: "PAYMENT", entityId: created.id, eventType: "PAYMENT_PROPOSED", actorMemberId: session.memberId, idempotencyKey, payload: { loanId: loan.id, publicCode: loan.publicCode, amountCentavos: amountCentavos.toString(), method: created.method, status: created.status, reference: created.reference } });
      return created;
    });
    return NextResponse.json({ payment: { id: payment.id, loanId: payment.loanId, amountCentavos: payment.amountCentavos.toString(), method: payment.method, status: payment.status, createdAt: payment.createdAt.toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was used for another operation." },
        LOAN_NOT_FOUND: { status: 404, message: "Loan not found." },
        LOAN_NOT_ACTIVE: { status: 409, message: "Payments can only be proposed for active loans." },
        NOT_PARTY: { status: 403, message: "You are not a party to this loan." },
        PAYMENT_EXCEEDS_BALANCE: { status: 400, message: "Payment exceeds the outstanding confirmed balance." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This request conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
