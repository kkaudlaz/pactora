import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashAccessToken } from "@/lib/access";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Temporary convenience mode: the personal QR is the member's bearer credential. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string" || body.token.length < 32 || body.token.length > 128) {
    return NextResponse.json({ error: "Invalid personal QR link." }, { status: 401 });
  }
  const grant = await prisma.accessGrant.findUnique({ where: { tokenHash: hashAccessToken(body.token) }, include: { member: true } });
  if (!grant || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= new Date()) || grant.member.disabledAt || grant.member.role !== "MEMBER") {
    return NextResponse.json({ error: "This personal QR link is invalid or has expired. Ask the owner for a new one." }, { status: 401 });
  }
  await prisma.accessGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } });
  const response = NextResponse.json({ member: { id: grant.member.id, memberUid: grant.member.memberUid, displayName: grant.member.displayName, role: grant.member.role } });
  return setSessionCookie(response, grant.member.id, "MEMBER");
}
