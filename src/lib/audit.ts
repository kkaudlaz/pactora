import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export async function appendAuditEntry(
  tx: Prisma.TransactionClient,
  input: { entityType: string; entityId: string; eventType: string; actorMemberId?: string | null; payload: Record<string, unknown>; idempotencyKey: string },
) {
  // Serialize append operations so two concurrent writes cannot fork the global hash chain.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(711772601)`;
  const prior = await tx.auditEntry.findFirst({ orderBy: { sequence: "desc" }, select: { eventHash: true } });
  const canonicalPayload = canonicalJson(input.payload);
  const payloadSha256 = sha256(canonicalPayload);
  const previousHash = prior?.eventHash ?? null;
  const eventHash = sha256(JSON.stringify({ entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actorMemberId: input.actorMemberId ?? null, payloadSha256, previousHash, idempotencyKey: input.idempotencyKey }));
  return tx.auditEntry.create({ data: { entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actorMemberId: input.actorMemberId ?? null, payloadJson: input.payload as Prisma.InputJsonValue, payloadSha256, previousHash, eventHash, idempotencyKey: input.idempotencyKey } });
}
