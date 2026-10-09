import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMember: vi.fn(),
  findLoans: vi.fn(),
  findAudit: vi.fn(),
  getAuthenticatedMember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findFirst: mocks.findMember },
    loan: { findMany: mocks.findLoans },
    auditEntry: { findMany: mocks.findAudit },
  },
}));

vi.mock("@/lib/session", () => ({
  getAuthenticatedMember: mocks.getAuthenticatedMember,
}));

import { GET } from "./route";

describe("GET /api/admin/members/[memberId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests before querying member history", async () => {
    mocks.getAuthenticatedMember.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/members/member-1"), {
      params: Promise.resolve({ memberId: "member-1" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.findMember).not.toHaveBeenCalled();
    expect(mocks.findLoans).not.toHaveBeenCalled();
    expect(mocks.findAudit).not.toHaveBeenCalled();
  });

  it("rejects non-owner sessions", async () => {
    mocks.getAuthenticatedMember.mockResolvedValue({ id: "member-2", role: "MEMBER" });

    const response = await GET(new Request("http://localhost/api/admin/members/member-1"), {
      params: Promise.resolve({ memberId: "member-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.findMember).not.toHaveBeenCalled();
  });

  it("returns not found for a missing or disabled member", async () => {
    mocks.getAuthenticatedMember.mockResolvedValue({ id: "owner-1", role: "OWNER" });
    mocks.findMember.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/members/missing"), {
      params: Promise.resolve({ memberId: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Member not found." });
    expect(mocks.findLoans).not.toHaveBeenCalled();
    expect(mocks.findAudit).not.toHaveBeenCalled();
  });

  it("rejects malformed member identifiers before querying the database", async () => {
    mocks.getAuthenticatedMember.mockResolvedValue({ id: "owner-1", role: "OWNER" });

    const response = await GET(new Request("http://localhost/api/admin/members/"), {
      params: Promise.resolve({ memberId: "" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.findMember).not.toHaveBeenCalled();
  });
});
