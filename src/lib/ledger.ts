export type PaymentState = "PROPOSED" | "AWAITING_ACKNOWLEDGMENT" | "CONFIRMED" | "DISPUTED" | "REVERSED";

export interface PaymentForBalance {
  amountCentavos: bigint;
  status: PaymentState;
  reversesPaymentId?: string | null;
  id: string;
}

/** Only confirmed payments reduce the outstanding principal. Proposed and disputed payments do not. */
export function calculateOutstandingCentavos(principalCentavos: bigint, payments: PaymentForBalance[]): bigint {
  const confirmed = payments.reduce((sum, payment) => {
    if (payment.status !== "CONFIRMED") return sum;
    return sum + payment.amountCentavos;
  }, 0n);
  const outstanding = principalCentavos - confirmed;
  return outstanding > 0n ? outstanding : 0n;
}

export function canSettle(principalCentavos: bigint, payments: PaymentForBalance[]): boolean {
  return calculateOutstandingCentavos(principalCentavos, payments) === 0n;
}

export function assertValidLoanParties(borrowerId: string, lenderId: string): void {
  if (!borrowerId.trim() || !lenderId.trim()) throw new Error("Borrower and lender are required.");
  if (borrowerId === lenderId) throw new Error("Borrower and lender must be different members.");
}

export function assertValidPayment(amountCentavos: bigint, outstandingCentavos: bigint): void {
  if (amountCentavos <= 0n) throw new Error("Payment amount must be greater than zero.");
  if (amountCentavos > outstandingCentavos) throw new Error("Payment exceeds the outstanding balance.");
}
