# Auth Plan Implementation Tracker

This file tracks the production auth, profile, room, and LiveKit authorization waves.

# Wave 0 — Firebase Android foundation
Status: COMPLETE

Locked the Android-first Firebase foundation to project `yallgame-ebd19`, Android package `com.mh.games`, and existing `google-services.json`. iOS Firebase setup remains deferred.

# Wave 1 — Email/password auth hardening
Status: COMPLETE

Moved Firebase config to Expo public env vars, added sign-in/sign-up UX, password reset, email verification gating, and sign-out.

# Wave 2 — Auth profile architecture
Status: COMPLETE

Added Firestore-backed owner profile documents at `users/{uid}`, domain `AuthUser`, profile setup gate, profile validation, and owner-only rules.

# Wave 3 — Backend LiveKit auth enforcement
Status: COMPLETE

Protected the LiveKit token Function with Firebase ID tokens, verified email/profile server-side, and stopped trusting client-sent identity/display data.

# Wave 4 — Room membership auth
Status: COMPLETE

Added Firestore public room docs, membership docs, room creation/join flows, membership-gated LiveKit tokens, and room/member Firestore rules.

# Wave 5 — Host controls and moderation
Status: COMPLETE

Added the `roomCommand` Function, host-only role/status mutations, moderation audit events, removed/closed room enforcement, and host moderation controls.

# Wave 6 — Live room presence
Status: COMPLETE
Checkpoint: cbf0139
Implementation commit: 69e48ff8336f16a82b4aa9a33d3b9a2f8bd62da9
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Planned next. Add Firestore-backed room presence using client heartbeats, derive active speakers/listeners/counts from fresh presence docs, mark stale presence on leave, and keep membership as the authorization source.

Wave 6 implementation plan:
- Add a focused room presence module for validating/mapping `rooms/{roomId}/presence/{uid}` data, stale detection, and deriving speakers/listeners/counts from fresh presence while falling back to membership data.
- Extend `VoiceRoomsProvider` to subscribe to joined-room presence, write local-user heartbeat docs while the room is open, and mark local presence stale on leave/unmount.
- Extend Firestore rules with owner-only presence writes tied to active membership, active room status, and profile identity.
- Keep LiveKit token authorization unchanged; membership remains the authorization source.
- Add focused unit tests for presence mapping/staleness and room derivation. Run `npx tsc --noEmit` and `npm test`.
- Rollback: revert the implementation commit created after this checkpoint, or restore to checkpoint `cbf0139` if the full Wave 6 attempt must be discarded.

# Wave 7 — Private rooms and invites
Status: COMPLETE
Checkpoint: afb8482
Implementation commit: a41bb031c55ac1aab5c9aa33a1c3cd444a1cb117
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add private room visibility, invite codes, invite/member validation, and discovery rules so private rooms are hidden unless the user is invited or already a member.

Wave 7 implementation plan:
- Extend room documents with `visibility: 'public' | 'private'` and optional invite codes, while keeping public rooms compatible with existing UI.
- Add private room creation/join helpers that create host membership and allow invite-code joins without exposing private rooms in normal discovery.
- Update room listing so active public rooms are listed, while joined private rooms are available through local membership overrides after creation/join.
- Add Firestore rules for private room reads/joins: users can read public active rooms, hosts/members can read their private rooms, and invite-code joins can create listener membership without forging identity or role.
- Add focused tests for private room payloads, invite normalization/validation, room visibility mapping, and private join behavior. Run `npx tsc --noEmit` and `npm test`.
- Rollback: revert the Wave 7 implementation commit after checkpoint `afb8482`; full reset to `afb8482` is destructive and requires explicit approval.
- Completed with implementation commit `a41bb031c55ac1aab5c9aa33a1c3cd444a1cb117`. Note: `firestore.rules` already contained the Wave 7 private-room rule shape at the checkpoint; this implementation commit contains the app model/provider/test pieces.

# Wave 8 — Firebase rules emulator coverage
Status: COMPLETE
Checkpoint: 478a165
Implementation commit: 15782a0
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add emulator-backed tests for profile rules, room membership rules, presence rules, moderation write denial, and private invite access once Wave 7 lands.

Wave 8 implementation plan:
- Inspect existing Firebase/test tooling and prefer a lightweight emulator-test harness that can run from npm without changing production app code.
- Add rules coverage for owner profile access, public/private room read behavior, membership invite validation, presence writes, and moderation/admin write denial.
- Keep tests isolated from app unit tests when emulator tooling is unavailable; record any emulator startup requirement clearly.
- Update package scripts or config only as needed to run the rules tests.
- Run `npx tsc --noEmit`, `npm test`, and the focused rules test command if available.
- Rollback: revert the Wave 8 implementation commit after checkpoint `478a165`; full reset to `478a165` is destructive and requires explicit approval.
- Completed with implementation commit `15782a0`.

# Wave 9 — Account lifecycle and security UX
Status: COMPLETE
Checkpoint: fc588b9
Implementation commit: 1ce34af
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add production account settings: edit profile, change/reset password entry points, account deletion request flow, reauth handling, and user-facing security/error states.

Wave 9 implementation plan:
- Extend auth APIs with profile editing reuse, password reset for the current email, and an account deletion request document rather than destructive client-side deletion.
- Add an account/settings screen reachable from the main app header for profile edits, password reset entry point, sign-out, and account deletion request UX.
- Add a `users/{uid}/accountDeletionRequests/{requestId}` client-write path with strict owner-only Firestore rules and no immediate account deletion.
- Add tests for account deletion request payload validation/mapping, auth API behavior where unit-testable, and navigation type/gate coverage as appropriate.
- Run `npx tsc --noEmit` and `npm test`. Avoid running Java-based rules emulator unless rules changed in a way that requires it; if rules change, run `npm run test:rules` and expect a local Java firewall prompt.
- Rollback: revert the Wave 9 implementation commit after checkpoint `fc588b9`; full reset to `fc588b9` is destructive and requires explicit approval.
- Completed with implementation commit `1ce34af`.

# Wave 10 — iOS Firebase setup
Status: COMPLETE
Checkpoint: f55d24de463d2bc95b27357371c9bd0017dfb9e5
Implementation commit: afc8cdca7f3e14c063f3c27f58805dda80b663ce
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add iOS bundle id, `GoogleService-Info.plist`, Expo iOS Firebase config, and iOS auth smoke testing when the iOS release wave starts.

Wave 10 implementation plan:
- Add an Expo iOS bundle identifier aligned with the existing app identity and document the required Firebase iOS app registration for project `yallgame-ebd19`.
- Do not fabricate `GoogleService-Info.plist`; add checklist guidance and smoke-test coverage that makes the missing real plist explicit until the Firebase Console file is provided.
- Add focused automated coverage for iOS auth/Firebase configuration expectations without running native iOS builds or Java-based emulators.
- Run `npx tsc --noEmit` and `npm test`; avoid `expo run:ios` because it requires local Xcode/iOS environment and a real Firebase plist.
- Rollback: revert the Wave 10 implementation commit after checkpoint `f55d24de463d2bc95b27357371c9bd0017dfb9e5`; full reset to the checkpoint is destructive and requires explicit approval.
- Completed with implementation commit `afc8cdca7f3e14c063f3c27f58805dda80b663ce`. Native iOS builds still require the real `GoogleService-Info.plist` from Firebase Console.
