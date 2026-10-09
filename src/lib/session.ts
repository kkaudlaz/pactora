import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "pactora_session";
const SESSION_SECONDS = 60 * 60 * 8;
export type SessionClaims = { memberId: string; role: "OWNER" | "MEMBER"; exp: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32 || value.includes("replace-with")) {
    throw new Error("SESSION_SECRET must be a strong random secret of at least 32 bytes.");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionValue(memberId: string, role: SessionClaims["role"], now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ memberId, role, exp: Math.floor(now / 1000) + SESSION_SECONDS } satisfies SessionClaims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string, now = Date.now()): SessionClaims | null {
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.memberId !== "string" || !claims.memberId || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) return null;
    if (claims.role !== "OWNER" && claims.role !== "MEMBER") return null;
    return claims;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  return value ? verifySessionValue(value) : null;
}

export function setSessionCookie(response: NextResponse, memberId: string, role: SessionClaims["role"]): NextResponse {
  response.cookies.set(SESSION_COOKIE, createSessionValue(memberId, role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

/** Re-check the live member record on every protected API request so disabled accounts lose access immediately. */
export async function getAuthenticatedMember() {
  const session = await getSession();
  if (!session) return null;
  const member = await prisma.member.findUnique({ where: { id: session.memberId }, select: { id: true, memberUid: true, displayName: true, role: true, disabledAt: true } });
  if (!member || member.disabledAt || member.role !== session.role) return null;
  return { id: member.id, memberUid: member.memberUid, displayName: member.displayName, role: member.role };
}
