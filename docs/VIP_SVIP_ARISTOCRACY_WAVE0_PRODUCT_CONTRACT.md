# VIP, SVIP, and Aristocracy Wave 0 Product Contract

Status: in progress; repository and deployed-function discovery complete;
client evidence, production economy export, and named approvals pending

Version: `wave0-draft-1`

Started: 2026-08-13

Parent plan: [VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md](VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md)

## Wave 0 objective

Freeze a testable product and economy contract before implementing authority,
migration, purchase, or presentation code. Wave 0 performs no production
writes, publishes no catalog, grants no status, and changes no feature flag.

Wave 0 is complete only when:

- the client approves the intended Salam and Hilo reference behavior from
  dated screenshots or recordings;
- all decisions in this document have an owner, approval date, and outcome;
- production recharge and wallet data has been analyzed without exposing
  personal data;
- VIP/SVIP thresholds and Aristocracy prices pass the approved simulations;
- Arabic and English names, benefits, prohibitions, and asset briefs are
  approved; and
- Product, Economy, Engineering, Security, QA, Support, and Release sign the
  exit record.

## Non-negotiable product boundary

1. No Apple, Google, RevenueCat, Stripe, carrier, or other subscription or
   payment integration is used.
2. VIP/SVIP is permanent recharge progression. It has no purchase, expiry,
   renewal, or recurring charge.
3. Aristocracy is a manual fixed-duration purchase using existing wallet coins.
   Every purchase, renewal, or upgrade requires explicit confirmation. It never
   auto-renews.
4. Neither system changes moderation, consent, room access, staff authority,
   blocks, bans, rate limits, financial controls, or age/region rules.
5. The client never supplies a trusted recharge amount, point total, price,
   expiry, or entitlement.

Changing any boundary above requires a new product proposal and security
review; it is not an administrator customization.

## Evidence ledger

### Comparator evidence

| ID | Source | Observation | Confidence | Product implication |
| --- | --- | --- | --- | --- |
| `E-C01` | Salam Android public listing | Mentions free VIP upgrade for new users and migration of an ID and wealth level | Medium; public listing, not an authenticated product walkthrough | Supports progression/status, but proves no thresholds or benefits |
| `E-C02` | Third-party Salam iOS metadata | Lists SVIP products with one-, three-, and twelve-month terms | Low to medium; third-party metadata | Salam may be hybrid; this project still explicitly excludes external subscriptions |
| `E-C03` | Hilo App Store listing | Exposes `Hilo VIP Monthly` | High for the listed product name, low for current in-app behavior | Hilo is not evidence for a single progression-only model |
| `E-C04` | Public Hilo reviews | Users mention numbered SVIP levels, including SVIP4 | Low to medium; user-authored evidence | Supports numbered status levels, not pricing or privileges |
| `E-C05` | Client-provided Me-page screenshot, 716×1600, SHA-256 `5D681446F278A91CC9E648E0C3E5D0B1790F6DB81C6F6EFA982ACAD08C048958` | Approves only the two adjacent SVIP and Noble/Aristocracy status-card composition; explicitly excludes the rest of the page | High for this visual scope | Use the card layout as a reference with original artwork; remaining comparator flows are still required |

Public listings establish vocabulary and product shape only. They are not a
specification for level count, thresholds, prices, duration, or privileges.

The client evidence package must identify the app, platform, country/store
region, app version/build, capture date, and desired behavior on each screen.
It must cover status home, all levels/ranks, progress, purchase or join,
upgrade, renewal, expiry, benefits, history, public presentation, and relevant
admin controls. Account IDs and payment information must be redacted.

### Repository evidence

