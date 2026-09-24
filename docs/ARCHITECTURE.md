# Architecture

PetMate is one Next.js application with a single database. There is no service
mesh, no message broker and no separate API server, because at this size those
would add failure modes without removing any.

## The shape

```
Browser
  │  fetch(/api/*)            React Server Components
  ▼                                    │
src/app/api/**/route.ts  ─────────────┤   both call the same services
  │   route() wrapper                  │
  ▼                                    ▼
src/lib/services/**  ·  src/lib/payments/**  ·  src/lib/breeding/**
  │   business rules, authorisation, invariants
  ▼
Prisma ──► SQLite (development) / PostgreSQL (production)
  │
  └──► Job queue table ──► src/worker/main.ts
```

A page and an API route reach the same service function. Nothing important
lives in a route handler or a component, so there is exactly one place where a
rule is enforced and exactly one place to change it.

## Layers, and what may not cross them

| Layer | May import | Must never |
| --- | --- | --- |
| `src/app/**/page.tsx` | services, `lib/auth`, components | talk to Prisma for anything with a rule attached |
| `src/app/api/**/route.ts` | services, `route()` | contain business logic |
| `src/lib/services/**` | `lib/db`, other services | import from `src/app` or from a component |
| `src/components/**` | other components, `lib/api-client`, pure `lib` helpers | import a `server-only` module |

The last row is enforced by `tests/client-boundary.test.ts`, which walks every
`"use client"` file's import graph and fails with the chain when one reaches
Prisma, `next/headers` or a `server-only` module. That class of mistake
typechecks fine and only fails at build time, with an error pointing at the
leaf rather than the component that pulled it in.

## The single front door

Every API route goes through `route()` in `src/lib/api.ts`, which applies, in
order:

1. body-size guard
2. CSRF verification
3. identity and account status
4. verified-email requirement, when declared
5. permission check
6. rate limit
7. schema validation

A handler therefore never has to remember any of them, and "I forgot the auth
check on this one endpoint" stops being a class of bug that can exist.

## Authorisation

Two mechanisms, deliberately separate:

- **Permissions** (`src/lib/auth/rbac.ts`) answer "may this kind of account do
  this kind of thing". Roles are rows, not a column, so one account can be a
  breeder and a vet at once.
- **Ownership** is re-read from the database at the point of use. Nothing about
  who owns a row is ever taken from the request.

A missing row and a row belonging to someone else both raise **404, never
403**. A 403 would confirm the id exists, which is an enumeration oracle.

## Money

`src/lib/payments/` is a double-entry ledger. Every movement is a transaction
whose entries sum to exactly zero; `postTransaction` refuses anything else.
Balances are derived by summing entries, never stored on a user row, so they
cannot drift from the transactions that produced them.

See [PAYMENTS.md](PAYMENTS.md).

## Background work

A table, not a broker. `Job` rows are claimed with a conditional `updateMany`,
so several workers can run at once and two never take the same job. Failures
retry with exponential backoff; a stale lock is recovered by the next worker.

Email uses the outbox pattern: `queueEmail` writes a row inside the caller's
transaction, and the worker delivers it. A transaction that rolls back cannot
have sent mail, and a provider outage delays mail rather than losing it.

Deployments that cannot run a long-lived process can `POST /api/cron/tick`
instead; it drains the same queue with the same handlers.

## AI

`src/lib/ai/` wraps the Anthropic SDK. Every AI surface has a deterministic
fallback, and every response carries `source: "ai" | "rules"` which the
interface displays. Nothing is presented as AI output when it is not, and the
breeding compatibility engine — which is a weighted rule engine — is never
described as machine learning.

## Configuration

Commercial rules live in the database (`PlatformSetting`), not in code, and are
edited from `/admin/settings`. Changing a commission rate is an operational
decision, not a deployment. `src/lib/settings.ts` caches them for 30 seconds
and validates each stored value against the type of its default, so a bad row
cannot make a commission rate a string and break arithmetic.

## Where to look

| Question | File |
| --- | --- |
| How is a request authorised? | `src/lib/api.ts`, `src/lib/auth/rbac.ts` |
| Where does money move? | `src/lib/payments/settlement.ts` |
| How is a breeding match scored? | `src/lib/breeding/compatibility.ts` |
| What runs in the background? | `src/lib/jobs/handlers.ts` |
| What can an admin change? | `src/lib/settings.ts` |
| How is search ranked? | `src/lib/services/search.service.ts`, [SEARCH.md](SEARCH.md) |
