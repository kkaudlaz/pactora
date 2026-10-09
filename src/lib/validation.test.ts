import { describe, expect, it } from "vitest";
import { createLoanDraftSchema, proposePaymentSchema } from "./validation";

const validLoan = { borrowerId: "member-a", lenderId: "member-b", category: "FOOD_GROCERIES", description: "Chicken and groceries", amountPhp: "350.50", repaymentTerms: "No interest; repay when agreed" };

describe("createLoanDraftSchema", () => {
  it("accepts valid draft terms", () => expect(createLoanDraftSchema.safeParse(validLoan).success).toBe(true));
  it("rejects same borrower and lender", () => expect(createLoanDraftSchema.safeParse({ ...validLoan, lenderId: "member-a" }).success).toBe(false));
  it("rejects fractional centavos", () => expect(createLoanDraftSchema.safeParse({ ...validLoan, amountPhp: "10.999" }).success).toBe(false));
  it("rejects blank purpose", () => expect(createLoanDraftSchema.safeParse({ ...validLoan, description: " " }).success).toBe(false));
});

describe("proposePaymentSchema", () => {
  it("accepts a cash payment proposal", () => expect(proposePaymentSchema.safeParse({ loanId: "loan-1", amountPhp: "100", method: "CASH" }).success).toBe(true));
  it("rejects invalid payment method", () => expect(proposePaymentSchema.safeParse({ loanId: "loan-1", amountPhp: "100", method: "CRYPTO" }).success).toBe(false));
  it("requires a reference for GCash", () => expect(proposePaymentSchema.safeParse({ loanId: "loan-1", amountPhp: "100", method: "GCASH" }).success).toBe(false));
  it("requires a reference for bank transfers", () => expect(proposePaymentSchema.safeParse({ loanId: "loan-1", amountPhp: "100", method: "BANK_TRANSFER", reference: " " }).success).toBe(false));
  it("accepts a referenced bank transfer", () => expect(proposePaymentSchema.safeParse({ loanId: "loan-1", amountPhp: "100", method: "BANK_TRANSFER", reference: "TXN-123" }).success).toBe(true));
});
