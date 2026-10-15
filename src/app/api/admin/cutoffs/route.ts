import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { cutoffPeriodsBetween } from "@/lib/cutoff-schedule";

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

   const hasLegacyInitial = candidate.cutoffInstallments.some((item) =>
    dateKey(item.periodStart) === initialStart && dateKey(item.periodEnd) === legacyInitialEnd
   );
   const hasAgreedInitial = candidate.cutoffInstallments.some((item) =>
    dateKey(item.periodStart) === initialStart && dateKey(item.periodEnd) === agreedInitialEnd
   );
   const existingKeys = new Set(candidate.cutoffInstallments.map((item) => {
    const start = dateKey(item.periodStart);
    const rawEnd = dateKey(item.periodEnd);
    const end = start === initialStart && rawEnd === legacyInitialEnd && !hasAgreedInitial ? agreedInitialEnd : rawEnd;
    return start + ":" + end;
   }));
   const needsGeneration = periods.some((period) => !existingKeys.has(period.start + ":" + period.end));
   if (!needsGeneration && (!hasLegacyInitial || hasAgreedInitial)) continue;

   // Keep each transaction bounded to one loan. The former all-loans transaction
   // exceeded Prisma's 5-second interactive transaction limit with many audit writes.
   // The global advisory lock serializes audit-chain updates and makes concurrent refreshes safe.
   await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
    const loan = await tx.loan.findFirst({
     where: { id: candidate.id, status: "ACTIVE", dueAt: { not: null } },
     include: { cutoffInstallments: true },
    });
    if (!loan?.dueAt || loan.dueAt < loan.borrowedAt) return;

    const currentPeriods = cutoffPeriodsBetween(loan.borrowedAt, loan.dueAt);
    if (!currentPeriods.length) return;

    const legacyInitial = loan.cutoffInstallments.find((item) =>
     dateKey(item.periodStart) === initialStart && dateKey(item.periodEnd) === legacyInitialEnd
    );
    const currentInitial = loan.cutoffInstallments.some((item) =>
     dateKey(item.periodStart) === initialStart && dateKey(item.periodEnd) === agreedInitialEnd
    );
    if (legacyInitial && !currentInitial) {
     await tx.cutoffInstallment.update({
      where: { id: legacyInitial.id },
      data: {
       periodEnd: new Date(agreedInitialEnd + "T00:00:00.000Z"),
       dueAt: new Date(agreedInitialEnd + "T00:00:00.000Z"),
       note: legacyInitial.note
        ? legacyInitial.note + " (period aligned to shared cutoff calendar)"
        : "Period aligned to shared cutoff calendar.",
      },
     });
    }

    const existing = new Set(loan.cutoffInstallments.map((item) => {
     const start = dateKey(item.periodStart);
     const rawEnd = dateKey(item.periodEnd);
     const end = start === initialStart && rawEnd === legacyInitialEnd && !currentInitial ? agreedInitialEnd : rawEnd;
     return start + ":" + end;
    }));
    const missing = currentPeriods.filter((period) => !existing.has(period.start + ":" + period.end));
    if (!missing.length) return;

    const alreadyScheduled = loan.cutoffInstallments.reduce((sum, item) => sum + item.amountCentavos, 0n);
    const remaining = loan.principalCentavos > alreadyScheduled ? loan.principalCentavos - alreadyScheduled : 0n;
    if (remaining <= 0n) return;

    const base = remaining / BigInt(missing.length);
    let remainder = remaining % BigInt(missing.length);
    for (const period of missing) {
     const amountCentavos = base + (remainder > 0n ? 1n : 0n);
     if (remainder > 0n) remainder -= 1n;
     if (amountCentavos <= 0n) continue;

     const created = await tx.cutoffInstallment.create({ data: {
      loanId: loan.id,
      periodStart: new Date(period.start + "T00:00:00.000Z"),
      periodEnd: new Date(period.end + "T00:00:00.000Z"),
      dueAt: new Date(period.due + "T00:00:00.000Z"),
      amountCentavos,
      note: "Automatically calculated from the remaining loan principal across scheduled cutoff periods.",
      createdByMemberId: session.id,
     } });
     await appendAuditEntry(tx, {
      entityType: "CUTOFF_INSTALLMENT",
      entityId: created.id,
      eventType: "CUTOFF_INSTALLMENT_AUTO_GENERATED",
      actorMemberId: session.id,
      idempotencyKey: randomUUID(),
      payload: {
       loanId: loan.id,
       publicCode: loan.publicCode,
       periodStart: period.start,
       periodEnd: period.end,
       dueAt: period.due,
       amountCentavos: amountCentavos.toString(),
       method: "remaining-principal-evenly-divided-over-missing-periods",
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
