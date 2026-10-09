# Pactora

**Private financial records, built on trust.**

Pactora is a private family-and-friends ledger for recording loans, reimbursements, receipts, repayments, acknowledgments, and an auditable history of changes.

## Current implementation stage

This repository is the initial application foundation. The first milestone focuses on a usable responsive UI, a clear money-event domain model, and a safe database foundation. Blockchain integration is intentionally deferred until the core ledger and approval rules are tested.

### Product rules

- Store money as integer PHP centavos, never floating-point values.
- A draft or pending transfer is not a confirmed debt or payment.
- A payment only affects the confirmed balance after the required review/acknowledgment.
- Preserve confirmed events. Corrections are new events referencing the original; never silently rewrite financial history.
- QR links are revocable access credentials, not identities. A Member UID alone never grants access.
- Protect detailed member history behind a server-verified PIN and rate limits.
- Receipts, signatures, names, phone numbers, and other personal information stay off-chain.
- Blockchain receipts/hashes, if added later, are integrity evidence—not proof that a transfer happened or that a person legally agreed.

## Stack

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Zod validation
- Vitest for domain tests
- Later: private evidence storage, server-side PIN/session controls, and optional permissioned blockchain anchoring

## Development

Use Node.js 20.9+.

```bash
npm install
cp .env.example .env
npm run dev
```

The first UI milestone can run without a database using clearly labeled sample data. Database-backed operations require a PostgreSQL URL and the subsequent persistence/auth milestone.

```bash
npm run lint
npm run typecheck
npm test
```

## Environment

See .env.example. Never commit real credentials, PINs, personal records, GCash screenshots, or production data.

## Important safety note

The repository must be PRIVATE before any real financial or personal data is added. A private repository is still not a database or evidence vault. Use dedicated access-controlled production services for those records.

This is a software project, not legal, accounting, or lending advice. Before real-world use, review applicable Philippine privacy, electronic-transactions, and lending requirements.
