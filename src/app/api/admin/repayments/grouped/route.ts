import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { parsePhpToCentavos } from "@/lib/money";
import { calculateOutstandingCentavos } from "@/lib/ledger";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema, paymentMethodSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const manilaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
const childKey = (root: string, installmentId: string) => {
  const hex = createHash("sha256").update(root + ":" + installmentId).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return value.slice(0, 8) + "-" + value.slice(8, 12) + "-" + value.slice(12, 16) + "-" + value.slice(16, 20) + "-" + value.slice(20);
};

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Repayment details are invalid." }, { status: 400 });
  const data = body as Record<string, unknown>;
  if (typeof data.memberId !== "string" || typeof data.periodStart !== "string" || typeof data.periodEnd !== "string" || typeof data.amountPhp !== "string" || !paymentMethodSchema.safeParse(data.method).success) {
    return NextResponse.json({ error: "Member, cutoff period, payment method, and amount are required." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(data.periodEnd) || data.periodStart > data.periodEnd) {
    return NextResponse.json({ error: "Choose a valid cutoff period." }, { status: 400 });
  }
  let amountCentavos: bigint;
  try { amountCentavos = parsePhpToCentavos(data.amountPhp); } catch {
    return NextResponse.json({ error: "Enter a valid positive PHP amount." }, { status: 400 });
  }
  if (amountCentavos <= 0n) return NextResponse.json({ error: "Repayment amount must be greater than zero." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityType: true, eventType: true, payloadJson: true } });
      if (prior) {
        if (prior.entityType !== "PAYMENT_BATCH" || prior.eventType !== "PAYMENT_BATCH_RECORDED") throw new Error("IDEMPOTENCY_CONFLICT");
        const payload = prior.payloadJson as { paymentIds?: string[] };
        const payments = await tx.payment.findMany({ where: { id: { in: payload.paymentIds ?? [] } }, include: { loan: { select: { publicCode: true, description: true } } } });
        return { replay: true, payments };
      }

      const member = await tx.member.findUnique({ where: { id: data.memberId as string }, select: { id: true, displayName: true, role: true } });
      if (!member || member.role !== "MEMBER") throw new Error("MEMBER_NOT_FOUND");
      const ownedLoans = await tx.loan.findMany({
        where: { borrowerId: member.id, lenderId: session.id, status: "ACTIVE" },
        include: {
          payments: { include: { reversals: true } },
          cutoffInstallments: {
            where: { periodStart: new Date((data.periodStart as string) + "T00:00:00.000Z"), periodEnd: new Date((data.periodEnd as string) + "T00:00:00.000Z") },
            include: { payments: { include: { reversals: true } } },
          },
        },
      });
      const installments = ownedLoans.flatMap((loan) => loan.cutoffInstallments.map((item) => ({ ...item, loan })))
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.loan.publicCode.localeCompare(b.loan.publicCode));
      if (!installments.length) throw new Error("CUTOFF_NOT_FOUND");

      const balanceOf = (items: Array<{ amountCentavos: bigint; status: string; reversals: Array<{ amountCentavos: bigint; status: string }> }>) =>
        items.reduce((sum, item) => {
          if (item.status !== "CONFIRMED") return sum;
          const reversed = item.reversals.filter((r) => r.status === "CONFIRMED").reduce((total, r) => total + r.amountCentavos, 0n);
          return sum + item.amountCentavos - reversed;
        }, 0n);
      const eligible = installments.map((item) => {
        if (item.loan.payments.some((p) => p.status === "AWAITING_ACKNOWLEDGMENT")) throw new Error("PAYMENT_ALREADY_PENDING");
        const loanOutstanding = calculateOutstandingCentavos(item.loan.principalCentavos, item.loan.payments.map((p) => ({
          id: p.id, amountCentavos: p.amountCentavos, status: p.status,
          reversals: p.reversals.map((r) => ({ amountCentavos: r.amountCentavos, status: r.status })),
        })));
        const applied = balanceOf(item.payments);
        const remaining = item.amountCentavos > applied ? item.amountCentavos - applied : 0n;
        return { item, remaining: remaining < loanOutstanding ? remaining : loanOutstanding };
      }).filter((entry) => entry.remaining > 0n);
      const totalAvailable = eligible.reduce((sum, entry) => sum + entry.remaining, 0n);
      if (amountCentavos > totalAvailable) throw new Error("AMOUNT_EXCEEDS_CUTOFF");
      let unallocated = amountCentavos;
      const allocations: Array<{ installmentId: string; loanId: string; loanCode: string; amountCentavos: bigint }> = [];
      for (const entry of eligible) {
        if (unallocated <= 0n) break;
        const amount = entry.remaining < unallocated ? entry.remaining : unallocated;
        if ((data.method === "GCASH" || data.method === "BANK_TRANSFER") && manilaDate(new Date()) < manilaDate(entry.item.dueAt)) {
          throw new Error("QR_PAYMENT_NOT_YET_AVAILABLE");
        }
        allocations.push({ installmentId: entry.item.id, loanId: entry.item.loanId, loanCode: entry.item.loan.publicCode, amountCentavos: amount });
        unallocated -= amount;
      }
      if (unallocated !== 0n) throw new Error("AMOUNT_EXCEEDS_CUTOFF");

      const payments = [];
      for (const allocation of allocations) {
        const key = childKey(idempotencyKey, allocation.installmentId);
        const created = await tx.payment.create({ data: {
          loanId: allocation.loanId, cutoffInstallmentId: allocation.installmentId,
          amountCentavos: allocation.amountCentavos, method: data.method as "CASH" | "GCASH" | "BANK_TRANSFER" | "OTHER",
          status: "AWAITING_ACKNOWLEDGMENT", reference: typeof data.reference === "string" ? data.reference.slice(0, 200) || null : null,
          note: "Grouped cutoff repayment " + data.periodStart + " to " + data.periodEnd,
          createdByMemberId: session.id,
        } });
        await appendAuditEntry(tx, {
          entityType: "PAYMENT", entityId: created.id, eventType: "PAYMENT_PROPOSED", actorMemberId: session.id,
          idempotencyKey: key, payload: { loanId: allocation.loanId, publicCode: allocation.loanCode, amountCentavos: allocation.amountCentavos.toString(), method: created.method, status: created.status, reference: created.reference, cutoffInstallmentId: allocation.installmentId, batchKey: idempotencyKey },
        });
        payments.push({ ...created, loan: { publicCode: allocation.loanCode, description: allocation.loanCode } });
      }
      await appendAuditEntry(tx, {
        entityType: "PAYMENT_BATCH", entityId: member.id, eventType: "PAYMENT_BATCH_RECORDED", actorMemberId: session.id,
        idempotencyKey, payload: {
          memberId: member.id, memberName: member.displayName, periodStart: data.periodStart, periodEnd: data.periodEnd,
          method: data.method, amountCentavos: amountCentavos.toString(),
          allocations: allocations.map((item) => ({ installmentId: item.installmentId, loanId: item.loanId, loanCode: item.loanCode, amountCentavos: item.amountCentavos.toString() })),
          paymentIds: payments.map((payment) => payment.id),
        },
      });
      return { replay: false, payments };
    });
    return NextResponse.json({
      replay: result.replay,
      payments: result.payments.map((payment) => ({
        id: payment.id, loanId: payment.loanId, loanCode: payment.loan.publicCode,
        amountCentavos: payment.amountCentavos.toString(), method: payment.method, status: payment.status,
      })),
    }, { status: result.replay ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, { status: number; message: string }> = {
        IDEMPOTENCY_CONFLICT: { status: 409, message: "This idempotency key was already used for another operation." },
        MEMBER_NOT_FOUND: { status: 404, message: "Member not found." },
        CUTOFF_NOT_FOUND: { status: 404, message: "No active loans have a cutoff configured for that member and period." },
        PAYMENT_ALREADY_PENDING: { status: 409, message: "At least one included loan already has a repayment awaiting acknowledgment. Acknowledge it before recording another grouped repayment." },
        AMOUNT_EXCEEDS_CUTOFF: { status: 409, message: "The amount exceeds the remaining balance in this cutoff. Review the allocation and enter a smaller amount." },
        QR_PAYMENT_NOT_YET_AVAILABLE: { status: 409, message: "GCash and bank transfer allocations are only available from the due date in Philippine time." },
      };
      if (known[error.message]) return NextResponse.json({ error: known[error.message].message }, { status: known[error.message].status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "This request conflicts with an existing record." }, { status: 409 });
    throw error;
  }
}