| ID | Observed state | Consequence |
| --- | --- | --- |
| `E-R01` | `growthVipCore.js` defines Bronze, Silver, Gold, Platinum, and Diamond at 1,000 / 5,000 / 20,000 / 50,000 / 150,000 lifetime credited coins | This is a five-level prototype, not the approved VIP/SVIP ladder |
| `E-R02` | VIP resolution reads `walletSummaries.lifetimeCredit.coins` | It counts rewards, promotions, and admin credits and cannot be authoritative for paid recharge progression |
| `E-R03` | Representative transfers create completed recipient recharge receipts with transfer ID, currency, amount, representative, recipient, and balances | These receipts are a suitable V1 positive evidence source |
| `E-R04` | Reversals create linked recharge receipts with `kind: reversal`, `status: reversed`, and `reversalOf` | Deterministic negative contributions can be derived without using wallet balance as history |
| `E-R05` | Representative policy is fail-closed until complete per-currency transfer limits exist | VIP ingestion must preserve that fail-closed behavior |
| `E-R06` | Store purchase already validates server catalog state and atomically debits a wallet, writes ledgers, and grants timed ownership | Its transaction pattern can inform Aristocracy, but existing store ownership is not the entitlement authority |
| `E-R07` | Store prices in the repository are mock, test, or development seed values | They must not be used to price Aristocracy |
| `E-R08` | Public-profile rules do not currently admit the VIP projection parsed by backend/client code | Wave 1 must repair the schema/rules mismatch before new presentation writes |

### Read-only deployed inventory

Observed on 2026-08-13 with `firebase functions:list` against the configured
project `yallgame-ebd19`:

- 53 deployed functions were reported, all in `ACTIVE` state;
- `socialCommand` is active as a Node.js 22 callable in `us-central1`;
- `representativePortal` is active as a Node.js 22 HTTPS function in
  `us-central1`; and
- no deployed function name contains `vip` or `aristoc`.

This inventory proves only function metadata. It does not prove deployed rules,
catalog documents, feature-flag values, receipt quality, client adoption, or
correct runtime behavior. The production Firestore economy inventory remains
pending because application-default credentials were unavailable; no attempt
was made to bypass that control.

## Working product contract

The following items are implementation defaults for review. A row marked
`Proposed` is not permission to publish or migrate production data.

### VIP/SVIP ladder

| Decision | Working default | State |
| --- | --- | --- |
| Structure | One ordered ladder: `VIP1`–`VIP10`, then `SVIP1`–`SVIP10` | Proposed |
| Simultaneous status | Exactly one current level; SVIP replaces VIP presentation | Proposed |
| Persistence | Permanent except verified reversal/fraud correction | Proposed |
| V1 eligible source | Completed representative recharge receipts | Proposed |
| V1 currency | Coins only | Proposed |
| Point conversion | 1 eligible net coin = 1 point | Proposed; simulation required |
| Excluded sources | Admin credit, daily rewards, promotions, games, gifts received, purchase refunds, and ordinary transfers | Proposed |
| Spending effect | Spending never reduces points | Proposed |
| Reversal effect | Linked verified reversal subtracts the original contribution and may demote | Proposed |
| Negative floor | Account points never fall below zero | Proposed |
| Threshold storage | Immutable versioned server catalog | Proposed |
| Catalog change | New contributions use the active version; migration behavior requires explicit publish decision | Proposed |
| Public display | Highest current level only; user may hide public presentation | Proposed |
| Private truth | Remains visible to owner/support even when public presentation is hidden | Proposed |
| Legacy Bronze–Diamond | No automatic name mapping; reconstruct only from eligible receipts unless an approved honor policy exists | Proposed |

Diamonds remain excluded until Product and Economy define a stable conversion
and prove that representative diamond transfer semantics represent recharge.
Adding a source later requires a new source-policy version and historical
backfill decision.

No final thresholds are proposed before production data is analyzed. Choosing
round-looking values without the recharge distribution could make the ladder
meaningless, unattainable, or immediately maxed.

### Aristocracy

| Decision | Working default | State |
| --- | --- | --- |
| Stable product term | Aristocracy | Proposed; Arabic brand term pending |
| Purchase currency | Existing wallet coins only | Proposed |
| Duration | 30 days for every rank in V1 | Proposed |
| Renewal | Manual, full price, explicit confirmation | Proposed |
| Upgrade | Higher rank only; prorated difference; expiry unchanged | Proposed |
| Downgrade | Takes effect only through expiry followed by a new purchase | Proposed |
| Refund | No automatic downgrade/cancellation refund | Proposed; support policy pending |
| Gifting/transfer | Not available in V1 | Proposed |
| Auto-renew | Prohibited | Fixed |
| External billing | Prohibited | Fixed |
| Price authority | Immutable published server catalog and short-lived server quote | Proposed |

Working rank set, pending cultural and brand approval:

