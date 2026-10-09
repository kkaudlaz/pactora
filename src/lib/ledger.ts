export type PaymentState = "PROPOSED" | "AWAITING_ACKNOWLEDGMENT" | "CONFIRMED" | "DISPUTED";
export type ReversalState = "PROPOSED" | "AWAITING_ACKNOWLEDGMENT" | "CONFIRMED" | "DISPUTED";

export interface ReversalForBalance {
  amountCentavos: bigint;
  status: ReversalState;
}

export interface PaymentForBalance {
  amountCentavos: bigint;
  status: PaymentState;
  id: string;
  reversals?: ReversalForBalance[];
}

/** Only confirmed payments reduce the balance; separately confirmed reversals restore it. */
export function calculateOutstandingCentavos(principalCentavos: bigint, payments: PaymentForBalance[]): bigint {
  const netPaid = payments.reduce((sum, payment) => {
    if (payment.status !== "CONFIRMED") return sum;
    const confirmedReversals = (payment.reversals ?? []).reduce(
      (reversalSum, reversal) => reversal.status === "CONFIRMED" ? reversalSum + reversal.amountCentavos : reversalSum,
      0n,
    );
    return sum + payment.amountCentavos - confirmedReversals;
  }, 0n);
  const outstanding = principalCentavos - netPaid;
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

export function assertValidReversal(amountCentavos: bigint, originalPaymentCentavos: bigint, alreadyReversedCentavos: bigint): void {
  if (amountCentavos <= 0n) throw new Error("Reversal amount must be greater than zero.");
  if (alreadyReversedCentavos < 0n || alreadyReversedCentavos + amountCentavos > originalPaymentCentavos) {
    throw new Error("Total reversals cannot exceed the original payment amount.");
  }
}
