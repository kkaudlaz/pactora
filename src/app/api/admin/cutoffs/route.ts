import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";
import { cutoffPeriodsBetween } from "@/lib/cutoff-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
 const session = await getAuthenticatedMember();
 if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
 const owned = await prisma.auditEntry.findMany({ where: { actorMemberId: session.id, entityType: "LOAN", eventType: "LOAN_DRAFT_CREATED" }, select: { entityId: true } });
 const loanIds = [...new Set(owned.map((entry) => entry.entityId))];
 // Generate missing installment rows for active, dated loans. Existing amounts/payment history are never overwritten.
 await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
  const loans = await tx.loan.findMany({ where: { id: { in: loanIds }, status: "ACTIVE", dueAt: { not: null } }, include: { cutoffInstallments: true } });
  for (const loan of loans) {
   if (!loan.dueAt || loan.dueAt < loan.borrowedAt) continue;
   const periods = cutoffPeriodsBetween(loan.borrowedAt, loan.dueAt);
   if (!periods.length) continue;
   // Migrate the previous initial Aug 27–Oct 7 preset into the agreed Aug 27–Oct 15 period without losing payments.
   const legacyInitial = loan.cutoffInstallments.find((item) => item.periodStart.toISOString().slice(0, 10) === "2026-08-27" && item.periodEnd.toISOString().slice(0, 10) === "2026-10-07");
   const currentInitial = loan.cutoffInstallments.some((item) => item.periodStart.toISOString().slice(0, 10) === "2026-08-27" && item.periodEnd.toISOString().slice(0, 10) === "2026-10-15");
   if (legacyInitial && !currentInitial) {
    await tx.cutoffInstallment.update({ where: { id: legacyInitial.id }, data: { periodEnd: new Date("2026-10-15T00:00:00.000Z"), dueAt: new Date("2026-10-15T00:00:00.000Z"), note: legacyInitial.note ? legacyInitial.note + " (period aligned to shared cutoff calendar)" : "Period aligned to shared cutoff calendar." } });
   }
   const existing = new Map(loan.cutoffInstallments.map((item) => {
    const start = item.periodStart.toISOString().slice(0, 10);
    const rawEnd = item.periodEnd.toISOString().slice(0, 10);
    const end = start === "2026-08-27" && rawEnd === "2026-10-07" && !currentInitial ? "2026-10-15" : rawEnd;
    return [start + ":" + end, item] as const;
   }));
   const missing = periods.filter((period) => !existing.has(period.start + ":" + period.end));
   if (!missing.length) continue;
   const alreadyScheduled = loan.cutoffInstallments.reduce((sum, item) => sum + item.amountCentavos, 0n);
   const remaining = loan.principalCentavos > alreadyScheduled ? loan.principalCentavos - alreadyScheduled : 0n;
   if (remaining <= 0n) continue;
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
    await appendAuditEntry(tx, { entityType: "CUTOFF_INSTALLMENT", entityId: created.id, eventType: "CUTOFF_INSTALLMENT_AUTO_GENERATED", actorMemberId: session.id, idempotencyKey: randomUUID(), payload: { loanId: loan.id, publicCode: loan.publicCode, periodStart: period.start, periodEnd: period.end, dueAt: period.due, amountCentavos: amountCentavos.toString(), method: "remaining-principal-evenly-divided-over-missing-periods" } });
   }
  }
 });
 const installments = await prisma.cutoffInstallment.findMany({
  where: { loan: { id: { in: loanIds } } },
  include: { loan: { select: { id: true, publicCode: true, description: true, status: true, borrower: { select: { id: true, displayName: true } }, lender: { select: { id: true, displayName: true } } } }, payments: { select: { id: true, amountCentavos: true, status: true, createdAt: true, paidAt: true, reversals: { select: { amountCentavos: true, status: true } } } } },
  orderBy: [{ periodStart: "asc" }, { dueAt: "asc" }],
 });
 return NextResponse.json({ installments: installments.map((item) => ({
  id: item.id, loanId: item.loanId, periodStart: item.periodStart.toISOString().slice(0, 10), periodEnd: item.periodEnd.toISOString().slice(0, 10), dueAt: item.dueAt.toISOString().slice(0, 10),
  amountCentavos: item.amountCentavos.toString(), note: item.note, loan: item.loan,
  payments: item.payments.map((payment) => ({ ...payment, amountCentavos: payment.amountCentavos.toString(), createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null, reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos.toString(), status: reversal.status })) })),
 })) });
}

// Cutoff dates and amounts are generated from the shared schedule, not manually created per loan.
export async function POST(_request: NextRequest) {
 const session = await getAuthenticatedMember();
 if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
 return NextResponse.json({ error: "Manual cutoff creation is disabled. Refresh the automatic cutoff schedule instead." }, { status: 405 });
}
