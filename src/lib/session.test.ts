import { describe, expect, it } from "vitest";
import { createSessionValue, verifySessionValue } from "./session";

process.env.SESSION_SECRET = "test-only-secret-with-more-than-32-bytes";

describe("signed session values", () => {
  it("accepts a valid unexpired session", () => {
    const now = 1_800_000_000_000;
    const token = createSessionValue("member_123", "MEMBER", now);
    expect(verifySessionValue(token, now)).toMatchObject({ memberId: "member_123", role: "MEMBER" });
  });
  it("rejects a tampered token", () => {
    const token = createSessionValue("member_123", "OWNER");
    expect(verifySessionValue(`${token}x`)).toBeNull();
  });
  it("rejects expired sessions", () => {
    const now = 1_800_000_000_000;
    expect(verifySessionValue(createSessionValue("member_123", "OWNER", now), now + 9 * 60 * 60 * 1000)).toBeNull();
  });
});
