# VIP, SVIP, and Aristocracy Production Plan

Status: Waves 1-3 complete locally; product/economy approval and deployment pending

Last updated: 2026-08-13

## Executive decision

This project will not implement Apple, Google, RevenueCat, Stripe, carrier, or
other recurring subscriptions for VIP, SVIP, or Aristocracy.

The product model is:

1. **VIP/SVIP** is one permanent recharge-progression ladder. Eligible net
   recharge value automatically advances the user through VIP levels and then
   SVIP levels. There is no purchase button, expiry, or renewal.
2. **Aristocracy** is a separate, manually purchased fixed-duration privilege
   using the user's existing in-app coin wallet. It never auto-renews and never
   charges money. The user explicitly buys or renews a noble rank with coins.
3. Neither system may bypass moderation, blocks, room bans, DM consent, room
   passwords/capacity, rate limits, age/region controls, staff visibility, or
   financial controls.

This gives the app the familiar status structure of mature social voice-chat
products without introducing external billing infrastructure.

## What comparator research establishes

Public evidence is incomplete and sometimes contradictory, so it must not be
treated as a specification:

- Salam's current public Android listing describes a free VIP upgrade for new
  users and migration of an existing ID and wealth level. This supports a
  progression/status model.
- Public third-party iOS metadata also lists one-, three-, and twelve-month
  SVIP products for Salam.
- Hilo's App Store listing exposes a `Hilo VIP Monthly` product, while public
  user reviews mention numbered levels such as `SVIP 4`.
- Voice-chat apps in the same product category commonly show VIP/SVIP as a
  numbered recharge ladder and Aristocracy as a separate “Join” privilege.

The defensible conclusion is that Salam and Hilo use hybrid systems, not one
publicly documented universal model. The client must provide dated screenshots
or a screen recording of the exact Salam/Hilo experiences they want copied.
Until then, comparator names guide product shape but do not define thresholds,
prices, durations, or privileges.

## Product contract

### VIP and SVIP

VIP and SVIP are two bands in one ordered ladder, not two memberships that can
be active at the same time.

- Proposed V1 structure: `VIP1` through `VIP10`, followed by `SVIP1` through
  `SVIP10`.
- The current level is derived from **net eligible lifetime recharge points**.
- Completed representative recharge credits are the only eligible source in
  V1.
- A completed eligible recharge creates a positive contribution.
- Its verified reversal creates a linked negative contribution.
- Admin wallet credit, gifts received, promotions, games, daily rewards,
  refunds from purchases, and ordinary wallet transfers contribute zero.
- Normal coin spending never lowers VIP/SVIP.
- Recharge reversal or a reviewed fraud adjustment can lower it.
- SVIP includes all VIP presentation benefits; only the highest current level
  is displayed.
- Thresholds and recharge-point values are server catalog data, never embedded
  in the mobile client.

The existing `walletSummaries.lifetimeCredit` is not authoritative for this
ladder. It includes non-recharge credits and cannot distinguish an eligible
recharge from a promotion or admin adjustment.

### Aristocracy

Aristocracy is a manual coin-wallet privilege. It is not a recurring
subscription:

- The user selects a published noble rank and confirms the exact coin price
  and duration.
- The server debits coins and grants the entitlement atomically.
- The purchase has a fixed expiry and never renews automatically.
- The user must manually renew with a new confirmation and idempotent command.
- No external payment method, stored payment authorization, or background
  charge exists.
- The user may upgrade while active. Downgrades wait until expiry.
- Expiry removes only derived rank privileges and status presentation; it does
  not delete history or unrelated owned cosmetics.

Proposed rank names, pending Arabic cultural and brand approval:

| Rank | Stable ID | Arabic | English |
| ---: | --- | --- | --- |
| 1 | `knight` | فارس | Knight |
| 2 | `baron` | بارون | Baron |
| 3 | `viscount` | فيكونت | Viscount |
| 4 | `count` | كونت | Count |
| 5 | `marquis` | ماركيز | Marquis |
| 6 | `duke` | دوق | Duke |
| 7 | `prince` | أمير | Prince |
| 8 | `sultan` | سلطان | Sultan |

The catalog is extensible; clients must not assume eight ranks. Proposed V1
duration is 30 days for every rank, but duration and price remain blocking
economy decisions.

### Aristocracy upgrade formula

V1 permits only an upgrade to a higher rank while active. All ranks in a
catalog version must use the same duration.

For an active entitlement:

