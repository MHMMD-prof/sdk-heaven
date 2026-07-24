# Voice Room Wave 1 Contracts and Migration

## Status

Wave 1 implementation is complete and backward-compatible. Production activation remains intentionally pending until the migration dry run is executed against the selected Firebase project, every malformed record is resolved, and the post-migration dry run reports zero pending records.

No production deployment or production data write was performed as part of this implementation.

## Delivered behavior

- New rooms dual-write `ownerUid` and the compatibility `hostId` mirror.
- Existing rooms without `schemaVersion` are normalized as schema v1 and remain discoverable and joinable.
- Newer unsupported schemas are reported explicitly; joining them produces an update-required error.
- New memberships separate durable authority (`owner`, `moderator`, `member`) from the legacy microphone role and future seat state.
- Every new v2 room transactionally creates 20 deterministic vacant seats (`01` through `20`).
- Room ownership, authority, occupied-seat state, bans, seat requests, messages, moderation evidence, wallet, and commission data cannot be directly changed by a mobile client.
- An active room ban blocks creation of a new membership.
- Existing discovery and owner lookup continue to query `status`, `visibility`, and `hostId` until the migration and minimum-client gates are complete.

## Versioned contracts

### Room

New room documents use `schemaVersion: 2` and add:

| Field | Meaning |
| --- | --- |
| `ownerUid` | Authoritative persistent owner |
| `ownerDisplayName`, `ownerAvatarLabel` | Owner display snapshots |
| `hostId`, host snapshots | Compatibility mirrors while v1 clients remain supported |
| `revision` | Optimistic authority/configuration revision; starts at `1` |
| `availability` | `active`, `suspended`, or `removed` |
| `seatTargetCount` | One of `5`, `10`, `15`, or `20`; defaults to `10` |
| `seatMode` | `open`, `request`, `invite`, or `locked` |

For v2 documents, `ownerUid` and `hostId` must match. Ownership transfer in a later command wave must update both in one server transaction until legacy support is retired.

### Member

Member schema v2 retains the old `role` and `canPublishAudio` fields only for runtime compatibility, and adds:

- `authorityRole`: `owner`, `moderator`, or `member`.
- `seatId`: nullable seat reference, independent of authority.
- `privileges.canManageMusic`: independent DJ privilege.
- `schemaVersion: 2`.

The compatibility microphone role cannot grant moderator or owner authority. A legacy membership is normalized to `owner` only when its role is `host`; otherwise it becomes `member`.

### Seat

Seats use deterministic IDs `01` through `20` with `schemaVersion`, `seatNumber`, `state`, and `revision`. Occupied, reconnecting, and retiring states require an occupant UID; vacant open or locked states reject one.

The mobile client may only create a missing seat in the exact vacant initializer shape for a room it owns. It cannot update or delete seats, assign an occupant, or claim two seats. Seat commands and concurrency control arrive in Wave 3.

### Message

The strict mobile mapper recognizes `chat`, `system`, `gift`, `game`, and `moderation` messages with status, revision, sender, room, and a bounded text payload. Firestore client access remains closed until the authoritative message service and pagination UI are implemented.

## Migration tool

The migration is idempotent and defaults to dry-run:

```powershell
npm --prefix functions run rooms:v2:migrate -- --limit=500 --batch-size=50
```

Resume after a checkpoint:

```powershell
npm --prefix functions run rooms:v2:migrate -- --start-after=ROOM_ID --limit=500
```

Apply only after the dry run has no malformed rooms, members, or seats:

```powershell
npm --prefix functions run rooms:v2:migrate:apply -- --actor-uid=ADMIN_UID --limit=500 --batch-size=50
```

Apply mode requires an authenticated Firebase administrator account whose custom claims contain `admin: true`. The tool:

- counts every scanned room and nested member;
- reports ready, pending, and malformed records separately;
- creates only missing deterministic seats and never overwrites existing seat state;
- emits page checkpoints and a final resumable room ID;
- refuses apply when any malformed room, member, or seat is found;
- uses merge-only room/member patches and does not remove legacy fields.

## Production rollout order

1. Deploy the new composite indexes and wait until all are ready.
2. Deploy the backward-compatible rules.
3. Release the dual-read/dual-write client while keeping v2 UI behavior dark.
4. Run the migration in dry-run mode for the entire rooms collection.
5. Repair every malformed record and repeat until every room/member is accounted for.
6. Run apply in bounded checkpointed pages.
7. Repeat the dry run; require zero pending and zero malformed records.
8. Observe room discovery, creation, joins, presence, and LiveKit connection metrics.
9. Only after minimum-supported-client enforcement may owner queries move from `hostId` to `ownerUid`.

Rollback is safe during this wave: v2 rooms retain all v1 fields, old membership writes remain accepted when they contain no partial v2 authority fields, and the migration is additive.

## Verification completed

- TypeScript compile: passed.
- Mobile room/profile and v2 contract tests: passed.
- Backend migration-core tests: passed.
- Functions syntax validation: passed.
- Firestore and Storage emulator rules suites: passed, including the real 22-write room/owner/seat creation batch.
- Rules tests deny ownership forgery, ownership mutation, moderator forgery, self-promotion, direct seat occupancy, a second seat claim, moderation-event writes, and banned joins.

## Wave 2 handoff

Wave 2 can now make commands authoritative without changing stored meanings. It should use `ownerUid`, `authorityRole`, `seatId`, `revision`, and server-resolved membership state, while continuing to mirror `hostId` until the compatibility gate closes.
