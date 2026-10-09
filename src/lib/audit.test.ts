import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "./audit";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function record() {
  const payloadJson = { b: 2, a: 1 };
  const payloadSha256 = sha256("{\"a\":1,\"b\":2}");
  const idempotencyKey = "11111111-1111-4111-8111-111111111111";
  const event = { entityType: "LOAN", entityId: "loan-1", eventType: "CREATED", actorMemberId: "member-1", payloadSha256, previousHash: null, idempotencyKey };
  return { sequence: 1n, ...event, payloadJson, eventHash: sha256(JSON.stringify(event)) };
}

describe("audit hash chain", () => {
  it("accepts a valid event hash and payload digest", () => expect(verifyAuditChain([record()])).toEqual({ ok: true, checked: 1, firstInvalidSequence: null }));
  it("detects a modified payload", () => expect(verifyAuditChain([{ ...record(), payloadJson: { a: 9 } }])).toMatchObject({ ok: false, firstInvalidSequence: "1" }));
  it("detects a broken previous-hash link", () => expect(verifyAuditChain([{ ...record(), previousHash: "broken" }])).toMatchObject({ ok: false, firstInvalidSequence: "1" }));
  it("accepts an empty ledger", () => expect(verifyAuditChain([])).toMatchObject({ ok: true, checked: 0 }));
});
