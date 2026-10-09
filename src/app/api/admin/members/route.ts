import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { hashPin, createAccessToken, hashAccessToken } from "@/lib/access";
import { appendAuditEntry } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const createMemberSchema = z.object({ displayName: z.string().trim().min(2).max(100), pin: z.string().regex(/^[0-9]{6,12}$/), email: z.string().trim().email().max(254).optional() });

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const members = await prisma.member.findMany({ where: { disabledAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, memberUid: true, displayName: true, email: true, role: true, createdAt: true, accessGrants: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } } } });
  return NextResponse.json({ members: members.map(({ accessGrants, ...member }) => ({ ...member, hasActiveAccess: accessGrants.length > 0 })) });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = createMemberSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Provide a name, a 6–12 digit PIN, and an optional valid email." }, { status: 400 });
  const email = parsed.data.email?.toLowerCase();
  if (email && await prisma.member.findUnique({ where: { email }, select: { id: true } })) return NextResponse.json({ error: "That email is already in use." }, { status: 409 });

  const token = createAccessToken();
  const pinHash = await hashPin(parsed.data.pin);
  try {
    const member = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
      const created = await tx.member.create({ data: { displayName: parsed.data.displayName, email, role: "MEMBER", pinHash } });
      await tx.accessGrant.create({ data: { memberId: created.id, tokenHash: hashAccessToken(token), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
      await appendAuditEntry(tx, { entityType: "MEMBER", entityId: created.id, eventType: "MEMBER_CREATED", actorMemberId: session.id, idempotencyKey, payload: { displayName: created.displayName, memberUid: created.memberUid, role: created.role } });
      return { id: created.id, memberUid: created.memberUid, displayName: created.displayName, email: created.email, role: created.role, createdAt: created.createdAt };
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.json({ member, accessToken: token, accessUrl: `${appUrl}/access#token=${encodeURIComponent(token)}`, warning: "Copy or encode the QR access URL now. The raw token is shown once; only its hash is stored." }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "That member or idempotency key already exists." }, { status: 409 });
    throw error;
  }
}