```text
remainingMs = max(0, expiresAt - serverNow)
priceDifference = targetPriceCoins - currentPriceCoins
amountDue = ceil(priceDifference * remainingMs / durationMs)
newExpiry = current expiresAt
```

The server calculates the quote. The client sends the catalog version, target
rank, displayed quote ID, and request ID—not an amount. Quotes expire quickly
and bind the UID, source rank, target rank, expiry, catalog version, and price.

If the existing entitlement has expired, the operation is a new full-price
purchase with `newExpiry = serverNow + durationMs`. A manual renewal at the
same rank charges full price and extends from `max(serverNow, expiresAt)`.

No downgrade refund, cancellation refund, gifting, transfer, stacking across
catalog versions, or partial-duration purchase exists in V1.

## Recommended privilege matrix

Privileges must be status and presentation benefits, not safety or economy
advantages.

| Surface | VIP band | SVIP band | Aristocracy |
| --- | --- | --- | --- |
| Profile/seat badge | Numbered VIP badge | Numbered SVIP badge | Noble title |
| Avatar frame | Tier family frame | Premium tier family frame | Rank frame |
| Nameplate/accent | Static | Premium static/approved motion | Rank style |
| Chat bubble | Selected levels | Selected levels | Selected ranks |
| Room entry | Short static/motion | Premium bounded motion | Rank entrance |
| Status Center | Progress to next level | Max/progress state | Expiry and renew |
| Catalog access | VIP-gated cosmetics | VIP + SVIP catalog | Rank-gated catalog |
| Upgrade celebration | Major milestones | Major milestones | High ranks only |

Recommended launch default:

- launch with badges, frames, nameplates, bubbles, and bounded entrance effects;
- do not launch coin stipends, recharge bonuses, gift discounts, ranking boosts,
  custom moderation powers, invisible safety identity, or message bypasses;
- add no privilege that creates a financial liability or changes game/gift odds;
- make public display user-hideable while preserving private entitlement state.

## Current repository assessment

### Reusable foundations

- Server-authoritative wallet summaries and immutable wallet transactions.
- Idempotent store purchase commands and atomic coin debits.
- Representative recharge receipts plus linked reversal records.
- Store ownership, equipment, expiry, and reconciliation patterns.
- Canonical versioned cosmetic assets with approval, checksum, and fallback
  controls.
- Profile, seat, room-chat, direct-chat, and entry-effect renderers.
- Admin roles, conflict tokens, reason fields, and immutable audit events.
- Fail-closed client feature flags and staged rollout scripts.

### Defects and gaps to address

1. Existing VIP is a five-tier display prototype derived from generic lifetime
   credit. It has no SVIP or Aristocracy authority.
2. VIP projection updates lazily through `get-vip-status`, not from every
   eligible recharge/reversal, and it has no drift reconciler.
3. Backend and client parse `publicProfiles.vipTier`, but current Firestore
   `validPublicProfile` does not allow that field. A projected profile can fail
   public reads.
4. The tier catalog is a seed script, not a versioned publish workflow.
5. The client has no complete Status Center, tier road, noble shop, quote,
   purchase confirmation, expiry, renewal, history, or visibility controls.
6. `growthFeatures.vipTiers` is too broad for independent rollback.
7. The existing `socialCommand` callable authenticates users but does not set
   callable App Check enforcement. New economy commands need a staged enforced
   path without unexpectedly breaking older clients.
8. Deployed production state is unknown. “Implemented locally” does not prove
   that functions, rules, flags, or data are live.

The legacy Bronze-to-Diamond tier IDs should not be extended. They should be
migrated to the new VIP/SVIP account only from eligible recharge evidence, not
by name or generic lifetime credit.

## Server-authoritative data model

Names may change during implementation, but responsibilities must remain
separate.

| Path | Purpose | Client access |
| --- | --- | --- |
| `vipTierCatalogVersions/{version}` | Immutable published VIP/SVIP ladder | Sanitized published projection only |
| `vipAccounts/{uid}` | Current points, level, version, reconciliation state | Backend only |
| `vipContributions/{eventId}` | Immutable recharge/reversal/adjustment evidence | Backend only |
| `vipTransitions/{uid}/items/{id}` | Immutable level history | Owner via command only |
| `aristocracyCatalogVersions/{version}` | Immutable rank prices, duration, benefits, assets | Sanitized published projection only |
| `aristocracyEntitlements/{uid}` | Current active/expired rank authority | Backend only |
| `aristocracyTransactions/{id}` | Immutable purchase/upgrade/renewal history | Backend only |
| `aristocracyQuotes/{uid}/items/{quoteId}` | Short-lived server price quotes | Backend only |
| `statusPresentationJobs/{id}` | Projection retry/dead-letter work | Backend only |
| `adminAuditEvents/{id}` | Catalog, adjustment, freeze, and repair audit | Backend only |

