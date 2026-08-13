# Cosmetics and Room Effects Wave 7: reactions and animated themes

## Outcome

Wave 7 is implemented locally behind fail-closed flags. It adds:

- authenticated, server-authorized room reactions delivered as LiveKit data;
- independent per-user and per-room reaction rate limits;
- a bounded mobile ambient-reaction aggregator outside the major-effect queue;
- backward-compatible room-theme manifest V2 motion references;
- one silent MP4 background and at most two Lottie ambient theme slots;
- canonical-registry approval, exact-version, checksum, format, and static
  fallback enforcement at theme publication;
- shared-renderer lifecycle, reduced/off, background, and Majlis fallback
  behavior; and
- admin V1/V2 editing, motion-reference preview, control safe-area preview,
  emergency disable, and immutable rollback.

No function, rule, application configuration, asset, catalog, or manifest was
deployed. `room_reactions` and `room_animated_themes` default to false.

## Reaction authority and delivery

Clients submit an asset ID/version and intent to `roomReactionCommand`. The
service verifies active membership and the current presence session, room
policy, the configured `room_reaction_catalog`, and the exact immutable
approved/published `room-reaction` registry version. It applies a rolling
20-per-user and 120-per-room limit each minute.

The committed command record is idempotent and retained for 24 hours. The
server then sends a compact versioned envelope on
`sdk-heaven.room-reaction.v1` with LiveKit reliable data. Replaying the same
request may redeliver the same event ID after a transient LiveKit failure.
Reactions do not write `rooms/{roomId}/events` and cannot consume the
eight-item gift/entry/rocket queue.

The client rejects unknown keys, wrong rooms, malformed identities, stale or
future timestamps, invalid checksums, unsupported formats, and oversized
payloads. It merges bursts for 800 ms, caps counts at 99, and keeps at most
four active groups. Notices and major effects suppress ambient reactions.
Backgrounding, leaving, suspension, viewer-off mode, expiry, and flag disable
clear the pool.

## Animated theme contract

Manifest V1 remains valid without migration. Manifest V2 adds:

```text
motion.background: room-theme MP4 asset reference or null
motion.ambient: up to two bounded room-theme Lottie asset references
```

The admin publish transaction resolves every exact canonical version and its
approval. Background motion must be MP4; ambient motion must be Lottie JSON.
All motion must be silent and must reference an approved static PNG/JPEG
fallback. Ambient slots are constrained to the room content safe area.

Mobile always mounts the static theme first. Motion is layered above that
static background and below seats, identity cosmetics, notices, controls, and
major effects. Any lookup, validation, renderer, feature-flag, reduced-motion,
background, suspension, or playback failure leaves the static theme visible.
Invalid or disabled manifests atomically return to the bundled Majlis theme.

## Rollout and rollback

`functions/scripts/setCosmeticsRendererFlags.js` can force both Wave 7 flags
off but cannot enable them. Reactions and animated themes can be disabled
independently. Theme emergency-disable and immutable revision rollback remain
available. Disabling motion does not disable static room themes, ownership,
purchases, gifts, entry effects, voice, or room controls.

Before either flag is enabled:

1. Publish an explicitly approved reaction catalog and representative V2
   theme assets through the canonical registry.
2. Pass Firestore emulator rules and all local typecheck/test/build gates.
3. Complete Wave 0/2 physical Android and iOS Lottie/MP4 evidence.
4. Verify Arabic/English RTL, font scaling, reduced/off settings, background
   teardown, low memory, 5/10/15/20 seats, reaction bursts, gift/entry
   coexistence, and continuous LiveKit voice quality on mid-range Android.
5. Observe reaction throttle/drop and theme fallback/first-frame metrics
   before widening rollout.

## Current acceptance status

Local verification on 2026-08-04:

- root TypeScript compilation passed;
- the main non-emulator suite passed 211 files and 1,131 tests;
- Functions syntax/lint checks passed;
- the focused reaction, aggregation, V2 contract, and flag suites passed;
- Expo Doctor passed all 21 checks;
- Android export passed;
- the admin production build passed; and
- the admin standalone typecheck remains blocked only by the pre-existing
  `DailyLoginRewardsPanel.tsx` errors recorded in Wave 6.

The combined Firestore/Storage emulator run passed 59 of 60 tests. Its only
failure is the pre-existing Wave 6 public-profile projection expectation at
`firestore.rules.emulator.test.mjs:141`; all new Wave 7 server-only reaction
collection denials passed. Physical Android/iOS acceptance, approved
production assets, deployment, and production flag enablement remain open
release gates.
