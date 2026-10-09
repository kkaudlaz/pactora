import { describe, expect, it } from "vitest";
import { clearLoginFailures, isLoginLimited, recordLoginFailure } from "./login-limit";

describe("login attempt throttle", () => {
  it("blocks repeated failed attempts and clears after success", () => {
    const key = `test-${crypto.randomUUID()}`;
    expect(isLoginLimited(key)).toBe(false);
    for (let i = 0; i < 8; i++) recordLoginFailure(key);
    expect(isLoginLimited(key)).toBe(true);
    clearLoginFailures(key);
    expect(isLoginLimited(key)).toBe(false);
  });
});
