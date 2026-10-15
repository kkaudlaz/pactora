import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { cutoffPeriodsBetween } from "@/lib/cutoff-schedule";
import { calculateOutstandingCentavos } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const initialStart = "2026-08-27";
const legacyInitialEnd = "2026-10-07";
const agreedInitialEnd = "2026-10-15";

export async function GET() {
 const session = await getAuthenticatedMember();
 if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

 try {
  const owned = await prisma.auditEntry.findMany({
   where: { actorMemberId: session.id, entityType: "LOAN", eventType: "LOAN_DRAFT_CREATED" },
   select: { entityId: true },
  });
  const loanIds = [...new Set(owned.map((entry) => entry.entityId))];

  // Read first so we only open write transactions for loans that actually need work.
  const candidates = await prisma.loan.findMany({
   where: { id: { in: loanIds }, status: "ACTIVE", dueAt: { not: null } },
   include: { cutoffInstallments: true },
  });

  for (const candidate of candidates) {
   if (!candidate.dueAt || candidate.dueAt < candidate.borrowedAt) continue;
   const periods = cutoffPeriodsBetween(candidate.borrowedAt, candidate.dueAt);
   if (!periods.length) continue;

   // One loan is assigned to one cutoff: the latest cutoff ending on/before its due date.
   // If the loan itself starts on the 16th and has no prior eligible cutoff, use its due-date period.
   const dueDateKey = dateKey(candidate.dueAt);
   const dueDay = Number(dueDateKey.slice(8, 10));
   const target = (dueDay >= 16
    ? [...periods].reverse().find((period) => period.end < dueDateKey)
    : periods.find((period) => period.end >= dueDateKey)) ?? periods[periods.length - 1];
   if (!target) continue;

   await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
    const loan = await tx.loan.findFirst({
     where: { id: candidate.id, status: "ACTIVE", dueAt: { not: null } },
     include: {
      cutoffInstallments: { include: { payments: true } },
      payments: { include: { reversals: true } },
     },
    });
    if (!loan?.dueAt || loan.dueAt < loan.borrowedAt) return;

    const currentPeriods = cutoffPeriodsBetween(loan.borrowedAt, loan.dueAt);
    const loanDueKey = dateKey(loan.dueAt);
    const loanDueDay = Number(loanDueKey.slice(8, 10));
    const targetPeriod = (loanDueDay >= 16
     ? [...currentPeriods].reverse().find((period) => period.end < loanDueKey)
     : currentPeriods.find((period) => period.end >= loanDueKey)) ?? currentPeriods[currentPeriods.length - 1];
    if (!targetPeriod) return;

    const existing = loan.cutoffInstallments;
    // Never move or delete a cutoff that already has payment history. Keeping its
    // attribution intact is safer than silently rewriting a member's statement.
    if (existing.some((item) => item.payments.length > 0)) return;

    const targetStart = new Date(targetPeriod.start + "T00:00:00.000Z");
    const targetEnd = new Date(targetPeriod.end + "T00:00:00.000Z");
    const targetDue = new Date(targetPeriod.due + "T00:00:00.000Z");
    const outstanding = calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((payment) => ({
     id: payment.id,
     amountCentavos: payment.amountCentavos,
     status: payment.status,
     reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos, status: reversal.status })),
    })));
    if (outstanding <= 0n) {
     if (existing.length) await tx.cutoffInstallment.deleteMany({ where: { loanId: loan.id, payments: { none: {} } } });
     return;
    }

    const targetExisting = existing.find((item) =>
     dateKey(item.periodStart) === targetPeriod.start && dateKey(item.periodEnd) === targetPeriod.end
    );
    let targetId: string;
    if (targetExisting) {
     const updated = await tx.cutoffInstallment.update({
      where: { id: targetExisting.id },
      data: {
       dueAt: targetDue,
       amountCentavos: outstanding,
       note: "Full outstanding loan balance assigned to its applicable cutoff.",
      },
     });
     targetId = updated.id;
    } else {
     const created = await tx.cutoffInstallment.create({ data: {
      loanId: loan.id,
      periodStart: targetStart,
      periodEnd: targetEnd,
      dueAt: targetDue,
      amountCentavos: outstanding,
      note: "Full outstanding loan balance assigned to its applicable cutoff.",
      createdByMemberId: session.id,
     } });
     targetId = created.id;
    }

    const obsoleteIds = existing.filter((item) => item.id !== targetId).map((item) => item.id);
    if (obsoleteIds.length) {
     await tx.cutoffInstallment.deleteMany({ where: { id: { in: obsoleteIds }, payments: { none: {} } } });
    }

    if (!targetExisting || existing.some((item) =>
     item.id === targetId && (item.amountCentavos !== outstanding ||
      dateKey(item.periodStart) !== targetPeriod.start || dateKey(item.periodEnd) !== targetPeriod.end)
    ) || obsoleteIds.length) {
     await appendAuditEntry(tx, {
      entityType: "CUTOFF_INSTALLMENT",
      entityId: targetId,
      eventType: "CUTOFF_INSTALLMENT_SCHEDULE_CONSOLIDATED",
      actorMemberId: session.id,
      idempotencyKey: randomUUID(),
      payload: {
       loanId: loan.id,
       publicCode: loan.publicCode,
       periodStart: targetPeriod.start,
       periodEnd: targetPeriod.end,
       dueAt: targetPeriod.due,
       amountCentavos: outstanding.toString(),
       method: "single-applicable-cutoff-full-outstanding-balance",
       priorInstallmentIds: obsoleteIds,
      },
     });
    }
   }, { maxWait: 10000, timeout: 15000 });
  }

  const installments = await prisma.cutoffInstallment.findMany({
   where: { loan: { id: { in: loanIds } } },
   include: {
    loan: { select: { id: true, publicCode: true, description: true, status: true, borrower: { select: { id: true, displayName: true } }, lender: { select: { id: true, displayName: true } } } },
    payments: { select: { id: true, amountCentavos: true, status: true, createdAt: true, paidAt: true, reversals: { select: { amountCentavos: true, status: true } } } },
   },
   orderBy: [{ periodStart: "asc" }, { dueAt: "asc" }],
  });

  return NextResponse.json({ installments: installments.map((item) => ({
   id: item.id,
   loanId: item.loanId,
   periodStart: dateKey(item.periodStart),
   periodEnd: dateKey(item.periodEnd),
   dueAt: dateKey(item.dueAt),
   amountCentavos: item.amountCentavos.toString(),
   note: item.note,
   loan: item.loan,
   payments: item.payments.map((payment) => ({
    ...payment,
    amountCentavos: payment.amountCentavos.toString(),
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    reversals: payment.reversals.map((reversal) => ({
     amountCentavos: reversal.amountCentavos.toString(),
     status: reversal.status,
    })),
   })),
  })) });
 } catch (error) {
  console.error("[cutoffs] Failed to load or generate cutoff schedule:", error);
  return NextResponse.json({ error: "Could not refresh the cutoff schedule. Check the Vercel function logs for /api/admin/cutoffs." }, { status: 500 });
 }
}

// Cutoff dates and amounts are generated from the shared schedule, not manually created per loan.
export async function POST(_request: NextRequest) {
 const session = await getAuthenticatedMember();
 if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
 return NextResponse.json({ error: "Manual cutoff creation is disabled. Refresh the automatic cutoff schedule instead." }, { status: 405 });
}
