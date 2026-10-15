CREATE TYPE "PersonalPurchaseType" AS ENUM ('CREDIT_CARD', 'INSTALLMENT');

CREATE TABLE "PersonalPurchase" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "purchaseType" "PersonalPurchaseType" NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "merchant" TEXT,
  "totalAmountCentavos" BIGINT NOT NULL,
  "downPaymentCentavos" BIGINT NOT NULL DEFAULT 0,
  "installmentCount" INTEGER,
  "statementDate" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonalPurchase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PersonalPurchasePayment" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalPurchasePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonalPurchasePayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PersonalPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PersonalPurchase_ownerId_createdAt_idx" ON "PersonalPurchase"("ownerId", "createdAt");
CREATE INDEX "PersonalPurchase_ownerId_dueAt_idx" ON "PersonalPurchase"("ownerId", "dueAt");
CREATE INDEX "PersonalPurchasePayment_purchaseId_paidAt_idx" ON "PersonalPurchasePayment"("purchaseId", "paidAt");
