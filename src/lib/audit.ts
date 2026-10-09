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
  await tx.$queryRaw`SELECT 'locked'::text AS result FROM (SELECT pg_advisory_xact_lock(711772601)) AS lock_result`;
  const prior = await tx.auditEntry.findFirst({ orderBy: { sequence: "desc" }, select: { eventHash: true } });
  const canonicalPayload = canonicalJson(input.payload);
  const payloadSha256 = sha256(canonicalPayload);
  const previousHash = prior?.eventHash ?? null;
  const createdAt = new Date();
  const eventHash = sha256(JSON.stringify({ entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actorMemberId: input.actorMemberId ?? null, payloadSha256, previousHash, idempotencyKey: input.idempotencyKey, createdAt: createdAt.toISOString() }));
  return tx.auditEntry.create({ data: { entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actorMemberId: input.actorMemberId ?? null, payloadJson: input.payload as Prisma.InputJsonValue, payloadSha256, previousHash, eventHash, idempotencyKey: input.idempotencyKey, createdAt } });
}

export type AuditIntegrityRecord = {
  sequence: bigint | string | number; entityType: string; entityId: string; eventType: string;
  actorMemberId: string | null; payloadJson: unknown; payloadSha256: string; previousHash: string | null;
  eventHash: string; idempotencyKey: string; createdAt: Date | string;
};

/** Verify payload digests, event hashes, and continuity in ascending database sequence. */
export function verifyAuditChain(records: AuditIntegrityRecord[]): { ok: boolean; checked: number; firstInvalidSequence: string | null } {
  let previousHash: string | null = null;
  for (const [index, record] of records.entries()) {
    const sequence = String(record.sequence);
    const expectedPayloadHash = sha256(canonicalJson(record.payloadJson));
    if (expectedPayloadHash !== record.payloadSha256 || record.previousHash !== previousHash) return { ok: false, checked: index, firstInvalidSequence: sequence };
    const expectedEventHash = sha256(JSON.stringify({ entityType: record.entityType, entityId: record.entityId, eventType: record.eventType, actorMemberId: record.actorMemberId ?? null, payloadSha256: record.payloadSha256, previousHash: record.previousHash, idempotencyKey: record.idempotencyKey, createdAt: new Date(record.createdAt).toISOString() }));
    if (expectedEventHash !== record.eventHash) return { ok: false, checked: index, firstInvalidSequence: sequence };
    previousHash = record.eventHash;
  }
  return { ok: true, checked: records.length, firstInvalidSequence: null };
}
