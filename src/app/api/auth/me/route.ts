import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ member: null }, { status: 401 });
  const member = await prisma.member.findUnique({ where: { id: session.memberId }, select: { id: true, displayName: true, role: true, disabledAt: true } });
  if (!member || member.disabledAt || member.role !== session.role) return NextResponse.json({ member: null }, { status: 401 });
  return NextResponse.json({ member: { id: member.id, displayName: member.displayName, role: member.role } });
}
