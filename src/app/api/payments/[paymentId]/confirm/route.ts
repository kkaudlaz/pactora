import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { calculateOutstandingCentavos } from "@/lib/ledger";
import { idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ paymentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  const { paymentId } = await context.params;
  if (!z.string().min(1).max(128).safeParse(paymentId).success) return NextResponse.json({ error: "Invalid payment." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(711772601)`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true } });
      if (prior) {
        if (prior.entityType !== "PAYMENT") throw new Error("IDEMPOTENCY_CONFLICT");
        return { payment: await tx.payment.findUniqueOrThrow({ where: { id: prior.entityId } }), settled: false, replay: true };
      }
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { loan: { include: { payments: { include: { reversals: true } } } } });
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      const loan = payment.loan;
      if (session.memberId !== loan.borrowerId && session.memberId !== loan.lenderId) throw new Error("NOT_PARTY");
      if (payment.createdByMemberId === session.memberId) throw new Error("SELF_CONFIRM");
      if (payment.status !== "AWAITING_ACKNOWLEDGMENT") throw new Error("PAYMENT_NOT_PENDING");
      const outstanding = calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((item) => ({ id: item.id, amountCentavos: item.amountCentavos, status: item.status, reversals: item.reversals.map((r) => ({ amountCentavos: r.amountCentavos, status: r.status })) })));
      if (payment.amountCentavos > outstanding) throw new Error("PAYMENT_EXCEEDS_BALANCE");
      const confirmedAt = new Date();
      const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: "CONFIRMED", confirmedAt } });
      const payloadHash = createHash("sha256").update(JSON.stringify({ paymentId: payment.id, amountCentavos: payment.amountCentavos.toString(), method: payment.method, loanId: loan.id })).digest("hex");
      await tx.approval.create({ data: { memberId: session.memberId, loanId: loan.id, paymentId: payment.id, kind: "PAYMENT", payloadHash, decision: "CONFIRMED" } });
      await appendAuditEntry(tx, { entityType: "PAYMENT", entityId: payment.id, eventType: "PAYMENT_CONFIRMED", actorMemberId: session.memberId, idempotencyKey, payload: { loanId: loan.id, amountCentavos: payment.amountCentavos.toString(), confirmedAt: confirmedAt.toISOString(), payloadHash } });
      const netPaid = loan.payments.reduce((sum, item) => {
        if (item.status !== "CONFIRMED" && item.id !== payment.id) return sum;
        const reversals = item.reversals.reduce((total, reversal) => reversal.status === "CONFIRMED" ? total + reversal.amountCentavos : total, 0n);
        return sum + item.amountCentavos - reversals;
      }, 0n);
      const settled = loan.status === "ACTIVE" && loan.principalCentavos - netPaid <= 0n;
      if (settled) {
        await tx.loan.update({ where: { id: loan.id }, data: { status: "SETTLED" } });
        await appendAuditEntry(tx, { entityType: "LOAN", entityId: loan.id, eventType: "LOAN_SETTLED", actorMemberId: session.memberId, idempotencyKey: `${idempotencyKey}:settled`, payload: { publicCode: loan.publicCode, settledByPaymentId: payment.id, settledAt: confirmedAt.toISOString() } });
      }
      return { payment: updated, settled, replay: false };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ payment: { id: result.payment.id, status: result.payment.status, confirmedAt: result.payment.confirmedAt?.toISOString() ?? null }, settled: result.settled, replay: result.replay });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was used for another operation." }, PAYMENT_NOT_FOUND: { status: 404, message: "Payment not found." }, NOT_PARTY: { status: 403, message: "You are not a party to this loan." }, SELF_CONFIRM: { status: 403, message: "The person who proposed a payment cannot acknowledge it." }, PAYMENT_NOT_PENDING: { status: 409, message: "This payment is no longer awaiting acknowledgment." }, PAYMENT_EXCEEDS_BALANCE: { status: 409, message: "The payment now exceeds the outstanding balance; resolve the discrepancy first." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This acknowledgment conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
