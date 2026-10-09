import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ loanId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  const { loanId } = await context.params;
  if (!z.string().min(1).max(128).safeParse(loanId).success) return NextResponse.json({ error: "Invalid loan." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(711772601)`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true } });
      if (prior) {
        if (prior.entityType !== "LOAN") throw new Error("IDEMPOTENCY_CONFLICT");
        const existing = await tx.loan.findUniqueOrThrow({ where: { id: prior.entityId }, select: { id: true, publicCode: true, status: true, termsHash: true } });
        return { loan: existing, replay: true };
      }
      const loan = await tx.loan.findUnique({ where: { id: loanId }, include: { approvals: true } });
      if (!loan) throw new Error("LOAN_NOT_FOUND");
      if (session.memberId !== loan.borrowerId && session.memberId !== loan.lenderId) throw new Error("NOT_PARTY");
      if (!loan.termsHash) throw new Error("TERMS_MISSING");
      if (loan.status !== "DRAFT" && loan.status !== "AWAITING_APPROVAL") throw new Error("LOAN_NOT_PENDING");
      const alreadyApproved = loan.approvals.some((a) => a.memberId === session.memberId && a.kind === "LOAN_TERMS" && a.termsVersion === loan.termsVersion && a.payloadHash === loan.termsHash && a.decision === "ACCEPTED");
      if (alreadyApproved) throw new Error("ALREADY_APPROVED");
      const acceptedAt = new Date();
      await tx.approval.create({ data: { memberId: session.memberId, loanId: loan.id, kind: "LOAN_TERMS", termsVersion: loan.termsVersion, payloadHash: loan.termsHash, decision: "ACCEPTED", decidedAt: acceptedAt } });
      const otherPartyId = session.memberId === loan.borrowerId ? loan.lenderId : loan.borrowerId;
      const otherAccepted = loan.approvals.some((a) => a.memberId === otherPartyId && a.kind === "LOAN_TERMS" && a.termsVersion === loan.termsVersion && a.payloadHash === loan.termsHash && a.decision === "ACCEPTED");
      const status = otherAccepted ? "ACTIVE" : "AWAITING_APPROVAL";
      const updated = await tx.loan.update({ where: { id: loan.id }, data: { status }, select: { id: true, publicCode: true, status: true, termsHash: true } });
      await appendAuditEntry(tx, { entityType: "LOAN", entityId: loan.id, eventType: "LOAN_TERMS_ACCEPTED", actorMemberId: session.memberId, idempotencyKey, payload: { publicCode: loan.publicCode, termsVersion: loan.termsVersion, termsHash: loan.termsHash, acceptedAt: acceptedAt.toISOString(), status } });
      if (status === "ACTIVE") await appendAuditEntry(tx, { entityType: "LOAN", entityId: loan.id, eventType: "LOAN_ACTIVATED", actorMemberId: session.memberId, idempotencyKey: `${idempotencyKey}:activated`, payload: { publicCode: loan.publicCode, termsVersion: loan.termsVersion, termsHash: loan.termsHash, activatedAt: acceptedAt.toISOString() } });
      return { loan: updated, replay: false };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ loan: result.loan, replay: result.replay });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was used for another operation." }, LOAN_NOT_FOUND: { status: 404, message: "Loan not found." }, NOT_PARTY: { status: 403, message: "Only a borrower or lender can approve these terms." }, TERMS_MISSING: { status: 409, message: "This loan has no frozen terms hash." }, LOAN_NOT_PENDING: { status: 409, message: "This loan is not awaiting approval." }, ALREADY_APPROVED: { status: 409, message: "You have already approved this version of the loan terms." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This approval conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
