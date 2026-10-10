import { z } from "zod";

export const loanCategorySchema = z.enum(["FOOD_GROCERIES", "DELIVERY", "PERSONAL_CASH", "BILLS", "REIMBURSEMENT", "OTHER"]);
export const paymentMethodSchema = z.enum(["GCASH", "BANK_TRANSFER", "CASH", "OTHER"]);

export const createLoanDraftSchema = z.object({
  borrowerId: z.string().trim().min(1).max(128),
  lenderId: z.string().trim().min(1).max(128),
  category: loanCategorySchema,
  description: z.string().trim().min(1).max(500),
  amountPhp: z.string().trim().regex(/^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,2})?$/, "Use a PHP amount with at most two decimal places."),
  repaymentTerms: z.string().trim().min(1).max(2000),
  borrowedAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
}).refine((value) => value.borrowerId !== value.lenderId, {
  message: "Borrower and lender must be different members.",
  path: ["lenderId"],
});

export const proposePaymentSchema = z.object({
  loanId: z.string().trim().min(1).max(128),
  amountPhp: z.string().trim().regex(/^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,2})?$/, "Use a PHP amount with at most two decimal places."),
  method: paymentMethodSchema,
  paidAt: z.string().datetime().optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((value) => !["GCASH", "BANK_TRANSFER"].includes(value.method) || Boolean(value.reference?.trim()), {
  message: "A transaction reference is required for GCash and bank transfers.",
  path: ["reference"],
});

export const idempotencyKeySchema = z.string().uuid();
