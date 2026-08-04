# Voice Room Wave 11 — Synchronized catalog music and DJ controls

## Status

Wave 11 is **deployed and enabled for controlled production testing** on
`yallgame-ebd19` as of 2026-07-26.

- Feature flag:
  `appConfig/voiceRoomFeatures.voice_room_shared_music = true`
- Region: `us-central1`
- Command function:
  `https://us-central1-yallgame-ebd19.cloudfunctions.net/roomMusicCommand`
- Cleanup schedule: `cleanupRoomMusic`, every minute
- Activation audit:
  `adminAuditEvents/voice_room_shared_music_enable_1785075336558`

Production readback confirmed the flag changed from `false` to `true` and the
audit event is `completed`.

## Enabled scope

The enabled implementation is foreground, server-clock-synchronized catalog
playback:

- one active DJ lease per room;
- 45-second server lease with a 15-second heartbeat;
- owner and moderators may control music;
- the owner or a moderator may grant/revoke session DJ privilege;
- all active room members hear the allowlisted HTTPS track using `expo-audio`;
- each listener has independent music mute and volume controls;
- room voices remain connected and are not controlled by music volume;
- pause/resume uses the controller's actual playback position;
- clients estimate server time, seek late joiners to the current position, and
  correct drift on heartbeat revisions;
- music pauses while the app is backgrounded and resynchronizes on foreground;
- an orderly DJ room exit stops the lease before disconnecting.

Device-file broadcast is **not enabled**. The current Expo/LiveKit client has no
native bridge that converts a user-selected local audio file into a distinct
LiveKit audio source. No local file is uploaded to Firestore or Storage.

## Command contract

`roomMusicCommand` supports:

1. `list-room-music-catalog`
2. `claim-dj-lease`
3. `heartbeat-dj-lease`
4. `update-now-playing`
5. `stop-music`

Every request requires a valid Firebase token with revocation checking, client
version `1.0.0` or newer, and music protocol version `2`. The protocol gate
prevents an older `1.0.0` build from enabling the previous unsynchronized
behavior. Active room membership and an active public profile are required for
catalog playback. Platform Owner and scoped Super Moderator authority remains
stop-only.

The retired `report-published-track` future command is not callable.

## Lifecycle and abuse controls

- Commands are globally rate-limited per user.
- Catalog reads and heartbeats do not create replay documents.
- Mutating command replays are idempotent and retained for 24 hours.
- Rate-limit state is retained for 24 hours.
- Terminal leases are retained for seven days.
- The minute scheduler expires dead leases and clears room pointers.
- Every listener also enforces `expiresAtMs` locally, so a dead DJ cannot leave
  music playing while waiting for the scheduler.
- Removing or banning the active DJ, revoking DJ privilege, staff lockdown,
  closing the room, or removing the room terminates the active lease.
- `stop-music` remains available after the feature flag is disabled so rollback
  cannot trap cleanup.

## Firestore boundary

- Music leases are readable only when the feature flag is true and the reader
  is an active room member with a complete active profile.
- Lease writes, command request records, and global music rate-limit records are
  denied to clients.
- Clients cannot write room music pointers.

## Catalog warning

The initial SoundHelix entries are test catalog media. Before a general
commercial launch, replace them with app-owned or explicitly licensed tracks
served from infrastructure controlled by the product.

## Controlled acceptance

Use two physical devices and two active test accounts:

1. Join the same public room on both devices.
2. Start a catalog track as the owner. Confirm the second device begins near
   the same position while voice remains connected.
3. Join a third device after at least 20 seconds. Confirm it seeks to the current
   position instead of starting at zero.
4. Pause and resume. Confirm all devices converge to the controller's current
   position.
5. Change listener-only music volume and mute. Confirm voice volume is
   unaffected.
6. Background one listener, then return. Confirm music resynchronizes.
7. Disconnect or terminate the DJ app. Confirm listeners stop no later than the
   45-second lease deadline.
8. Grant DJ to a member, start music, then revoke DJ. Confirm immediate stop.
9. Start music and kick the DJ. Confirm the lease and room pointers clear.
10. Apply staff lockdown and close/remove-room tests. Confirm playback stops.
11. Disable the feature flag during an active lease. Confirm new commands stop
    while authorized cleanup remains possible.
12. Test calls, alarms, wired headphones, Bluetooth disconnect, speaker route,
    and microphone coexistence on Android and iOS. Expo documents that playback
    automatically stops when headphones or Bluetooth audio disconnects; the
    expected product behavior is to remain stopped until foreground
    resynchronization is safe.

## Operations

Dry run:

```powershell
npm --prefix functions run rooms:music:flag
```

Audited owner-only enable/disable:

```powershell
npm --prefix functions run rooms:music:enable -- --actor-uid <uid> --reason "<reason>" --request-id <id>
npm --prefix functions run rooms:music:disable -- --actor-uid <uid> --reason "<reason>" --request-id <id>
```

Use a unique stable request ID for each intended change. Identical reuse is
idempotent; conflicting reuse fails.

## Deferred

- User-selected device-file broadcasting
- Native PCM/media-source bridge into a distinct LiveKit audio track
- Background room-music playback
- Queue, seek slider, skip, and playlist management
- Commercial production catalog and rights-management workflow
