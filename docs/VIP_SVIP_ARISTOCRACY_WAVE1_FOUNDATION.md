# VIP, SVIP, and Aristocracy Wave 1 Foundation

Status: complete locally; dark and not deployed

Implemented: 2026-08-13

Parent plan: [VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md](VIP_SVIP_ARISTOCRACY_PRODUCTION_PLAN.md)

Wave 0 decisions and economy simulation remain open. The user authorized Wave
1 to begin, so this wave implements only reversible, non-user-visible authority
foundations. It does not publish a catalog, migrate an account, consume a
recharge receipt, debit a wallet, grant an entitlement, or enable a flag.

## Outcome

- Added strict, separately versioned VIP/SVIP and Aristocracy catalog schemas.
- Added private VIP account, contribution, Aristocracy entitlement, source
  outbox, and projection-job contracts.
- Added a sanitized, user-hideable public status projection that contains no
  points, prices, expiry, wallet data, or administrative metadata.
- Added six independent status flags that fail closed when missing or malformed.
- Added an authenticated read-only `statusCommand` callable with
  `enforceAppCheck: true`; no released client calls it.
- Added a scheduled projection reconciler that exits without querying its queue
  unless both presentation and repair flags are enabled.
- Repaired the Firestore public-profile schema to admit the current bounded
  legacy `vipTier` projection, including its intentional `null` state.
- Kept every new authority, catalog, job, outbox, quote, transaction, and
  command document inaccessible to Firestore clients.
- Added indexes required by future outbox/projection workers and reconciliation.
- Preserved the legacy Bronze–Diamond implementation unchanged for supported
  clients; no dual-read cutover occurs in Wave 1.

## Source layout

| Source | Responsibility |
| --- | --- |
| `functions/statusMembershipCore.js` | Pure schemas, catalog validation, immutable-publish guard, authority mappers, source outbox, public projection, flags, and command normalization |
| `functions/statusMembershipService.js` | Read-only private overview and fail-closed projection-job processing |
| `functions/index.js` | App Check-protected callable and dark scheduled reconciler exports |
| `functions/socialProfileCore.js` | Preserves only a valid sanitized status projection during profile repair |
| `firestore.rules` | Legacy VIP repair, sanitized projection validation, readable public flag, and server-only authority boundaries |
| `firestore.indexes.json` | Status job, source outbox, contribution, transaction, and account reconciliation indexes |

## Catalog invariants

VIP/SVIP catalogs:

- contain at least one VIP and one SVIP level;
- require ordered, unique, contiguous levels with all VIP levels before SVIP;
- require strictly increasing non-negative thresholds;
- accept only completed representative coin recharge as the point source;
- require linked-net reversals and no spending effect;
- accept only allowlisted presentational benefits and canonical asset IDs; and
- reject unknown keys and prohibited benefit identifiers.

Aristocracy catalogs:

- require one fixed duration for every rank in a version;
- require ordered, unique ranks and strictly increasing positive coin prices;
- hard-code manual full-price renewal, no auto-renewal, no gifting, downgrade
  after expiry, and ceiling-rounded prorated upgrades with unchanged expiry;
- accept only allowlisted presentational benefits and canonical assets; and
- reject unknown keys.

Published or retired versions are immutable. Publishing requires distinct
author and approver identities. This core guard complements, but does not
replace, the future audited admin publish workflow.

## Feature flags

`appConfig/statusFeatures` uses schema version 1 and these independent booleans:

| Flag | Default | Purpose |
| --- | --- | --- |
| `vipProgression` | `false` | Expose the new VIP/SVIP catalog and account path |
| `aristocracyShop` | `false` | Expose the Aristocracy catalog; no purchase exists yet |
| `statusPresentation` | `false` | Permit new public status presentation |
| `statusProjectionRepair` | `false` | Permit projection-job processing and repair |
| `statusAnnouncements` | `false` | Reserved independent celebration rollback |
| `statusAnimations` | `false` | Reserved independent motion rollback |

Missing schema, missing document, malformed values, and unknown values all
resolve to disabled. No flag is written or enabled by this implementation.

## App Check path

The existing `socialCommand` callable is unchanged so older clients are not
broken. The new `statusCommand` is safe to enforce from its first deployment
because it has no released caller and currently supports only
`get-status-overview`.

Expo SDK 56 documentation was reviewed before implementation. Expo's
`@expo/app-integrity` remains alpha and has explicit device-support and gradual
rollout constraints, so Wave 1 does not add it to the mobile runtime. The app
already carries Firebase App Check dependencies; client attestation and
physical-device acceptance remain a staged rollout task before this callable
is used. Reference:
https://docs.expo.dev/versions/v56.0.0/sdk/app-integrity/

## Verification

- Wave 1 syntax check: passed.
- Focused core/service/profile/legacy compatibility tests: 4 files, 32 tests,
  all passed.
- Firestore and Storage emulator suite: 2 files, 76 tests, all passed. The
  runner emitted pre-existing Storage rules null-evaluation warnings and a Java
  shutdown exception after reporting success; exit code was 0.
- Full non-emulator application suite: 315 files and 1,704 tests, all passed on
  the final run. An earlier run had one copy-encoding timeout under concurrent
  load; the test passed in isolation and in the final full run.
- JSON parsing and `git diff --check`: passed.
- Installed Firebase Functions v2 types/runtime confirm `enforceAppCheck` is
  supported by the repository's pinned dependency.

## Remaining gates

Wave 1 has no production effect until an explicit rollout operation later:

1. Complete Wave 0 economy and product approvals.
2. Publish approved catalogs through the future two-person admin workflow.
3. Add the Wave 2 deterministic recharge/reversal producer and contribution
   processor.
4. Configure Firebase App Check providers and pass development-build tests on
   supported physical Android and iOS devices.
5. Deploy rules, indexes, and functions through the normal reviewed release.
6. Verify all six production flags remain false after deployment.

No production deployment or production data write was performed in Wave 1.
