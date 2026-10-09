import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { clearLoginFailures, isLoginLimited, recordLoginFailure } from "@/lib/login-limit";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const key = `owner:${email}`;
  if (isLoginLimited(key)) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

  const member = await prisma.member.findUnique({ where: { email } });
  const valid = Boolean(member && member.role === "OWNER" && !member.disabledAt && member.passwordHash && await verifyPassword(parsed.data.password, member.passwordHash));
  if (!valid || !member) {
    recordLoginFailure(key);
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  clearLoginFailures(key);
  const response = NextResponse.json({ member: { id: member.id, displayName: member.displayName, role: member.role } });
  return setSessionCookie(response, member.id, member.role);
}
