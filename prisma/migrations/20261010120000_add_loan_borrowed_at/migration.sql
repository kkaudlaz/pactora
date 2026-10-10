ALTER TABLE "Loan" ADD COLUMN "borrowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Existing records retain their creation date as the best available historical approximation.
UPDATE "Loan" SET "borrowedAt" = "createdAt";
