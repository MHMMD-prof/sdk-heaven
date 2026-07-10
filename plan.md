# Top Feature Wave Plan

This file tracks the highest-impact app features as staged waves that can be implemented and reviewed one at a time.

# Wave 0 - Private room foundation
Status: COMPLETE
Checkpoint: d534cf7
Implementation Commit: 8f7ccd1

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: COMPLETE

Implementation Plan:
- Touched files: review existing private-room implementation in `src/voice/roomProfile.ts`, `src/voice/VoiceRoomsProvider.tsx`, `src/screens/GroupsScreen.tsx`, `src/types/voice.ts`, `firestore.rules`, and focused room/rules tests.
- Risks: duplicating already-implemented private-room work, exposing private rooms in public discovery, accepting invalid invite codes, or weakening room membership authorization.
- Required tests: run focused room profile tests, `npx tsc --noEmit`, and `npm test`; inspect Firestore room rules for private visibility and invite membership constraints.
- Rollback: revert tracker-only closure commit for this wave; revert implementation commit `8f7ccd1` only if the underlying private-room implementation must be removed.

Verification Notes:
- PASSED: `npx vitest run src\voice\__tests__\roomProfile.test.ts`
- PASSED: `npx tsc --noEmit`
- PASSED: `npm test`

Review Notes:
- PASSED: public room discovery queries only active public rooms.
- PASSED: private room direct reads require active membership, and private membership creation requires the matching invite code.
- PASSED: app code exposes create/join private room flows with normalized invite codes and does not broaden public-room behavior.

Remaining:
- None.

Add or tighten private room creation, invite code generation, invite-code joining, and discovery rules. Private rooms should be hidden unless the signed-in user is invited or already a member, while public rooms keep their current behavior.

# Wave 1 - Live presence polish
Status: COMPLETE
Checkpoint: e57aee5
Implementation Commit: 69e48ff8336f16a82b4aa9a33d3b9a2f8bd62da9

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: COMPLETE

Implementation Plan:
- Touched files: review existing presence implementation in `src/voice/roomPresence.ts`, `src/voice/VoiceRoomsProvider.tsx`, `src/screens/VoiceRoomScreen.tsx`, `firestore.rules`, and focused voice presence tests.
- Risks: duplicating prior presence work, counting stale clients as live participants, replacing membership authorization with presence, or leaving rooms visually stale after unmount/leave.
- Required tests: run focused room presence tests, related voice mapping/session tests, `npx tsc --noEmit`, and `npm test`; inspect Firestore presence rules for active-member read/write constraints.
- Rollback: revert tracker-only closure commit for this wave; revert implementation commit `69e48ff8336f16a82b4aa9a33d3b9a2f8bd62da9` only if the underlying presence implementation must be removed.

Verification Notes:
- PASSED: `npx vitest run src\voice\__tests__\roomPresence.test.ts src\voice\__tests__\mapVoiceRoomToMockParticipants.test.ts src\voice\__tests__\voiceRoomSessionReducer.test.ts`
- PASSED: `npx tsc --noEmit`
- PASSED: `npm test`

Review Notes:
- PASSED: voice rooms start presence on room screen mount and write stale presence on leave/unmount.
- PASSED: heartbeats refresh `online` presence every 20 seconds and fresh filtering drives live speaker/listener counts.
- PASSED: Firestore rules require active room membership for presence reads and only allow users to write their own presence using their member role and publish capability.

Remaining:
- None.

Make live room presence feel accurate across normal app use: fresh heartbeats, stale cleanup, leave cleanup, and speaker/listener counts that reflect who is actually online. Keep membership as the authorization source and presence as live UI state only.

# Wave 2 - Room reconnect and recovery
Status: NOT_STARTED

Recover the correct room state after app backgrounding, network drop, screen switch, or reconnect. Prevent duplicate membership, lost role state, broken local member data, and stale UI after reconnect.

# Wave 3 - Drawing Guess private room join flow
Status: NOT_STARTED

Connect Drawing Guess cleanly to private rooms so a host can create a private Drawing Guess room, share the invite code, and another signed-in user can join the same online match from a second device.

# Wave 4 - Drawing Guess online gameplay reliability
Status: NOT_STARTED

Harden the online Drawing Guess match loop: prompt privacy, drawing sync, guessing flow, scoring, round transitions, host transfer, and reconnect behavior. Keep scope limited to private-room play and do not add public matchmaking in this wave.

# Wave 5 - Two-device QA and release gate
Status: NOT_STARTED

Validate Private Online Drawing Guess Rooms on two real devices or equivalent manual QA setup. Record create, invite, join, reconnect, scoring, prompt privacy, and leave/rejoin evidence before calling the headline feature release-ready.

# Wave 6 - Carrom multiplayer
Status: DEFERRED

After private Drawing Guess rooms are stable, upgrade Carrom with a room-backed multiplayer session model, remote player identities, synchronized shot submission/resolution, reconnect-safe match state, and command/state recovery tests.

# Wave 7 - External game bridge
Status: DEFERRED

After the app has a real external game contract to support, replace the WebView bridge placeholder with typed launch metadata, lifecycle hooks, message validation, close/error handling, and one demo external game entry.

# Recommended headline feature
Status: SELECTED

Ship Private Online Drawing Guess Rooms first. This combines invite-only rooms, live presence, reconnect handling, two-device online play, and a fun reason to use the app with friends.
