# Voice Room Wave 9 — Entry vehicles and room effects runtime

## Status

Wave 9 is **deployed and enabled for controlled production testing** on
`yallgame-ebd19` (2026-07-26): Firestore rules, `roomEntryEffectCommand`, and
the hourly `cleanupRoomEntryEffects` worker are active. The runtime remains
remotely controlled by:

- `appConfig/voiceRoomFeatures.voice_room_entry_effects`

Native device acceptance of future motion/video formats remains deferred to the
asset-format gate. The current rollout uses the verified static fallback.

## Decision

- Equipped `cars` store items are the only entry vehicles in v1.
- Existing `diamonds` / gift earnings are untouched.
- **No new Lottie/video dependency** was added. Playback uses a static
  thumbnail/banner fallback until the Wave 0/9 asset-format gate passes on
  Expo SDK 56 native devices.
- Optional catalog metadata keys are allowlisted but defaulted when absent:
  asset version, duration, dimensions, fallback URL, sound policy, minimum
  client version, performance tier.
- Entry assets must use approved immutable
  `store-assets/{itemId}/{kind}/{version}` Firebase Storage paths. Arbitrary
  remote image hosts are rejected.
- Controlled test item: `wave9_test_royal_car`, one coin, unlimited stock,
  static asset version `static-1`, client `1.0.0+`, four-second duration,
  sound off.

## Server flow

Dedicated HTTP function `roomEntryEffectCommand`:

1. `announce-entry-effect` with `roomId` + presence `sessionId`
2. Validates membership, presence session match, feature flag, equipped active
   non-expired car ownership, and catalog availability
3. Creates one claim per `uid + sessionId` so reconnect/foreground churn cannot
   replay the vehicle
4. Writes `rooms/{roomId}/events/{eventId}` with `kind: 'room-entry'` only after
   validation succeeds
5. Skips cleanly when no car is equipped (`NO_EQUIPPED_CAR`)
6. Applies a 12-command/minute per-user/per-room limit and does not create new
   request documents for alternate request IDs after the session is claimed
7. Purges requests, claims, rate state, and ephemeral events after at most 24 hours

## Client runtime

- Shared bounded effect queue (max 8) for entry + gift events
- One major overlay at a time; playback advances using the validated 3–5 second duration
- Respects per-feature flags, room `effectsPolicy`, OS reduced motion, low-memory
  warnings, app background, active presence, and local user blocks
- Reduced mode uses a compact text banner. Off mode suppresses entry vehicles
  while retaining compact financially relevant gift text.
- Cancels decorative playback on room/audio suspension and records
  queued/played/completed/dropped debug events with drop reasons
- Joining never waits for animation
- Subscribes to `rooms/{roomId}/events` when entry-effects or gifts flags are on
- Retries transient presence/network races with one stable idempotency key

## Controlled test

1. Open the store and purchase **Royal Test Car**
   (`wave9_test_royal_car`) for one coin.
2. Equip it in the `cars` slot.
3. Leave the room completely, then perform a genuine join.
4. Confirm one four-second entrance banner appears for active room members.
5. Toggle OS reduced motion and confirm the next genuine join produces only the
   compact banner.
6. Background/foreground or reconnect within the same presence session and
   confirm the car does not replay.

The generated static artwork is stored locally at
`assets/store/wave9-test-royal-car-v1.webp` and published as immutable
thumbnail/preview objects.

## Rollout and rollback

```powershell
npm --prefix functions run rooms:entry-effects:flag
npm --prefix functions run rooms:entry-effects:enable -- --actor-uid <uid>
npm --prefix functions run rooms:entry-effects:disable -- --actor-uid <uid>
```

## Out of scope

- Production motion/video player dependency
- Entry-effect audio mixing with LiveKit voice
- Multi-vehicle queues beyond the shared P3 envelope
- Catalog admin UI for the new optional metadata fields