### VIP contribution identity

Use deterministic IDs so replay cannot add points twice:

- recharge: `representative:{transferId}`;
- reversal: `representative-reversal:{originalTransferId}:{reversalId}`;
- approved correction: `admin:{requestId}`.

A reversal must reference an existing positive contribution, match its UID and
source, and cannot reverse more points than remain unreversed. Contributions
store the source type, source ID, signed point delta, policy version, event
time, processing time, and settlement state. They never store mutable balances
as historical truth.

### VIP account invariants

`vipAccounts/{uid}` includes:

- `uid`, non-negative `points`, catalog version, level ID/rank/band;
- `highestEverRank` for analytics only;
- last contribution and reconciliation cursors;
- created/updated timestamps and schema version.

Current level is recomputed from current net points. `highestEverRank` never
authorizes presentation or privilege after a reversal.

Published threshold versions are immutable. V1 permits lowering future
thresholds or adding levels, but not raising a published threshold. Any later
threshold increase requires a separately approved migration and user-promise
policy.

### Aristocracy entitlement invariants

`aristocracyEntitlements/{uid}` includes:

- `uid`, rank ID/rank, catalog version, state;
- acquired/renewed/upgraded timestamps and `expiresAt`;
- latest transaction ID and reconciliation timestamp;
- presentation/benefit policy version and schema version.

Only one effective rank exists. The document is a derived authority; immutable
transactions remain the history. Scheduled expiry and on-read enforcement both
use server time. A stale active document past `expiresAt` grants nothing.

## Public projection

Replace legacy `vipTier` with one bounded public object:

```text
statusPresentation: {
  vip?: { id, band, level, labelAr, labelEn, accentColor, rank },
  aristocracy?: { id, labelAr, labelEn, accentColor, rank },
  projectionVersion,
  visibilityVersion
}
```

It exposes no points, next threshold, wallet price, expiry, transaction,
recharge source, admin note, or fraud decision. Owners retrieve private status
through `get-status-center`.

Firestore rules must allow only the exact bounded public shape, deny client
writes, and temporarily support legacy `vipTier` during migration. Client
mappers fail closed on malformed/unknown projections.

SVIP replaces VIP on compact surfaces. Aristocracy may appear beside VIP/SVIP,
with at most two status badges. Staff, safety, moderation, representative, and
room-role indicators always remain visually and semantically distinct.

## Authoritative flows

### Recharge to VIP/SVIP

1. Representative transfer completes through the existing transaction.
2. In the same transaction where practical, write an outbox event with the
   deterministic source ID. Do not make status projection a prerequisite for
   the financial transfer to succeed.
3. An idempotent worker creates the contribution, updates net points, resolves
   the catalog level, and records any transition.
4. A projection worker updates public presentation and queues a bounded
   milestone celebration.
5. A reversal writes a linked negative outbox event and follows the same path.
6. Scheduled reconciliation recomputes expected points from authoritative
   eligible receipts/reversals and repairs drift through an audited repair.

Outbox records are retried until processed or dead-lettered. Queue failure can
delay status but can never lose or duplicate recharge value.

### Aristocracy quote and purchase

1. Client calls `quote-aristocracy` with the target rank.
2. Server validates active profile, moderation status, feature flags, catalog,
   current entitlement, target direction, wallet currency, and server time.
3. Server returns a short-lived quote containing price, duration/expiry result,
   Arabic/English disclosure, and an opaque quote ID.
4. User confirms the exact coin debit and result.
5. Client calls `purchase-aristocracy` with quote ID and request ID.
6. One Firestore transaction revalidates the quote/catalog/current entitlement,
   debits the wallet, writes wallet transaction, writes Aristocracy transaction,
   updates entitlement, consumes the quote, and records the command result.
7. Projection and presentation events update through an outbox/retry path.

Repeated request IDs return the prior result. A quote cannot be reused, moved
to another UID, used after expiry, or applied after wallet/entitlement/catalog
state changes.

### Expiry and reconciliation

- Every privileged command checks current entitlement and server time.
- A scheduled job expires overdue entitlements and clears public presentation.
- A reconciler compares entitlement, transactions, wallet ledger, public
  projection, catalog, and cosmetic benefit state.
