# Drawing Guess V1 Verification

Use this checklist before treating Drawing Guess v1 as release-ready. V1 is private-room multiplayer only: no Firebase persistence, public matchmaking, server authority, or result thumbnails.

## Native Runtime Setup

- Verify Expo SDK 56 docs before changing Expo/native code: https://docs.expo.dev/versions/v56.0.0/
- Use a native dev-client or native build. Do not use web as the release signal for this feature.
- Confirm the native build includes Skia, Gesture Handler, LiveKit React Native, and WebRTC.
- Set `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` to a working token endpoint.
- Confirm the token response includes `serverUrl` and `token`, and the token grants LiveKit data publish permission.

## Automated Checks

- Run `npx tsc --noEmit`.
- Run `npm test`.
- Add regression tests for any release-blocking bug found during manual verification.

## Manual Game Flows

- Games tab: open Drawing Guess, create a local simulated room, start a match, choose a prompt, draw, guess, advance through every drawer, and finish the match.
- Games tab online: create an online room on device A, join the same room code on device B, and confirm both devices show the same players.
- VoiceRoom: enter a voice room, tap Start Drawing Guess, and confirm the Drawing Guess room id matches the voice room id while the voice session remains separate.
- Prompt privacy: confirm only the drawer sees the prompt during drawing, and guessers see it only in round results.
- Scoring: confirm correct guesses score once, repeated correct guesses do not double score, and the drawer cannot score by guessing.
- Drawing sync: draw quickly on the drawer device and confirm the guesser sees lossy preview strokes before reliable committed strokes.
- Eraser sync: use the eraser and confirm the remote device renders it as an eraser stroke.
- Clear/undo: confirm undo removes the drawer's latest stroke and clear removes current committed strokes plus previews.
- Late join: join an online room after drawing has started and confirm snapshot recovery restores the current state.
- Reconnect: disconnect/reconnect a device and confirm input stays blocked until snapshot recovery completes.
- Host transfer: disconnect the host and confirm the connected player with the lowest join order can continue authority actions.

## Layout And Performance

- Check Android small screen and large screen layouts for canvas clipping, keyboard overlap, unreachable buttons, and text overflow.
- Confirm fast drawing remains responsive and does not block guess input or navigation.
- Confirm preview packet throttling keeps remote preview smooth without flooding.
- Confirm long rounds do not visibly degrade memory or rendering performance.
- Confirm snapshot payloads remain chunked and bounded; do not send full unbounded stroke history in one packet.

## Release Decision

- Release only after automated checks pass and every manual scenario above is either passed or has a tracked release-blocking fix.
- If a bug is found, fix it in the smallest responsible layer: model/controller for game rules, transport for sync, rendering/screens for canvas and UI.