| Order | Stable ID | Arabic | English | State |
| ---: | --- | --- | --- | --- |
| 1 | `knight` | فارس | Knight | Proposed |
| 2 | `baron` | بارون | Baron | Proposed |
| 3 | `viscount` | فيكونت | Viscount | Proposed |
| 4 | `count` | كونت | Count | Proposed |
| 5 | `marquis` | ماركيز | Marquis | Proposed |
| 6 | `duke` | دوق | Duke | Proposed |
| 7 | `prince` | أمير | Prince | Proposed |
| 8 | `sultan` | سلطان | Sultan | Proposed |

The spelling `الاستراقيه` is not approved product copy. The intended concept is
likely `الأرستقراطية`, but Arabic localization and cultural review must decide
whether a clearer customer-facing label such as `المراتب الملكية` is better.
Stable IDs must not depend on translated labels.

For an active upgrade, the server-owned V1 quote formula is:

```text
remainingMs = max(0, expiresAt - serverNow)
priceDifference = targetPriceCoins - currentPriceCoins
amountDue = ceil(priceDifference * remainingMs / durationMs)
newExpiry = current expiresAt
```

The server binds each quote to UID, source rank, target rank, entitlement
expiry, catalog version, amount, and a short expiry. The client confirms a
quote ID and idempotency key; it never sends a trusted price.

### Benefits and prohibitions

Launch benefits are presentational:

- numbered badge or noble title on approved surfaces;
- tier/rank avatar frame and nameplate;
- selected chat bubble;
- bounded room-entry effect with static and reduced-motion fallbacks;
- Status Center progress, history, expiry, and renewal information; and
- access to designated cosmetic catalog items without a price discount.

The following are prohibited at launch and cannot be enabled through the admin
dashboard:

- moderation powers or immunity;
- block, ban, consent, DM, room password, capacity, or age/region bypass;
- hiding identity from staff, audit, report, or safety systems;
- coin stipends, recharge bonuses, refunds, discounts, credit, or exchange-rate
  changes;
- gift/game odds, scoring, ranking, commission, or payout advantages;
- unbounded animation, sound, broadcast, or notification privileges; and
- client-selected assets, scripts, URLs, colors, effects, prices, or commands.

### Me-page status-card design contract

The client-approved reference applies only to the two compact landscape cards.
It does not approve copying the reference profile header, wallet, icon grid,
menus, bottom navigation, typography, or page background.

Placement in the existing app:

- render one two-card row directly below the current profile summary card and
  directly above `الوصول السريع`;
- keep the SVIP card in the left visual slot and Aristocracy in the right visual
  slot, matching the supplied composition;
- use equal widths, a consistent gap, and one shared height;
- use approximately a 3.2:1–3.6:1 card aspect ratio rather than literal square
  cards; and
- on narrow screens, reduce internal art and type before stacking. Stacking is
  the final fallback only when two cards cannot meet text and touch-target
  requirements.

Card composition:

| Element | SVIP card | Aristocracy card |
| --- | --- | --- |
| Background | Deep emerald-to-near-black gradient with restrained gold highlights | Midnight/royal-blue-to-near-black gradient with restrained gold highlights |
| Hero object | Original faceted-gem or VIP-emblem artwork entering from the left/lower edge | Original crown or noble-emblem artwork entering from the left/lower edge |
| Primary label | `SVIP` plus current numbered level when available | Approved localized product label plus current rank when active |
| Type treatment | Large gold/ivory, heavy or display weight, high contrast | Large gold/ivory, heavy or display weight, high contrast |
| Optional corner ribbon | `جديد` / `NEW` only when a server-owned unseen/new state is true | Same rule if Product enables it |
| Tap destination | Status Center, VIP/SVIP tab | Status Center, Aristocracy tab |

The source screenshot's diamond, crown, gradients, lettering, and ribbon are
composition references, not production assets. Design must create original
artwork that fits this app's ruby-and-gold visual system. All production assets
must use the canonical approved asset pipeline, fixed dimensions, checksum,
static fallback, and bounded file/performance budgets.

Behavior and accessibility:

- the whole card is one button with a clear pressed/focus state and at least a
  48×48 dp interactive target;
- screen-reader labels describe destination and current state, for example
  `SVIP، المستوى 4، عرض التقدم`;
