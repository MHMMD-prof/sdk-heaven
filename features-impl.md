# Features Plan Implementation Tracker

This file tracks missed app features and production polish waves that can be implemented incrementally by Codex.

# Wave 0 — Arabic copy and mojibake cleanup
Status: COMPLETE
Checkpoint: 1b28cd5
Implementation Commit: 41c7a69

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: COMPLETE

Implementation Plan:
- Touched files: scan reachable UI/source/test/data/docs files for mojibake markers, then edit only files that contain broken copy for this wave.
- Risks: mojibake can appear in generated artifacts or intentionally encoded snapshots; avoid broad rewrites and preserve UI behavior.
- Required tests: run targeted copy/mojibake tests if present, then `npx tsc --noEmit` and relevant test suites for touched files.
- Rollback: revert to checkpoint commit `1b28cd5` or revert the final implementation commit once created.

Verification Notes:
- `npx vitest run src/__tests__/copyEncoding.test.ts src/battleship/__tests__/BattleshipPersistence.test.ts src/battleship/__tests__/BattleshipReleaseGate.test.ts` passed: 3 files, 45 tests.
- `npx tsc --noEmit` passed.
- `npm test` passed: 37 files, 284 tests.

Remaining:
- None.

Fix broken Arabic/mojibake text across reachable screens, data files, validation messages, and release-path copy. Keep existing UI behavior unchanged, prefer valid UTF-8 Arabic strings, and add or update targeted tests where release gates already check for broken copy.

# Wave 1 — Room presence accuracy
Status: COMPLETE
Checkpoint: 012ce98
Implementation Commit: 69e48ff8336f16a82b4aa9a33d3b9a2f8bd62da9

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: COMPLETE

Implementation Plan:
- Touched files: review existing Firestore presence rules, `src/voice/roomPresence.ts`, `src/voice/VoiceRoomsProvider.tsx`, voice-room controller usage, and focused presence tests.
- Risks: duplicating the earlier auth Wave 6 presence work, weakening membership authorization, or counting stale clients as live room participants.
- Required tests: run focused voice presence tests and `npx tsc --noEmit`.
- Rollback: revert tracker-only closure commit for this wave; revert implementation commit `69e48ff8336f16a82b4aa9a33d3b9a2f8bd62da9` only if the underlying presence implementation itself must be removed.

Verification Notes:
- PASSED: `npx vitest run src\voice\__tests__\roomPresence.test.ts src\voice\__tests__\mapVoiceRoomToMockParticipants.test.ts src\voice\__tests__\voiceRoomSessionReducer.test.ts`
- PASSED: `npx tsc --noEmit`

Review Notes:
- PASSED: existing client code writes Firestore presence heartbeats with `online` status while active and stale cleanup on leave/unmount.
- PASSED: fresh presence filtering drives live speaker/listener arrays and participant counts without replacing room membership as the authorization source.
- PASSED: Firestore rules allow only active room members to read presence and only the signed-in active member to write their own presence.

Remaining:
- None.

Add Firestore-backed room presence using client heartbeats, fresh presence filtering, leave cleanup, and active speaker/listener counts. Keep room membership as the authorization source and use presence only for live availability, counts, and UI freshness.

# Wave 2 — Private rooms and invite codes
Status: COMPLETE
Checkpoint: 4a711b7
Implementation Commit: 8f7ccd1

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: COMPLETE

Implementation Plan:
- Touched files: `src/screens/GroupsScreen.tsx` plus existing private-room provider/core/rules/tests.
- Risks: private rooms must stay hidden from public discovery, public rooms must keep existing behavior, and invite codes must not bypass membership authorization.
- Required tests: focused room profile tests, copy encoding test, `npx tsc --noEmit`, `npm test`, and rules tests if the emulator is available.
- Rollback: revert to checkpoint commit `4a711b7` or revert the final Wave 2 implementation/tracker commits once created.

Verification Notes:
- PASSED: `npx vitest run src/voice/__tests__/roomProfile.test.ts src/__tests__/copyEncoding.test.ts`
- PASSED: `npx tsc --noEmit`
- PASSED: `npm test`
- PASSED: `npm run test:rules` after sandboxed npm cache/network access failed and the check was rerun with escalation.
- PASSED after review fix: focused room profile/copy tests, `npx tsc --noEmit`, and `npm test`.

