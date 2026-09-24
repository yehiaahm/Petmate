# Security

What is implemented, and what is deliberately not.

## Passwords

scrypt with OWASP-recommended parameters (N = 2^17, r = 8, p = 1, 256 MB
maxmem). The parameters are embedded in the stored hash, so raising them later
does not invalidate existing passwords: `needsRehash` upgrades a password
transparently on the next successful sign-in.

Comparison is constant-time. A plain-text password is never logged, never put
in an error message, and never returned by any query — `passwordHash` is
excluded from every `select`.

The policy rejects: fewer than 10 characters, known-breached passwords, a
single repeated character, keyboard sequences, and any password containing the
user's own name or email. That last check compares against the squashed form
too, so "Alex Morgan" catches "alexmorgan2024".

The browser mirrors the same rules from
`src/components/auth/password-strength.tsx` — one client module, not a copy per
form, because the copies drift. The server is still the authority; the client
copy exists so the meter does not promise a password the server will reject.

## Sessions

A 32-byte random token in an HttpOnly, SameSite=Lax, Secure cookie. **Only the
SHA-256 of the token is stored.** A database leak yields hashes, not working
sessions.

Sessions are listed in Settings → Security with device, IP and last activity,
and can be revoked individually or all at once. Changing a password revokes
every other session.

## CSRF

An HMAC-signed double-submit token. The middleware mints one for anonymous
visitors too — login is itself a CSRF target, so the auth routes are **not**
exempt.

The middleware runs on the Edge runtime and the verification runs in Node, so
the signature is computed twice by two different crypto implementations.
`tests/csrf.test.ts` asserts they produce byte-identical output; a divergence
there would lock every user out, silently.

## Authorisation

- **Permissions** answer "may this kind of account do this kind of thing".
  Roles are rows, so one account can hold several.
- **Ownership** is re-read from the database at the point of use. Nothing about
  who owns a row is trusted from the request.

**A missing row and someone else's row both return 404.** Answering 403 would
confirm the id exists. The same reasoning applies to the support-ticket lookup,
the payout account check and the admin queue modes.

## Input

Every boundary validates with Zod before the handler runs. Beyond types:

- Control characters are rejected by an explicit codepoint check.
- External URLs are rejected when they resolve to a private, loopback or
  link-local host — an SSRF guard, since these URLs are fetched for previews.
- Redirect targets must be relative paths; `safeRedirect` refuses anything that
  could leave the origin, which closes the open-redirect that makes phishing
  links look legitimate.
- Uploads are checked by magic bytes, not by the filename or the client's
  declared content type, and are served with `X-Content-Type-Options: nosniff`.

## Rate limiting

Per-route buckets keyed by user id when signed in and by IP when not.
Authentication, payments, uploads, AI calls, messaging and support all have
their own. Failed logins additionally lock the account for a period, which is
recorded in the audit log.

## Headers

Set in `next.config.ts` for every response: `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, a `Permissions-Policy` that denies
camera, microphone and payment APIs, `Cross-Origin-Opener-Policy`, and HSTS in
production. Uploaded files get their own stricter set.

## Privacy by construction

| Never public | Why |
| --- | --- |
| email address, phone, exact address | contactable identity |
| a pet's full health record | transfers with the animal, not with the listing |
| microchip number | a claim credential — showing it lets anyone assert ownership elsewhere |
| verification documents | visible only to the reviewers processing them |
| delivery confirmation codes | stored hashed |
| clinical notes on an appointment | clinic-only, distinct from the owner-visible outcome |

Support tickets keep the requester's IP as a salted hash, for abuse
investigation, rather than in the clear.

The support-ticket page POSTs the email address used to open a ticket rather
than putting it in a query string, so it does not land in browser history,
access logs or a `Referer` header.

## Auditing

`AuditLog` is append-only. Every security-relevant action records the actor,
the entity, the IP and a summary: sign-ins, password changes, role grants,
suspensions, moderation decisions, dispute resolutions, settings changes,
payout approvals. Members see their own entries in Settings → Security.

## Known limits

Worth stating plainly rather than leaving someone to discover:

- **No two-factor authentication.** This is the largest gap. It should exist
  before real money moves at volume.
- **Rate limits live in the database.** Fine for one or two instances; at
  higher scale they want Redis, and the interface in `lib/rate-limit.ts` is
  shaped so the store can be swapped without touching call sites.
- **The local storage driver writes to the container filesystem.** That does
  not survive a redeploy and is not shared between instances. Use S3 in
  production.
- **No automated dependency scanning is wired in.** Add `npm audit` or
  Dependabot to CI.
- **The CSP is not yet nonce-based in production.** The header set is strict
  otherwise, but this is the remaining piece.

## Reporting a vulnerability

Open a support ticket with topic `SAFETY`, or email the address in
`supportEmail`. Reports are taken seriously and acknowledged.