- Repairs create audit/repair events; they never rewrite immutable history.
- If a rank asset is disabled or missing, the status remains valid and renders
  a native static fallback.

## Commands

Owner mobile commands:

- `get-status-center`;
- `get-vip-history` with bounded cursor pagination;
- `get-aristocracy-catalog`;
- `quote-aristocracy`;
- `purchase-aristocracy` for purchase, upgrade, or renewal;
- `get-aristocracy-history` with bounded cursor pagination;
- `set-status-visibility`.

Admin commands:

- create/publish/retire catalog version;
- inspect status, contribution, entitlement, wallet, and transaction history;
- post reviewed VIP point adjustment;
- grant/revoke an explicitly expiring complimentary Aristocracy entitlement;
- freeze new Aristocracy purchases or celebrations;
- dry-run/apply status reconciliation;
- retry/dead-letter projection jobs.

Every mutation uses authenticated UID/role, enforced App Check where
applicable, bounded validated input, idempotency key, server time, immutable
event, and stable error code.

## Feature and operations controls

Add a dedicated sanitized `appConfig/statusFeatures` instead of extending the
broad growth flag:

- `status_center`;
- `vip_progression`;
- `svip_progression`;
- `aristocracy_shop`;
- `status_animations`;
- `status_announcements`.

Private `appRuntime/statusOperations` controls workers, cohorts, catalog
versions, freezes, and emergency presentation fallback.

Flags never authorize privileges. Disabling the Aristocracy shop blocks new
purchases but does not remove already-purchased active privileges, history, or
the owner's ability to see expiry. Disabling animation produces a static
fallback rather than hiding status.

## Mobile experience

### Status Center

Build one first-class Arabic-RTL Status Center reachable from Me and Wallet:

- current VIP/SVIP badge, level, net eligible recharge points, and progress to
  the next threshold;
- plain-language list of eligible and excluded recharge sources;
- level road showing locked/current/completed states;
- current Aristocracy rank, expiry countdown, and benefits;
- published noble-rank comparison with coin prices and duration;
- explicit purchase/upgrade/renew action and confirmation sheet;
- transaction and level history;
- public visibility controls;
- pending-sync, expired, insufficient balance, quote expired, catalog changed,
  feature frozen, offline, and retry states.

Never label wallet-funded Aristocracy as an Apple/Google subscription. Use copy
such as “30-day rank,” “Buy with coins,” “Expires on,” and “No automatic
renewal.” Show the wallet balance before and estimated balance after.

### Identity surfaces

Integrate status presentation across:

- Me and public profiles;
- room seats and participant sheets;
- room and direct-chat messages;
- room entry presentation;
- discovery, search, friends, and leaderboards where space allows.

Status-derived cosmetics occupy dedicated slots and never overwrite permanent
store ownership or the user's selected equipment. Expiry restores the user's
prior equipment automatically.

All motion uses approved canonical assets, checksums, bounded duration, static
fallbacks, reduced-motion behavior, low-memory fallback, and physical-device
approval. Native readable names and staff/safety indicators stay above art.
Colors are never the only status signal.

## Admin and economy operations

Add a Status workspace to the admin dashboard:

- draft/publish/retire immutable VIP/SVIP and Aristocracy catalog versions;
- threshold and price distribution simulation before publish;
- exact versioned asset/benefit assignment;
- per-user contribution, transition, entitlement, purchase, and wallet view;
- quote/purchase failure and reconciliation inspection;
- reviewed point correction and complimentary entitlement tools;
- outbox, retry, dead-letter, drift, and scheduler health;
- independent shop, animation, and announcement freezes;
- cohort rollout and status distribution metrics.

Catalog publication, bulk operations, high-value adjustments, and long
complimentary grants require two authorized people. Initiators cannot approve
their own operation. Corrections are compensating events, never in-place edits.

### Admin customization policy

Admin customization is required for operating and evolving the product, but it
must be a bounded catalog editor rather than an arbitrary rule or database
editor.

