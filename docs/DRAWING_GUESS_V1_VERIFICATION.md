# Drawing Guess V1 Verification

Use this checklist before treating Drawing Guess v1 as release-ready.

**Current product path for online play:** voice-room-linked Drawing Guess
(invite → join → shared LiveKit data room). Games-tab private `DG-*` codes remain
deferred.

## Wave 4 gate status (2026-08-08)

| Gate | Status | Evidence |
| --- | --- | --- |
| Shared host bootstrap (Wave 1) | Automated pass | `drawingGuessControllerModel` + launch resolve |
| Voice-room lobby guards (Wave 2) | Automated pass | voice-room hides create/join/reset controls |
| Online reliability (Wave 3) | Automated pass | `onlineGameplayReliability` |
| Two-player online gate (Wave 4) | Automated pass | `twoPlayerOnlineGate` + room create/join/leave |
| LiveKit no-echo local apply | Fixed 2026-08-08 | Host/drawer publish then apply locally; self-inbound ignored |
| Remount probe → yield → snapshot adopt | Automated pass | `drawingGuessRemountIntegration` |
| Presence-flap claim grace (2 absent intervals) | Automated pass | `drawingGuessPresenceFlap` + claim helpers in `onlineGameplayReliability` |
| Physical two-device acceptance | **Required before release** | Checklist below on two native clients |

Automated Wave 4 command:

```powershell
npx vitest run `
  src/drawingGuess/__tests__/twoPlayerOnlineGate.test.ts `
  src/drawingGuess/__tests__/drawingGuessRemountIntegration.test.ts `
  src/drawingGuess/__tests__/drawingGuessPresenceFlap.test.ts `
  src/drawingGuess/__tests__/onlineGameplayReliability.test.ts `
  src/drawingGuess/__tests__/drawingGuessControllerModel.test.ts
npm --prefix functions test -- roomGameService.test.mjs
```

### Hardening residuals (non-blocking for code; watch in QA)

- **Zombie connected peer:** if a peer stays in LiveKit presence but is unresponsive, an empty remounter keeps probing and does not force-claim until presence clears for two consecutive probe intervals (~5s).
- **Lobby host-transfer with no progress:** after seeing a peer, a single empty presence tick does not instant-claim; snapshot publish waits for consecutive absent grace.
- These behaviors are covered by mock transport tests; native two-device QA still confirms LiveKit presence timing.

## Native Runtime Setup

- Verify Expo SDK 56 docs before changing Expo/native code: https://docs.expo.dev/versions/v56.0.0/
- Use a native dev-client or native build. Do not use web as the release signal for this feature.
- Confirm the native build includes Skia, Gesture Handler, LiveKit React Native, and WebRTC.
- Set `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` to a working token endpoint.
- Confirm room games are enabled (`voice_room_games`) and `roomGameCommand` resolves from the LiveKit endpoint config.
- Confirm the game transport token response includes `serverUrl`, `token`, `participantId`, and `transportRoomId` / `gameSessionId` binding.

## Automated Checks

- Run `npx tsc --noEmit`.
- Run `npm test`.
- Run the Wave 4 command above.
- Add regression tests for any release-blocking bug found during manual verification.

## Manual two-device acceptance (release blocking)

Use two signed-in test accounts in the same public voice room.

1. A and B enter the same public room. Voice works for both.
2. A starts Drawing Guess from room tools. B sees the optional invite card (not forced).
3. B taps join, then both open the game with the same `roomId` + `sessionId`.
4. Lobby shows one host (A). B cannot start. No Create/Join online room controls appear.
5. A starts the match. Only the drawer sees the prompt. B does not.
6. A draws; B sees preview then committed strokes while voice continues.
7. B guesses correctly once; score updates on both; prompt reveals only in round results.
8. B leaves the game screen. B’s game seat drops; voice room stays open for both.
9. **Remount:** force-kill A mid-round; A relaunches into the same session. A must not publish a fresh empty lobby over B. A probes, yields, and adopts B’s public snapshot (strokes + scores + phase). Prompt stays redacted for guessers.
10. **Host drop:** A leaves transport permanently; B becomes sticky host and can answer snapshot requests. When A returns empty, B remains authority until A adopts.
11. **Presence flap (optional):** briefly background/foreground B so presence flickers once. A must not dual-host or announce a new empty match on a single empty tick.

## Manual Game Flows (broader)

- Games tab: open Drawing Guess local showcase, start a match, choose a prompt, draw, guess, advance through every drawer, and finish the match.
- Games tab private online codes: deferred; do not treat as release-ready.
- VoiceRoom host-local Carrom / Royal Majlis: confirm non-hosts are not offered a fake Join.
- Confirm no game UI or command can award coins, diamonds, gift earnings, or `gameRewards`.

## Layout And Performance

- Check Android small screen and large screen layouts for canvas clipping, keyboard overlap, unreachable buttons, and text overflow.
- Confirm fast drawing remains responsive and does not block guess input or navigation.
- Confirm preview packet throttling keeps remote preview smooth without flooding.
- Confirm long rounds do not visibly degrade memory or rendering performance.
- Confirm snapshot payloads remain chunked and bounded; do not send full unbounded stroke history in one packet.

## Release Decision

- Release only after automated Wave 4 gates pass **and** the manual two-device acceptance list is signed off on native builds.
- If a bug is found, fix it in the smallest responsible layer: model/controller for game rules, transport for sync, rendering/screens for canvas and UI.
