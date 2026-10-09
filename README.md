# Pactora

**Private financial records, built on trust.**

Pactora is a private family-and-friends ledger for loans, reimbursements, receipts, repayments, acknowledgments, and auditable history. Blockchain is an optional behind-the-scenes integrity layer, not a user-facing requirement.

## Status: early prototype

The current branch contains a responsive dashboard prototype, a safe integer-centavo domain layer with tests, initial PostgreSQL/Prisma models, request schemas, a database health endpoint, and CI checks. Dashboard sample data and draft changes live only in browser memory. **Owner login, server-side PIN/QR access, durable loan/payment APIs, private evidence uploads, and blockchain integration are not implemented yet. Do not use this version for real financial records.**

## Stack

- Node.js 20
- Next.js App Router + React + TypeScript
- PostgreSQL + Prisma
- Zod input schemas
- Vitest domain tests
- GitHub Actions CI

## Run locally

Install Node.js 20 and Docker Desktop. From the repository root:

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npx prisma generate
npx prisma db push
npm run dev
```

Open `http://localhost:3000`. The UI is a sample-data prototype. The database health endpoint is `http://localhost:3000/api/health`.

On Windows PowerShell, copy the environment file with:

```powershell
Copy-Item .env.example .env
```

To stop the local database, run `docker compose down`. To also remove its local development data, run `docker compose down -v` (destructive).

## Validate

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Product invariants

- Store money as integer PHP centavos, never floating-point values.
- Drafts and pending transfers are not confirmed debts or payments.
- Only confirmed payments affect the confirmed balance; reversals are separate records.
- Preserve confirmed events. Corrections append events referencing originals.
- Member UID is not a credential. QR grants must be random, scoped, revocable, and stored as hashes; detailed access requires a server-verified PIN and rate limiting.
- Receipts, signatures, names, phone numbers, PINs, and tokens stay off-chain. Private evidence files must live in access-controlled encrypted storage, not GitHub.
- A receipt screenshot does not independently prove a transfer succeeded; a drawn signature alone does not prove identity or guarantee legal enforceability.

## Security

**Set this repository to Private before adding any sensitive project information.** A private GitHub repository is still not a database or evidence vault. Never commit `.env`, production records, GCash screenshots, signatures, member PINs, QR tokens, or signing keys. See [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Before real-world use, complete server-side authentication/authorization, privacy controls, rate limiting, durable event/idempotency transactions, private evidence storage, recovery tests, and a security review. Review applicable Philippine privacy, electronic-transactions, and lending requirements.
