import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { createAccessToken, hashAccessToken } from "@/lib/access";
import { appendAuditEntry } from "@/lib/audit";
import { idempotencyKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerSession() {
  const session = await getAuthenticatedMember();
  return session?.role === "OWNER" ? session : null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
  const session = await ownerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  const { memberId } = await context.params;
  if (!z.string().min(1).max(128).safeParse(memberId).success) return NextResponse.json({ error: "Invalid member." }, { status: 400 });
  const token = createAccessToken();
  try {
    const member = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(711772601)`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (prior) throw new Error("IDEMPOTENCY_REPLAY");
      const target = await tx.member.findUnique({ where: { id: memberId } });
      if (!target || target.disabledAt || target.role !== "MEMBER") throw new Error("MEMBER_NOT_FOUND");
      await tx.accessGrant.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accessGrant.create({ data: { memberId, tokenHash: hashAccessToken(token), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
      await appendAuditEntry(tx, { entityType: "MEMBER", entityId: memberId, eventType: "MEMBER_QR_ROTATED", actorMemberId: session.id, idempotencyKey, payload: { memberUid: target.memberUid, rotatedAt: new Date().toISOString(), expiryDays: 90 } });
      return { id: target.id, memberUid: target.memberUid, displayName: target.displayName };
    }, { isolationLevel: "Serializable" });
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    return NextResponse.json({ member, accessToken: token, accessUrl: `${appUrl}/access#token=${encodeURIComponent(token)}`, warning: "Previous QR grants were revoked. This new token is shown once." });
  } catch (error) {
    if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") return NextResponse.json({ error: "Active member not found." }, { status: 404 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_REPLAY") return NextResponse.json({ error: "This key was already used. Generate a new key to rotate the QR again." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
  const session = await ownerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  const { memberId } = await context.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(711772601)`;
      const prior = await tx.auditEntry.findUnique({ where: { idempotencyKey }, select: { entityId: true, entityType: true } });
      if (prior) {
        if (prior.entityType !== "MEMBER") throw new Error("IDEMPOTENCY_CONFLICT");
        return { revoked: 0, replay: true };
      }
      const member = await tx.member.findUnique({ where: { id: memberId }, select: { id: true, memberUid: true, role: true } });
      if (!member || member.role !== "MEMBER") throw new Error("MEMBER_NOT_FOUND");
      const now = new Date();
      const update = await tx.accessGrant.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: now } });
      await appendAuditEntry(tx, { entityType: "MEMBER", entityId: memberId, eventType: "MEMBER_QR_REVOKED", actorMemberId: session.id, idempotencyKey, payload: { memberUid: member.memberUid, revokedCount: update.count, revokedAt: now.toISOString() } });
      return { revoked: update.count, replay: false };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") return NextResponse.json({ error: "Member not found." }, { status: 404 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This idempotency key was used for another operation." }, { status: 409 });
    throw error;
  }
}
