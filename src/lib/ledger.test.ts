import { describe, expect, it } from "vitest";
import { assertValidLoanParties, assertValidPayment, calculateOutstandingCentavos, canSettle } from "./ledger";
import { parsePhpToCentavos } from "./money";

const payment = (id: string, amountCentavos: bigint, status: "PROPOSED" | "AWAITING_ACKNOWLEDGMENT" | "CONFIRMED" | "DISPUTED" | "REVERSED") => ({ id, amountCentavos, status });

describe("PHP amount parsing", () => {
  it("uses integer centavos", () => expect(parsePhpToCentavos("1,234.56")).toBe(123456n));
  it("rejects too many decimal places", () => expect(() => parsePhpToCentavos("12.345")).toThrow());
  it("rejects negative amounts", () => expect(() => parsePhpToCentavos("-10")).toThrow());
});

describe("confirmed ledger balances", () => {
  it("subtracts only confirmed payments", () => {
    expect(calculateOutstandingCentavos(100000n, [payment("a", 20000n, "CONFIRMED"), payment("b", 30000n, "PROPOSED"), payment("c", 10000n, "DISPUTED")])).toBe(80000n);
  });
  it("does not subtract reversed payments", () => expect(calculateOutstandingCentavos(10000n, [payment("a", 5000n, "REVERSED")])).toBe(10000n));
  it("never returns a negative outstanding balance", () => expect(calculateOutstandingCentavos(10000n, [payment("a", 12000n, "CONFIRMED")])).toBe(0n));
  it("settles only at zero confirmed balance", () => expect(canSettle(10000n, [payment("a", 10000n, "CONFIRMED")])).toBe(true));
});

describe("input validation", () => {
  it("requires different borrower and lender", () => expect(() => assertValidLoanParties("member-a", "member-a")).toThrow());
  it("rejects payments above the current balance", () => expect(() => assertValidPayment(200n, 100n)).toThrow());
});
