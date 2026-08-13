# Cross-room PK Wave 1 Foundation

Status: implemented locally; `crossRoomPk` remains disabled by every supported
growth rollout preset

Completed: 2026-08-13

Parent plan: [CROSS_ROOM_PK_PRODUCTION_PLAN.md](CROSS_ROOM_PK_PRODUCTION_PLAN.md)

Wave 0 contract: [CROSS_ROOM_PK_WAVE0_PRODUCT_CONTRACT.md](CROSS_ROOM_PK_WAVE0_PRODUCT_CONTRACT.md)

## Delivered

- Cross-room command normalization and validation for discovery, challenge
  creation/status, accept, decline, cancel, and the reserved surrender shape.
- Deterministic challenge and session IDs.
- Strict V1 in-room and V2 cross-room session mapping.
- Fail-closed rollout-policy mapping with stable symmetric room-pair hashing.
- Server-filtered, bounded, cursor-based opponent discovery returning only
  sanitized presentation fields.
- Atomic two-room challenge reservation.
- Atomic acceptance creating one V2 session, 32 zero-valued score shards, both
  room pointers, terminal challenge state, replay state, and audit record.
- Atomic decline/cancel/expiry and conditional two-room pointer cleanup.
- User, room, and repeated-opponent throttling contracts.
- Bidirectional authority-block and active-profile checks at discovery,
  creation, and acceptance.
- Stale pointer repair only after the referenced challenge/session is terminal
  or missing.
- Legacy in-room protection: an in-room PK cannot start while a cross-room
  challenge reserves the room; V2 sessions cannot enter V1 join/end/scoring or
  finalization paths.

## Boundaries at Wave 1 completion

- At this checkpoint, surrender, V2 projection, and verified settlement were
  intentionally deferred to Wave 2. They are now delivered in
  [CROSS_ROOM_PK_WAVE2_SETTLEMENT.md](CROSS_ROOM_PK_WAVE2_SETTLEMENT.md).
- Rules, indexes, lifecycle hooks, client UI, notifications, telemetry sinks,
  admin controls, and rollout scripts remain in their later waves.
- No supported growth preset enables `crossRoomPk`, so the service stays dark
  without an explicit future audited rollout path.

## Atomicity and compatibility invariants

1. Challenge creation reads both room documents, both current authorities,
   profile/membership state, both block directions, replay/rate/cooldown
   records, rollout flags, and referenced pointers before writing either room.
2. Acceptance re-reads the challenge and both rooms, revalidates current
   authorities and rollout eligibility, then creates the session and all 32
   shards in the same transaction.
3. The first transaction to reserve or accept wins. A competing transaction
   observes the committed pointer/state and returns a stable conflict.
4. Request replay is fingerprinted by actor, action, room, challenge/session,
   opponent, client version, duration, cursor, and request ID.
5. Red is permanently challenger; blue is permanently opponent; `roomId`
   remains the red compatibility alias.
6. V2 parent team totals remain zero while active, and V1 unbounded arrays are
   rejected.

## Verification

The focused suite covers:

- V1 compatibility and strict V2 mapping;
- every Wave 1 command shape and deterministic IDs;
- exactly 16 shards per side;
- dark flags and dark rollout policy;
- sanitized discovery exclusions;
- stale pending and active pointer repair;
- A-to-B versus C-to-B reservation races;
- concurrent acceptance producing exactly one session;
- replay and request-fingerprint conflict behavior;
- accept, decline, cancel, expiry, late acceptance, and authority boundaries;
- in-room start conflict while reserved; and
- fail-closed surrender/settlement behavior.

Wave 1 is ready for review. Wave 2 must land durable gift projection and
verified settlement before any environment enables cross-room PK.
