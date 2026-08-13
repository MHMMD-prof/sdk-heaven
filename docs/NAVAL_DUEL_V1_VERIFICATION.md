# Naval Duel V1 Verification

Use this checklist before treating voice-room Naval Duel (`naval-duel`) as
release-ready.

**Current product path:** voice-room invite → join → MiniGame online lobby →
private placement → fog-of-war battle over LiveKit data transport.

Farm / Royal Majlis remains host-local and is out of scope.

## Wave 5 gate status (2026-08-08)

| Gate | Status | Evidence |
| --- | --- | --- |
| Registry + launch (Wave 0) | Automated pass | `roomGameCore` + `resolveMiniGameRoomLaunch` |
| Online lobby / no hot-seat (Wave 1) | Automated pass | `resolveBattleshipLaunch` |
| LiveKit transport shell (Wave 2) | Automated pass | `battleshipLiveKitTransport` |
| Secret placement seals (Wave 3) | Automated pass | `battleshipOnlinePlacement` |
| Fog-of-war battle loop (Wave 4) | Automated pass | `battleshipOnlineBattle` |
| Snapshot / disconnect reliability (Wave 5) | Automated pass | `battleshipOnlineReliability` + `navalDuelOnlineGate` |
| LiveKit no-echo local apply | Automated pass | Mock transport + gate (publish then apply locally) |
| Remount probe → yield → snapshot adopt | Automated pass | `navalDuelRemountIntegration` |
| Presence-flap claim grace (2 absent intervals) | Automated pass | `navalDuelPresenceFlap` + claim helpers in `onlineReliability` |
| Physical two-device acceptance | **Required before release** | Checklist below on two native clients |

Automated Wave 5 command:

```powershell
npx vitest run `
  src/battleship/__tests__/navalDuelOnlineGate.test.ts `
  src/battleship/__tests__/navalDuelRemountIntegration.test.ts `
  src/battleship/__tests__/navalDuelPresenceFlap.test.ts `
  src/battleship/__tests__/battleshipOnlineReliability.test.ts `
  src/battleship/__tests__/battleshipOnlineBattle.test.ts `
  src/battleship/__tests__/battleshipOnlinePlacement.test.ts `
  src/battleship/__tests__/battleshipLiveKitTransport.test.ts
npm --prefix functions test -- roomGameService.test.mjs
```

### Hardening residuals (non-blocking for code; watch in QA)

- **Zombie connected peer:** if a peer stays in LiveKit presence but is unresponsive, the empty remounter keeps probing and does not force-claim until presence clears for two consecutive probe intervals (~5s).
- **Lobby host-transfer with no progress:** after seeing a peer, a single empty presence tick does not instant-claim; announce/claim waits for consecutive absent grace.
- These behaviors are covered by mock transport tests; native two-device QA still confirms LiveKit presence timing.

## Native Runtime Setup

- Verify Expo SDK 56 docs before changing Expo/native code: https://docs.expo.dev/versions/v56.0.0/
- Use a native dev-client or native build. Do not use web as the release signal.
- Set `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` to a working token endpoint.
- Confirm room games are enabled (`voice_room_games`) and `naval-duel` is listed.
- Confirm game transport token binding includes `gameSessionId`, `participantId`, and `transportRoomId`.

## Manual two-device acceptance (release blocking)

Use two signed-in test accounts in the same public voice room.

1. A and B enter the same public room. Voice works for both.
2. A starts Naval Duel from room tools. B sees the optional invite card.
3. B joins; both open MiniGame with the same `roomId` + `sessionId` + `hostUid`.
4. Lobby shows transport connected and 2/2 players. No hot-seat handoff UI.
5. Both place fleets privately and confirm. Only readiness seals sync (no enemy ships appear).
6. Battle starts. A fires; B’s device resolves hit/miss; A sees only the result.
7. Hits keep turn; misses flip turn immediately (no pass-device screen).
8. Sink the fleet; victory shows. Leave returns to the voice room; room stays open.
9. **Remount:** force-kill A mid-battle; A relaunches into the same session. A must not start a fresh placement match over B. A probes, yields, and adopts B’s public snapshot (shots + turn). Private fleets stay local.
10. **Host drop:** A leaves transport permanently; B becomes sticky host and can answer snapshot requests. When A returns empty, B remains authority until A adopts.
11. **Presence flap (optional):** briefly background/foreground B so presence flickers once. A must not dual-host or announce a new empty match on a single empty tick.

## Release Decision

- Release only after automated Wave 5 gates pass **and** the manual two-device acceptance list is signed off on native builds.
- If a bug is found, fix the smallest layer: online model for rules, transport for sync, screen/view for UI.