- decorative art is hidden from accessibility traversal;
- text remains readable at supported font scaling without clipping the current
  level or rank;
- reduced motion disables shimmer/parallax and uses the static composition;
- loading uses a stable skeleton without changing row height;
- an unavailable status shows honest neutral copy and never fabricates a level,
  rank, price, or expiry; and
- the two cards have independent presentation flags so either system can be
  hidden without changing its authority or the rest of the Me page.

The existing small legacy VIP chip may remain during dual-read migration, but
it must be removed once the new status projection and supported-client adoption
gate pass. The final page must not show contradictory legacy and new levels.

## Administrator customization contract

Customization is good when it is typed, versioned, reviewed, and bounded.
Administrators may draft labels, descriptions, ordered levels/ranks, strictly
increasing thresholds/prices, approved benefit keys, approved canonical assets,
visibility defaults, and celebration settings within server limits.

Published catalogs are immutable. Editing creates a new draft version. The
server rejects unknown keys, duplicate IDs/orders, decreasing thresholds,
unsupported currencies/durations/benefits, noncanonical assets, and values
outside absolute ceilings. Publishing requires a reason, conflict token,
preview/diff, immutable audit event, and a second eligible approver for
economy-affecting versions. An author cannot approve their own high-risk
version.

Administrators cannot directly edit wallet balances, points, current level,
entitlement expiry, or history documents. Corrections and complimentary grants
use typed compensating commands with idempotency keys, reason codes, limits,
expiry, audit, and—above the approved risk threshold—two-person approval.

## Economy simulation contract

### Required read-only inputs

Use the longest reliable window up to 365 days, with a minimum target of 180
days. Export aggregates or pseudonymous rows only; never include display name,
email, phone, public ID, IP address, message content, or representative PIN.

1. Recharge evidence: stable pseudonymous user key, transfer ID, event time,
   currency, amount, status, reversal ID, and `reversalOf`.
2. Wallet state: pseudonymous user key and current coin balance.
3. Wallet activity: pseudonymous user key, event time, coin amount, direction,
   source category, and idempotent reference—not free-text notes.
4. Store activity: pseudonymous user key, event time, item category, coin
   price, transaction kind, and success state.
5. Population denominators: daily/monthly active eligible users and active
   rechargers by approved country cohort; suppress small cohorts.
6. Data-quality counts: malformed, duplicate, unmatched reversal,
   over-reversal, missing timestamp/currency/amount, and unsupported currency.

The export owner must record project, query version, UTC window, extraction
time, row counts, SHA-256 hashes, suppression rule, and access/retention owner.
Raw exports remain access-controlled outside Git. Only aggregate results and
approved threshold/price candidates belong in this repository.

### VIP/SVIP simulation outputs

For every candidate catalog, calculate:

- user count and percentage at every level, with zero-point users separate;
- p10/p25/p50/p75/p90/p95/p99 net eligible points among rechargers;
- time from first eligible recharge to each reached level;
- 30/90/180/365-day transition rates;
- percentage already at maximum on launch day;
- demotions caused by valid reversals and users driven to the zero floor;
- concentration by approved country cohort and representative; and
- distribution changes under point multipliers `0.5`, `1`, and `2`.

Reject a candidate if any level is unreachable in the observation window,
multiple adjacent levels have no meaningful population, the maximum is
immediately saturated, or one representative/source anomaly determines a
material share of progression. Product and Economy must state their desired
launch distribution before selecting thresholds.

### Aristocracy simulation outputs

For every candidate rank-price curve, calculate:

- users and active rechargers who can afford each rank from current balance;
- affordability after preserving an approved minimum spending reserve;
- projected monthly coin sink at 0.5%, 1%, 2%, 5%, and 10% conversion;
- upgrade quote distribution for each source/target rank and remaining-day
  bucket;
- insufficient-funds rate, concentration, and top-user sensitivity;
- comparison with real 30-day cosmetic spending, excluding mock/test items;
  and
- worst-case support/refund liability under the approved compensation policy.

Reject a curve if it depends on mock prices, makes rank 1 inaccessible to the
intended cohort, makes most ranks indistinguishable, allows broad immediate
access to the maximum rank, creates an unowned support liability, or exceeds
approved wallet/debit limits.

### Simulation approval artifact

The signed result must contain:

- dataset window, quality report, and limitations;
- at least three VIP/SVIP threshold candidates and three Aristocracy price
  curves;
- aggregate tables/plots for every required output;
- selected candidate and explicit reasons rejected alternatives lost;
- sensitivity results and abuse/fraud observations; and
- Product, Economy, Engineering, and Security approval.

## Decision register

`Pending` means implementation may prepare dark, reversible foundations only;
it may not publish catalogs, migrate accounts, debit users, or grant status.

| ID | Decision | Recommended default | Owner | State |
| --- | --- | --- | --- | --- |
| `D-001` | Exact Salam/Hilo behavior to emulate | Two Me-page status cards approved; remaining screens require feature-by-feature evidence | Client/Product | Partially approved |
| `D-002` | VIP/SVIP level count and labels | VIP1–VIP10, SVIP1–SVIP10 | Product | Pending approval |
| `D-003` | Eligible sources/currency | Completed representative coin recharge only | Product/Economy | Pending approval |
| `D-004` | Point conversion | 1 net eligible coin = 1 point | Economy | Pending simulation |
| `D-005` | Thresholds | Select only from production-data simulation | Economy/Product | Pending export |
| `D-006` | Reversal/demotion | Linked reversal subtracts and may demote; zero floor | Product/Security | Pending approval |
| `D-007` | Legacy promise policy | Evidence reconstruction only; exceptions require an honor policy | Product/Support | Pending audit |
| `D-008` | Aristocracy name/ranks | Eight-rank working set; customer-facing Arabic label reviewed | Product/Localization | Pending approval |
| `D-009` | Duration | Fixed 30 days for every V1 rank | Product/Economy | Pending approval |
| `D-010` | Prices | Select only from production-data simulation | Economy | Pending export |
| `D-011` | Upgrade/renewal | Prorated upgrade with unchanged expiry; manual full-price renewal | Product/Economy | Pending approval |
| `D-012` | Benefits/prohibitions | Presentation benefits only; prohibited list fixed | Product/Security | Pending approval |
| `D-013` | Public visibility | User-hideable public presentation; private truth preserved | Product/Privacy | Pending approval |
| `D-014` | Admin customization | Typed drafts, immutable publish, audit, dual control for economy | Product/Security | Pending approval |
| `D-015` | Complimentary grants/corrections | Typed compensating command; capped; dual control above threshold | Economy/Security/Support | Pending limits |
| `D-016` | SLOs, retention, rollout, go/no-go | Must be named before Wave 1 exit | Release/Operations | Pending owners |

Each approval adds approver name, role, UTC date, evidence link, and the next
document version. Rejection records the alternative. No blank owner may be
treated as implicit approval.

## Immediate work queue

1. Client/Product supplies the remaining redacted Salam and Hilo flows; the
   two-card Me-page composition is already captured as `E-C05`.
2. An authorized data owner supplies application-default read credentials or
   runs the approved read-only aggregate export and provides its manifest.
3. Economy states desired launch distributions and spending reserve.
4. Product/Localization reviews `الأرستقراطية`, the alternative customer label,
   and the eight rank names.
5. Security and Product approve the prohibited-benefit list and admin-control
   boundary.
6. Owners review `D-001`–`D-016`; accepted decisions produce
   `wave0-candidate-1`.
7. The economy simulation produces candidates and the signers select one.
8. Design supplies an Arabic/English copy sheet and canonical asset brief.
9. QA converts every approved decision into acceptance cases.
10. Release records the final Wave 0 sign-off; only then may Wave 1 start.

## Exit checklist

- [ ] Comparator evidence package approved
- [x] Repository authority/economy audit recorded
- [x] Deployed function inventory recorded read-only
- [ ] Production economy export manifest and quality report approved
- [ ] VIP/SVIP simulation approved
- [ ] Aristocracy simulation approved
- [ ] Product decisions `D-001`–`D-016` approved or explicitly rejected
- [ ] Arabic/English copy sheet approved
- [ ] Asset brief and performance budgets approved
- [ ] Security/admin customization review approved
- [ ] QA acceptance matrix approved
- [ ] Support and incident policy approved
- [ ] Named Wave 0 signers approve the version

Wave 0 remains open. No production data was written and no feature was enabled
while creating this contract.