| Customization | Policy |
| --- | --- |
| Arabic/English names, descriptions, colors, and ordering | Allowed in draft with schema validation and preview |
| Approved canonical badge, frame, nameplate, bubble, and entry assets | Allowed by exact published asset version only |
| Benefits selected from a hard-coded server allowlist | Allowed with compatibility validation |
| Retire a level/rank from future acquisition | Allowed with future effective date; existing history preserved |
| VIP/SVIP recharge thresholds | High risk: simulation, reason, future effective date, and two-person approval |
| Aristocracy coin prices and duration | High risk: simulation, immutable new version, reason, and two-person approval |
| Celebration thresholds and presentation limits | Allowed within hard-coded safety/rate bounds |
| Direct edit of a user's points, wallet, level, expiry, or entitlement | Prohibited |
| Arbitrary JSON fields, formulas, scripts, database paths, or collection names | Prohibited |
| Unapproved URLs/files or mutable asset references | Prohibited |
| Backdating catalog changes or rewriting a published version | Prohibited |
| Moderation, block, room-access, consent, staff-visibility, or rate-limit bypass | Prohibited |
| Gift/game odds, leaderboard multipliers, or automatic wallet charges | Prohibited |

The workflow is always `draft -> validate/simulate -> independent review ->
publish with effective date -> retire`. Published versions are immutable. A
change creates a new version; rollback selects a prior compatible version for
future calculations and never rewrites historical contributions, purchases,
quotes, transactions, or entitlements.

The admin interface exposes typed fields and approved selectors only. The
backend repeats every validation and rejects unknown keys, unsafe benefit IDs,
invalid asset versions, non-monotonic thresholds, duplicate ranks, unsafe
durations/prices, and changes outside the caller's role. Hiding a field in the
dashboard is not an authorization control.

User exceptions use compensating operations, never direct document edits. A
VIP point correction or complimentary Aristocracy grant records:

- initiator and independent approver where required;
- reason and evidence/reference;
- stable idempotent request ID;
- previous and resulting derived state;
- bounded signed adjustment or explicit expiry;
- creation/effective timestamps and immutable audit-event ID.

High-value corrections, bulk changes, threshold/price publication, and long
complimentary grants always require two-person approval. The initiator cannot
approve their own request. Break-glass access is separately logged, alerted,
time-bounded, and reviewed after the incident.

Before publishing thresholds or prices, simulate:

- population per VIP/SVIP level;
- time/recharge required to progress;
- Aristocracy affordability by active payer cohorts;
- coin sink per rank and expected renewal rate;
- upgrade rounding at boundary times;
- reversal/demotion and support-case volume;
- asset delivery/rendering cost.

## Security and abuse controls

- Enforce authentication and App Check on new status/economy commands.
- Keep all accounts, contributions, quotes, entitlements, transactions, jobs,
  and audits client-denied in Firestore rules.
- Never accept point delta, coin price, discount, duration, rank, current level,
  expiry, or balance from the client as authority.
- Use deterministic contribution and wallet transaction IDs.
- Revalidate quote, entitlement, catalog, wallet, profile, and moderation state
  inside the purchase transaction.
- Rate-limit quote, purchase, history, visibility, and celebration commands.
- Detect representative-recipient velocity, circular transfers/reversals,
  shared-device/account patterns, rapid rank purchase after suspicious credit,
  repeated quote probing, and high reversal ratios.
- A reversed recharge may demote presentation immediately. It does not claw
  back unrelated legitimate store ownership.
- Aristocracy coin purchases are final in V1 except an audited service-error
  compensation. No self-service refund creates coins.
- Suspended/removed profiles retain private financial history but lose public
  status and cannot buy/renew/upgrade.
- Redact UID-adjacent financial details from routine logs and analytics; retain
  only approved audit data for the approved period.

## Reconciliation and observability

Dashboards and alerts must cover:

- eligible recharge -> contribution -> account -> transition -> projection
  latency and failure funnel;
- reversal processing and negative-point anomalies;
- points and tier distribution by catalog version;
- quote -> confirmation -> wallet debit -> entitlement conversion;
- duplicate request prevention and transaction conflicts;
- expired entitlements still projected or privileged;
- wallet ledger versus Aristocracy transaction debit drift;
- contribution/account and entitlement/projection drift;
- queue depth/age, dead letters, scheduler completion, and oldest pending event;
- asset fallback and entry-effect failure rate;
- support adjustments, complimentary grants, and administrator actions.

Initial service objectives:

- p95 recharge/reversal reflected in owner status within 60 seconds;
- repair path catches valid status within 5 minutes;
- Aristocracy purchase authority commits atomically or not at all;
- active entitlement visible to owner immediately after committed purchase;
- overdue public presentation cleared within 5 minutes, while privileged
  commands deny it immediately at expiry;
