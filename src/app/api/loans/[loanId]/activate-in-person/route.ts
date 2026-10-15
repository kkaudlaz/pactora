import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner records an in-person agreement without impersonating either member's approval. */
export async function POST(request: NextRequest, context: { params: Promise<{ loanId: string }> }) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  const { loanId } = await context.params;
  if (!z.string().min(1).max(128).safeParse(loanId).success) return NextResponse.json({ error: "Invalid loan." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true, eventType: true } });
      if (prior) {
        if (prior.entityType !== "LOAN" || prior.eventType !== "LOAN_ACTIVATED_IN_PERSON") throw new Error("IDEMPOTENCY_CONFLICT");
        return tx.loan.findUniqueOrThrow({ where: { id: prior.entityId }, select: { id: true, publicCode: true, status: true } });
      }
      const loan = await tx.loan.findUnique({ where: { id: loanId }, select: { id: true, publicCode: true, status: true, termsHash: true, borrowerId: true, lenderId: true } });
      if (!loan) throw new Error("LOAN_NOT_FOUND");
      if (loan.status !== "DRAFT" && loan.status !== "AWAITING_APPROVAL") throw new Error("LOAN_NOT_PENDING");
      if (!loan.termsHash) throw new Error("TERMS_MISSING");
      const updated = await tx.loan.update({ where: { id: loan.id }, data: { status: "ACTIVE" }, select: { id: true, publicCode: true, status: true } });
      await appendAuditEntry(tx, { entityType: "LOAN", entityId: loan.id, eventType: "LOAN_ACTIVATED_IN_PERSON", actorMemberId: session.id, idempotencyKey, payload: { publicCode: loan.publicCode, activatedAt: new Date().toISOString(), activationMode: "OWNER_RECORDED_IN_PERSON_AGREEMENT", termsHash: loan.termsHash, borrowerId: loan.borrowerId, lenderId: loan.lenderId, note: "Owner recorded that both parties agreed to the current loan terms in person. This event does not impersonate either party's individual approval." } });
      return updated;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ loan: result });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was already used for another operation." },
        LOAN_NOT_FOUND: { status: 404, message: "Loan not found." },
        LOAN_NOT_PENDING: { status: 409, message: "Only draft or awaiting-approval loans can be activated this way." },
        TERMS_MISSING: { status: 409, message: "Loan terms are missing; cannot activate this record." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This activation conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
