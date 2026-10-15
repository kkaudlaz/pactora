import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMember: vi.fn(),
  findLoans: vi.fn(),
  findAudit: vi.fn(),
  findAuditFirst: vi.fn(),
  getAuthenticatedMember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findFirst: mocks.findMember },
    loan: { findMany: mocks.findLoans },
    auditEntry: { findFirst: mocks.findAuditFirst, findMany: mocks.findAudit },
  },
}));

vi.mock("@/lib/session", () => ({
  getAuthenticatedMember: mocks.getAuthenticatedMember,
}));

import { GET } from "./route";

describe("GET /api/admin/members/[memberId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAuditFirst.mockResolvedValue({ id: "ownership-entry" });
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

  it("returns safe member history and includes reversal IDs in audit lookup", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const confirmedAt = new Date("2026-01-02T00:00:00.000Z");
    mocks.getAuthenticatedMember.mockResolvedValue({ id: "owner-1", role: "OWNER" });
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      memberUid: "P-001",
      displayName: "Sample Member",
      email: "member@example.test",
      role: "MEMBER",
      createdAt,
      accessGrants: [{ id: "grant-1" }],
    });
    mocks.findLoans.mockResolvedValue([{
      id: "loan-1",
      publicCode: "L-001",
      category: "PERSONAL",
      description: "Test loan",
      principalCentavos: 10000n,
      currency: "PHP",
      repaymentTerms: "One payment",
      dueAt: null,
      status: "ACTIVE",
      termsVersion: 1,
      createdAt,
      borrower: { id: "member-1", displayName: "Sample Member", memberUid: "P-001" },
      lender: { id: "member-2", displayName: "Other Member", memberUid: "P-002" },
      payments: [{
        id: "payment-1",
        amountCentavos: 5000n,
        method: "GCASH",
        status: "CONFIRMED",
        paidAt: confirmedAt,
        reference: "REF-001",
        note: null,
        createdByMemberId: "member-1",
        createdAt,
        confirmedAt,
        reversals: [{
          id: "reversal-1",
          amountCentavos: 2000n,
          reason: "Partial correction",
          status: "CONFIRMED",
          createdAt,
          confirmedAt,
        }],
        approvals: [],
      }],
      approvals: [],
    }]);
    mocks.findAudit.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/admin/members/member-1"), {
      params: Promise.resolve({ memberId: "member-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.member).toMatchObject({
      id: "member-1",
      displayName: "Sample Member",
      hasActiveAccess: true,
    });
    expect(body.loans[0].outstandingCentavos).toBe("7000");
    expect(body.loans[0].payments[0].reversals[0]).toMatchObject({
      id: "reversal-1",
      amountCentavos: "2000",
      status: "CONFIRMED",
    });
    expect(mocks.findAudit).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityId: { in: expect.arrayContaining(["member-1", "loan-1", "payment-1", "reversal-1"]) } },
    }));
    expect(JSON.stringify(body)).not.toMatch(/pinHash|qrToken|accessToken/i);
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
