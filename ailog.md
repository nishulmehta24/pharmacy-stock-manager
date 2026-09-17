# AI-Assisted Development Log

## Requirements

The pharmacy manager tracks medicine batches and expiry dates, dispenses using
first-expiry-first-out (FEFO), excludes expired stock from sellable counts and
search results, and reports batches expiring soon. The implementation also
supports the Level 1 `/clock` automation, Level 2 messy batch imports, and
Level 3 reorder notifications through `/outbox`.

## Implementation

- Extended the Prisma SQLite model with batch status/expiry flags, reorder
  thresholds, and persisted notification outbox events.
- Kept the existing `/api` routes and added `/clock`, batch import aliases, and
  `/outbox` endpoints.
- Normalized import quantities (`10 units`) and ISO or `dd/mm/yyyy` dates,
  deduplicating valid rows and reporting imported, deduped, and rejected rows.
- Added a Prisma 7 SQLite adapter and a safe local `file:./dev.db` default so
  `npm run db:push` works without manual environment setup.

## Validation

Backend focused tests pass (2/2), Prisma schema validation passes, the backend
syntax check passes, `npm run db:push` reports the local database in sync, the
frontend production build passes, and `/clock` plus `/outbox` were smoke-tested.

## Known limitations

- The outbox is a persisted local queue; delivery to an external notification
  provider is outside this repository.
- Import rows must reference an existing medicine by exact name.
- The current test suite focuses on normalization helpers; full HTTP/database
  integration coverage is not included.
