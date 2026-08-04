# Cosmetics and Room Effects Wave 5: entry vehicles

## Outcome

Wave 5 upgrades the deployed static room-entry banner to the shared cosmetics
renderer without changing existing car ownership or equipment documents.
`storeEquipment/{uid}.slots.cars` remains the legacy equipment authority and is
mapped server-side to the canonical `entry-effect` slot.

No production data was changed, no function or rule was deployed, and all new
motion/audio/video switches remain disabled by default.

## Approved asset contract

An animated car presentation references exact immutable registry versions:

- one published and approved 1280x720 `entry-effect` Lottie JSON or opaque H.264 MP4;
- one published and approved static `entry-effect` PNG or legacy WebP
  1280x720 fallback embedded in the visual version;
- optionally, one published and approved `effect-audio` M4A/AAC version embedded
  in the visual version;
- one immutable `entryPresentationApprovalReceipts/{receiptId}` record.

The receipt snapshots the car ID, exact version IDs, checksums, duration,
performance tier, minimum client, sound policy, reviewer, tested devices, and
client version. Android and iOS must pass. The allocated presentation region
must pass the controls safe-zone check. MP4 additionally requires an opaque
composition pass because transparent MP4 is not supported by this runtime.

Changing the visual version creates a new deterministic receipt ID. Changing
the bundle or playback policy invalidates the existing immutable receipt and
therefore requires a new visual version plus a new physical pass. Users may submit assets through the
registry, but no user-owned asset can render before the same administrator
approval and publication checks pass.

## Server behavior

`announce-entry-effect` still creates at most one claim for a genuine
`uid + presence session`. Reconnects, foreground churn, and alternate request
IDs cannot create another room event.

Before announcing, the server verifies:

- active membership and matching current presence session;
- active public profile and active room;
- room effects/customization are not suspended;
- an equipped `cars` item with active, non-expired ownership;
- an available car catalog item;
- compatible client version;
- exact published asset versions, approval checksums, and the immutable
  physical-device receipt.

The event snapshots the canonical and legacy slots, exact visual/fallback/audio
references and checksums, receipt ID, duration, compatibility, performance,
sound policy, delivery switches, and expiry. Disabled renderer switches produce
the existing static entry banner. They do not change ownership or room joining.

## Mobile behavior

- Entry, gifts, and room rockets continue through the shared priority queue.
- The queue is capped at eight; equal-priority joins use deterministic expiry
  ordering, so a twenty-person burst remains bounded.
- Only one major effect renders at a time.
- Full mode uses a clipped 1280x720-style presentation region ending above the
  bottom controls. It is pointer-transparent and below safety/connection UI.
- Reduced motion, low-memory mode, disabled flags, lookup failure, checksum
  failure, or renderer failure use the compact static banner.
- Off mode suppresses decorative entries.
- Backgrounding removes queued/active entry effects and marks their event IDs
  seen, preventing a foreground replay.
- Leaving, participant departure, room customization suspension, audio
  lockdown, room closure, or event expiry stops the entry effect.
- Room join and LiveKit connection never wait for asset lookup or playback.

The Expo SDK 56 implementation follows the versioned
[Video](https://docs.expo.dev/versions/v56.0.0/sdk/video/),
[Audio](https://docs.expo.dev/versions/v56.0.0/sdk/audio/), and
[Image](https://docs.expo.dev/versions/v56.0.0/sdk/image/) APIs. Video uses a
lifecycle-managed player, no native controls, no picture-in-picture, no
background playback, `textureView`, and no persistent cache dependency.

## Dark rollout and rollback

`appConfig/cosmeticsFeatures` adds three independent fail-closed switches:

- `room_entry_animations`
- `room_entry_audio`
- `room_entry_video`

`functions/scripts/setCosmeticsRendererFlags.js` can only write these switches
as `false`; it has no enable command. The existing
`voice_room_entry_effects` product flag remains the server announcement gate.

Rollback is immediate: set the three Wave 5 switches to false. Existing cars
continue to show the deployed static entry banner, and ownership/equipment data
is not migrated or rewritten.

## Release gate still required

Before any Wave 5 switch is enabled, physically verify representative low,
standard, and high-tier Lottie entries plus every MP4 entry on supported Android
and iOS devices. Confirm control visibility, background/foreground cancellation,
reconnect non-replay, reduced motion, audio mixing, low-memory fallback, room
suspension, participant departure, and twenty-person burst behavior.