- zero duplicate contributions, debits, entitlements, or transitions on replay;
- zero client-authorized writes to private status collections;
- confirmed drift after two reconciliation passes pages an operator.

## Test matrix

### VIP/SVIP

- every threshold boundary, malformed catalog, and unknown version;
- recharge replay, concurrent recharge, delayed outbox, worker crash, and
  out-of-order processing;
- partial/full/multiple reversals and reversal-before-positive retry behavior;
- excluded credits never contribute;
- demotion, requalification, highest-ever analytics, and public visibility;
- catalog publish/retire and forbidden threshold increase;
- full recomputation and repair from authoritative receipts.

### Aristocracy

- new purchase, active renewal, expired renewal, and every allowed upgrade;
- exact rounding at zero, one millisecond, partial day, and full duration;
- quote expiry, reuse, wrong UID, stale entitlement, catalog change, and wallet
  change;
- insufficient funds, concurrent purchase, duplicate request, transaction
  retry, and partial-write prevention;
- downgrade rejection, max-rank behavior, expiry, complimentary overlap, and
  suspended profile;
- wallet ledger/entitlement/transaction reconciliation;
- feature freeze that preserves existing privileges.

### Rules, client, and operations

- rules allow only published sanitized catalog/public projection reads and
  deny all client writes to authority/history;
- admin-role tests cover typed allowlists, unknown-key rejection, immutable
  published versions, self-approval denial, two-person approval, conflict
  tokens, break-glass alerts, and compensating-operation audit history;
- mapper failure on malformed/unknown projection;
- Arabic RTL, English, font scaling, screen reader, contrast, reduced motion,
  offline, low memory, and stale cache;
- status ordering against moderator/owner/representative/mute/speaking badges;
- paginated migration, queue retry/dead letter, bulk reconciliation, and load
  tests for recharge bursts and simultaneous expiries;
- physical iOS and Android approval for every animated asset family.

## Migration

1. Inventory deployed rules, functions, flags, clients, and production data.
2. Export and count legacy `vipTier`, wallet lifetime credit, representative
   receipts, reversals, and any promised user status.
3. Deploy rules and mappers that temporarily support legacy and new projection,
   with new presentation dark.
4. Publish a versioned VIP/SVIP catalog only after economy simulation.
5. Dry-run deterministic contributions from completed eligible representative
   receipts minus linked reversals.
6. Report and resolve malformed, duplicated, unmatched, over-reversed, or
   ambiguous records.
7. Snapshot/hash the accepted migration input and catalog version.
8. Apply through paginated, checkpointed, restart-safe batches.
9. Reconcile expected contribution count, signed point total, account count,
   level distribution, and projection count; require zero unexplained drift.
10. Dual-read for one supported compatibility release.
11. Stop lazy legacy writes and remove `growthFeatures.vipTiers`/`vipTier` only
   after adoption and rollback review.

Migration never grants Aristocracy. It never maps Bronze/Silver/Gold names to
new levels without recharge evidence. If users were explicitly promised legacy
VIP status, product must approve and communicate an honor policy first.

## Delivery waves

### Wave 0 - comparator and economy contract

Execution and decision tracking live in
[`VIP_SVIP_ARISTOCRACY_WAVE0_PRODUCT_CONTRACT.md`](VIP_SVIP_ARISTOCRACY_WAVE0_PRODUCT_CONTRACT.md).

- Obtain client-approved Salam and Hilo screenshots/screen recordings and note
  app/build version and region.
- Approve VIP/SVIP level count, labels, thresholds, eligible recharge sources,
  reversal policy, and legacy promise policy.
- Approve Aristocracy rank names, 30-day duration or replacement duration,
  prices, upgrade formula, and benefits.
- Approve privilege prohibitions, Arabic/English copy, assets, and visibility.
- Assign product, economy, backend, mobile, design/localization, QA, security,
  support, and release owners.

Exit: signed versioned decision register, simulation, copy, and asset brief. No
production writes.

### Wave 1 - authority contracts and legacy rule repair

**Implementation status (2026-08-13): complete locally, dark, and not
deployed.** Strict versioned catalogs, authority/outbox/job schemas, sanitized
projection, independent fail-closed flags, an App Check-enforced read boundary,
the legacy `vipTier` rule repair, private collection rules, indexes, and a dark
reconciler are implemented and tested. Wave 0 economy/product approvals remain
open, so no catalog was published, no account was migrated, and no feature was
enabled. See
[`VIP_SVIP_ARISTOCRACY_WAVE1_FOUNDATION.md`](VIP_SVIP_ARISTOCRACY_WAVE1_FOUNDATION.md).

