# Drawing Guess Game Architecture

## Purpose

Build a production-shaped Drawing Guess game, like Gartic/Draw Something for live groups, without coupling the feature to one screen, one transport implementation, or one authority model. The game must work as a standalone game from the Games tab and as an embedded activity inside VoiceRoom.

This file is the source of truth for the Drawing Guess feature. Any implementation must follow it unless the user explicitly revises the architecture.

## Required References

Before writing Expo-related code for this feature, read the exact Expo v56 docs required by `AGENTS.md`:

- https://docs.expo.dev/versions/v56.0.0/
- https://docs.expo.dev/versions/v56.0.0/sdk/skia/
- https://docs.expo.dev/versions/v56.0.0/sdk/gesture-handler/
- https://docs.expo.dev/versions/v56.0.0/sdk/view-shot/

Also read the LiveKit data transport docs before implementing realtime sync:

- https://docs.livekit.io/transport/data/packets/

Expo v56 currently maps this repo to `expo ~56.0.8`, React Native `0.85.3`, and React `19.2.3`. Expo v56 lists `@shopify/react-native-skia` bundled at `2.6.2` and `react-native-gesture-handler` at `~2.31.1`. Install Expo-managed native packages only with `npx expo install`.

## Non-Negotiable Architecture Rules

- Do not put drawing-game realtime logic inside `VoiceClient`; voice and game data are separate domains.
- Do not expose raw LiveKit `Room` objects to UI components.
- Do not make the Skia canvas the source of truth; canonical drawing state is serializable vector data.
- Do not send full unbounded stroke history in one packet.
- Do not make host-authoritative logic impossible to replace with server authority later.
- Do not rely on Games tab launch having an existing voice room.
- Do not add Firebase persistence for v1 unless the architecture is explicitly revised.
- Do not support public matchmaking in v1; use private room codes only.

## System Shape

Add a new `src/drawingGuess/` module with clear sublayers:

- `model`
  - Pure types, reducer, scoring, prompt selection, normalization, validation, and snapshot merge logic.
  - No React, Skia, navigation, LiveKit, timers, or network calls.
- `rendering`
  - Skia canvas, stroke-to-path conversion, brush previews, eraser rendering, and canvas sizing.
  - Depends on model stroke types but does not mutate match state directly.
- `transport`
  - `DrawingGuessTransport` interface plus LiveKit and mock implementations.
  - Encodes/decodes versioned game messages and owns packet chunking.
- `controller`
  - React hooks that connect model, transport, timers, lifecycle, and navigation.
  - The only layer that dispatches remote events into local state.
- `screens`
  - `DrawingGuessScreen`, lobby/join UI, round UI, results UI, and panels.

Public route:

```ts
DrawingGuess: {
  roomId?: string;
  source?: 'games' | 'voice-room';
  mode?: 'online' | 'local-simulated';
}
```

Launch mapping:

- Games tab:
  - Opens a Drawing Guess lobby screen.
  - User can create a private room code, join by room code, or run local simulated mode.
- VoiceRoom:
  - Uses the existing voice `roomId`.
  - Starts a Drawing Guess activity in the same logical room, but through `DrawingGuessTransport`, not through `VoiceClient`.

## Library Choices

- `@shopify/react-native-skia`
  - Primary native canvas renderer.
  - Renders vector strokes, eraser masks, active preview stroke, and optional flattened background snapshots.
  - Web is not a first-class target unless CanvasKit setup is explicitly added and verified.
- `react-native-gesture-handler`
  - Owns pan input for drawing.
  - The app root must be checked for `GestureHandlerRootView`; add it if required by the chosen gesture API.
- `react-native-view-shot`
  - Optional utility for local thumbnails/results sharing only.
  - Not the canonical drawing state and not required for realtime sync.
- `livekit-client` / `@livekit/react-native`
  - Realtime transport for online play.
  - Use LiveKit data packets with explicit topics and versioned payloads.

## Room Lifecycle

Standalone Games flow:

- `Create Room`
  - Generate a short private room code, for example `DG-7KQ2`.
  - Request a LiveKit token using that room code.
  - Join as first player and become provisional host.
- `Join Room`
  - User enters a room code.
  - Request a LiveKit token using that room code.
  - Join as player and request a match snapshot.
- `Local Simulated`
  - Uses mock transport and simulated players.
  - Used for development, demos, and offline testing.

VoiceRoom flow:

- Reuse the voice room id as the Drawing Guess room id.
- Join the Drawing Guess transport separately from the audio session.
- Participants may remain in voice while drawing, but the game must still function if audio is disconnected.

Room identity:

- `roomId` is transport-level identity.
- `matchId` is a generated id for one game session inside a room.
- `playerId` must be stable for the current app session.
- `hostId` is the current game authority, not necessarily the voice-room owner.

## Transport Interface

Create a dedicated transport contract:

```ts
type DrawingGuessTransport = {
  connect(options: DrawingGuessConnectOptions): Promise<DrawingGuessConnection>;
};

type DrawingGuessConnection = {
  localPlayerId: string;
  publish(message: DrawingGuessOutboundMessage): Promise<void>;
  onMessage(listener: (message: DrawingGuessInboundMessage) => void): () => void;
  onPresence(listener: (players: DrawingGuessPresencePlayer[]) => void): () => void;
  disconnect(): Promise<void>;
};
```

LiveKit implementation:

- Owns its own LiveKit `Room` instance or an explicit shared-room adapter.
- Does not reuse `VoiceClient` internals.
- Does not leak LiveKit SDK objects outside the transport layer.
- Converts LiveKit participants to game presence.
- Uses `RoomEvent.DataReceived` and `localParticipant.publishData`.

Topics:

- `dg.v1.stroke.preview`
  - Lossy, high-frequency, small batches for in-progress drawing feedback.
- `dg.v1.stroke.commit`
  - Reliable final stroke commit.
- `dg.v1.chat`
  - Reliable guesses and system chat events.
- `dg.v1.control`
  - Reliable phase changes, prompt choices, scoring, host transfer, snapshot metadata.
- `dg.v1.snapshot`
  - Reliable chunked snapshot transfer.

Every message includes:

- `protocolVersion`
- `matchId`
- `messageId`
- `senderId`
- `clientTime`
- `sequence`
- `payload`

All inbound messages are validated before reducer dispatch. Unknown versions/types are ignored and logged in development.

## Authority Model

Use a pluggable authority boundary from day one:

```ts
type DrawingGuessAuthority = {
  canStartRound(playerId: string): boolean;
  canChoosePrompt(playerId: string): boolean;
  canCommitStroke(playerId: string): boolean;
  canScoreGuess(playerId: string): boolean;
  reduceAuthoritativeEvent(event: DrawingGuessEvent): DrawingGuessEvent[];
};
```

Initial authority:

- Client-host authority.
- First player becomes host.
- Host controls match start, turn order, prompt selection, timer expiry, scoring, round transitions, and snapshot replies.
- Host transfer promotes the connected player with the lowest join order if the host leaves.

Future server authority:

- The model and transport must not assume the host is a React component.
- The same authoritative events must be usable by a future Firebase Function, LiveKit agent, or custom server.
- Client-host authority is an implementation of the authority interface, not hardcoded throughout the UI.

Security posture:

- Private room codes and casual trust are acceptable for v1.
- Public competitive rooms are out of scope until server authority and moderation are added.
- Clients must never reveal the prompt to non-drawers through public state before results.

## Game Model

Match phases:

- `idle`
- `lobby`
- `prompt-select`
- `drawing`
- `round-results`
- `match-results`
- `disconnected`

Core state:

- `roomId`
- `matchId`
- `players`
- `hostId`
- `drawerId`
- `turnOrder`
- `roundNumber`
- `phase`
- `promptOptions`
- `promptCommitment`
- `revealedPrompt`
- `roundStartedAt`
- `roundEndsAt`
- `canvasRevision`
- `strokeIndex`
- `strokeChunks`
- `guesses`
- `scores`
- `correctGuessPlayerIds`
- `connectionStatus`

Prompt privacy:

- Drawer receives the prompt over a targeted reliable message when possible.
- Public state stores only `promptCommitment` during drawing.
- Result state reveals `revealedPrompt`.
- If targeted messages are unavailable, the host may send prompt only to the drawer by destination identity.

Default game rules:

- 2-8 players.
- 60 seconds per round.
- Each connected player draws once per match.
- Correct guess locks that player for the round.
- Drawer receives bonus if at least one guesser is correct.
- Guessers receive more points for faster correct guesses.
- Exact scoring constants live in pure model code and are covered by tests.

Word bank:

- Local static Arabic/English-friendly prompts.
- Categories: objects, food, places, actions, simple animals, household items.
- No user-generated prompts in v1.
- Profanity and unsafe terms are excluded from bundled prompts.

Guess normalization:

- Trim whitespace.
- Collapse repeated spaces.
- Case-insensitive English matching.
- Arabic diacritic-insensitive matching.
- Optional alias list per prompt.
- Store original guess for chat display and normalized guess for scoring.

## Drawing Data Model

Canonical drawing is vector-based:

```ts
type DrawingStroke = {
  id: string;
  authorId: string;
  tool: 'brush' | 'eraser';
  color: string;
  width: number;
  points: DrawingPoint[];
  createdAt: number;
  revision: number;
};
```

Point data:

- Coordinates are normalized to `[0, 1]` relative to the canvas bounds.
- Renderer converts normalized points to device pixels.
- Store enough points for fidelity but simplify noisy input before commit.

Brush behavior:

- Brush draws colored strokes.
- Eraser is modeled as an eraser stroke, not deletion of historical strokes.
- Renderer applies eraser strokes with Skia blend/masking.
- This keeps undo, replay, snapshots, and remote rendering deterministic.

Undo/clear:

- Drawer can undo only their latest stroke in the current round.
- Clear canvas is an authoritative control event that increments `canvasRevision`.
- After clear, old stroke commits with previous revisions are ignored.

Stroke batching:

- Preview points are throttled and sent lossy.
- Commit sends the simplified full stroke reliably.
- Receiver shows preview strokes separately until the commit arrives.
- Duplicate commits are ignored by `stroke.id`.

## Snapshot And History Strategy

Snapshots must be bounded and chunked.

Snapshot contents:

- Match metadata.
- Players and scores.
- Current phase/timer.
- Canvas revision.
- Stroke list for current revision.
- Guess history needed for display/scoring.

Chunking:

- Snapshot encoder splits payload into chunks under a conservative packet size.
- Chunks include `snapshotId`, `chunkIndex`, `chunkCount`, and checksum.
- Receiver applies snapshot only after all chunks arrive and checksum passes.
- Expired incomplete snapshots are discarded.

Compaction:

- At round end, old round stroke history can be discarded after results.
- During a long round, the host may emit a compacted canvas checkpoint:
  - A flattened image can be used for local render acceleration.
  - Vector strokes remain canonical for scoring/replay within the active round.
- Never require one huge full-history packet for late join.

Reconnect:

- Reconnected clients request snapshot.
- Until snapshot is applied, UI shows reconnecting state and blocks guesses/drawing.
- If no authority answers, the client returns to lobby recovery UI.

## UI Architecture

Screens and panels:

- `DrawingGuessScreen`
- `DrawingGuessLobbyPanel`
- `DrawingGuessCanvasStage`
- `DrawingGuessToolbar`
- `DrawingGuessGuessPanel`
- `DrawingGuessScorePanel`
- `DrawingGuessRoundResults`
- `DrawingGuessConnectionBanner`

Layout:

- Top bar: back, room code, round number, timer, connection status.
- Main area: responsive canvas with stable aspect ratio.
- Drawer toolbar: colors, brush size, eraser, undo, clear.
- Guesser panel: guess input, chat/guess feed, disabled state after correct guess.
- Score panel: players, current drawer, correct markers, points.

Visibility:

- Drawer sees prompt and drawing tools.
- Guessers see canvas, guess input, chat feed, and scores.
- Spectators/listeners can watch but cannot draw or score unless promoted to player.
- Results reveal prompt and score changes.

Accessibility and input:

- Buttons have text labels or accessible labels.
- Touch targets are large enough for mobile.
- Keyboard input must not cover the guess field.
- Canvas gestures should not conflict with screen scrolling.

## Platform Boundaries

Native Android/iOS:

- First-class targets.
- Skia and Gesture Handler are acceptable Expo v56 dependencies.

Web:

- Not first-class for this feature until CanvasKit setup is explicitly implemented and verified.
- If web support is required, add a renderer adapter:
  - `SkiaDrawingRenderer` for native.
  - `WebCanvasDrawingRenderer` or verified Skia web setup for web.

Expo Go/dev-client:

- Confirm whether added native packages work in the current development surface.
- If dev-client rebuild is required, document it in implementation notes.

## Testing Requirements

Pure unit tests:

- Reducer phase transitions.
- Authority permissions.
- Host transfer.
- Turn rotation.
- Scoring formula.
- Prompt visibility.
- Guess normalization.
- Stroke simplification.
- Duplicate/out-of-order message handling.
- Snapshot chunk encode/decode/apply.
- Canvas revision clear/ignore behavior.

Transport tests:

- Message validation rejects malformed payloads.
- Topic mapping uses reliable/lossy correctly.
- Snapshot chunks reassemble in any order.
- Missing chunks time out.
- Mock transport simulates multi-player sessions.

Manual scenarios:

- Create private room from Games tab.
- Join private room by code on a second device.
- Start from VoiceRoom using the same logical room id.
- Drawer draws and remote clients see preview plus committed strokes.
- Correct guess scores once.
- Drawer cannot guess their own prompt.
- Prompt is not visible to guessers before results.
- Late join receives chunked snapshot.
- Reconnect blocks input until snapshot is applied.
- Host leaves and host transfer continues the match.
- Clear canvas invalidates old stroke commits.
- Android small screen and large screen canvas layout remain stable.

Performance checks:

- Drawing stays responsive during fast finger movement.
- Packet rate is throttled.
- Long rounds do not grow memory without bound.
- Snapshot size remains chunked and bounded.

## Implementation Order

1. Build pure model, types, scoring, prompt normalization, and reducer tests.
2. Build mock transport and local simulated multi-player flow.
3. Build Skia canvas renderer against canonical vector strokes.
4. Add lobby/create/join route and Games tab entry.
5. Add LiveKit transport behind `DrawingGuessTransport`.
6. Add snapshot chunking and reconnect recovery.
7. Add VoiceRoom launch integration.
8. Run full test and manual device verification.

## Assumptions

- V1 is private-room multiplayer, not public matchmaking.
- Session history is not persisted after everyone leaves.
- LiveKit is the primary online transport because the repo already has token infrastructure and data-packet permissions.
- Firebase Functions remain useful for token creation, but not for game-state persistence in v1.
- The architecture intentionally supports future server authority without requiring it immediately.
- Native mobile quality is more important than web support for the first release.
