# Production database migration baseline

The existing Neon production database predates Prisma migration tracking. The migration `20261009000000_baseline` describes the existing schema before the additive `borrowedAt` and `phone` changes.

For an existing database, the baseline is recorded as applied; do not execute the baseline SQL against a database whose tables already exist. Subsequent schema changes are managed with `prisma migrate deploy`.
