# Pactora

**Private financial records, built on trust.**

Pactora is a private family-and-friends ledger for loans, repayments, member acknowledgments, and an append-only audit history. Blockchain is an optional behind-the-scenes integrity layer, not a user-facing requirement.

## Current milestone: local MVP foundation

This branch now includes:

- A responsive sample-data dashboard at `/` and a separate authenticated owner workspace at `/workspace`.
- Owner sign-in with scrypt password hashing, HMAC-signed HttpOnly sessions, and bounded login-attempt throttling.
- Member creation with a server-hashed 6–12 digit PIN and a random QR bearer token whose hash is stored in PostgreSQL.
- Member QR + PIN sign-in at `/access` and a private member dashboard at `/member`.
- Database-backed loan drafts; both borrower and lender must approve the exact same terms hash/version before a loan becomes active.
- Payment proposals; the other party must acknowledge a proposal before it changes the confirmed balance.
- Integer-centavo arithmetic, idempotency keys, transactional audit entries, and a serialized SHA-256 hash chain.
- Prisma/PostgreSQL, Vitest tests, local Docker Compose, and GitHub Actions CI.

**Still incomplete:** GCash/cash evidence uploads, signatures, member/PIN recovery, full dispute/correction UI, durable shared rate limiting, audit verification tooling, automated database backup/restore tests, and optional blockchain anchoring. This is a local development milestone, not a production-ready financial service. Do not enter real family financial data until the remaining security and privacy work is complete.

## Stack

- Node.js 20
- Next.js App Router + React + TypeScript
- PostgreSQL + Prisma
- Zod validation and Vitest tests
- GitHub Actions CI

## Run locally on Windows

Install Node.js 20 and Docker Desktop, then open PowerShell in the repository folder.

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npx prisma generate
npx prisma db push
```

Open `.env` and replace `SESSION_SECRET` with a fresh random value. Generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Copy the output into `.env` as `SESSION_SECRET="..."`. Do not commit `.env`.

Bootstrap the owner account from the same PowerShell window. These variables are read only by the one-time seed command and are not written into repository files:

```powershell
$env:OWNER_EMAIL = "you@example.com"
$env:OWNER_DISPLAY_NAME = "Workspace Owner"
$securePassword = Read-Host "Enter a unique password (12+ characters)" -AsSecureString
$env:OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run seed:owner
Remove-Item Env:OWNER_PASSWORD
Remove-Item Env:OWNER_EMAIL
Remove-Item Env:OWNER_DISPLAY_NAME
```

Then start the app:

```powershell
npm run dev
```

Open `http://localhost:3000`. The root route is a **sample-data visual preview**. Choose **Open secure workspace** or go to `http://localhost:3000/login` to sign in. Create member profiles in **Members & access**; scan a member QR link on the device that member will use, enter their PIN, and visit `/member`. Create a loan draft, then sign in as each party to approve the same terms. Once active, either party can propose a payment and the other party must acknowledge it.

The database health endpoint is `http://localhost:3000/api/health`.

To stop the local database, run `docker compose down`. To also delete the local development database volume, run `docker compose down -v` (destructive).

## Validate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## Ledger and trust invariants

- Store money as integer PHP centavos, never floating-point values.
- A draft is not an active debt. Both parties must accept the same frozen terms hash/version.
- A proposed payment does not reduce the confirmed balance until the other party acknowledges it.
- Confirmed history is corrected with additional records, not silently overwritten.
- Member UID is an identifier, not a secret. QR grants use random bearer tokens; only token hashes are persisted.
- Screenshots and transaction references are supporting evidence, not automatic proof that a transfer happened.
- Never put personal data, PINs, raw QR tokens, screenshots, signatures, or secrets on a blockchain. Blockchain anchoring is not yet implemented.

## Security limits to address before deployment

The current login throttle is in-memory and per application process. It is useful for local development but is not sufficient for a multi-instance deployment; production requires a shared rate-limit store and edge controls. Configure HTTPS, secure cookies, secret management, private evidence storage, backup/restore drills, monitoring, and a security review before any real-world pilot. A drawn signature alone does not prove identity or guarantee legal enforceability. Review applicable Philippine privacy, electronic-transactions, and lending requirements.

**Set this repository to Private before adding any sensitive project information.** A private GitHub repository is still not a database or evidence vault. Never commit `.env`, production records, GCash screenshots, signatures, member PINs, QR tokens, or signing keys. See [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
