CREATE TABLE "PaymentDestination" (
    "id" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT NOT NULL,
    "recipientName" TEXT,
    "accountLabel" TEXT,
    "qrImageData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentDestination_lenderId_method_provider_key"
    ON "PaymentDestination"("lenderId", "method", "provider");

CREATE INDEX "PaymentDestination_lenderId_method_idx"
    ON "PaymentDestination"("lenderId", "method");

ALTER TABLE "PaymentDestination"
    ADD CONSTRAINT "PaymentDestination_lenderId_fkey"
    FOREIGN KEY ("lenderId") REFERENCES "Member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
