import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { calculateOutstandingCentavos } from "@/lib/ledger";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema, paymentMethodSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: paymentMethodSchema,
  reference: z.string().trim().max(200).optional(),
}).refine((value) => !["GCASH", "BANK_TRANSFER"].includes(value.method) || Boolean(value.reference?.trim()), {
  message: "A transaction reference is required for GCash and bank transfers.",
  path: ["reference"],
});

const manilaToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  }
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid statement repayment details." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityType: true, eventType: true } });
      if (prior) {
        if (prior.entityType !== "STATEMENT" || prior.eventType !== "STATEMENT_PAYMENT_BATCH_PROPOSED") throw new Error("IDEMPOTENCY_CONFLICT");
        return { count: 0, total: 0n, replay: true };
      }

      const installments = await tx.cutoffInstallment.findMany({
        where: {
          periodStart: new Date(parsed.data.periodStart + "T00:00:00.000Z"),
          periodEnd: new Date(parsed.data.periodEnd + "T00:00:00.000Z"),
          loan: { borrowerId: session.id, status: "ACTIVE" },
        },
        include: { loan: { include: { payments: { include: { reversals: true } } } }, payments: { include: { reversals: true } } },
        orderBy: [{ dueAt: "asc" }, { loanId: "asc" }],
      });
      if (!installments.length) throw new Error("STATEMENT_NOT_FOUND");

      const today = manilaToday();
      const proposals: Array<{ installmentId: string; loanId: string; publicCode: string; amount: bigint; method: string; dueAt: Date }> = [];
      for (const installment of installments) {
        const loan = installment.loan;
        if (loan.payments.some((payment) => payment.status === "AWAITING_ACKNOWLEDGMENT")) throw new Error("PAYMENT_ALREADY_PENDING");
        const installmentApplied = installment.payments.reduce((sum, payment) => {
          if (payment.status !== "CONFIRMED" && payment.status !== "AWAITING_ACKNOWLEDGMENT") return sum;
          const reversed = payment.reversals.filter((item) => item.status === "CONFIRMED").reduce((total, item) => total + item.amountCentavos, 0n);
          return sum + payment.amountCentavos - reversed;
        }, 0n);
        const cutoffRemaining = installment.amountCentavos > installmentApplied ? installment.amountCentavos - installmentApplied : 0n;
        const loanOutstanding = calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((payment) => ({
          id: payment.id, amountCentavos: payment.amountCentavos, status: payment.status,
          reversals: payment.reversals.map((item) => ({ amountCentavos: item.amountCentavos, status: item.status })),
        })));
        const amount = cutoffRemaining < loanOutstanding ? cutoffRemaining : loanOutstanding;
        if (amount <= 0n) continue;
        if ((parsed.data.method === "GCASH" || parsed.data.method === "BANK_TRANSFER") && today < installment.dueAt.toISOString().slice(0, 10)) {
          throw new Error("QR_PAYMENT_NOT_YET_AVAILABLE");
        }
        proposals.push({ installmentId: installment.id, loanId: loan.id, publicCode: loan.publicCode, amount, method: parsed.data.method, dueAt: installment.dueAt });
      }
      if (!proposals.length) throw new Error("STATEMENT_ALREADY_PAID");

      for (const proposal of proposals) {
        const payment = await tx.payment.create({ data: {
          loanId: proposal.loanId, cutoffInstallmentId: proposal.installmentId,
          amountCentavos: proposal.amount, method: parsed.data.method, status: "AWAITING_ACKNOWLEDGMENT",
          reference: parsed.data.reference || null,
          note: "Statement repayment " + parsed.data.periodStart + " to " + parsed.data.periodEnd,
          createdByMemberId: session.id,
        } });
        await appendAuditEntry(tx, {
          entityType: "PAYMENT", entityId: payment.id, eventType: "PAYMENT_PROPOSED",
          actorMemberId: session.id, idempotencyKey: randomUUID(),
          payload: { loanId: proposal.loanId, publicCode: proposal.publicCode, amountCentavos: proposal.amount.toString(), method: payment.method, status: payment.status, reference: payment.reference, cutoffInstallmentId: proposal.installmentId, statementPeriodStart: parsed.data.periodStart, statementPeriodEnd: parsed.data.periodEnd, statementBatchKey: idempotencyKey },
        });
      }
      const total = proposals.reduce((sum, proposal) => sum + proposal.amount, 0n);
      await appendAuditEntry(tx, {
        entityType: "STATEMENT", entityId: parsed.data.periodStart + ":" + parsed.data.periodEnd,
        eventType: "STATEMENT_PAYMENT_BATCH_PROPOSED", actorMemberId: session.id,
        idempotencyKey,
        payload: { periodStart: parsed.data.periodStart, periodEnd: parsed.data.periodEnd, paymentCount: proposals.length, totalCentavos: total.toString(), method: parsed.data.method, reference: parsed.data.reference || null },
      });
      return { count: proposals.length, total, replay: false };
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 15000 });
    return NextResponse.json({ ok: true, paymentCount: result.count, totalCentavos: result.total.toString(), replay: result.replay }, { status: result.replay ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was used for another operation." },
        STATEMENT_NOT_FOUND: { status: 404, message: "No active loan items were found for this statement." },
        STATEMENT_ALREADY_PAID: { status: 409, message: "This statement has no remaining amount to repay." },
        PAYMENT_ALREADY_PENDING: { status: 409, message: "At least one loan in this statement already has a repayment awaiting acknowledgment. Wait for it to be acknowledged before submitting this statement again." },
        QR_PAYMENT_NOT_YET_AVAILABLE: { status: 409, message: "Bank and GCash repayments unlock when all items in this statement reach their cutoff due date. Cash and other methods remain available earlier." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This request conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
