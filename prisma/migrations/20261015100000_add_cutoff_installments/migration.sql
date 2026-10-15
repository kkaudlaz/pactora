ALTER TABLE "Payment"
ADD COLUMN "cutoffInstallmentId" TEXT;

CREATE TABLE "CutoffInstallment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueAt" DATE NOT NULL,
    "amountCentavos" BIGINT NOT NULL,
    "note" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CutoffInstallment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CutoffInstallment_loanId_periodStart_periodEnd_key"
ON "CutoffInstallment"("loanId", "periodStart", "periodEnd");

CREATE INDEX "CutoffInstallment_periodStart_periodEnd_dueAt_idx"
ON "CutoffInstallment"("periodStart", "periodEnd", "dueAt");

CREATE INDEX "CutoffInstallment_loanId_dueAt_idx"
ON "CutoffInstallment"("loanId", "dueAt");

CREATE INDEX "Payment_cutoffInstallmentId_idx"
ON "Payment"("cutoffInstallmentId");

ALTER TABLE "CutoffInstallment"
ADD CONSTRAINT "CutoffInstallment_loanId_fkey"
FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_cutoffInstallmentId_fkey"
FOREIGN KEY ("cutoffInstallmentId") REFERENCES "CutoffInstallment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
