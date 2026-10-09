# Domain model and invariants

## Money

All persisted amounts are integer PHP centavos (`BigInt` in Prisma). Parse decimal strings strictly; never use floating point for ledger arithmetic. Principal and payments must be positive. A payment must not exceed the outstanding confirmed amount unless a separately designed overpayment/refund flow is added.

## Loan agreement

A loan includes borrower, lender, category, description, principal, currency, repayment terms, optional due date, terms version, and terms hash. Borrower and lender must differ. A record is not an active obligation merely because an administrator typed it in. Both required parties must accept the exact terms version before activation.

## Payment

A payment records amount, method, timestamp, optional external reference, private evidence object key/hash, and status. Admin entry creates a proposal only. Confirmation requires the configured acknowledgment policy. Cash entries follow the same rule. Uploading a GCash screenshot is evidence for review, not automatic verification.

## Balance

The UI may show proposed payments separately, but the confirmed balance is computed only from confirmed payments and explicit, confirmed reversals. A disputed payment remains visible and is not silently counted as confirmed. Settled is a derived/validated state, not a free-form admin toggle.

## Audit and correction

Financial mutations create immutable events with actor, timestamp, versioned payload hash, prior event hash, idempotency key, and processing/chain status. Corrections append a compensating event with a reason and reference to the original. Never delete or overwrite a confirmed payment to repair history.

## Access

Member UID is non-secret. QR grant token is a high-entropy bearer secret, stored as a hash, and can be revoked. PINs must never be logged or stored in plain text. Detailed history requires PIN verification; acceptance and payment confirmation require an explicit action that identifies the exact terms/payment being accepted.
