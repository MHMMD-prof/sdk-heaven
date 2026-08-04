# Voice Room Wave 12 — Super Moderator operations

## Status

Wave 12 is **deployed and enabled for production testing** on
`yallgame-ebd19` (2026-07-26). The deployed surface includes
`adminDashboard`, `roomCommand`, `livekitToken`, `roomChatCommand`,
`roomMediaCommand`, `roomMusicCommand`, `roomRecordingCommand`, and
`retryRoomLiveKitSync`; all are active in `us-central1`.

The fail-closed switch is:

- `appConfig/voiceRoomFeatures.voice_room_super_moderation = true`

Activation is recorded by
`adminAuditEvents/voice_room_super_moderation_wave12_super_moderation_release_20260726`.
The sole legacy administrator was migrated to the explicit `owner` role and
an active owner profile before activation; that migration is separately
audited. Device acceptance and emergency-operation drills remain release
gates before broad external availability.

## Decision

- Reuse `roomCommand` + `adminProfiles.regionCodes` rather than a parallel bus.
- Platform Owner assigns Super Moderator regions from the admin dashboard
  (`set-region-scope`) or CLI (`rooms:super-scope`).
- Dashboard room/user discovery and mutations are region-scoped for
  `super-moderator`.
- Atomic `staff-lockdown` / `clear-staff-lockdown` pause audio, chat, effects,
  gifts, games, music, and seat requests; stamp `staffLockdown` so room owners
  cannot reverse enforcement. Clearance restores the exact pre-lockdown state.
- `kick-everyone` closes the active LiveKit room and denies reconnect tokens
  while staff lockdown remains active.
- Room staff cannot mute/kick/ban active platform staff profiles.
- Super Moderators cannot act on the Platform Owner or another Super
  Moderator.
- Fresh `auth_time` (10 minutes) is required for high-impact room, media,
  recording, report, and user operations.
- Dashboard discovery, evidence, exports, and mutations fail closed outside
  the operator's assigned regions.
- High-impact room actions create owner notification and appeal records;
  repeated emergency use creates an owner-facing anomaly alert.

## Remaining acceptance / follow-up

- Physical Android/iOS room-operation matrix
- Staff-specific visible enter/inspect identity UX
- Owner notification and appeal UI (backend records and rules are shipped)
- Production emergency drill and alert-routing acceptance

## Rollout and rollback

```powershell
npm --prefix functions run rooms:super-mod:flag
npm --prefix functions run rooms:super-mod:enable -- --actor-uid <uid>
npm --prefix functions run rooms:super-mod:disable -- --actor-uid <uid>
```

The enable/disable scripts require an active explicit Platform Owner profile,
are idempotent by request ID, and write before/after audit state.

## Verification completed

- 771 application/function tests passed.
- TypeScript, function lint, and admin production build passed.
- Firestore and Storage emulator rule suites passed.
- Production Hosting serves the exact built admin assets.
- All eight Wave 12 production functions report `ACTIVE`.
- Explicit owner claim/profile, activation flag, and both audit records were
  read back successfully from production.
