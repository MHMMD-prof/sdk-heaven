# VIP, SVIP, and Aristocracy Wave 2 Progression

Status: complete locally; ready for catalog approval and deployment review

Implemented: 2026-08-13

Parent plan: [VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md](VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md)

## Outcome

Wave 2 implements the authoritative VIP/SVIP progression pipeline. It does not
implement Aristocracy purchases or change the Me page. There are currently no
users to migrate, so this implementation does not require a prolonged dark or
closed-beta phase. The independent controls remain as operational kill
switches, and the pipeline can be enabled directly after the real catalog is
approved, published, deployed, and smoke-tested.

- A completed representative **coin** transfer creates one deterministic
  status-source outbox event inside the same Firestore transaction as the
  wallets, ledgers, receipts, transfer fact, proof consumption, and command.
- Diamond transfers never create VIP/SVIP evidence.
- A completed representative reversal creates one deterministic negative event
  linked to the original positive event inside the reversal transaction.
- The worker re-reads the authoritative transfer or reversal before awarding
  points. Wallet `lifetimeCredit`, client data, generic receipts, and spending
  are not progression authorities.
- One immutable `vipContributions/{eventId}` fact is created per source event.
  Firestore transactions serialize concurrent retries, so replays cannot grant
  twice.
- The account stores current net points, current tier, and the highest tier
  order ever reached. A valid linked reversal may demote the current tier but
  does not erase highest-reached history.
- Every tier change creates immutable promotion/demotion history at
  `vipTransitions/{uid}/items/{eventId}` and queues a sanitized presentation
  projection.
- Retryable failures use bounded exponential backoff. Permanent authority
  mismatches and exhausted retries are dead-lettered without changing points.
- Daily reconciliation recomputes account truth from immutable contributions,
  validates reversal links, detects duplicate reversal links, invalid net
  points, account/tier drift, signed-point drift, and level-distribution drift.
  It paginates deterministically and reports truncation instead of claiming a
  clean result when its one-million-document safety bound is exceeded.
- The migration utility is intentionally dry-run-only. It reads only completed
  representative transfer/reversal facts, excludes diamonds, reports malformed
  or unmatched evidence, and emits a deterministic SHA-256 snapshot hash.

## Source layout

| Source | Responsibility |
| --- | --- |
| `functions/statusProgressionCore.js` | Deterministic source IDs, coin-to-point arithmetic, tier transitions, migration preview/hash, and reconciliation |
| `functions/statusProgressionService.js` | Outbox processor, authority verification, retry/dead-letter handling, transactional contribution/account/history writes, and paginated audit |
| `functions/representativeService.js` | Atomic recharge and reversal outbox producers |
| `functions/scripts/dryRunVipContributionMigration.js` | Bounded, paginated, apply-forbidden migration inspection |
| `functions/index.js` | One-minute progression processor and daily reconciliation schedules |

## Exact authority and idempotency

For a representative transfer ID `T`:

- recharge event ID: `representative_T`;
- reversal event ID: `representative_reversal_T`; and
- reversal link: `representative_T`.

The positive source must match `representativeTransfers/T`; the negative source
must match `representativeTransferReversals/T`. UID, amount, currency, status,
timestamp, transfer ID, catalog version, and computed point delta must agree.
Any existing contribution with a different fingerprint is a permanent conflict.

Point conversion uses integer arithmetic:

`floor(coins * pointsPerCoinNumerator / pointsPerCoinDenominator)`

The reversal uses the exact negative of that result. A sub-point event is
rejected rather than rounded up, and an over-reversal can never make the account
negative.

## Activation path

No catalog or flag was written by this wave. Before activation:

1. Approve the real VIP/SVIP thresholds, names, point ratio, benefits, copy, and
   two-person catalog publication.
2. Deploy the reviewed Functions, Firestore rules, and indexes.
3. Publish the catalog and its `statusCatalogPointers/vip-svip` pointer.
4. Run `npm --prefix functions run status:vip:migration:dry-run` and require
   `clean: true`. With no historical users, it should report an empty or fully
   explained input set.
5. Enable `vipProgression`. Enable `statusPresentation` and
   `statusProjectionRepair` when the Wave 4 presentation is ready.
6. Run one representative coin recharge and linked reversal smoke test, then
   require clean reconciliation.

The flags are rollback controls, not a requirement to keep an empty product in
a long dark-launch phase.

## Verification

- Wave 2 syntax gate: passed.
- Focused progression, representative integration, Wave 1 compatibility, and
  migration CLI tests: 5 files and 47 tests passed.
- The focused suite covers deterministic coin-only evidence, exact integer
  conversion, promotion, demotion, over-reversal rejection, concurrent worker
  replay, source mismatch dead-lettering, migration mismatch reporting,
  reconciliation drift, and a 2,000-transfer/200-user load preview.
- Full non-emulator application suite: 317 files and 1,717 tests passed.
- Firestore and Storage emulator suite: 2 files and 76 tests passed. The runner
  reproduced its pre-existing Storage null-evaluation warnings and Java
  shutdown exception after the successful result; its reported exit code was 0.
- JSON parsing, Wave 2 syntax checks, and `git diff --check`: passed.

No production deployment, catalog publication, feature enablement, wallet
mutation, migration write, or user-status write was performed by Wave 2.
