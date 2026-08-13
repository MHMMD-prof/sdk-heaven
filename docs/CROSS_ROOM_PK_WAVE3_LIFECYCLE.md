# Cross-room PK Wave 3 — Lifecycle, Rules, Indexes, and Rollback

Status: implemented locally; `crossRoomPk` remains disabled by every supported
growth rollout preset

Completed: 2026-08-13

Parent plan: [CROSS_ROOM_PK_PRODUCTION_PLAN.md](CROSS_ROOM_PK_PRODUCTION_PLAN.md)

Wave 2 settlement: [CROSS_ROOM_PK_WAVE2_SETTLEMENT.md](CROSS_ROOM_PK_WAVE2_SETTLEMENT.md)

## Delivered

- A retryable room-document lifecycle trigger detects close, removal, staff
  lockdown, and gift-pause transitions from every owner, moderator, and admin
  mutation path.
- Pending challenges are cancelled immediately when either room becomes
  ineligible, with matching pointers cleared conditionally on both rooms.
- Active V2 sessions move immediately to verified settlement. The invalid room
  forfeits, simultaneous invalidation becomes `both`/void, and both active
  pointers remain until terminal reconciliation publishes the result.
- Lifecycle transactions recover pointers from the pre-update event when a
  deleting/finalizing mutation removes fields, and never mutate V1 in-room PK.
- The minute worker expires pending challenges, starts natural V2 settlement,
  drains cross-room work after either kill switch turns off, reconciles jobs,
  and clears expired recent-result pointers in bounded batches.
- Flag-off challenge cancellation and session settlement re-read the current
  flags inside their transactions, closing re-enable races while preserving
  in-room PK when only `crossRoomPk` is disabled.
- Terminal finalization updates the symmetric room-pair cooldown with bounded
  retention.
- The two-minute recent-result pointer survives room closure and is cleared
  only when its stored expiry is reached.

## Firestore authorization

- V1 session reads retain their active-room membership behavior.
- Strict V2 sessions and score shards are readable by an active membership in
  either the red or blue room, even if the room document is closed during the
  short terminal-result window.
- V2 identity must contain distinct red/blue IDs, the red compatibility alias,
  and immutable ordered `roomIds`; malformed parents and their shards fail
  closed.
- Challenges are readable only to an active member of either participating
  room.
- Session/challenge/shard writes and every fact, gifter, reconciliation,
  cooldown, rate-limit, command, and audit write remain backend-only.
- Existing room create/update allowlists still exclude all PK pointer fields.

## Indexes and retention

The index manifest now covers:

- challenge `status + expiresAt`;
- session `mode + status + endsAt`, `mode + status`, and
  `status + settleAfter`;
- reconciliation `status + leaseExpiresAt` and `status + updatedAt`;
- active/public room discovery; and
- committed gift reconciliation by `pkContext.pkId + createdAt`.

TTL overrides cover challenges, V2 sessions, score shards, gift facts,
projection/reconciliation gifter markers, reconciliation jobs, user/room rate
records, command requests, pair cooldowns, and PK audit events.

## Verification

Lifecycle/service coverage includes:

- close, remove, lockdown, and gift-pause classification;
- pending challenge cancellation and conditional two-room pointer cleanup;
- single-room forfeit and serialized dual-invalid void;
- challenge expiry and stale/newer pointer safety;
- isolated `crossRoomPk` rollback with V1 preservation;
- V1 lifecycle non-interference;
- recent-result cleanup; and
- index, TTL, and dark-preset manifest assertions.

Verification results:

- Functions: 169 test files passed, 1,001 tests passed.
- Firestore/Storage emulator: 2 files passed, 78 tests passed.
- Function syntax/lint passed.
- Index manifest parsed with 108 indexes, 21 field overrides, and no exact
  duplicate definitions.

The emulator prints pre-existing Storage Rules null-evaluation diagnostics and
a Firebase Emulator shutdown `NullPointerException`, but the test process exits
successfully with all 78 assertions passing.

## Intentional Wave 4 boundaries

- No mobile opponent picker, challenge sheet, scoreboard, reconnect controller,
  or result UI is included.
- No push notification workflow is included.
- No dedicated audited cross-room enable command exists yet. General growth
  rollout presets continue writing `crossRoomPk: false`.
- Indexes, TTL policies, rules, triggers, and functions are implemented only in
  the local repository; deployment and index `READY` confirmation remain
  release operations.
- Production telemetry dashboards and alert routing remain later operational
  waves. The feature must stay dark until those gates and Wave 4 client safety
  are complete.
