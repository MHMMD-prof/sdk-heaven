# Cosmetics and Room Effects — Wave 2 Runtime

Status: local implementation complete on 2026-08-02. The shared runtime remains
dark. Wave 2 is not accepted for production until the open Wave 0 physical
Android and iOS media gates pass and the Wave 2 physical runtime checks below
are recorded.

## What Wave 2 adds

- A fail-closed `appConfig/cosmeticsFeatures` client contract with five exact
  flags. Missing documents, read errors, malformed values, and truthy
  non-booleans all resolve to disabled.
- Exact published-version lookup from the Wave 1 registry. The client accepts
  only an approved, published, rendering-enabled immutable version and resolves
  download URLs only after validating its canonical storage path.
- A shared renderer for verified PNG, JPEG, legacy WebP, Lottie JSON, restricted
  MP4, and short M4A/AAC. Lottie, video, and effect audio have independent
  gates.
- A 40 MiB/40-file cache with exact byte-size and SHA-256 verification before a
  file is written or decoded. LRU pruning is best-effort and never makes room
  join depend on cache retention.
- Static fallback for disabled flags, invalid descriptors, incompatible client
  versions, reduced motion, low-memory mode, high-cost assets on a low device
  tier, missing cached files, checksum/download/decode failures, app
  backgrounding, and renderer errors.
- Hook-managed video/audio player cleanup, cancellation on descriptor change or
  unmount, disabled video controls/PiP/fullscreen, a poster until the first
  frame, muted visual MP4, and optional separately approved effect audio.
- A reusable preview surface. Only a ready primary renderer reports compatible;
  fallback or failure cannot authorize a future purchase/equip flow.
- Canonical asset references, combo coalescing, completion signals, unchanged
  queue cap, and queue/runtime telemetry in the existing room-effect path.

## Production flag state

The only Wave 2 owner script is a dark-only kill-switch:

```text
npm --prefix functions run cosmetics:renderer:disable
npm --prefix functions run cosmetics:renderer:disable -- --apply --actor-uid OWNER_UID
```

It writes all of these values as `false` and rejects enable arguments:

```text
cosmetics_asset_registry
cosmetics_shared_renderer
cosmetics_lottie
cosmetics_video
cosmetics_effect_audio
```

There is intentionally no production enable command while the physical-device
gate is open. No flag was written or deployed by the local implementation.

## Compatibility and failure behavior

- With flags off, room effects continue using their current HTTPS artwork and
  legacy rocket sound. Registry lookups do not run.
- A canonical room event is only a reference. The client independently verifies
  that the exact asset version is still published and approved.
- Animated assets require an exact published static fallback. Referenced effect
  audio must also be its exact published and approved version.
- Preparation failures use the verified static fallback, then the current
  compatibility image. A terminal failure never blocks room join or voice
  controls; the existing bounded queue timeout remains a final cleanup guard.
- Reduced/off modes never start canonical effect audio. Backgrounding, memory
  warnings, suspension, leaving the room, and unmounting clear or tear down
  effect work.

## Observability boundary

The bounded in-memory session log records lookup, cache hit/miss, download,
decode, ready, first frame, completion, cancellation, fallback, failure, queue
wait/expiry/priority drop/combo update, and teardown. Events may include only an
asset ID/version, category, format, elapsed time, and sanitized reason. Signed
URLs, storage paths, file paths, source documents, and asset contents are never
recorded.

## Remaining physical acceptance gate

Using the same approved fixtures on a physical Android device and iPhone:

1. Verify static, Lottie, MP4 poster/first frame/completion, and M4A playback.
2. Verify reduced motion, mute, app background/foreground, interruption, offline
   cache hit/miss, checksum failure, emergency disable, and low-memory cleanup.
3. Verify room join, speaking/listening, mute/speaker controls, and reconnect
   remain usable during each effect format.
4. Verify repeated effects and combos stay within the queue/cache budgets and
   release players after completion, cancellation, and room exit.
5. Keep video and effect-audio flags off until their individual device results
   pass. Record device model, OS version, build version, asset version, and
   result in the Wave 0 evidence table.
6. Supply `GoogleService-Info.plist` through the approved local/EAS secret path
   before the iOS run. The Wave 2 Android export succeeded, but the local file
   is currently absent and Expo reported that iOS config-path warning.

Until those checks pass, Wave 3 may consume the static compatibility path only;
MP4 and effect audio are not eligible for production rollout.
