# VIP, SVIP, and Aristocracy Wave 3 Economy

Status: complete locally; catalog approval and deployment pending

Implemented: 2026-08-13

Parent plan: [VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md](VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md)

## Outcome

Wave 3 implements Aristocracy as a manual, fixed-duration purchase funded only
from the existing in-app **coin wallet**. It is not an Apple, Google, web, card,
carrier, or recurring subscription. There is no stored payment authorization,
automatic charge, automatic renewal, gifting, transfer, downgrade refund, or
background purchase.

- A short-lived opaque server quote binds UID, catalog version, target rank,
  operation, price, current rank/order, entitlement revision, current expiry,
  latest transaction, resulting expiry, issue time, and quote expiry.
- The client supplies a target rank to obtain a quote and later confirms only
  the opaque quote ID plus a separate idempotent request ID. It never supplies
  an authoritative price, duration, current rank, expiry, or balance.
- Confirmation revalidates the feature flag, active profile/moderation state,
  catalog pointer and immutable catalog, quote state/expiry, full entitlement
  fingerprint, formula, and wallet balance inside one Firestore transaction.
- The transaction either performs all writes or none: wallet debit, wallet
  ledger, immutable Aristocracy history, entitlement, consumed quote,
  projection job, and idempotent command result.
- Concurrent and repeated confirmations return one result and create exactly
  one debit. A consumed quote cannot be used with a second request.
- Quotes are limited to 30 per UTC hour per user and expire after five minutes.
- Scheduled expiry changes only derived entitlement state/history and queues
  presentation cleanup. It never modifies a wallet or deletes purchase history.
- Reconciliation paginates up to a bounded 100,000 documents per authority,
  reports truncation, verifies paid history against exact wallet ledger entries,
  detects orphan ledgers, and checks every entitlement against its latest
  immutable transaction.

## Purchase policy

For a new or expired entitlement, the quote is full price and the resulting
expiry is `serverNow + duration`.

For an active manual renewal of the same rank, the quote is full price and the
duration extends from `max(serverNow, existingExpiry)`.

For an active upgrade:

```text
remainingMs = max(0, existingExpiry - serverNow)
priceDifference = targetPrice - currentPrice
amountDue = ceil(priceDifference * remainingMs / catalogDurationMs)
resultingExpiry = existingExpiry
```

All arithmetic is integer-safe. One-millisecond boundary calculations round up,
as required by the approved working contract. Active downgrades, cross-catalog
stacking, frozen/review entitlements, and purchases over an active complimentary
grant are rejected.

## Administration and corrections

The App Check-protected admin boundary provides:

- entitlement, wallet, and recent immutable-history inspection;
- a bounded complimentary grant of at most 90 days;
- typed entitlement revocation/correction;
- per-user freeze and unfreeze; and
- an immediate global shop availability control.

Complimentary grants, revokes, freezes, and unfreezes use a proposal followed by
approval from a different active administrator. The approver must be a Platform
Owner; the initiator cannot approve their own operation. Every completed action
creates immutable Aristocracy history, an audit event, a revision change, and a
projection job. Direct edits are not exposed.

Only a Platform Owner can change global shop availability. Enabling is rejected
unless an active published Aristocracy catalog exists. The operation is
idempotent and audited. Disabling the shop blocks new quotes and confirmations
while retaining already-active status until its normal expiry or an approved
correction.

Paid purchases remain final in V1. There is no self-service coin refund. A
service-error financial compensation still goes through the existing reviewed
wallet-adjustment process and must be correlated with the Aristocracy audit;
the entitlement correction itself uses the typed revoke proposal above.

## Source layout

| Source | Responsibility |
| --- | --- |
| `functions/aristocracyEconomyCore.js` | Strict inputs, quote formula and binding, entitlement/history builders, and bounded admin proposals |
| `functions/aristocracyEconomyService.js` | Quote/purchase transactions, expiry, admin dual control, shop freeze, inspection, and reconciliation |
| `functions/index.js` | App Check-protected user/admin commands and expiry/reconciliation schedules |
| `functions/statusMembershipCore.js` | Versioned immutable catalog and effective-expiry entitlement mapping |
| `firestore.rules` | Client denial for quotes, entitlements, history, rate limits, proposals, and commands |
| `firestore.indexes.json` | Expiry and history query indexes |

## Activation path

No catalog, feature flag, wallet, quote, entitlement, or production data was
written by this wave. Before activation:

1. Approve rank names/Arabic localization, coin prices, fixed duration, upgrade
   formula, benefits, and support policy through Wave 0.
2. Publish the independently approved immutable catalog and active pointer.
3. Deploy reviewed rules, indexes, and Functions.
4. Run purchase, upgrade, manual renewal, freeze, expiry, and insufficient-funds
   smoke tests with test accounts.
5. Require a clean economy reconciliation and then enable
   `aristocracyShop`. Presentation remains independently controlled for Wave 4.

Because there are no users, no historical Aristocracy migration or prolonged
dark launch is required. The controls remain production rollback mechanisms.

## Verification

- Wave 3 syntax gate: passed.
- Focused Wave 1-3 economy compatibility suite: 6 files and 61 tests passed.
- Tests cover full purchase, active renewal, expired repurchase, every current
  upgrade direction, exact rounding boundaries, downgrade and catalog-change
  rejection, quote expiry/reuse/mutation, wrong-account isolation, stale
  entitlement, wallet change, insufficient balance, feature freeze, quote-rate
  limiting, concurrent confirmation, partial-write prevention, expiry,
  complimentary grants, self-approval rejection, per-user freeze, global shop
  freeze, and wallet-ledger reconciliation drift.
- Full non-emulator application suite: 319 files and 1,733 tests passed.
- Firestore and Storage emulator suite: 2 files and 76 tests passed. The runner
  reproduced its pre-existing Storage null-evaluation warnings and post-success
  Java shutdown exception; its reported test exit code was 0.
- JSON parsing, Wave 3 syntax checks, and `git diff --check`: passed.

No Wave 4 Me-page or visual work was pulled into this wave.
