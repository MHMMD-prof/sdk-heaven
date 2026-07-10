# Top Feature Wave Plan

This file tracks the highest-impact app features as staged waves that can be implemented and reviewed one at a time.

# Wave 0 - Private room foundation
Status: NOT_STARTED

Add or tighten private room creation, invite code generation, invite-code joining, and discovery rules. Private rooms should be hidden unless the signed-in user is invited or already a member, while public rooms keep their current behavior.

# Wave 1 - Live presence polish
Status: NOT_STARTED

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
