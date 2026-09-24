# Payments

Money is the part of this product where a bug is not a bug — it is somebody's
money. The design reflects that.

## Money is an integer

Every monetary value is an `Int` in the currency's minor unit. Field names end
in `Cents`. There is no float arithmetic on money anywhere, and no `Decimal`
column, because the schema has to run on SQLite too.

There is one currency per deployment, `NEXT_PUBLIC_CURRENCY` (EGP for the
Egyptian launch; see `src/lib/currency.ts`). There is no exchange-rate engine,
and the ledger keeps a separate balance per currency, so a price in a second
currency would not be converted — it would open a second, disconnected set of
books. Price schemas therefore accept only the platform currency, and every
balance, payout and report is read in it.

Rates are basis points (`Bps`), 100 = 1%. `commissionBps(amountCents, bps)`
rounds once, at the end, and the caller never does the arithmetic inline.

Splitting a total across several parties uses `distribute()`, which hands the
remainder cents to the first recipients rather than losing them. Three-way
splits of 100 cents produce 34/33/33, never 33/33/33.

## Double-entry ledger

Every movement of money is a `LedgerTransaction` with two or more
`LedgerEntry` rows that **sum to exactly zero**. `postTransaction` refuses
anything else — an unbalanced posting throws rather than being written.

```
CHARGE — Appointment APT-39TZNHW2
    EXTERNAL/GATEWAY          -250.00     money leaves the customer's card
    PLATFORM/REVENUE           +20.00     commission
    CLINIC/PENDING            +230.00     the clinic's share, held
```

Account kinds:

| Kind | Holds |
| --- | --- |
| `GATEWAY` | the outside world: cards, banks |
| `ESCROW` | money PetMate holds that belongs to neither party yet |
| `PENDING` | earned but not yet withdrawable |
| `AVAILABLE` | withdrawable |
| `PAYABLE` | a requested payout, debited from available, not yet sent |
| `REVENUE` / `FEES` | the platform's own |

**Balances are derived, never stored.** There is no `balanceCents` column on a
user, so a balance cannot drift from the transactions that produced it.

`npm run audit:ledger` sums the whole book. It must print zero. The admin
console shows the same check at `/admin/finance`, and `tests/money.test.ts`
asserts it after every scenario it runs.

## Escrow

A pet sale is not a product order. It moves an animal and a passport, so it is
escrowed:

1. Buyer pays → money goes to `ESCROW/ESCROW`, not to the seller.
2. Seller sees it has cleared, which is what makes them willing to hold the
   animal, but cannot touch it.
3. Both confirm the handover → escrow releases.
4. Or nobody disputes within `escrowAutoReleaseHours` → the worker releases it.
5. Or someone disputes → the money freezes until a person decides.

**Ownership of the pet transfers inside the same transaction that releases the
money.** The two cannot come apart: there is no state where the seller has been
paid but still owns the record, or the reverse.

## Exactly-once settlement

Three mechanisms, each guarding a different failure:

**Idempotency keys.** `PaymentIntent.idempotencyKey` is unique. A
double-submitted form, a retried request or an impatient second click resolves
to the same intent rather than a second charge.

**Conditional status transitions.** Settlement claims an intent with

```ts
updateMany({ where: { id, status: "REQUIRES_CONFIRMATION" }, data: { status: "SUCCEEDED" } })
```

and does nothing when `count === 0`. Two webhooks arriving at once produce one
settlement and one no-op, not two ledger postings.

**Database constraints.** Where a race is about a scarce resource rather than a
status, the database decides — a unique index on `(vetId, startAt)` for slots, a
conditional stock decrement for products.

## Prices come from the database

The client never states an amount. A checkout request carries a listing id, not
a price; the server reads the row. The same is true of commission rates,
subscription prices and appointment fees. A request that includes a price has
that price ignored.

## Refunds

