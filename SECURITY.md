# Security policy

## Reporting

Please do not publish real member information, screenshots, access tokens, PINs, or suspected vulnerabilities in public issues. Contact the repository owner privately through GitHub to report security concerns.

## Current maturity

Pactora is an early prototype. It is not approved for real financial records or public deployment. Member authentication, rate limiting, server-side authorization, private evidence storage, production secrets, and database-backed mutation flows must be completed and tested before a family pilot.

## Data handling

Never commit `.env`, database dumps, production data, GCash screenshots, signatures, PINs, QR tokens, or blockchain keys. Rotate any secret that is accidentally exposed. Treat repository access and production data access as separate permissions.
