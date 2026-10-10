-- Baseline for the existing Pactora PostgreSQL schema before the
-- 20261010120000_add_loan_borrowed_at and 20261010133000_add_member_phone migrations.
-- Existing production databases must mark this migration as applied; do not execute
-- this file against the existing production schema.
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "LoanStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'PENDING_VERIFICATION', 'ACTIVE', 'DISPUTED', 'SETTLED', 'CANCELLED');
CREATE TYPE "LoanCategory" AS ENUM ('FOOD_GROCERIES', 'DELIVERY', 'PERSONAL_CASH', 'BILLS', 'REIMBURSEMENT', 'OTHER');
CREATE TYPE "PaymentMethod" AS ENUM ('GCASH', 'BANK_TRANSFER', 'CASH', 'OTHER');
CREATE TYPE "PaymentStatus" AS ENUM ('PROPOSED', 'AWAITING_ACKNOWLEDGMENT', 'CONFIRMED', 'DISPUTED');
CREATE TYPE "ApprovalKind" AS ENUM ('LOAN_TERMS', 'PAYMENT', 'AMENDMENT');
CREATE TYPE "ReversalStatus" AS ENUM ('PROPOSED', 'AWAITING_ACKNOWLEDGMENT', 'CONFIRMED', 'DISPUTED');

CREATE TABLE "Member" (
  "id" TEXT NOT NULL,
  "memberUid" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "email" TEXT,
  "passwordHash" TEXT,
  "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
  "pinHash" TEXT,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Member_memberUid_key" ON "Member"("memberUid");
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

CREATE TABLE "Loan" (
  "id" TEXT NOT NULL,
  "publicCode" TEXT NOT NULL,
  "borrowerId" TEXT NOT NULL,
  "lenderId" TEXT NOT NULL,
  "category" "LoanCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "principalCentavos" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "repaymentTerms" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "status" "LoanStatus" NOT NULL DEFAULT 'DRAFT',
  "termsVersion" INTEGER NOT NULL DEFAULT 1,
  "termsHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Loan_publicCode_key" ON "Loan"("publicCode");
CREATE INDEX "Loan_borrowerId_status_idx" ON "Loan"("borrowerId", "status");
CREATE INDEX "Loan_lenderId_status_idx" ON "Loan"("lenderId", "status");

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PROPOSED',
  "paidAt" TIMESTAMP(3),
  "reference" TEXT,
  "evidenceObjectKey" TEXT,
  "evidenceSha256" TEXT,
  "note" TEXT,
  "createdByMemberId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Payment_loanId_status_idx" ON "Payment"("loanId", "status");

CREATE TABLE "Approval" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "paymentId" TEXT,
  "kind" "ApprovalKind" NOT NULL,
  "termsVersion" INTEGER,
  "payloadHash" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Approval_loanId_kind_decidedAt_idx" ON "Approval"("loanId", "kind", "decidedAt");

CREATE TABLE "LedgerEvent" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "paymentId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" JSONB NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "actorMemberId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "chainStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "chainTxId" TEXT,
  CONSTRAINT "LedgerEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerEvent_idempotencyKey_key" ON "LedgerEvent"("idempotencyKey");
CREATE INDEX "LedgerEvent_loanId_createdAt_idx" ON "LedgerEvent"("loanId", "createdAt");
CREATE INDEX "LedgerEvent_chainStatus_idx" ON "LedgerEvent"("chainStatus");

CREATE TABLE "AccessGrant" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccessGrant_tokenHash_key" ON "AccessGrant"("tokenHash");
CREATE INDEX "AccessGrant_memberId_revokedAt_idx" ON "AccessGrant"("memberId", "revokedAt");

CREATE TABLE "PaymentReversal" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ReversalStatus" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentReversal_paymentId_status_idx" ON "PaymentReversal"("paymentId", "status");

CREATE TABLE "AuditEntry" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorMemberId" TEXT,
  "payloadJson" JSONB NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuditEntry_sequence_key" ON "AuditEntry"("sequence");
CREATE UNIQUE INDEX "AuditEntry_idempotencyKey_key" ON "AuditEntry"("idempotencyKey");
CREATE INDEX "AuditEntry_entityType_entityId_createdAt_idx" ON "AuditEntry"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditEntry_createdAt_idx" ON "AuditEntry"("createdAt");

ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEvent" ADD CONSTRAINT "LedgerEvent_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEvent" ADD CONSTRAINT "LedgerEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
