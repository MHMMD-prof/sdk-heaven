# Cosmetics and Room Effects Wave 10: hardening, migration, staged launch

## Outcome

Wave 10 is **local code complete** for tools, cores, runbooks, and staged-launch
metadata. No function, rule, catalog record, or presentation flag was deployed
or enabled.

This pass adds:

- canonical `{assetId, assetVersionId}` migration planner/applier
  (`cosmeticsMigrationCore.js`) with dry-run default backfill script;
- registry reconciliation owner script + dry-run-only schedule hook;
- alert threshold constants/evaluator (`cosmeticsHardeningCore.js`) and local
  client rate helpers in `runtimeTelemetry.ts`;
- Vitest load/chaos harnesses (queue, reactions, equip idempotency, fallback);
- staged rollout matrix (`cosmeticsRolloutCore.js`) matching WAVE_PLAN order;
- status script with `--assert-dark` and metadata-only stage recorder;
- admin Settings read-only rollout stage display (no enable buttons).

## Migration

Collections covered: `storeCatalog`, `giftCatalog`, `roomRocketCampaigns`,
`roomThemes`, `storeOwnerships`, `storeEquipment`, `publicProfiles`.

Rules:

- default dry-run;
- `--apply` requires `--actor-uid` (active Platform Owner);
- apply only when refs resolve to approved published versions;
- dual-read friendly: add canonical fields; do not strip legacy URLs;
- never delete immutable asset history.

Commands (functions package):

```bash
npm run cosmetics:migration
npm run cosmetics:migration -- --apply --actor-uid <ownerUid>
npm run cosmetics:reconcile
npm run cosmetics:reconcile -- --apply --actor-uid <ownerUid>
```

Scheduled `reconcileCosmeticAssetRegistry` always runs with `apply: false`.

## Hardening

Thresholds (pure evaluation over telemetry samples):

| Metric | Threshold |
| --- | --- |
| asset failure rate | > 5% |
| fallback rate | > 15% |
| first-frame delay p95 | > 1500 ms |
| queue expiry rate | > 10% |
| memory pressure rate (stub) | > 5% |
| crash-free session ratio (stub) | < 99.5% |

Automated harness covers gift/entry queue bounds, reaction spam aggregation,
rapid equip/unequip idempotency, checksum mismatch → fallback, and fetch miss →
fallback.

### Physical chaos remains a release gate

Phone call, audio route change, background/foreground, low memory, mid-play
disconnect, and device-specific renderer crash containment are **not** closed by
this local pass. They remain required before production enablement.

## Rollout stages

Order (WAVE_PLAN Wave 10):

0. `dark`
1. `internal`
2. `static-frames`
3. `animated-frames`
4. `gift-lottie`
5. `gift-mp4-restricted`
6. `entry-motion`
7. `categories`
8. `reactions-themes`
9. `couple`
10. `custom`

Each stage lists required flags and prerequisites in `cosmeticsRolloutCore.js`.

**This pass policy:** `setCosmeticsRolloutStage` writes only
`appRuntime/cosmeticsRollout` metadata (stage name/id, actor, timestamps). It
must **not** flip `appConfig/cosmeticsFeatures` to true. Presentation enablement
is a later ops gate. The only production-safe cosmeticsFeatures write in this
pass remains `setCosmeticsRendererFlags` (force false).

```bash
npm run cosmetics:rollout:status
npm run cosmetics:rollout:status -- --assert-dark
npm run cosmetics:rollout:stage -- --stage dark
npm run cosmetics:rollout:stage -- --stage internal --apply --actor-uid <ownerUid>
```

## Runbooks

### Asset takedown

1. Suspend the asset/version in Cosmetics Asset Registry (immutable history kept).
2. Confirm equipped projections reconcile away from the suspended version.
3. Do not delete ownership or ledger history.

### Emergency disable

1. Prefer admin Settings emergency «فرض false» for the affected couple/custom
   flags, or run `npm run cosmetics:renderer:disable -- --apply --actor-uid <uid>`
   to force the full dark patch.
2. Preserve economy, ownership, and audits.
3. Fall back to bundled/static presentations.

### Approval appeal

1. Keep the rejected/suspended version immutable.
2. Require a new version + fresh approval path.
3. Never mutate an already-approved checksum/storagePath in place.

### Cache / version incident

1. Disable the affected presentation flag (or full dark patch).
2. Suspend the bad published version; publish a corrected new version.
3. Re-run migration dry-run + registry reconcile dry-run; apply only after review.

### Rollback

1. Record stage metadata back toward `dark` if needed (metadata only).
2. Force cosmeticsFeatures false via renderer disable script.
3. Ship forward fixes; never destructively roll back issued ownership.

## Open gates

1. Physical Android/iOS chaos and acceptance.
2. Deployment of functions, schedules, admin surfaces, and scripts.
3. Explicit later enablement of presentation flags per stage (not this pass).
4. Production observation windows between stages.

## Verification (local)

- focused Wave 10 core + harness tests
- root `tsc --noEmit`
- non-emulator `npm test`
- `npm run lint:cosmetics-wave10` in functions
