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
Status: INCOMPLETE
Checkpoint: cbf0139
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: NOT_STARTED

Planned next. Add Firestore-backed room presence using client heartbeats, derive active speakers/listeners/counts from fresh presence docs, mark stale presence on leave, and keep membership as the authorization source.

Wave 6 implementation plan:
- Add a focused room presence module for validating/mapping `rooms/{roomId}/presence/{uid}` data, stale detection, and deriving speakers/listeners/counts from fresh presence while falling back to membership data.
- Extend `VoiceRoomsProvider` to subscribe to joined-room presence, write local-user heartbeat docs while the room is open, and mark local presence stale on leave/unmount.
- Extend Firestore rules with owner-only presence writes tied to active membership, active room status, and profile identity.
- Keep LiveKit token authorization unchanged; membership remains the authorization source.
- Add focused unit tests for presence mapping/staleness and room derivation. Run `npx tsc --noEmit` and `npm test`.
- Rollback: revert the implementation commit created after this checkpoint, or restore to checkpoint `cbf0139` if the full Wave 6 attempt must be discarded.

# Wave 7 — Private rooms and invites
Status: INCOMPLETE

Add private room visibility, invite codes, invite/member validation, and discovery rules so private rooms are hidden unless the user is invited or already a member.

# Wave 8 — Firebase rules emulator coverage
Status: INCOMPLETE

Add emulator-backed tests for profile rules, room membership rules, presence rules, moderation write denial, and private invite access once Wave 7 lands.

# Wave 9 — Account lifecycle and security UX
Status: INCOMPLETE

Add production account settings: edit profile, change/reset password entry points, account deletion request flow, reauth handling, and user-facing security/error states.

# Wave 10 — iOS Firebase setup
Status: INCOMPLETE

Add iOS bundle id, `GoogleService-Info.plist`, Expo iOS Firebase config, and iOS auth smoke testing when the iOS release wave starts.
