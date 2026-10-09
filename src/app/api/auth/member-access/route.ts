import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPin, hashAccessToken } from "@/lib/access";
import { isLoginLimited, recordLoginFailure, clearLoginFailures } from "@/lib/login-limit";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const accessSchema = z.object({ token: z.string().min(32).max(128), pin: z.string().regex(/^[0-9]{6,12}$/) });

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = accessSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "QR token or PIN is invalid." }, { status: 401 });
  const tokenHash = hashAccessToken(parsed.data.token);
  const grant = await prisma.accessGrant.findUnique({ where: { tokenHash }, include: { member: true } });
  if (!grant || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= new Date()) || grant.member.disabledAt || !grant.member.pinHash) {
    return NextResponse.json({ error: "QR token or PIN is invalid." }, { status: 401 });
  }
  const key = `member:${grant.memberId}`;
  if (isLoginLimited(key)) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (!await verifyPin(parsed.data.pin, grant.member.pinHash)) {
    recordLoginFailure(key);
    return NextResponse.json({ error: "QR token or PIN is invalid." }, { status: 401 });
  }
  clearLoginFailures(key);
  await prisma.accessGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } });
  const response = NextResponse.json({ member: { id: grant.member.id, memberUid: grant.member.memberUid, displayName: grant.member.displayName, role: grant.member.role } });
  return setSessionCookie(response, grant.member.id, grant.member.role);
}