- Never exceed the original amount. The cap is enforced against the sum of
  prior refunds, not against the intent's face value.
- Reverse the commission with the refund. PetMate does not keep a fee on a
  transaction that did not happen.
- Post to the ledger like everything else, so the books still balance
  afterwards.

## Refunds of store orders

A store order's money was split at settlement: commission to the platform,
goods and shipping to each shop's pending balance. A refund therefore first
takes the shops' share back (`clawBackOrderEarnings`) — from pending if the
hold window has not passed, otherwise from available, which may go into debit —
and only then returns the money through the gateway. The platform's own share
of the refund is its commission being reversed. Cancelling a paid order that
has not shipped does all of this automatically; so does a dispute refund.

## Cash on delivery

Most Egyptian e-commerce is paid at the door, so a shop can opt in
(`Shop.acceptsCod`) and buyers can choose it when every shop in the basket
takes cash and the total is under `codMaxOrderCents`.

1. The order is `CONFIRMED`, not `PAID`: it goes to the shops straight away and
   nothing is written to the ledger, because no money has moved.
2. When a shop's parcel is delivered — confirmed with the buyer's code by the
   courier, or marked delivered by a shop that delivers itself — that shop
   holds the cash. Its commission is charged against its balance:

```
COMMISSION — Commission on cash collected for PM-XXXX
    SHOP/AVAILABLE            -30.00
    PLATFORM/REVENUE          +30.00
```

   `CodCollection` records the cash collected, and its unique
   `(orderId, shopId)` index makes the charge happen once whichever path
   reports the delivery first.
3. A refused or returned parcel puts the stock back; there is nothing to refund.

A shop in debit cannot request a payout until its online sales cover it.

## Providers

`PAYMENT_PROVIDER=paymob` is the gateway for Egypt. The server creates an
Intention (`POST /v1/intention/`, `Authorization: Token <secret key>`) and the
buyer pays on Paymob's hosted Unified Checkout, so card and wallet details
never reach PetMate. The payment is confirmed only by the Transaction
Processed callback at `/api/webhooks/paymob`, whose `hmac` query parameter is
an HMAC-SHA512 over twenty of the transaction's fields in Paymob's documented
order; the redirect back to the site is only UX. A callback whose amount or
currency differs from the intent is flagged, never settled. Refunds go through
`/api/acceptance/void_refund/refund` with the transaction id kept from the
callback.

`PAYMENT_PROVIDER=ledger` is the default. It settles through the internal
ledger and shows a clearly labelled sandbox confirmation screen that says no
real money is involved. Everything downstream of the gateway — escrow,
commission, payouts, refunds, disputes — is the real implementation running on
real rows.

`PAYMENT_PROVIDER=stripe` swaps the gateway. The sandbox confirmation endpoint
then returns 404, so a deployment cannot have both a real gateway and a way to
confirm payments without one.

Webhooks verify the provider's signature before doing anything, and are
idempotent by provider event id.

## Payouts

Requesting a payout is a ledger movement, not a status column:

```
PAYOUT — Payout requested: Maadi Veterinary Centre
    CLINIC/AVAILABLE          -430.00
    CLINIC/PAYABLE            +430.00
```

The available balance drops immediately, so the same money cannot be requested
twice. Marking it paid moves it out to `EXTERNAL/GATEWAY`; rejecting it moves it
back to `AVAILABLE`. Both use conditional `updateMany`, so two admins clicking
at once produce one outcome.

Bank details are never stored. `destination` is a label the requester typed for
their own recognition; the transfer itself happens in a banking system a human
operates.

## What is deliberately not built

- **No card details touch PetMate.** There is no field anywhere that accepts a
  card number. When a real gateway is configured, the card is entered on the
  provider's own form.
- **No stored payment methods.** A saved card is a liability this product does
  not need.
- **No manual balance adjustment in the admin console.** Every movement is a
  ledger posting with a reason attached, including corrections.