Review Notes:
- PASSED: public room creation and joining still use the existing `createRoom`/`joinRoom` paths.
- PASSED: private room creation now requires an explicit invite code in the UI and uses `createPrivateRoom`.
- PASSED: private room joining uses separate room id and invite code state and calls `joinPrivateRoom` without exposing private rooms in public discovery.

Remaining:
- None.

Add private room visibility, invite code creation, invite-based joining, and discovery rules so private rooms are hidden unless the signed-in user is invited or already a member. Keep public rooms working as they do today.

# Wave 3 — Account settings and profile management
Status: INCOMPLETE
Checkpoint: bb56d06
Implementation Commit: 1ce34af

Phase Status:
- Plan: COMPLETE
- Implementation: COMPLETE
- Verification: PASSED
- Review: PASSED
- Commit: BLOCKED

Implementation Plan:
- Touched files: verify existing `src/screens/AccountSettingsScreen.tsx`, `src/components/HomeHeader.tsx`, `src/auth/accountLifecycle.ts`, auth provider account methods, navigation, and Firestore rules/tests; add code only if verification exposes missing Wave 3 requirements.
- Risks: account deletion must remain a request flow rather than immediate destructive deletion, profile edits must keep existing validation, and password reset/sign-out paths must stay clear and user-facing.
- Required tests: focused account lifecycle/profile/copy tests, `npx tsc --noEmit`, `npm test`, and `npm run test:rules` if emulator tooling is available.
- Rollback: revert to checkpoint commit `bb56d06` or revert the final Wave 3 tracker/implementation commits once created.

Verification Notes:
- PASSED: `npx vitest run src/auth/__tests__/accountLifecycle.test.ts src/auth/__tests__/profile.test.ts src/auth/__tests__/authGate.test.ts src/__tests__/copyEncoding.test.ts`
- PASSED: `npx tsc --noEmit`
- PASSED: `npm test`
- PASSED: `npm run test:rules` after sandboxed npm cache/network access failed and the check was rerun with escalation.

Review Notes:
- PASSED: account/settings is registered in navigation and reachable from the home header.
- PASSED: profile edit, signed-in password reset, sign-out, and account deletion request flow use existing auth provider methods and validation.
- PASSED: account deletion remains a non-destructive request document under owner-only rules; no direct account deletion path was added.

Remaining:
- Commit phase is blocked because sandboxed Git cannot create `.git/index.lock`, and escalated `git add features-impl.md` was rejected by the app approval/usage limit. Resume by staging only `features-impl.md` and creating the Wave 3 tracker completion commit.

Add an account/settings entry point with edit profile, password reset access, sign-out, account deletion request flow, reauthentication handling, and clear user-facing security/error states.

# Wave 4 — Battleship release QA closure
Status: INCOMPLETE

Complete the Battleship Android manual release gate, record real device evidence in the existing QA result template, fix any blocking bugs found during QA, and keep automated checks passing before marking the local Battleship path release-ready.

# Wave 5 — Drawing Guess online readiness
Status: INCOMPLETE

Move Drawing Guess from local showcase/private-room prototype toward online readiness by validating create/join on two devices, snapshot recovery, reconnect behavior, host transfer, prompt privacy, scoring, and LiveKit data sync. Do not add public matchmaking, Firebase persistence, or server authority in this wave.

# Wave 6 — Carrom multiplayer wave
Status: INCOMPLETE

Upgrade Carrom beyond local two-player flow by adding a room-backed multiplayer session model, remote-ready player identities, synchronized shot submission/resolution, reconnect-safe match state, and tests for command validity and state recovery.

# Wave 7 — External game bridge
Status: INCOMPLETE

Replace the current WebView bridge placeholder with a minimal external game integration path: typed launch metadata, lifecycle hooks, message validation, close/error handling, and one demo external game entry. Keep the bridge narrow until a real external game contract is needed.

# Wave 8 — Rules emulator coverage
Status: INCOMPLETE

Add Firebase rules emulator tests for profiles, room membership, room presence, private invites, moderation write denial, and any new account/settings writes introduced by earlier waves.

# Wave 9 — iOS release foundation
Status: INCOMPLETE

Add iOS Firebase setup, Expo iOS config, `GoogleService-Info.plist`, iOS auth smoke testing, and iOS manual QA gates only when iOS becomes an active release target.
