import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { parsePhpToCentavos } from "@/lib/money";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const owned = await prisma.auditEntry.findMany({ where: { actorMemberId: session.id, entityType: "LOAN", eventType: "LOAN_DRAFT_CREATED" }, select: { entityId: true } });
  const installments = await prisma.cutoffInstallment.findMany({
    where: { loan: { id: { in: owned.map((entry) => entry.entityId) } } },
    include: { loan: { select: { id: true, publicCode: true, description: true, status: true, borrower: { select: { id: true, displayName: true } }, lender: { select: { id: true, displayName: true } } } }, payments: { select: { id: true, amountCentavos: true, status: true, createdAt: true, paidAt: true, reversals: { select: { amountCentavos: true, status: true } } } } },
    orderBy: [{ periodStart: "asc" }, { dueAt: "asc" }],
  });
  return NextResponse.json({ installments: installments.map((item) => ({
    id: item.id, loanId: item.loanId, periodStart: item.periodStart.toISOString().slice(0, 10), periodEnd: item.periodEnd.toISOString().slice(0, 10), dueAt: item.dueAt.toISOString().slice(0, 10),
    amountCentavos: item.amountCentavos.toString(), note: item.note, loan: item.loan,
    payments: item.payments.map((payment) => ({ ...payment, amountCentavos: payment.amountCentavos.toString(), createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null, reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos.toString(), status: reversal.status })) })),
  })) });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const key = request.headers.get("idempotency-key");
  if (!key || !idempotencyKeySchema.safeParse(key).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Installment details are invalid." }, { status: 400 });
  const data = body as Record<string, unknown>;
  if (typeof data.loanId !== "string" || !validDate(data.periodStart) || !validDate(data.periodEnd) || !validDate(data.dueAt) || typeof data.amountPhp !== "string") {
    return NextResponse.json({ error: "Loan, cutoff start/end, due date, and amount are required." }, { status: 400 });
  }
  if (data.periodStart > data.periodEnd || data.dueAt < data.periodStart || data.dueAt > data.periodEnd) return NextResponse.json({ error: "Cutoff dates must be valid and the due date must fall within the cutoff." }, { status: 400 });
  let amountCentavos: bigint;
  try { amountCentavos = parsePhpToCentavos(data.amountPhp); } catch { return NextResponse.json({ error: "Enter a valid positive PHP amount." }, { status: 400 }); }
  if (amountCentavos <= 0n) return NextResponse.json({ error: "Installment amount must be greater than zero." }, { status: 400 });
  const owned = await prisma.auditEntry.findFirst({ where: { actorMemberId: session.id, entityType: "LOAN", entityId: data.loanId, eventType: "LOAN_DRAFT_CREATED" }, select: { entityId: true } });
  if (!owned) return NextResponse.json({ error: "Loan not found in this workspace." }, { status: 404 });
  try {
    const installment = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey: key }, select: { entityId: true, entityType: true, eventType: true } });
      if (prior) {
        if (prior.entityType !== "CUTOFF_INSTALLMENT" || prior.eventType !== "CUTOFF_INSTALLMENT_CREATED") throw new Error("IDEMPOTENCY_CONFLICT");
        return tx.cutoffInstallment.findUniqueOrThrow({ where: { id: prior.entityId } });
      }
      const overlap = await tx.cutoffInstallment.findFirst({ where: { loanId: data.loanId as string, periodStart: { lte: new Date(`${data.periodEnd}T00:00:00.000Z`) }, periodEnd: { gte: new Date(`${data.periodStart}T00:00:00.000Z`) } }, select: { id: true } });
      if (overlap) throw new Error("CUTOFF_PERIOD_OVERLAP");
      const created = await tx.cutoffInstallment.create({ data: {
        loanId: data.loanId as string, periodStart: new Date(`${data.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${data.periodEnd}T00:00:00.000Z`), dueAt: new Date(`${data.dueAt}T00:00:00.000Z`),
        amountCentavos, note: typeof data.note === "string" ? data.note.slice(0, 500) : null, createdByMemberId: session.id,
      } });
      await appendAuditEntry(tx, { entityType: "CUTOFF_INSTALLMENT", entityId: created.id, eventType: "CUTOFF_INSTALLMENT_CREATED", actorMemberId: session.id, idempotencyKey: key, payload: { loanId: created.loanId, periodStart: data.periodStart, periodEnd: data.periodEnd, dueAt: data.dueAt, amountCentavos: amountCentavos.toString() } });
      return created;
    });
    return NextResponse.json({ installment: { id: installment.id, loanId: installment.loanId, periodStart: installment.periodStart.toISOString().slice(0, 10), periodEnd: installment.periodEnd.toISOString().slice(0, 10), dueAt: installment.dueAt.toISOString().slice(0, 10), amountCentavos: installment.amountCentavos.toString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This idempotency key was already used for another operation." }, { status: 409 });
    if (error instanceof Error && error.message === "CUTOFF_PERIOD_OVERLAP") return NextResponse.json({ error: "This cutoff overlaps an existing cutoff for the same loan. Keep the Oct 8–15 gap unassigned and configure each period separately." }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "An installment already exists for this loan and cutoff. Edit or reuse that cutoff instead of duplicating it." }, { status: 409 });
    throw error;
  }
}
