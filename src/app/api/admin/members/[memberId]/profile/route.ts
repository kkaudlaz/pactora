import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateMemberSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { memberId } = await context.params;
  if (!z.string().min(1).max(128).safeParse(memberId).success) return NextResponse.json({ error: "Invalid member." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a name of at least 2 characters, a valid optional email, and a phone number of at most 40 characters." }, { status: 400 });
  const email = parsed.data.email?.trim().toLowerCase() || null;
  const phone = parsed.data.phone?.trim() || null;
  const ownership = await prisma.auditEntry.findFirst({ where: { actorMemberId: session.id, entityType: "MEMBER", entityId: memberId, eventType: "MEMBER_CREATED" }, select: { id: true } });
  if (!ownership) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (email && await prisma.member.findFirst({ where: { email, NOT: { id: memberId } }, select: { id: true } })) {
    return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const member = await tx.member.update({ where: { id: memberId }, data: { displayName: parsed.data.displayName, email, phone }, select: { id: true, memberUid: true, displayName: true, email: true, phone: true, role: true, createdAt: true } });
      await appendAuditEntry(tx, {
        entityType: "MEMBER", entityId: memberId, eventType: "MEMBER_PROFILE_UPDATED", actorMemberId: session.id,
        idempotencyKey: crypto.randomUUID(),
        payload: { displayName: member.displayName, email: member.email, phone: member.phone, updatedAt: new Date().toISOString() },
      });
      return member;
    });
    return NextResponse.json({ member: updated });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    throw error;
  }
}
