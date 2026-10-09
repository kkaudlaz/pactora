# Security policy

## Reporting

Please do not publish real member information, screenshots, access tokens, PINs, or suspected vulnerabilities in public issues. Contact the repository owner privately through GitHub to report security concerns.

## Current maturity

Pactora is a local development MVP foundation, not a production-ready financial service. The current branch includes owner sign-in, member QR + PIN access, loan draft/approval APIs, payment proposal/acknowledgment APIs, and a hash-chained audit log. These workflows have not yet completed end-to-end validation on the latest branch. Private evidence uploads, signatures, PIN recovery, full dispute/correction workflows, shared distributed rate limiting, monitoring, and backup/restore drills remain incomplete. Do not deploy publicly or enter real financial data yet.

## Data handling

Never commit `.env`, database dumps, production data, GCash screenshots, signatures, member PINs, QR tokens, or blockchain keys. Rotate any secret that is accidentally exposed. Treat repository access and production data access as separate permissions. QR access URLs are bearer credentials: issue them privately, rotate them when lost, and do not post them in issues or chat rooms.

## Before a family pilot

- Set the repository to private and restrict collaborator access.
- Use HTTPS, managed secrets, secure backups, and a tested restore procedure.
- Replace in-memory login throttling with a shared rate-limit store and configure edge-level controls.
- Complete private evidence storage, retention/deletion policies, member recovery, and dispute/correction flows.
- Validate audit integrity and idempotency under retries/concurrent requests; review production logs for sensitive data.
- Obtain an appropriate security and legal/privacy review for applicable Philippine requirements.
