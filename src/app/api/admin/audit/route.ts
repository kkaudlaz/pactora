import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const entries = await prisma.auditEntry.findMany({ where: { actorMemberId: session.id }, orderBy: { sequence: "desc" }, take: 100, select: { sequence: true, entityType: true, entityId: true, eventType: true, actorMemberId: true, payloadJson: true, payloadSha256: true, previousHash: true, eventHash: true, createdAt: true } });
  return NextResponse.json({ entries: entries.map((entry) => ({ ...entry, sequence: entry.sequence.toString(), createdAt: entry.createdAt.toISOString() })) });
}
