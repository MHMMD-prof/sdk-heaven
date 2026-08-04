# Voice Room Wave 13 — Rolling safety recording (control plane)

## Status

Wave 13 governance control plane is **deployed dark** to `yallgame-ebd19`
(2026-07-25): Firestore/Storage rules, indexes, `roomRecordingCommand`,
`roomChatCommand`, and `cleanupRoomRecordingEvidence`. Fail-closed behind:

- `appConfig/voiceRoomFeatures.voice_room_safety_recording`

LiveKit audio egress output is **not configured** in this environment. Evidence
records always stamp `audioStatus` explicitly (`missing` / `pending-egress` /
`preserved` / `expired`) so staff never assume bytes exist.

## Decision

1. Server-only recording sessions + `roomEvidence` metadata.
2. Voice reports create evidence windows (pre 5m / post 60s) when the flag is on.
3. Default retention 30 days; legal hold extends to 180 days.
4. Unreported segment cleanup + expired evidence jobs.
5. Staff-only playback/legal-hold commands with access audit logs.
6. Client consent notice + always-on REC indicator when the flag is enabled.
7. Storage path `room-evidence/**` denies all client access.

## Commands

`roomRecordingCommand`:

- `get-recording-status`
- `acknowledge-recording-notice`
- `ensure-rolling-session`
- `stop-rolling-session`
- `preserve-for-report`
- `set-legal-hold`
- `request-playback`

## Ops

```powershell
npm --prefix functions run rooms:recording:flag
npm --prefix functions run rooms:recording:enable -- --actor-uid <uid>
npm --prefix functions run rooms:recording:disable -- --actor-uid <uid>
npm --prefix functions run lint:wave13
```

Dark deploy: rules, indexes, `roomRecordingCommand`, `roomChatCommand`,
`cleanupRoomRecordingEvidence`.

**Testing note:** leave `voice_room_safety_recording` off until product/legal
confirms a real capture reason. `rooms:flags:all:enable` forces this flag
`false`.

## Follow-up (egress bytes)

Wire LiveKit `EgressClient` + segmented/GCS output when egress credentials exist.
Until then, preservation requests remain honest `missing` / `pending-egress`.

## Out of scope

- Enabling the production flag by default
- Room owner/moderator evidence download
- Device-side safety recording
