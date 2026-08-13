# Bottom Cinematic Effect Stage — Implementation Plan

## Product decision

Entry effects and major/global room gifts use one shared, pointer-transparent
cinematic stage anchored above the room controls. Inline gifts remain compact and
targeted gifts remain attached to the recipient seat.

The presentation is deliberately only partly configurable:

- Admins configure the approved visual/fallback/audio asset versions, duration,
  gift tier, sound policy, haptic policy, compatibility, and performance tier.
- The app owns stage placement, control-safe spacing, z-order, queue rules,
  text structure, accessibility behavior, and fallback behavior.
- Admins and uploaded assets cannot provide arbitrary explanatory text, screen
  coordinates, z-indexes, HTML, scripts, or autoplay behavior.

No new free-form layout fields are required for V1. The deterministic mapping is:

| Event | Surface |
| --- | --- |
| Room entry | Bottom stage |
| Couple entry | Bottom stage |
| Inline gift | Compact receipt |
| Targeted gift | Recipient seat |
| Major gift | Bottom stage |
| Global gift | Bottom stage |
| Reduced/off mode or render failure | Compact/static receipt |

This gives content teams useful control without making every asset a new layout
and device-compatibility problem.

## Trusted explanatory copy

The client renders localized copy from typed, server-snapshotted fields. It does
not trust an asset-authored sentence or a generic event `label` as authority.

Required meanings:

- Entry: “Ahmed entered the room” and, when useful, “Ahmed entered using Plane.”
- Couple entry: “Ahmed and Sara entered together.”
- Gift: “Ahmed sent Plane ×3 to Sara.”
- Missing or removed display names use the localized neutral member label.

The event keeps trusted IDs alongside bounded display-name snapshots. Blocking,
presence checks, room membership, and gift transaction authority remain unchanged.
The same generated copy is used for visible text and the accessibility live region.

## Stage contract

- One logical 1280×720 canvas, rendered with aspect-preserving `cover` inside a
  clipped bottom region.
- The important subject stays inside the central 80 percent of the source asset.
- The stage ends above the interactive room dock and respects device safe-area
  insets; controls, connection banners, moderation notices, and dialogs render
  above it.
- The stage consumes no touches and never delays joining, gifting, or wallet work.
- Dark edge gradients blend opaque video into the room and prevent hard rectangular
  edges. The first frame, final frame, and fallback must not flash white.
- One active stage effect at a time. The existing priority and eight-item queue cap
  remain authoritative. Compatible gift combos update the active presentation
  instead of replaying it.
- Backgrounding, leaving, suspension, lockdown, room closure, expiry, blocking,
  or entry participant departure cancels playback and prevents replay.

## Media contract

- Visual: approved Lottie JSON or opaque MP4 with one approved static fallback.
- MP4: H.264, at most 1280×720, at most 30 FPS, at most 5 MiB.
- Entry duration: 3–5 seconds. Gift duration: 1.5–6 seconds.
- MP4 is silent. Optional sound is a separately approved M4A/AAC asset so app,
  room, viewer, and interruption policies can mute it independently.
- Unsupported: GIF, MOV, HEVC, WebM, arbitrary remote URLs, embedded MP4 audio,
  executable bundles, and unapproved user uploads.

The supplied 22-second WhatsApp recording is a visual reference, not a valid
single effect. Individual effects must be exported as separate short assets.

## Wave 0 — Freeze contract and fixtures

**Status: prerequisite contract completed locally on 2026-08-09.** Typed copy and
surface contracts, deterministic surface mapping, Arabic/English fixtures, and
the short-media boundary are now executable. Stage geometry remains Wave 2 work.

1. Add pure `RoomEffectSurface` and structured `RoomEffectCopyInput` contracts.
2. Define the deterministic event-to-surface resolver shown above.
3. Define bottom-stage geometry tokens, safe-area rules, and stacking order.
4. Add Arabic and English copy fixtures for entry, couple entry, single gift,
   quantity gift, missing names, long names, and mixed RTL/LTR names.
5. Add valid/invalid short MP4 fixtures; keep the supplied recording outside the
   repository and record only why it is rejected.

Exit gate:

- Contract tests cover every event kind/tier and reject unknown surfaces or
  asset-authored explanatory copy.

## Wave 1 — Trusted event copy and media hardening

