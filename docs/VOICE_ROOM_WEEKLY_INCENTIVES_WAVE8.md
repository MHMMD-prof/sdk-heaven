# Weekly Incentives — Wave 8

Status: implemented locally, verified, and intentionally disabled.

## Delivered

### Mobile room

- A dedicated Room Target control appears directly beneath Rocket when
  `voice_room_owner_targets` and the public rendering switch are enabled.
- Everyone currently in the room can see:
  - current support points and target;
  - live progress, cycle state, and countdown;
  - the locked current-week roster;
  - each member's support points, qualifying spend, and estimated/final return;
  - an explicit warning that gifts from users outside the locked roster do not
    count toward this target.
- Only the current room owner can edit the next week's roster.
- The current week's roster is never editable.
- User lookup runs through `roomTargetCommand`, verifies current ownership
  first, and returns only the existing privacy-safe public discovery shape.
- Empty, partial, and full rosters are supported up to the global template
  limit (hard maximum: 20 selected users plus the owner).

### Safe Firestore projections

- Private accounting remains in `targetCycles`, `members`, drafts, receipts,
  holds, and settlements.
- Signed-in active room members can read only
  `rooms/{roomId}/targetPublicCycles/{cycleId}`.
- Only the current owner can read
  `rooms/{roomId}/targetRosterPreviews/{nextCycleId}`.
- Public projections are materialized after cycle creation, qualifying gift
  projection, and settlement-state changes.
- Direct client writes to projections, previews, and all accounting documents
  remain denied.

### Admin dashboard

- Global Room Target template editor:
  - target points and return percentage;
  - payout currency and rational conversion;
  - minimum qualifying gift;
  - per-user and per-room caps;
  - selected-user limit;
  - diamond and item liability valuations.
- A deterministic conversion example is shown before publication.
- Server-calculated stacked Rocket + Room Target liability, commission, margin,
  and viability snapshots are displayed.
- Publication is next-cycle only and stores immutable historical versions.
- Emergency rendering disable and rollback create audited revisions.
- Operations show qualifying room count, active cycles, active holds, recent
  progress, settlement counts, and paid coin/diamond totals.
- Administrators with `incentives:manage` can apply or release a member hold
  for an open cycle.
- The panel is lazy-loaded as its own production chunk to preserve dashboard
  bundle limits.

## Runtime configuration

The mobile client accepts:

```text
EXPO_PUBLIC_ROOM_TARGET_COMMAND_ENDPOINT=
```

If omitted, the endpoint is derived from
`EXPO_PUBLIC_ROOM_COMMAND_ENDPOINT` or `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT`.

## Rollout state

No deployment or feature enablement was performed in Wave 8.

```text
voice_room_owner_targets=false
voice_room_owner_target_payouts=false
```

Rendering must be enabled before payouts. Payouts stay independently disabled
until the shadow/reconciliation review is accepted.

## Verification

- Application TypeScript: passed.
- Application suite: 159 files, 897 tests passed.
- Focused Room Target suite: 4 files, 18 tests passed.
- Firestore and Storage emulator rules: 2 files, 45 tests passed.
- Admin dashboard typecheck: passed.
- Admin dashboard tests: 8 files, 20 tests passed.
- Admin dashboard production build and bundle budget: passed.
- Expo Android production export: passed (2,165 modules).

The Expo export also reports the existing unrelated iOS config warning for the
`GoogleService-Info.plist` path; it does not block the Android export.
