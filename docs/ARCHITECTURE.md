# Pactora architecture

## Current branch implementation status

Implemented in the current local-MVP branch: owner password login, signed HttpOnly session cookies, server-side account revalidation, member QR bearer tokens with 90-day expiry/rotation/revocation, server-hashed PINs, member-scoped loan reads, loan draft creation, matching-term approval by both parties, payment proposal and counterparty acknowledgment, integer-centavo balance calculations, and a sequenced SHA-256 audit chain with verification endpoint.

Not implemented or not production-ready: private GCash/cash evidence object storage, drawn signatures, PIN recovery, full dispute and correction workflows, shared rate limiting across processes, monitoring/alerting, verified backup restoration, external security review, and blockchain anchoring. The in-memory login throttle is only a local-development guard. End-to-end CI for the latest branch must pass before relying on these workflows.

## Trust boundary

The browser is untrusted. It may display a prototype, but all real financial changes must be validated and authorized on the server. The member UID is an identifier, not an authenticator. QR tokens must be cryptographically random, stored only as hashes, scoped to a member, expiring/revocable, and followed by server-verified PIN checks. Apply rate limits to both token and PIN attempts.

## Data layers

1. **Web app:** responsive member and owner interfaces. Never treat client-side state as a source of truth.
2. **Application services:** validate input, authenticate actor, enforce loan/payment state transitions, check idempotency, write audit events in the same database transaction.
3. **PostgreSQL:** canonical operational state, integer-centavo amounts, versioned terms, approvals, payment status, and append-only event records.
4. **Private evidence storage:** GCash/bank screenshots and signature artifacts stored encrypted off-chain, with access-controlled object keys and retention rules. The database may store an evidence hash, never the image itself.
5. **Optional private blockchain:** later anchor confirmed event hashes/order. Do not store names, phone numbers, PINs, screenshots, signatures, or loan descriptions on-chain.

## Core state rules

- Loan: `DRAFT -> AWAITING_APPROVAL -> PENDING_VERIFICATION -> ACTIVE -> SETTLED`; any active record may enter `DISPUTED` when a legitimate conflict is raised. Cancellation is an explicit event and must not erase history.
- Payment: `PROPOSED -> AWAITING_ACKNOWLEDGMENT -> CONFIRMED`; disputes stay visible. Reversals/corrections append a new event referencing the original payment.
- Only confirmed, non-reversed payment events affect the confirmed balance. Evidence upload alone never confirms a transfer.
- Both parties approve the same frozen terms version/hash. Any amendment increments the version and requires new approval; old approvals remain auditable.
- Every mutating request needs an idempotency key. A retry must return the original result rather than duplicate a loan/payment.
- Write the operational change and an outbox/audit event atomically. Blockchain publishing is asynchronous and reconcilable; do not claim on-chain finality before the chain confirms it.

## Rollout phases

1. UI and domain model (current prototype).
2. PostgreSQL migrations, server-side service layer, and integration tests.
3. Owner authentication, member PIN verification, scoped QR grants, session security, and recovery.
4. Loan approvals, payment acknowledgments, private evidence upload, disputes, append-only corrections.
5. Idempotency/outbox/reconciliation and fault-injection tests.
6. Optional local permissioned blockchain prototype, then a limited family pilot.

## Security and privacy

- Keep this repository private before adding any personal or financial data. Never commit production records, screenshots, PINs, tokens, signing keys, or `.env` files.
- Production requires HTTPS, secure/HttpOnly/SameSite cookies, CSRF protection where applicable, strict server-side authorization, password/PIN hashing with a modern password-hashing algorithm, rate limiting, audit logging, encrypted backups, secret management, and a tested recovery procedure.
- A drawn signature is an acknowledgment artifact, not proof of identity by itself or a guarantee of legal enforceability.
- Hashes show integrity of a specific byte sequence; they do not prove a screenshot is authentic or that a payment occurred.
- Review applicable Philippine privacy, electronic-transactions, and lending obligations before real-world use.