- Add schemas, catalogs, contribution/account/entitlement cores, indexes,
  rules, dedicated flags, outbox/jobs, and App Check rollout path.
- Fix the current public-profile `vipTier` rule mismatch safely.
- Add dark reconcilers and sanitized status projection.

Exit: unit, service, and rules tests pass; no user-visible change.

### Wave 2 - VIP/SVIP contribution pipeline

**Implementation status (2026-08-13): complete locally and not deployed.**
Representative coin transfers and linked reversals now emit deterministic
atomic outbox evidence. The idempotent worker verifies source truth, writes
immutable contributions and transitions, updates net-point accounts, queues
sanitized projection, dead-letters bad evidence, and supports paginated full
reconciliation. A dry-run-only historical migration utility emits a stable
input hash and rejects ambiguous records. Because the app currently has no
users, the system can proceed to direct activation after catalog approval and
deployment smoke tests; the independent flags remain rollback controls. See
[`VIP_SVIP_ARISTOCRACY_WAVE2_PROGRESSION.md`](VIP_SVIP_ARISTOCRACY_WAVE2_PROGRESSION.md).

- Hook representative recharge and reversal outbox events.
- Implement idempotent contribution processing, transitions, projection,
  history, dead letters, and full reconciliation.
- Build and verify dry-run migration.

Exit: replay/reversal/load tests pass and generic lifetime credit is no longer
an authority.

### Wave 3 - Aristocracy economy

**Implementation status (2026-08-13): complete locally and not deployed.**
The five-minute UID/catalog/entitlement-bound quote, explicit manual purchase,
full-price renewal, ceiling-rounded prorated upgrade, atomic coin debit,
immutable history, expiry, projection queue, retry-safe command result, hourly
quote limit, and paginated wallet-ledger reconciliation are implemented.
App Check-protected admin operations provide inspection, independently approved
complimentary grants/revokes/freezes, and an owner-only audited global shop
freeze. No price catalog or flag was published because Wave 0 economy and
localization decisions remain pending. See
[`VIP_SVIP_ARISTOCRACY_WAVE3_ECONOMY.md`](VIP_SVIP_ARISTOCRACY_WAVE3_ECONOMY.md).

- Implement immutable catalog, quote, atomic debit/purchase, upgrade, renewal,
  expiry, history, and reconciliation.
- Add admin inspection, corrections, complimentary entitlement, and freezes.

Exit: zero ledger drift under retry/concurrency and all quote abuse tests pass.

### Wave 4 - status presentation and assets

**Implementation status (2026-08-13): implemented locally; physical-device
approval pending; not deployed.** The bounded client projection, dedicated
benefit slots, original fixed/checksummed static card art, approved Me-page
row, and profile/seat/chat/entry/discovery fallbacks are implemented. Public
mappers and Firestore rules reject arbitrary URLs and unknown fields; expiry
removes only status overlays and cannot overwrite user equipment. Expo web
bundle/runtime smoke verification passed, while the Android/iOS physical exit
gate remains intentionally open. See
[`VIP_SVIP_ARISTOCRACY_WAVE4_PRESENTATION.md`](VIP_SVIP_ARISTOCRACY_WAVE4_PRESENTATION.md).

- Implement dedicated benefit slots and canonical assets.
- Add the client-approved two-card Me-page row only: SVIP in the left visual
  slot and Aristocracy in the right visual slot, below the existing profile
  summary and above Quick Access. Preserve the rest of the Me page.
- Add profile, seat, chat, entry, discovery, and static fallback presentation.
- Verify expiry restores user equipment and safety badges stay dominant.

Exit: renderer, accessibility, low-memory, reduced-motion, and physical-device
approval pass.

### Wave 5 - Status Center

- Build VIP/SVIP road, recharge explanation/history, noble comparison, quote,
  confirmation, purchase/renew/upgrade, history, expiry, and visibility UI.
- Complete Arabic RTL and English localization.

Implementation status (2026-08-13): code-complete locally. See
`VIP_SVIP_ARISTOCRACY_WAVE5_STATUS_CENTER.md`. Automated gates pass; authenticated
Android/iOS accessibility, RTL, commerce-error, offline, and projection checks
remain required before this exit gate is closed.

Exit: all success/error/offline/stale states and physical device flows pass.

### Wave 6 - operations and closed beta

