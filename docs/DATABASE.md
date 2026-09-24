# Database

One schema runs on both SQLite and PostgreSQL. Development needs no
infrastructure; production uses PostgreSQL.

## The portability contract

`prisma/schema.prisma` is written in the intersection of what Prisma supports
on both engines:

| Not used | Used instead | Why |
| --- | --- | --- |
| native `enum` | `String`, validated by Zod at every entry point | SQLite has no enums |
| `Json` | `String` holding JSON, read via `lib/json.ts` | SQLite has no JSON column type in Prisma |
| scalar lists (`String[]`) | join table, or a delimited string for display-only data | Postgres-only |
| `Decimal` | `Int` in the currency's minor unit | float money is a bug waiting to happen; see [PAYMENTS.md](PAYMENTS.md) |

`npm run pg:schema` generates `prisma/schema.postgres.prisma` **and verifies
the contract**. If someone adds a native enum or a `Json` column, the script
fails with the file and line rather than letting it reach production. CI runs
it, checks the generated file is committed, and applies it to a real PostgreSQL
container — because a portability claim nobody checks is just a comment.

## Conventions

**Money is `Int`, always in minor units.** A field holding money ends in
`Cents`. A rate ends in `Bps` (basis points, 100 = 1%).

**Soft deletes** use `deletedAt`. Every query that should not see deleted rows
filters on it explicitly; there is no global middleware doing it invisibly,
because an invisible filter is one you forget exists when writing a report.

**Denormalised counters** (`viewCount`, `ratingCount`, `completedSales`) are
written inside the same transaction as the event that changed them. They are
read-hot and write-cold. `npm run recompute` rebuilds them from source data,
and the trust and health scores with them.

**Indexes** exist for the queries that actually run. Every search path narrows
on an indexed predicate first — status plus intent plus published date, species,
price, a location bounding box — and only then applies text matching to a
bounded page. Nothing in `search.service.ts` scans the table.

## Constraints that carry business rules

Some invariants are enforced by the database rather than by application code,
because application code loses races:

| Constraint | Prevents |
| --- | --- |
| `Appointment @@unique([vetId, startAt])` | two people booking the same slot |
| `PaymentIntent.idempotencyKey @unique` | a double-submitted payment charging twice |
| `LedgerAccount @@unique([ownerType, ownerId, kind, currency])` | two accounts for the same balance |
| `Pet.microchipId @unique` | the same chip registered to two animals |
| `AdoptionApplication @@unique([listingId, applicantId])` | applying twice to the same listing |

Stock is protected the same way in code: the decrement is a conditional
`updateMany(where: { stock: { gte: n } })`, so two simultaneous checkouts for
the last unit cannot both succeed. `tests/concurrency.test.ts` runs both races.

## Local development

```bash
cp .env.example .env
npm install
npm run db:push     # create dev.db from the schema
npm run db:seed     # reference data, plus demo data when SEED_DEMO_DATA=true
```

`npm run db:reset` drops and rebuilds. It refuses to run against anything that
is not a SQLite file, so it cannot be pointed at production by accident.

`npm run db:studio` opens Prisma Studio.

## Production

```bash
npm run pg:schema
npx prisma migrate deploy --schema prisma/schema.postgres.prisma
```

Use `migrate deploy`, not `db push`: migrations are reviewable, ordered and
replayable, and `db push` will silently drop a column to make the schema match.

Set `PETMATE_DIRECT_URL` to an unpooled connection string when the main URL
goes through a pooler — migrations need a direct connection.

### Why the variable is namespaced

`PETMATE_DATABASE_URL`, not `DATABASE_URL`. A machine-level `DATABASE_URL`
belonging to another project silently shadows a project `.env` and points the
app at the wrong database, which is exactly the kind of failure that looks like
a code bug for an hour.

## Seeding

`prisma/seed.ts` writes two things:

1. **Reference data** — breeds, vaccines, product categories, plans, platform
   settings. Always written, in production too.
2. **Demo data** — accounts, pets, listings, clinics, orders. Only when
   `SEED_DEMO_DATA=true`, which production refuses to start with.

Demo accounts use `@demo.petmate.invalid`, a reserved TLD that cannot receive
mail, so a seeded environment cannot email a real person.

Demo trust and health scores are not set directly. The seed awards real
`TrustSignal` rows and calls `recomputeHealthScore`, so the numbers are
derivable and `npm run recompute` reproduces them instead of zeroing them.

## Backups

- **Take them from a replica or a snapshot**, not by pausing the primary.
- `pg_dump --format=custom` daily, retained 30 days, plus continuous WAL
  archiving if the platform offers it.
- **Test the restore.** An untested backup is a hypothesis. Restore into a
  scratch database monthly and run `npm run audit:ledger` against it — if the
  ledger does not balance in the restored copy, the backup is not usable for
  the thing you would actually need it for.
- The uploads directory is not in the database. Back it up too, or use S3 with
  versioning.
