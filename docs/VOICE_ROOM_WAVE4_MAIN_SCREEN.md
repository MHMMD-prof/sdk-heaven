# Voice Room Wave 4: Production Main Screen

## Status

Implementation is complete locally as of 2026-07-23. No production deployment or Firebase mutation was performed. Native-device layout, font-scaling, screen-reader, keyboard, and two-device voice acceptance remain release gates.

## Delivered screen

The old vertically scrolling proof screen is replaced by a fixed, safe-area-aware room composition:

- Compact header with leave, room identity, persistent owner name, room ID, participant count, participant sheet, and native share action.
- Five-column microphone stage that represents 5, 10, 15, or 20 configured seats and keeps occupied retiring seats visible after downsizing.
- Seat visuals for empty, locked, occupied, speaking, muted, reconnecting, and retiring states.
- Owner and room-moderator badges derived from authority, never from seat position.
- Authoritative open/request seat actions connected to the Wave 3 command service.
- Priority notice region for command errors, connection failure, audio lockdown, and reconnect actions.
- Bounded room activity viewport that cannot cover the stage, safety notice, or bottom controls.
- Persistent bottom controls for gifts, Command Center, reactions, seat/microphone, speaker output, and chat availability.
- Participant sheet with speaker/listener state and profile navigation.
- Production Command Center drawer inspired by the supplied tool-drawer reference, with a clear grid and role-aware availability.

## Feature boundaries

Wave 4 does not fake later-wave success:

- Music, room settings, and room locking remain disabled until their authoritative Wave 5/6 services exist.
- Chat reports that it is unavailable until the room chat service and policy are active.
- Games launch the existing room-linked Drawing Guess flow without disconnecting the voice provider.
- Gifts open the existing gift center.
- Report entry opens the participant selector; the existing role-safe reporting command remains authoritative.

## Presentation model

`roomMainScreenModel.ts` is independent from React Native rendering. It:

- Projects legacy rooms into deterministic seats while v2 activation is staged.
- Uses explicit v2 seat documents when present.
- Keeps retiring overflow seats visible.
- Maps seat modes to valid self-service actions.
- Produces accessibility labels with seat number, occupant, authority, and recovery state.
- Resolves critical errors above lockdown and connection notices.

## Verification

Completed locally:

- Presentation-model tests for legacy projection, retiring seats, action modes, priority notices, and supported seat counts.
- Existing room-profile, room-contract, presence, and room-command tests.
- TypeScript compilation.
- Expo SDK 56 production bundle verification.
- Backend syntax/function lint and the Wave 3 seat test set.

The repository-wide test command still contains failures in concurrently edited representative-transfer and social-wallet tests. They are outside the voice-room files and are recorded as a repository integration gate, not hidden as a Wave 4 pass.

## Native acceptance matrix

Before rollout, verify:

- 5, 10, 15, and 20 seats on a small Android phone, large Android phone, iPhone, and tablet.
- Large font and screen-reader announcements for seat number, role, speaking, mute, lock, and reconnect states.
- Command Center and participant sheet focus order and dismissal.
- Bottom controls with keyboard visible and while Android/iOS safe-area insets change.
- LiveKit reconnect, forced mute, seat claim/request, speaker routing, and navigation to a game.
- Reduced-motion behavior for reactions and future entry/gift overlays.
