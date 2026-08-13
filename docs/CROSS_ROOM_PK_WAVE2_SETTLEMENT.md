# Cross-room PK Wave 2 — Durable Scoring and Verified Settlement

Status: implemented locally; `crossRoomPk` remains disabled by every supported
growth rollout preset

Completed: 2026-08-13

Parent plan: [CROSS_ROOM_PK_PRODUCTION_PLAN.md](CROSS_ROOM_PK_PRODUCTION_PLAN.md)

Wave 1 foundation: [CROSS_ROOM_PK_WAVE1_FOUNDATION.md](CROSS_ROOM_PK_WAVE1_FOUNDATION.md)

## Delivered

- The room-gift transaction snapshots server-derived `pkContext`,
  `priceCoins`, and `createdAtMs` into each committed event when a valid PK is
  active. Gift debit and ledger settlement do not depend on PK projection.
- The retryable gift-event trigger projects cross-room gifts into one of 16
  deterministic score shards per side.
- `roomPkGiftFacts/{eventId}` makes projection idempotent; bounded
  `{side}_{uid}` marker documents make first-gifter counting idempotent without
  growing the session parent.
- Projection accepts delayed trigger delivery while a session is `settling`,
  but only when the source gift timestamp is inside the original session
  window and the server-authored PK context matches.
- Natural expiry and flag-off drain move V2 sessions from `active` to
  `settling` and create restart-safe reconciliation jobs.
- Authorized room surrender moves the session to `settling`, records the
  forfeiting side and immutable `scoringEndsAt` cutoff, preserves both active
  pointers during the ingestion grace, and creates the same reconciliation job
  used by natural expiry.
- Final reconciliation pages the committed room gift-event collections in
  `(createdAt, documentId)` order, checkpoints the exact Firestore timestamp
  and event ID, uses a unique worker identity per scheduler invocation, renews
  its lease, and processes at most 50,000 source documents per room.
- Reconciliation-owned gifter markers prevent page restart or lease takeover
  from double-counting unique contributors.
- Missing pagination data or scan-cap overflow produces
  `attention-required`; no result is guessed.
- Finalization re-reads the job, session, both rooms, and all 32 score shards in
  one transaction. It writes committed-event totals to the session, records
  live-projection drift, applies anti-farm/draw/forfeit resolution, completes
  the job, and atomically moves matching room pointers to the recent-result
  window.

## Safety and compatibility invariants

1. The committed gift event is the authoritative final score source. Shards
   are a live projection and may be repaired by reconciliation.
2. Quantity is never multiplied again: `priceCoins` already represents the
   committed total debit.
3. V1 in-room scoring and finalization remain separate. V2 documents never
   enter the V1 array-based projector or finalizer.
4. Parent V2 scores remain zero while active or settling and receive aggregate
   values only during verified terminal finalization.
5. Surrender is a verified forfeit: source gifts are still reconciled, but the
   opponent result overrides score.
6. A disabled `crossRoomPk` flag drains active V2 sessions while leaving the V1
   in-room path controlled independently by `roomPk`.
7. The existing gift transaction, wallet entries, and gift ledgers are never
   replayed or mutated during PK reconciliation.

## Verification

The focused suite covers:

- committed-event PK binding;
- strict in-window normalization using `priceCoins`;
- deterministic shard selection and aggregation;
- duplicate projector delivery and repeated-gifter idempotency;
- delayed delivery during settling;
- natural settlement and job creation;
- authoritative red/blue reconciliation and anti-farm resolution;
- transactional terminal pointer movement and drift recording;
- authorized surrender and forfeit metadata;
- cursor mismatch rejection, lease contention, lease expiry takeover, and
  exact resume after a full 100-event page;
- scan-cap and invalid-source `attention-required` outcomes; and
- V1 in-room compatibility.

The synthetic harness
`functions/scripts/crossRoomPkSettlementLoadTest.js` completed the maximum
bounded workload of 50,000 events per room (100,000 total), 1,002 pages, and 40
simulated lease takeovers with exact verified totals and zero drift.

Focused verification command:

```powershell
cd functions
npm.cmd exec -- vitest run crossRoomPkSettlementService.test.mjs crossRoomPkSettlementCore.test.mjs crossRoomPkContract.test.mjs roomPkCore.test.mjs roomPkService.test.mjs roomGiftService.test.mjs scripts/crossRoomPkSettlementLoadTest.test.mjs
```

Result: 7 test files passed, 52 tests passed.

## Intentional Wave 3 boundaries

- Firestore rules and composite indexes are not yet added for V2 reads,
  backend-only writes, or reconciliation queries.
- Room close/remove/moderation-lockdown hooks, pending-challenge flag-off
  cancellation, and lifecycle race coverage remain Wave 3.
- Retention cleanup/TTL configuration, operator repair tooling, telemetry
  sinks, and production alerts remain later operational waves.
- Client UI, notifications, admin rollout controls, and the audited enablement
  path remain later waves.
- The feature must remain dark until Wave 3 rules/indexes and rollback gates
  pass; Wave 2 is not a deployment-ready public release by itself.
