import { describe, expect, it } from "vitest";
import { createAccessToken, hashAccessToken, hashPin, verifyPin } from "./access";

describe("PIN protection", () => {
  it("hashes and verifies a valid PIN without storing it directly", async () => {
    const encoded = await hashPin("483920");
    expect(encoded).not.toContain("483920");
    expect(await verifyPin("483920", encoded)).toBe(true);
    expect(await verifyPin("483921", encoded)).toBe(false);
  });
  it("rejects short PINs", async () => await expect(hashPin("1234")).rejects.toThrow());
  it("fails closed on malformed hashes", async () => expect(await verifyPin("123456", "not-a-hash")).toBe(false));
});

describe("QR access tokens", () => {
  it("generates unique high-entropy tokens", () => expect(createAccessToken()).not.toBe(createAccessToken()));
  it("stores a stable digest instead of the raw token", () => {
    const token = createAccessToken();
    expect(hashAccessToken(token)).toBe(hashAccessToken(token));
    expect(hashAccessToken(token)).not.toBe(token);
  });
});
