import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { verifyAuditChain } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const entries = await prisma.auditEntry.findMany({ orderBy: { sequence: "asc" }, select: { sequence: true, entityType: true, entityId: true, eventType: true, actorMemberId: true, payloadJson: true, payloadSha256: true, previousHash: true, eventHash: true, idempotencyKey: true, createdAt: true } });
  const result = verifyAuditChain(entries);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