**Status: completed locally on 2026-08-09; not deployed.** New entry, couple-entry,
and gift events snapshot versioned bounded copy inputs and a deterministic surface.
The client generates explanatory Arabic text while retaining legacy event support,
and the pure builder also covers English. New gift/entry visual MP4 is required to
be silent; optional sound remains a separately approved M4A/AAC reference. New
physical receipts snapshot copy-template version and presentation surface, while
legacy receipts remain compatible until their assets are republished.

1. Replace ad hoc client `label` construction with a pure localized copy builder.
2. Preserve server-snapshotted sender, recipient, entrant, gift, vehicle, quantity,
   and couple fields with strict length and type limits.
3. Keep `label` only as a backward-compatible compact fallback for legacy events.
4. Reject embedded audio in entry/gift MP4 validation and require a separate exact
   approved audio reference when sound is enabled.
5. Include the structured copy inputs and stage surface in immutable physical
   approval receipts without changing gift economy or ownership authority.

Exit gate:

- Tests prove who sent what to whom, who entered, quantity/combo wording, neutral
  fallbacks, spoofed-field rejection, and silent-video enforcement.

## Wave 2 — Shared `BottomEffectStage`

**Status: completed locally on 2026-08-09; not deployed.** Entry and major/global
gift presentation now share one safe-area-aware, pointer-transparent bottom stage.
The stage uses trusted copy, entrant/sender/recipient identity bubbles, opaque
`cover` media with dark edge blending, reduced/off compact receipts, and a static
fallback for unavailable or failed renderers. Media completion settles once while
the queue's bounded duration/expiry timer remains the authoritative backstop.
The room dock, announcement/connection UI, notices, interactive rails, sheets, and
dialogs use higher shared layers. Focused stage/voice tests pass (25/25), TypeScript
passes, and the full repository run has 1,547 passing tests with unrelated existing
failures recorded outside this wave.

1. Extract stage rendering from `RoomEffectOverlay` into a dedicated component.
2. Render artwork/video behind a fixed information banner containing trusted copy
   and the relevant entrant/sender/recipient avatar where available.
3. Keep the effect pointer-transparent and the room dock, safety UI, sheets, and
   dialogs interactive and visually above it.
4. Support full, reduced, and off viewer modes plus static fallback on lookup,
   decode, timeout, or renderer failure.
5. Complete the queue item on media completion or the authoritative duration,
   whichever safely terminates first.

Exit gate:

- Component tests cover stage geometry, safe-area insets, control z-order,
  pointer behavior, copy, avatars, fallback, completion, and error handling.

## Wave 3 — Entry integration

**Status: completed locally on 2026-08-09; not deployed.** Normal and couple
entries now use the shared bottom stage with exact trusted entrant copy and exact
approved asset versions. Approved static fallback assets remain discoverable when
entry motion, Lottie, or video playback is disabled. First-time announcements now
require an active membership plus an online/reconnecting, unexpired presence lease;
the existing deterministic per-session claim prevents reconnect amplification.
The client preserves seen IDs across reconnect/foreground subscriptions, rejects
events older than the current foreground boundary, and cancels normal or couple
entries when any required participant leaves. Focused entry integration tests pass
(53/53), including the 20-person bounded burst; the full repository run has 1,579
passing tests with two unrelated social expectation failures.

1. Route normal and couple entry visuals to the bottom stage.
2. Use the entrant/couple copy template and current approved entry presentation.
3. Preserve genuine-presence/session deduplication and participant-left removal.
4. Preserve static entry banners when animation/video flags are off.
5. Confirm reconnect and foreground transitions never replay an entry.

Exit gate:

- Service and client integration tests cover one entry per presence session,
  entrant identity, couple identity, cancellation, fallback, and a 20-person burst.

## Wave 4 — Gift integration

**Status: completed locally on 2026-08-09; not deployed.** Major/global gifts use
the shared bottom stage, while inline receipts and targeted-seat effects retain
their existing surfaces. Server-authored gift events now persist an authoritative
combo-window ID beside the sender, recipient, gift, quantity, tier, and exact
asset snapshot. Only effects with the same window, participants, gift, tier,
surface, media, and playback policy update in place; their MP4/audio renderer
inputs remain stable so count updates do not restart playback. Economy, scoring,
receipts, blocking, duplicate-request, and global-campaign behavior remain
transactional and independent of renderer success. Focused gift/effect tests pass
(55/55), Functions lint passes, and the full repository run has 1,587 passing
tests with two unrelated existing social-test expectation failures.

