# Competitive Social Growth — Wave 9

Status: **implemented locally** (watch-together: allowlisted HTTPS catalog, server-clock sync, host/DJ lease).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

Music baseline: [`VOICE_ROOM_WAVE11_SHARED_MUSIC.md`](./VOICE_ROOM_WAVE11_SHARED_MUSIC.md).

## Locked product decisions (Wave 9)

28. Flag is **`growthFeatures.watchTogether`** (plan’s `voice_room_watchTogether` is stale).
29. Playback sources are **allowlisted HTTPS catalog only** — no device-file / pirate URIs.
30. Sync model clones shared music: Firestore lease + `updatedAtMs` / `positionMs` /
    `playbackState`; clients seek when drift > **1.2s**.
31. Authority reuses owner / moderator / DJ (`canManageMusic`) privilege.
32. Voice continues independently of video mute.

## What shipped

| Piece | Location |
|-------|----------|
| Core + catalog | `functions/roomWatchCore.js` |
| Command txn + expiry | `functions/roomWatchService.js` |
| HTTP + cleanup scheduler | `roomWatchCommand`, `cleanupRoomWatch` |
| Client sync | `roomWatchSync.ts`, `useRoomWatchSession.ts` |
| UI | Command Center **مشاهدة** + `RoomWatchSheet` |
| Rules | `watchLeases` member-read when flag on |

## Ops

```bash
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Emergency: set `watchTogether: false` on `appConfig/growthFeatures` (or stage → `dark`).
Host controls deny; active leases expire via heartbeat TTL / cleanup.

## Exit criteria

- Late joiners catch up via target position from server clock.
- Flag off → `FEATURE_DISABLED` on mutate; stop still available to staff while lease exists.
- Catalog rejects unknown / non-HTTPS items.

## Out of scope

- LiveKit data-channel sync
- Device-file ingest
- Third-party platform embeds / DRM players
- Fancy catalog browser beyond two sample streams
