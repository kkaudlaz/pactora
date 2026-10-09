import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("owner password hashing", () => {
  it("hashes a password and verifies it without embedding the password", async () => {
    const encoded = await hashPassword("a-long-unique-password");
    expect(encoded).not.toContain("a-long-unique-password");
    expect(await verifyPassword("a-long-unique-password", encoded)).toBe(true);
    expect(await verifyPassword("a-long-unique-passw0rd", encoded)).toBe(false);
  });
  it("rejects short passwords when creating a hash", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });
  it("fails closed for malformed hashes", async () => {
    expect(await verifyPassword("some-password", "invalid")).toBe(false);
  });
});