Execution and operational handoff live in
[`VIP_SVIP_ARISTOCRACY_WAVE6_OPERATIONS.md`](VIP_SVIP_ARISTOCRACY_WAVE6_OPERATIONS.md).

- Complete dashboards, alerts, admin dual control, runbooks, support tooling,
  migration, reconciliation, and rollback drills.
- Enable staff/test UIDs, then a bounded representative-recharge cohort.
- Observe at least one full Aristocracy duration/expiry/renewal cycle.

Implementation status (2026-08-13): operations code and local runbooks are
complete. Deployment, approved catalogs/assets, production inventory or a
documented zero-user migration skip, physical-device acceptance, live drills,
named sign-offs, and the full duration-cycle observation remain required before
this exit gate is closed.

Exit: objectives met, no duplicate debit/status, no unexplained drift, and
product/economy/security/support sign-off.

### Wave 7 - public rollout

- Roll out 5% -> 25% -> 50% -> 100% by country/cohort.
- Keep shop, progression presentation, animation, and announcement controls
  independent.
- Remove legacy VIP only after supported-client adoption reaches the approved
  threshold.

Exit: objectives stable for two weeks after 100%, reconciliation clean, and
operations ownership handed off.

## Rollback semantics

- **Aristocracy shop off:** blocks new quotes/purchases but preserves active
  privileges, owner status, expiry, history, and wallet truth.
- **VIP/SVIP presentation off:** keeps contributions and accounts processing;
  hides optional surfaces only after product approval.
- **Animation off:** renders static native badges/frames.
- **Announcement off:** stops new celebrations without changing status.
- **Worker freeze:** financial transfers/purchases use outbox evidence and catch
  up before re-enable; drift is visible and alerted.
- **Catalog retirement:** prevents new use but never mutates transactions made
  under that immutable version.

No rollback flag can refund, grant, debit, extend, shorten, or erase an
entitlement by itself.

## Blocking decision register

Wave 0 is incomplete until each item has an owner, decision date, and version:

1. Client-provided Salam/Hilo reference screens and exact desired behavior.
2. VIP/SVIP level count, display labels, thresholds, and maximum.
3. Eligible recharge sources and point conversion policy.
4. Reversal/demotion and legacy-user promise policy.
5. Aristocracy rank names and cultural/brand approval.
6. Rank prices, duration, upgrade rounding, and renewal behavior.
7. Exact benefits and explicit prohibited privileges.
8. Status visibility, celebration thresholds, and rate limits.
9. Admin dual-control thresholds and complimentary grant limits.
10. SLOs, retention, support compensation policy, rollout metrics, and go/no-go
    owners.

## Production definition of done

Production-ready means:

- VIP/SVIP is a deterministic recharge ladder, Aristocracy is a clearly
  disclosed manual coin purchase, and neither auto-renews or uses external
  billing.
- Only server-authoritative recharge/reversal and wallet evidence changes
  status; clients cannot supply financial truth.
- Replays/concurrency create no duplicate points, debits, transactions,
  entitlements, transitions, or announcements.
- Wallet, contribution, account, entitlement, transaction, and projection
  reconciliation has zero unexplained drift.
- Arabic RTL/English, accessibility, offline, error, expiry, and static fallback
  experiences pass on physical iOS and Android devices.
- Paid/earned status cannot weaken moderation, consent, room access, staff
  visibility, rate limits, or financial controls.
- Admin controls, two-person approval, queues, dead letters, dashboards, alerts,
  retention, support, incidents, and rollback are owned and tested.
- A full Aristocracy duration cycle succeeds in closed beta and all named owners
  approve public rollout.

## Realistic schedule and ownership

With one backend engineer, one mobile engineer, and shared design/QA/security,
the implementation is approximately 8-12 engineering weeks plus one full
Aristocracy duration observation cycle. Solo implementation is more
realistically 14-20+ weeks. Comparator uncertainty, economy decisions, art,
and production-data repair can extend the schedule.

## Research references

- Salam Android listing:
  https://com-xfaceline-wagas.en.uptodown.com/android
- Salam App Store listing:
  https://apps.apple.com/sa/app/id6566183765
- Public Salam SVIP product metadata:
  https://appshunter.io/ios/app/salam-party-and-games/id6566183765
- Hilo Google Play listing:
  https://play.google.com/store/apps/details?id=com.qiahao.nextvideo
- Hilo App Store listing:
  https://apps.apple.com/app/id1519958782
- Expo SDK 56 reference:
  https://docs.expo.dev/versions/v56.0.0/
