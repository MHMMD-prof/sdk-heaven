# Voice Room Wave 14 — Scale, resilience, and abuse hardening

## Status

Wave 14 is deployed and enabled for controlled production testing on
`yallgame-ebd19` as of 2026-07-27.

The production rollout included:

- Firebase Auth revocation checks on room command, media, chat, and gift HTTP
  boundaries.
- A server-authoritative new-joins kill switch. An explicit
  `voice_room_new_joins=false` blocks room creation and first-time membership;
  only an existing member with an unexpired online/reconnecting presence lease
  may reconnect.
- A global per-user HTTP attempt limiter in addition to room/action limits.
  Denied commands, seat commands, and gift quote/send traffic are covered.
- True rolling-window timestamps for command, seat, gift, game, music, and
  entry-effect limits.
- Retention timestamps plus hourly cleanup for command requests, gift quotes,
  rate-limit records, and global HTTP limit records.
- A leased LiveKit retry worker, eight-attempt dead-letter state, immutable
  moderation/audit propagation, and a Platform Owner security alert.
- Fair stale-presence ordering and a persistent room reconciliation cursor so
  large stale sets and early room IDs cannot starve later records.
- A composite presence index and collection-group retention indexes.

The single existing production room passed the exact v2 migration and seat
activation planners, was migrated to schema v2, received its deterministic
20-seat map, and was activated on seat-engine version 1. Its existing publisher
was preserved on seat `01`.

The audited production flag event is
`adminAuditEvents/voice_room_wave14_enable_20260727_v1`:

- `voice_room_v2_read=true`
- `voice_room_v2_mutations=true`
- `voice_room_seats=true`
- `voice_room_new_joins=true`
- `voice_room_safety_recording=false`

Recording remains explicitly disabled because Wave 13 was rejected.

## Verification

- 776 repository tests pass.
- 40 focused Wave 14 tests pass.
- Firestore and Storage emulator suites pass.
- TypeScript compilation and the complete Functions syntax suite pass.
- The production administrator dashboard build passes.
- Production Firestore rules compile and are released.
- Required Firestore indexes are deployed and `READY`.
- `roomCommand`, `roomMediaCommand`, `roomChatCommand`, `roomGiftCommand`,
  `retryRoomLiveKitSync`, and `recoverVoiceRoomSeats` were updated successfully.
- `cleanupVoiceRoomHardening` was created successfully.
- Production read-back confirms the flags, v2 room, seat-engine state, seat
  assignment, and immutable activation audit.
- Post-activation `recoverVoiceRoomSeats` invocations complete successfully
  without a feature skip, index error, or recovery backlog.

## Operations

The new-joins switch is intentionally independent from the other room features:

```powershell
npm --prefix functions run rooms:new-joins:flag
npm --prefix functions run rooms:new-joins:disable -- --actor-uid <uid> --reason "<incident>"
npm --prefix functions run rooms:new-joins:enable -- --actor-uid <uid> --reason "<recovery>"
```

Default behavior remains fail-open for capacity: absent or `true` allows new
joins; only explicit `false` freezes them. Firestore rules are authoritative,
so a stale or modified client cannot bypass the freeze.

## Remaining broad-release gates

Wave 14 is enabled for testing, but these Wave 15 acceptance gates are still
physical or infrastructure work:

- staged multi-device load and network-chaos tests;
- Android/iOS microphone, Bluetooth, interruption, and process-kill testing;
- App Check provider integration and measured enforcement rollout;
- accessibility device matrix for RTL, dynamic type, screen readers, switch
  control, reduced motion, and contrast;
- economy anomaly and alternate-account alert fanout;
- measured performance telemetry against the frozen budgets.

These remaining gates do not make the deployed hardening dark; they limit
expansion from controlled production testing to a broad audience.
