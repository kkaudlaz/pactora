import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { calculateOutstandingCentavos } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ memberId: string }> }) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { memberId } = await context.params;
  if (!memberId || memberId.length > 128) return NextResponse.json({ error: "Invalid member." }, { status: 400 });

  const ownership = await prisma.auditEntry.findFirst({ where: { actorMemberId: session.id, entityType: "MEMBER", entityId: memberId, eventType: "MEMBER_CREATED" }, select: { id: true } });
  if (!ownership) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const member = await prisma.member.findFirst({
    where: { id: memberId, disabledAt: null },
    select: { id: true, memberUid: true, displayName: true, email: true, role: true, createdAt: true,
      accessGrants: { where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } } },
  });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const records = await prisma.loan.findMany({
    where: { OR: [{ borrowerId: memberId }, { lenderId: memberId }] },
    include: {
      borrower: { select: { id: true, displayName: true, memberUid: true } },
      lender: { select: { id: true, displayName: true, memberUid: true } },
      payments: { include: { reversals: { select: { id: true, amountCentavos: true, reason: true, status: true, createdAt: true, confirmedAt: true } }, approvals: { include: { member: { select: { id: true, displayName: true } } } } }, orderBy: { createdAt: "desc" } },
      approvals: { include: { member: { select: { id: true, displayName: true } } }, orderBy: { decidedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const loans = records.map((loan) => ({
    id: loan.id, publicCode: loan.publicCode, category: loan.category, description: loan.description,
    principalCentavos: loan.principalCentavos.toString(), currency: loan.currency, repaymentTerms: loan.repaymentTerms,
    dueAt: loan.dueAt?.toISOString() ?? null, status: loan.status, termsVersion: loan.termsVersion,
    createdAt: loan.createdAt.toISOString(), borrower: loan.borrower, lender: loan.lender,
    outstandingCentavos: calculateOutstandingCentavos(loan.principalCentavos, loan.payments.map((payment) => ({
      id: payment.id, amountCentavos: payment.amountCentavos, status: payment.status,
      reversals: payment.reversals.map((reversal) => ({ amountCentavos: reversal.amountCentavos, status: reversal.status })),
    })).map((payment) => ({...payment, amountCentavos: payment.amountCentavos}))).toString(),
    approvals: loan.approvals.map((approval) => ({ id: approval.id, kind: approval.kind, decision: approval.decision, termsVersion: approval.termsVersion, decidedAt: approval.decidedAt.toISOString(), member: approval.member })),
    payments: loan.payments.map((payment) => ({
      id: payment.id, amountCentavos: payment.amountCentavos.toString(), method: payment.method, status: payment.status,
      paidAt: payment.paidAt?.toISOString() ?? null, reference: payment.reference, note: payment.note,
      createdByMemberId: payment.createdByMemberId, createdAt: payment.createdAt.toISOString(), confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      approvals: payment.approvals.map((approval) => ({ id: approval.id, decision: approval.decision, decidedAt: approval.decidedAt.toISOString(), member: approval.member })),
      reversals: payment.reversals.map((reversal) => ({ ...reversal, amountCentavos: reversal.amountCentavos.toString(), createdAt: reversal.createdAt.toISOString(), confirmedAt: reversal.confirmedAt?.toISOString() ?? null })),
    })),
  }));

  const entityIds = [memberId, ...records.map((loan) => loan.id), ...records.flatMap((loan) => [
    ...loan.payments.map((payment) => payment.id),
    ...loan.payments.flatMap((payment) => payment.reversals.map((reversal) => reversal.id)),
  ])];
  const audit = await prisma.auditEntry.findMany({
    where: { entityId: { in: entityIds } }, orderBy: { sequence: "desc" }, take: 200,
    select: { sequence: true, entityType: true, entityId: true, eventType: true, actorMemberId: true, createdAt: true, eventHash: true, previousHash: true },
  });
  return NextResponse.json({
    member: { id: member.id, memberUid: member.memberUid, displayName: member.displayName, email: member.email, role: member.role, createdAt: member.createdAt.toISOString(), hasActiveAccess: member.accessGrants.length > 0 },
    loans,
    audit: audit.map((entry) => ({ ...entry, sequence: entry.sequence.toString(), createdAt: entry.createdAt.toISOString() })),
  });
}