1. Route only major/global gifts to the bottom stage.
2. Keep inline receipts and targeted-seat presentation unchanged.
3. Show sender, gift name, quantity/combo, and recipient from the authoritative
   transaction snapshot.
4. Update a compatible active combo in place without restarting MP4 or audio.
5. Preserve wallet, commission, score, receipt, block, and global-campaign rules
   regardless of animation success.

Exit gate:

- Tests cover all four tiers, sender/recipient correctness, combo updates,
  duplicate requests, blocked senders, global eligibility, and renderer failure
  without any financial replay or rollback.

## Wave 5 — Admin preview and bounded configuration

**Status: completed locally on 2026-08-10; not deployed.** Gift and entry editors
now render a shared-contract preview for compact 360×720 and tall 393×852 phones,
including the real surface mapping, generated trusted example copy, room controls,
and the protected control zone. New animated gifts no longer have an unreviewed
admin publication path: they require immutable Android, iOS, and safe-zone
approval bound to the exact visual, fallback, optional audio, duration, tier,
playback policy, performance tier, compatibility version, copy template, and
surface. Editing a bound field clears receipt reuse; stale catalog revisions and
stale receipt scopes fail closed. Runtime compatibility remains for previously
published simple MP4 gifts. Media publication rechecks dimensions, duration,
size, frame rate, codec, silence, usage, fallback, and optional audio limits.
Admin tests pass (39/39), focused Wave 5 tests pass (49/49), Functions lint and
the production dashboard build pass. The full repository run has 1,598 passing
tests with three unrelated existing failures.

1. Add a bottom-stage preview using representative phone aspect ratios and room
   control-safe overlays.
2. Keep the existing asset, duration, tier, sound, haptic, compatibility, and
   performance controls; do not add free-form position or text fields.
3. Show a generated example sentence using test sender/recipient/entrant names.
4. Require Android and iOS approval receipts for the exact visual, fallback,
   optional audio, duration, tier, and bottom-stage safe-zone result.
5. Reject publication when the asset is too long, too large, uses unsupported
   codecs, contains embedded audio, lacks a fallback, or fails either platform.

Exit gate:

- Admin tests cover preview parity, immutable receipt matching, stale revisions,
  approval separation, and every invalid media/configuration path.

## Wave 6 — Rollout, telemetry, and physical acceptance

**Status: implemented and globally enabled in the empty/test environment on
2026-08-11.** Android preview build `48c97563-5b60-4e64-a646-2f68a5e42d57`
completed successfully and the Firebase rollout is audited. The
bottom stage now has an independent fail-closed master switch with tester,
controlled-room, and global rollout modes plus an audited owner-only operator
command. Rollback restores the legacy overlay without changing entry or gift
authority. Identity-free telemetry covers every required stage outcome, and
automated lifecycle, stress, accessibility, and queue acceptance checks are in
place. The six-row real-device matrix in
`docs/BOTTOM_EFFECT_STAGE_WAVE6_ACCEPTANCE.md` remains required before users are
onboarded.

1. Add a disabled-by-default `room_bottom_effect_stage` flag. When false, retain
   the current presentation so rollback does not affect entries or gift economy.
2. Record redacted stage outcomes: shown, reduced, fallback reason, decode error,
   completion, cancellation reason, queue drop, and combo update.
3. Test low/mid/high Android and iOS devices with LiveKit audio, calls,
   headphones/Bluetooth changes, reduced motion, low memory, background/foreground,
   slow/corrupt/missing assets, RTL/LTR names, and rapid event bursts.
4. Enable for owner/test accounts first, then controlled rooms, then wider rollout.
5. Roll back the stage flag independently of video, audio, entry, gift, ownership,
   store, wallet, and receipt systems.

Exit gate:

- No obscured controls, stuck queue, replayed entry, duplicated gift transaction,
  leaked audio, inaccessible copy, or crash in the physical acceptance matrix.

## Definition of done

- Every entry and major/global gift uses the same bottom cinematic surface.
- Visible and accessible text always explains the actor, action, item, and target
  when applicable.
- Opaque MP4 works without transparency and fails safely to a static receipt.
- Layout remains consistent across supported phones without per-asset coordinates.
- Existing inline/targeted gifts, queue priority, financial authority, blocking,
  presence, and rollback behavior remain intact.
