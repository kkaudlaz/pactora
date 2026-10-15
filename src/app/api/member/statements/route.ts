import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const manilaToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const installments = await prisma.cutoffInstallment.findMany({
    where: { loan: { OR: [{ borrowerId: session.id }, { lenderId: session.id }] } },
    include: {
      loan: { select: {
        id: true, publicCode: true, description: true, status: true,
        borrower: { select: { id: true, displayName: true } },
        lender: { select: { id: true, displayName: true } },
      } },
      payments: { include: { reversals: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ periodStart: "desc" }, { periodEnd: "desc" }, { dueAt: "asc" }],
  });

  const today = manilaToday();
  const groups = new Map<string, {
    id: string; periodStart: string; periodEnd: string; dueAt: string;
    items: Array<Record<string, unknown>>; totalCentavos: bigint; paidCentavos: bigint;
    pendingCentavos: bigint; remainingCentavos: bigint; state: "PAST" | "CURRENT" | "UPCOMING";
  }>();

  for (const installment of installments) {
    const periodStart = installment.periodStart.toISOString().slice(0, 10);
    const periodEnd = installment.periodEnd.toISOString().slice(0, 10);
    const dueAt = installment.dueAt.toISOString().slice(0, 10);
    const id = periodStart + ":" + periodEnd;
    let group = groups.get(id);
    if (!group) {
      group = {
        id, periodStart, periodEnd, dueAt, items: [], totalCentavos: 0n, paidCentavos: 0n,
        pendingCentavos: 0n, remainingCentavos: 0n,
        state: today < periodStart ? "UPCOMING" : today <= periodEnd ? "CURRENT" : "PAST",
      };
      groups.set(id, group);
    }
    const confirmed = installment.payments.filter((p) => p.status === "CONFIRMED");
    const pending = installment.payments.filter((p) => p.status === "AWAITING_ACKNOWLEDGMENT");
    const net = (p: typeof installment.payments[number]) => p.amountCentavos - p.reversals
      .filter((r) => r.status === "CONFIRMED").reduce((sum, r) => sum + r.amountCentavos, 0n);
    const paid = confirmed.reduce((sum, p) => sum + net(p), 0n);
    const pendingAmount = pending.reduce((sum, p) => sum + net(p), 0n);
    const applied = paid + pendingAmount;
    const remaining = installment.amountCentavos > applied ? installment.amountCentavos - applied : 0n;
    group.totalCentavos += installment.amountCentavos;
    group.paidCentavos += paid;
    group.pendingCentavos += pendingAmount;
    group.remainingCentavos += remaining;
    group.items.push({
      id: installment.id, loanId: installment.loanId, dueAt,
      amountCentavos: installment.amountCentavos.toString(),
      paidCentavos: paid.toString(), pendingCentavos: pendingAmount.toString(),
      remainingCentavos: remaining.toString(), note: installment.note,
      loan: installment.loan,
      payments: installment.payments.map((p) => ({
        id: p.id, amountCentavos: p.amountCentavos.toString(), method: p.method,
        status: p.status, reference: p.reference, note: p.note,
        createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null,
        createdByMemberId: p.createdByMemberId,
      })),
    });
    if (dueAt < group.dueAt) group.dueAt = dueAt;
  }

  const statements = [...groups.values()]
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.periodEnd.localeCompare(a.periodEnd))
    .map((group) => ({
      ...group,
      totalCentavos: group.totalCentavos.toString(),
      paidCentavos: group.paidCentavos.toString(),
      pendingCentavos: group.pendingCentavos.toString(),
      remainingCentavos: group.remainingCentavos.toString(),
      items: group.items.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))),
    }));

  return NextResponse.json({ statements, today });
}
