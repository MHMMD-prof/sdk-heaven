# Features Plan Implementation Tracker

This file tracks missed app features and production polish waves that can be implemented incrementally by Codex.

# Wave 0 — Arabic copy and mojibake cleanup
Status: INCOMPLETE

Fix broken Arabic/mojibake text across reachable screens, data files, validation messages, and release-path copy. Keep existing UI behavior unchanged, prefer valid UTF-8 Arabic strings, and add or update targeted tests where release gates already check for broken copy.

# Wave 1 — Room presence accuracy
Status: INCOMPLETE

Add Firestore-backed room presence using client heartbeats, fresh presence filtering, leave cleanup, and active speaker/listener counts. Keep room membership as the authorization source and use presence only for live availability, counts, and UI freshness.

# Wave 2 — Private rooms and invite codes
Status: INCOMPLETE

Add private room visibility, invite code creation, invite-based joining, and discovery rules so private rooms are hidden unless the signed-in user is invited or already a member. Keep public rooms working as they do today.

# Wave 3 — Account settings and profile management
Status: INCOMPLETE

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
