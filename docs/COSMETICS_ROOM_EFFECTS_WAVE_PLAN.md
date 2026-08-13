# User Cosmetics and Room Effects — Production Wave Plan

## Objective

Build one production system for user cosmetics and room effects instead of adding
format-specific behavior independently to profiles, chat, room seats, gifts,
entrances, and themes.

The finished system covers:

- static and animated avatar borders;
- profile skins;
- chat bubbles;
- nameplates, name effects, cosmetic titles, and collectible badges;
- entry vehicles and entrance effects;
- seat and microphone effects;
- small, targeted, combo, full-screen, and global gift presentations;
- room reactions and ambient effects;
- static and animated room themes;
- couple cosmetics where both users are eligible; and
- approved custom assets for authorized users.

Every wave is a releasable vertical slice. A wave includes server-authoritative
contracts, backward compatibility, Firestore and Storage enforcement, mobile
rendering, admin controls where applicable, automated tests, physical-device
acceptance, observability, a rollout flag, and a rollback path.

This plan targets the repository's installed Expo SDK 56 stack. Re-check the
exact versioned Expo documentation at
<https://docs.expo.dev/versions/v56.0.0/> before every Expo dependency,
configuration, image, audio, animation, or video implementation change.

---

## Current repository baseline

This project already has substantial production foundations:

- store catalog, wallets, immutable ledgers, purchase and gifting flows;
- permanent and timed ownership with expiry cleanup;
- one equipped item per existing store category;
- `avatar-frames`, `cars`, `chat-themes`, `game-items`, and `custom-ids`;
- public-profile projection of the equipped avatar frame;
- live avatar-frame projection into voice-room participants;
- avatar-frame rendering on occupied room seats;
- room gift events and an authoritative gift economy;
- entry-vehicle ownership and server-authoritative room-entry announcements;
- a shared room-effect queue capped at eight events and one major overlay at a
  time;
- reduced/off room-effect modes and static compact fallbacks;
- versioned immutable room themes and a bundled default theme;
- approved room images with private pending storage and moderation;
- catalog administration, scoped admin roles, audit events, feature flags, and
  emergency controls; and
- Firestore and Storage emulator coverage.

Important current gaps:

- store and gift records expose image URLs rather than one shared typed asset
  manifest;
- no Lottie renderer or `expo-video` runtime is installed;
- entry effects intentionally use static artwork pending a native format gate;
- the effect overlay maps all current effects to static artwork;
- profile headers receive an equipped frame but still render a fixed gold
  border;
- written room chat has no avatar/cosmetic identity treatment;
- additional cosmetic categories and equipment slots do not yet exist;
- room themes and rocket effects use related but separate asset contracts;
- custom user cosmetics do not have a dedicated submission and approval
  workflow; and
- asset load, decode, start-delay, dropped-frame, fallback, and disable metrics
  are not unified.

This plan extends those systems. It does not replace the store, room event
queue, gift ledger, room theme architecture, or existing moderation controls.

---

## Fixed V1 product decisions

### Supported formats

New creator-facing submissions are restricted to:

| Purpose | Accepted format | Rules |
| --- | --- | --- |
| Transparent static artwork | PNG | Canonical format for borders, overlays, badges, bubbles, and seat effects |
| Opaque static artwork | JPEG | Room/profile backgrounds only |
| Transparent/scalable animation | Lottie JSON | Vector-only approved subset; optional sound is separate |
| Opaque cinematic animation | MP4 | Restricted to approved full-screen gifts, opaque entrances, and animated room backgrounds |
| Effect audio | M4A/AAC | Separate asset; never required for the visual effect to complete |

Existing static WebP catalog assets remain readable during migration so current
items do not break. New custom submissions do not accept WebP in V1.

The system rejects GIF, animated WebP, APNG, SVG, MOV, WebM, HEVC, transparent
video, executable bundles, HTML, scripts, arbitrary remote URLs, and unknown
MIME types.

### Lottie restrictions

- JSON only, using the renderer version approved during Wave 0.
- Vector-only: no remote images, embedded raster payloads, external URLs, or
  runtime-fetched dependencies.
- Fonts must be converted to shapes.
- No After Effects expressions, third-party plugins, 3D layers, or
  blur-heavy/unsupported effects.
- Maximum 30 FPS.
- Maximum six seconds for normal gifts and entrances.
- Looping is allowed only for approved border, badge, seat, and ambient slots.
- Maximum one megabyte before server-side normalization.
- Every animation requires an approved static PNG fallback.

### MP4 restrictions

- MP4 container with H.264 video.
- AAC audio or no embedded audio. Separate M4A is preferred when effect audio
  must obey independent user controls.
- No transparency and no design that depends on chroma-key removal.
- Maximum 720p, 30 FPS, and six seconds for gifts or entrances.
- Maximum five megabytes for a normal effect.
- Animated room backgrounds may use a separately approved larger budget capped
  at ten megabytes and must loop cleanly.
- Every video requires a static JPEG or PNG poster/fallback.
- MP4 is not valid for avatar borders, chat bubbles, badges, name effects, or
  seat overlays.

### Equipment and stacking

- A user may equip at most one item in each equipment slot.
- V1 user slots are: `avatar-frame`, `profile-skin`, `chat-bubble`,
  `nameplate`, `cosmetic-badge`, `entry-effect`, and `seat-effect`.
- Status indicators such as room owner, room moderator, representative, safety,
  and platform authority are not cosmetics and cannot be replaced, hidden, or
  imitated by a cosmetic.
- A room theme never replaces, tints, or suppresses an occupied user's equipped
  avatar frame or status indicators.
- A user effect may render above a room theme only inside its assigned safe
  layer and bounds.
- Equipping a new item atomically unequips the current item in that slot.
- Expired, refunded, revoked, disabled, incompatible, or failed items
  immediately fall back to the bundled default.
- Custom assets are bound to the approved owner, non-transferable, and
  unavailable for gifting or catalog resale unless an admin deliberately
  publishes a separate platform-owned catalog version.

### Viewer controls

- `full`: approved animation and allowed audio.
- `reduced`: static fallback or compact motion-safe presentation, no decorative
  audio.
- `off`: hide decorative effects. Financially meaningful gift receipts remain
  visible as compact text.
- OS reduced motion always wins over room and cosmetic settings.
- The viewer may independently mute effect audio and disable expensive effects.
- Low-memory/performance fallback cannot block room join, chat, voice, gifting,
  moderation, or leaving.

### Effect ordering

- Only one major effect may play at a time.
- Safety, moderation, connection, and account notices are outside the cosmetic
  queue and always remain visible.
- Major effect priority is:
  `global campaign/rocket > premium full-screen gift > targeted gift >
  entry effect > ambient reaction`.
- The queue remains bounded at eight major events.
- Expired events are dropped rather than replayed late.
- Combo gifts update or extend the active compatible gift presentation instead
  of enqueuing one full animation per quantity.
- Leaving the room, suspension, app backgrounding, or teardown must stop and
  release all effect players.

### Approval and publication

Asset moderation status is:

```text
draft -> processing -> pending -> approved
                              \-> rejected
approved -> suspended
```

- User submissions stay private while draft, processing, pending, rejected, or
  suspended.
- Only trusted backend/admin authority can set `approved`, `rejected`, or
  `suspended`.
- Approval is bound to the exact immutable object path, version, byte size,
  MIME type, and SHA-256 checksum.
- Any replacement or edit creates a new version and returns it to `pending`.
- Pending assets cannot be equipped, purchased, gifted, referenced by a room
  event, or rendered publicly.
- Publishing is a separate decision from approval. An approved asset may remain
  unpublished.
- Emergency disable immediately prevents new events/equips and causes clients
  to use the fallback.
- User submissions require copyright/ownership attestation and an internal
  review reason.
- V1 custom submissions are limited to explicitly authorized users,
  representatives, agencies, or premium accounts. They are not open to every
  account.

---

## Target architecture

### Canonical asset record

Use a versioned, immutable record. Exact collection names may change during
implementation, but the contract must represent:

```text
assetId
assetVersionId
schemaVersion
ownerType: platform | user
ownerUid
category
slot
format: png | jpeg | lottie-json | mp4 | m4a-aac | legacy-webp
usage: static | looping | one-shot
sourcePath
fallbackAssetId
fallbackAssetVersionId
audioAssetId
audioAssetVersionId
width
height
durationMs
frameRate
byteSize
sha256
transparent
loop
performanceTier: low | standard | high
minimumClientVersion
moderationStatus
publicationStatus
approvalId
reviewerUid
createdAt
updatedAt
revision
```

The mobile client receives only a validated render descriptor. It does not
infer behavior from a filename or URL.

### Data ownership

- `cosmeticAssets/{assetId}`: mutable summary and current approved version.
- `cosmeticAssets/{assetId}/versions/{versionId}`: immutable version metadata.
- `cosmeticAssetApprovals/{approvalId}`: immutable review decision and
  checksum.
- `cosmeticSubmissions/{submissionId}`: private user submission workflow.
- `users/{uid}/storeOwnerships/{ownershipId}`: existing ownership authority.
- `users/{uid}/equipment/current`: existing equipment authority, migrated to
  canonical slot names.
- `publicProfiles/{uid}.equippedCosmetics`: server-authored, minimal,
  read-optimized projection for visible identity surfaces.
- existing `equippedAvatarFrame`: compatibility projection until old clients
  are outside the supported-version window.
- existing catalog documents: product, economy, availability, and ownership
  source; they reference approved asset versions rather than becoming the asset
  authority.
- room event documents: immutable event facts plus approved asset-version
  references and safe presentation snapshots.

### Storage ownership

- Platform assets:
  `cosmetic-assets/platform/{assetId}/{versionId}/{assetName}`
- Private user submissions:
  `cosmetic-submissions/{uid}/{submissionId}/{versionId}/source`
- Approved user-derived assets:
  `cosmetic-assets/users/{uid}/{assetId}/{versionId}/{assetName}`
- Existing `store-assets`, `room-theme-assets`, and room-effect paths remain
  readable during migration.

All published paths are immutable. No published object is overwritten in place.
Private sources are readable only by the owner and authorized reviewers.
Approved derivatives are readable only when their metadata is approved and not
suspended. Server-side validation inspects actual content and MIME type rather
than trusting the extension supplied by the uploader.

### Shared mobile renderer

One renderer boundary chooses a renderer from the validated descriptor:

```text
CosmeticRenderer
|- StaticCosmeticRenderer
|- LottieCosmeticRenderer
|- VideoEffectRenderer
|- EffectAudioController
`- StaticFallbackRenderer
```

Reusable presentation components consume it:

```text
UserAvatarPresentation
|- avatar image/label
|- equipped avatar frame
|- speaking/seat state
`- non-cosmetic authority badges

UserIdentityPresentation
|- UserAvatarPresentation
|- display name and nameplate
|- cosmetic badge/title
`- chat bubble/profile skin context
```

Profiles, room seats, room chat, participant sheets, friends, couples,
discovery, gifts, and future message surfaces must reuse these components
instead of implementing format-specific rendering.

### Delivery and caching

- Bundle default fallbacks for every surface.
- Use immutable versioned URLs and checksum-aware cache keys.
- Preload only equipped visible cosmetics and the next likely queued effect.
- Never preload the complete catalog.
- Video preloading and caching must follow the Expo SDK 56 `expo-video`
  lifecycle and release requirements.
- Cancel pending downloads when the asset is no longer visible.
- Cap memory and concurrent decoding by performance tier.
- A cache miss, failed checksum, unsupported client, or unavailable network
  must resolve to the fallback without blank UI.

### Server authority

- Clients submit item IDs, asset IDs, and intent; never arbitrary render URLs.
- Store purchase/equip services verify active non-expired ownership and current
  approved asset versions.
- Gift and entry services resolve the current approved asset version before
  writing a room event.
- Room events never create economic authority; the existing gift transaction
  remains canonical.
- A suspended asset cannot generate new room events.
- Cleanup and reconciliation remove expired equipment projections without
  deleting immutable ownership, ledger, approval, or audit history.

---

## Definition of done for every wave

A wave cannot close until all applicable checks pass:

- Backward-compatible schema, migration, and minimum-client strategy are
  documented.
- Pure validators cover allowed formats, exact keys, bounds, checksums,
  compatibility, and malformed input.
- Service tests cover permission denial, replay, idempotency, concurrent equip,
  expiry, refund/revocation, approval, suspension, and audit creation.
- Firestore and Storage emulator tests deny arbitrary URLs, forged approvals,
  forged ownership, public pending-asset reads, in-place version replacement,
  and unauthorized deletion.
- Mobile tests cover descriptor mapping, renderer selection, fallback,
  cancellation, queue priority, combo behavior, and teardown.
- `npx tsc --noEmit`, root tests, Functions lint/tests, rules tests, dashboard
  tests/typecheck/build, Expo Doctor, and Android export pass.
- Native Android and iOS testing covers small/large screens, RTL, font scaling,
  reduced motion, effect mute/off, slow network, offline cache, backgrounding,
  interruptions, room leave, and low-memory behavior.
- Mid-range Android testing records animation start delay, dropped frames,
  peak memory, player release, and voice quality while an effect plays.
- Every new user-facing category has a feature flag and server-side kill
  switch.
- Metrics and redacted logs exist before enabling a flag.
- Rollback preserves wallets, ledgers, ownerships, approvals, and immutable
  asset history.
- No unrelated dirty-worktree changes are overwritten.

---

## Wave 0 — Contract freeze and native feasibility gates

Implementation status (2026-07-31): contracts, backend Lottie structural draft,
SDK 56 dependency pins, dev-only feasibility lab, fixtures, automated tests,
artist handoff, and lifecycle checklist are complete. The exit gate remains
open only for the physical Android/iOS run with approved client MP4 and M4A
fixtures. See `COSMETICS_ROOM_EFFECTS_WAVE0_CONTRACT.md`.

### Goal

Freeze the V1 schemas, categories, layering, formats, budgets, and UX states.
Prove the selected renderers on real devices before migrating production data.

### Deliverables

- Add shared TypeScript and backend contract drafts for asset descriptors,
  categories, slots, moderation states, publication states, effect tiers, and
  viewer modes.
- Freeze per-category canvas sizes, safe areas, duration, byte-size,
  frame-rate, transparency, loop, and fallback requirements.
- Define layer order for room theme, seats, avatar, user frame, seat state,
  authority badges, chat, ambient reactions, and major effects.
- Define static, loading, failed, disabled, expired, incompatible,
  reduced-motion, muted, and off states.
- Build isolated native spikes for:
  - vector-only Lottie on avatar-size and full-screen canvases;
  - H.264 MP4 using Expo SDK 56 `expo-video`;
  - independent M4A/AAC effect audio mixed safely with LiveKit room audio;
  - preload, cache, cancellation, background, and teardown;
  - one Lottie and one MP4 effect on a mid-range Android device; and
  - a representative low-memory fallback.
- Select exact Expo SDK 56-compatible dependency versions only after the spike.
- Record unsupported Lottie features and export instructions for designers.
- Create a client/artist delivery checklist and sample accepted/rejected
  packages.

### Exit gate

- Lottie and restricted MP4 pass Android and iOS rendering, lifecycle, and
  audio coexistence tests.
- If MP4 fails, keep the schema reserved but ship Lottie/static only.
- No unresolved format, slot, layering, ownership, or fallback decision remains.

### Rollback

Wave 0 is documentation, isolated fixtures, and disabled spike code only.
Remove the spike without changing production data.

---

## Wave 1 — Canonical asset registry and immutable publishing

Implementation status (2026-08-02): the canonical registry, trusted validators,
immutable approvals and versions, publication/disable/rollback services, rules,
admin workspace, retention cleanup, and non-mutating legacy inventory are locally
implemented. Existing URL fields remain authoritative and the registry stays dark.
Deployment, target-environment inventory review, and the open Wave 0 physical
MP4/M4A gate remain operational acceptance steps. See
`COSMETICS_ROOM_EFFECTS_WAVE1_REGISTRY.md`.

### Goal

Create one server-authoritative asset contract and secure delivery path without
changing what users currently see.

### Backend and data

- Add canonical asset, immutable version, approval, and audit validators.
- Add content sniffing/validation for PNG, JPEG, Lottie JSON, MP4/H.264, and
  M4A/AAC.
- Calculate byte size and SHA-256 on trusted infrastructure.
- Validate Lottie structure and reject external dependencies or unsupported
  capabilities.
- Validate MP4 codec, dimensions, duration, frame rate, audio codec, and lack of
  transparency dependency.
- Require a compatible approved fallback for every animation/video.
- Add current-version publication pointers and emergency suspension.
- Add idempotent publish, disable, rollback-to-version, and reconcile services.
- Preserve current catalog URLs while adding asset-version references.

### Rules and storage

- Add immutable canonical Storage paths.
- Deny in-place update and client deletion of published assets.
- Deny client writes to approvals and publication state.
- Deny public reads of user submissions before approval.
- Add bounded retention for abandoned/rejected private submissions while
  preserving audit records.

### Admin

- Add asset inventory, version history, validation results, preview/fallback
  inspection, publish, suspend, and rollback controls.
- Require a reason and confirmation for suspension and version rollback.
- Prevent an admin UI from marking an asset approved without a successful
  server validation receipt.

### Migration

- Create a dry-run inventory of existing store, gift, entry, rocket, and room
  theme assets.
- Register current immutable assets as approved legacy versions.
- Report mutable paths, missing fallbacks, unknown MIME types, dead URLs, and
  duplicate content.
- Do not rewrite catalog references until dry-run results are reviewed.

### Exit gate

- No client can forge approval or publish an arbitrary URL.
- Existing assets render unchanged through compatibility reads.
- Disable and rollback are proven without an application update.

### Rollback

Keep new registry records dark. Existing URL fields remain authoritative until
Wave 2 is accepted.

---

## Wave 2 — Shared renderer, cache, fallback, and effect runtime

Implementation status (2026-08-02): the strict renderer boundary, exact
published-version lookup, verified bounded cache, static/Lottie/video/audio
lifecycle, fallback policy, preview surface, room-effect queue integration,
combo updates, and bounded non-sensitive telemetry are locally implemented.
All five renderer flags remain fail-closed and production-off. Wave 2 acceptance
remains blocked on the Wave 0 physical Android/iOS media evidence and the Wave 2
voice/runtime device checks. See `docs/COSMETICS_ROOM_EFFECTS_WAVE2_RUNTIME.md`.

### Goal

Implement the reusable mobile rendering boundary while all new presentations
remain behind flags.

### Mobile

- Install only the renderer dependencies approved in Wave 0.
- Implement strict descriptor mapping and format-to-renderer selection.
- Add static PNG/JPEG and grandfathered legacy WebP rendering.
- Add vector-only Lottie rendering with deterministic loop and completion
  callbacks.
- Add restricted MP4 rendering with native controls disabled, poster fallback,
  preloading, caching, cancellation, and explicit player release.
- Add a single effect-audio controller with mute, interruption, and cleanup.
- Add static fallback for unsupported versions, load failure, checksum failure,
  reduced motion, low performance, offline cache miss, and emergency disable.
- Evolve the existing room-effect queue without changing its cap or
  safety/financial behavior.
- Add combo-update support and renderer completion/error signals.
- Add one reusable mobile preview surface for Store, My Items, profile
  customization, and pre-equip confirmation. A preview failure must not permit
  purchase/equip of an incompatible item.
- Prevent animation mounts from delaying room join or voice connection.

### Observability

- Record asset lookup, cache hit/miss, download, decode, ready, first-frame,
  completion, cancellation, fallback, and failure reason.
- Record queue wait, expiry, priority drop, combo update, and teardown.
- Do not log signed URLs, user-submitted source paths, or asset contents.

### Exit gate

- The same test assets render consistently on Android and iOS.
- All failure paths show a fallback and release resources.
- Voice quality and controls remain usable during Lottie, MP4, and effect audio.
- Renderer flags remain off in production.

### Rollback

Disable the renderer flags. Compatibility/static renderers continue to use
current image fields.

---

## Wave 3 — Avatar borders on every identity surface

Local implementation completed on 2026-08-02; see
`docs/COSMETICS_ROOM_EFFECTS_WAVE3_AVATAR_FRAMES.md`. Production acceptance is
still blocked on the documented physical Android/iOS renderer gates, and all
Wave 3 flags remain off.

### Goal

Complete the existing avatar-frame feature before adding more cosmetic slots.

### Backend and projection

- Add canonical frame asset references to ownership/equipment.
- Expand the server-owned public projection while dual-writing the existing
  `equippedAvatarFrame`.
- Reconcile expired, refunded, disabled, suspended, malformed, and missing
  frames.
- Ensure room themes cannot alter occupied user frames.

### Mobile

- Create reusable avatar and identity presentation components.
- Render static or approved animated frames on:
  - Me profile;
  - public profile;
  - room seats;
  - room participant/management sheets;
  - room chat messages;
  - discovery;
  - friends;
  - couples;
  - gifts/history; and
  - every other currently implemented server-backed identity surface.
- Keep authority/representative badges readable and outside the cosmetic frame.
- Batch or reuse visible public-profile projections; do not open an unbounded
  listener per historical chat sender.
- Add profile navigation from eligible room chat identities if product policy
  permits it.

### Exit gate

- Equip/unequip/expiry/suspension updates all visible surfaces promptly.
- Fifty-message chat history does not create unbounded profile listeners.
- Large font, long Arabic names, reduced motion, and missing assets remain
  readable.

### Rollback

Disable animated frames first, then the unified-frame flag. Existing static room
seat behavior and fixed profile borders remain available.

---

## Wave 4 — Gift presentation tiers and combo runtime

Implementation status: local code complete on 2026-08-02; production flags,
catalog motion, global campaigns, and deployment remain off pending approved
assets and physical Android/iOS acceptance. See
`COSMETICS_ROOM_EFFECTS_WAVE4_GIFT_PRESENTATION.md`.

### Goal

Upgrade the existing authoritative gift economy from static overlay art to
approved tiered animations without changing wallet or commission semantics.

### Product tiers

- `inline`: compact chat/receipt presentation.
- `targeted`: animation anchored to one recipient/seat.
- `major`: one full-screen room effect.
- `global`: separately governed campaign effect across eligible rooms.

Price does not directly determine renderer behavior. Each gift catalog version
declares an approved presentation tier and asset version.

### Backend

- Extend gift catalog validation with approved visual, fallback, optional audio,
  duration, tier, minimum-client, and performance references.
- Snapshot asset version and tier into quote, immutable transaction, receipt,
  and room event.
- Verify approval and publication at quote/send time.
- Add quantity/combo window rules and bounded server-authored combo state.
- Preserve idempotency, wallet atomicity, commission snapshots, recipient
  eligibility, blocking, and audit behavior.
- Never charge a user based on whether an animation successfully plays.

### Mobile

- Render inline, targeted, major, and global tiers through the shared renderer.
- Update compatible active combos without replaying one major animation per
  quantity.
- Keep gift receipts visible in reduced/off modes.
- Add sound policy, haptics, target label, quantity, sender, and recipient
  presentation without hiding room controls.
- Ensure blocking suppresses decorative sender effects without altering the
  authoritative financial receipt.

### Admin

- Add gift asset/tier preview and physical-approval receipt.
- Prevent publishing a paid gift without an approved fallback.
- Add per-gift and global animation kill switches independent of gift economy.

### Exit gate

- Duplicate/replayed commands debit once and render at most once per event ID.
- Gift animation failure never rolls back or repeats a completed transaction.
- Burst/combo tests remain within queue, memory, and voice-performance budgets.

### Rollback

Disable motion/audio presentation while leaving gift purchase, ledger,
commission, receipts, and compact static notices active.

---

## Wave 5 — Entry vehicles and entrance effects

**Implementation status: complete locally (2026-08-02); dark pending physical-device acceptance and release.** Existing `cars` equipment now maps to exact approved `entry-effect` bundles without ownership migration. Immutable Android/iOS and control-safe-zone receipts, opaque-MP4 enforcement, server-authored version/checksum snapshots, independent disabled-by-default motion/audio/video gates, clipped shared-renderer presentation, reconnect/foreground non-replay, suspension/background cancellation, and deterministic twenty-person burst bounds are implemented. See `docs/COSMETICS_ROOM_EFFECTS_WAVE5_ENTRY_EFFECTS.md`. No deployment or production data mutation was performed.

### Goal

Replace the current static entry fallback with approved motion while preserving
the deployed server-authoritative session claim.

### Backend

- Map existing `cars` equipment to the canonical `entry-effect` slot without
  breaking current ownerships.
- Resolve approved Lottie or restricted opaque MP4 plus fallback at
  `announce-entry-effect`.
- Preserve one announcement per genuine presence session.
- Reject expired, refunded, disabled, suspended, incompatible, or unapproved
  entries.
- Snapshot the exact version in the event.

### Mobile

- Render entry effects through the shared queue and renderer.
- Keep room join and audio connection independent of playback.
- Clip/position transparent Lottie safely without covering leave, moderation,
  or connection controls.
- Restrict MP4 entries to opaque compositions designed for their allocated
  presentation region.
- Stop immediately on leave, suspension, background, or event expiry.

### Exit gate

- Reconnect and foreground churn do not replay an entry.
- Twenty-person join bursts remain bounded and deterministic.
- Reduced/off/low-memory modes use the existing compact fallback.

### Rollback

Disable motion entry rendering and return to the deployed static entry banner.
Do not alter car ownership.

---

## Wave 6 — Profile, chat, name, badge, and seat cosmetics

Implementation status: local code complete on 2026-08-02. All five category
flags and the shared renderer remain disabled; no deployment or production
data change was performed. See
`COSMETICS_ROOM_EFFECTS_WAVE6_EQUIPMENT_COSMETICS.md`.

### Goal

Add the remaining individual cosmetic slots using the shared identity
components and equipment authority.

### Categories

- profile skin;
- chat bubble;
- nameplate/name effect;
- cosmetic badge/title; and
- seat/microphone effect.

### Backend

- Extend store categories and equipment slots with exact validators.
- Add active equipment projections containing only the data needed for public
  rendering.
- Prevent cosmetic badges/titles from imitating authority, verification,
  moderation, staff, representative, or safety indicators.
- Add expiry/refund/disable reconciliation for every slot.
- Keep custom IDs and representative badges outside cosmetic equipment.

### Mobile

- Add each slot to My Items, preview, equip, and fallback flows.
- Apply profile skins only inside profile-owned surfaces.
- Apply chat bubbles without reducing contrast or obscuring moderation states.
- Apply nameplates/effects while preserving selectable/readable names.
- Apply cosmetic badges separately from trusted status indicators.
- Apply seat effects inside theme-safe bounds without replacing speaking,
  mute, owner, moderator, reconnecting, or retiring state.
- Ensure all cosmetics respect RTL, font scaling, contrast, reduced motion, and
  viewer disable settings.

### Exit gate

- Every category passes equip conflict, expiry, refund, suspension, and
  fallback tests.
- No cosmetic can impersonate platform authority or hide room state.
- A room with twenty distinct equipped cosmetics stays within performance
  budgets.

### Rollback

Disable categories individually. Ownership and purchase history remain intact;
clients show bundled defaults.

---

## Wave 7 — Room reactions, ambient effects, and animated themes

Implementation status: local code complete on 2026-08-04. Server-authorized
LiveKit reactions, bounded ambient aggregation, backward-compatible animated
theme manifests, canonical asset enforcement, admin safe-area preview,
independent dark flags, rollback, rules, and automated coverage are
implemented. No deployment or production data mutation was performed.
Root typecheck, 211 files/1,131 non-emulator tests, Functions lint, Expo Doctor,
Android export, and admin build pass. Rules pass 59/60 with only the
pre-existing Wave 6 projection expectation failing; admin standalone
typecheck retains the pre-existing daily-login errors. Physical Android/iOS
voice-performance acceptance and approved assets remain open. See
`docs/COSMETICS_ROOM_EFFECTS_WAVE7_REACTIONS_THEMES.md`.

### Goal

Add lightweight room activity and controlled motion without competing with
major gifts or entrances.

### Reactions and ambient effects

- Add a server-throttled or LiveKit-assisted reaction envelope with bounded
  Firestore durability only where required.
- Support approved applause, hearts, greetings, birthday/welcome cues, and
  similar lightweight effects.
- Aggregate bursts into counters/particles rather than creating one expensive
  renderer per tap.
- Apply per-user and per-room rate limits.
- Ambient effects always yield to notices and major effects.

### Animated room themes

- Extend the existing immutable room-theme manifest with optional approved
  Lottie ambient slots or restricted MP4 background slots.
- Keep the bundled static Majlis fallback.
- Preserve user-owned frame precedence and theme safe-area/layout validation.
- Pause background motion while the app is backgrounded and in reduced/off
  modes.
- Do not allow theme video audio in V1.

### Admin

- Extend the existing room-theme editor with format-specific validation,
  static fallback, motion preview, safe-area overlays, and disable/rollback.
- Preview 5, 10, 15, and 20 seats on compact and tall screens.

### Exit gate

- Reaction spam cannot grow the major-effect queue or Firestore without bound.
- Animated themes do not degrade voice, seat controls, or gift playback.
- Disabling or failing a theme atomically restores the bundled Majlis
  presentation.

### Rollback

Disable reactions and animated theme slots independently. Static versioned
themes continue to work.

---

## Wave 8 — Couple cosmetics and coordinated presentation

Implementation status: local code complete on 2026-08-04. Shared couple
entitlement (one partner buys for the exact relationship instance), dual
profile projections, profile treatment, paired borders, one coalesced
synchronized entrance through the existing room-entry queue, independent dark
flags for pair cosmetics and pair entrances, admin catalog authoring, false-only
rollback, sanitized telemetry, rules, and automated coverage are implemented.
No deployment or production data mutation was performed. Root typecheck, 218
files/1,178 non-emulator tests, Functions lint, and admin build pass. Physical
Android/iOS acceptance, approved production assets, relationship-ID backfill
review, and flag enablement remain open. See
`docs/COSMETICS_ROOM_EFFECTS_WAVE8_COUPLE_EFFECTS.md`.

### Goal

Add relationship cosmetics without granting ownership or access through
client-controlled relationship data.

### Backend

- Require a current server-authoritative couple relationship.
- Define whether an item is jointly earned, separately owned, or temporarily
  granted by a campaign.
- Require both users to remain eligible for a synchronized couple effect.
- Remove the public projection immediately on dissolution, suspension, expiry,
  refund, or asset disable.
- Prevent one member from transferring or reselling a shared effect.

### Mobile

- Add approved couple profile treatment, paired border treatment, or
  synchronized entrance presentation.
- Fall back to each user's individual cosmetics when the pair effect is
  unavailable.
- Do not reveal private relationship data beyond the existing public product
  policy.

### Exit gate

- Relationship changes cannot leave a stale paired cosmetic.
- Concurrent equip/dissolve operations resolve deterministically.
- Pair effects obey the same queue, reduced-motion, and performance rules.

### Rollback

Disable couple cosmetic rendering and remove projections while preserving
relationship and ownership history.

---

## Wave 9 — Approved custom user assets

Implementation status: **local code complete** on 2026-08-04 (gap-fill same
day). Server-owned eligibility allowlist, expiring quarantine upload
authorization, trusted finalize/process, copyright attestation → pending,
checksum-bound owner-bound approve (not catalog publish), custom equip path,
eligibility grant/revoke that preserves store purchases, admin queue/preview UI,
mobile upload/list/equip surface (including entry-effect Lottie JSON
DocumentPicker), room-entry custom playback with store-car fallthrough, dark
flags `cosmetics_custom_submissions` / `cosmetics_custom_rendering`, and
adversarial gap-fill (public projection hygiene, owner-bound list deny, atomic
suspend, transactional maxPending, client ownerType gates) are implemented
locally. Physical-device acceptance, production assets/allowlist, deployment,
and flag enablement remain open. No deployment or flag enablement. See
`docs/COSMETICS_ROOM_EFFECTS_WAVE9_CUSTOM_ASSETS.md`.

### Goal

Allow selected authorized users to submit custom assets without making
unreviewed content public or executable.

### Eligibility

- Feature flag off by default.
- Server-owned allowlist or entitlement for authorized representatives,
  agencies, premium accounts, or test users.
- Category allowlist begins narrowly; recommended V1 is static profile skin,
  static avatar frame, and approved Lottie entrance.
- Custom MP4 submissions remain disabled until moderation and device review
  demonstrate acceptable operational cost.
- Seasonal/platform collections use the same approved catalog workflow and do
  not require a separate runtime or schema.

### Submission flow

1. Server creates an expiring upload authorization and immutable submission ID.
2. User uploads to private quarantine storage.
3. Trusted processing verifies MIME/content, size, checksum, dimensions,
   duration, codec/Lottie restrictions, malware safety, and fallback.
4. User records ownership/copyright attestation.
5. Submission enters `pending`.
6. Admin previews the normalized derivative and validation report.
7. Admin approves or rejects with a reason.
8. Approval creates an immutable approved derivative and ownership-bound asset
   record.
9. Only then may the user equip and render it.

### Enforcement

- Submission status is server-owned.
- Pending/rejected/suspended source files are never public.
- Editing or replacing any byte requires a new version and new review.
- Approval is checksum-bound and cannot be copied to another file.
- User cannot change owner, category, slot, publication, or approval metadata.
- Admin suspension immediately blocks new equips/events and activates fallback.
- Repeated abusive submissions can revoke upload eligibility without affecting
  normal purchased cosmetics.

### Admin

- Add bounded review queues, preview, validation evidence, user context,
  approve/reject/suspend, copyright reason, and immutable audit history.
- Separate public catalog publishing from owner-only custom approval.
- Do not expose private source URLs in logs, exports, or ordinary dashboard
  tables.

### Exit gate

- A pending asset cannot be discovered or rendered by another account.
- Forged approval/status/owner/checksum writes fail in backend and rules tests.
- Replacing an approved object in place is impossible.
- Revocation and fallback propagate to active profile and room surfaces.

### Rollback

Disable new submissions and custom rendering. Preserve private submissions,
review decisions, ownership records, and audits for the approved retention
period.

---

## Wave 10 — Hardening, migration completion, and staged launch

Implementation status: **local code complete** on 2026-08-04 for migration/
hardening/rollout tools and runbooks. Dry-run migration + reconcile scripts,
alert-threshold evaluators, Vitest chaos harnesses, staged matrix with
`--assert-dark`, metadata-only `appRuntime/cosmeticsRollout` recorder (does not
enable `cosmeticsFeatures`), admin read-only stage display, and
`docs/COSMETICS_ROOM_EFFECTS_WAVE10_HARDENING.md` are in place. Physical-device
chaos, deployment, and presentation-flag enablement remain open. No production
data mutation or flag enablement was performed.

### Goal

Complete migrations, physical acceptance, observability, operational runbooks,
and controlled production rollout.

### Migration

- Dry-run and then backfill canonical asset references for store items, gifts,
  entries, rockets, themes, ownerships, equipment, and public projections.
- Dual-read and dual-write legacy fields until minimum-supported-client
  enforcement proves old clients are outside the active population.
- Remove legacy authority only in a later forward migration; do not delete
  immutable asset history.
- Re-run reconciliation until every active equipped item resolves to one
  approved compatible version or an explicit fallback.

### Hardening

- Load-test gift bursts, twenty-user entry bursts, reaction spam, rapid
  equip/unequip, expiry cleanup, and emergency suspension.
- Chaos-test asset 404/403, corrupt cache, checksum mismatch, slow download,
  mid-play disconnect, background/foreground, phone call, audio route change,
  low memory, and renderer crash containment.
- Verify that voice, leave, block, report, moderation, and wallet receipts
  remain usable throughout.
- Add alert thresholds for asset failure rate, fallback rate, first-frame
  delay, queue expiry, memory pressure, and crash-free sessions.
- Document asset takedown, emergency disable, approval appeal, cache/version
  incident, and rollback procedures.

### Rollout order

1. Internal/admin test accounts.
2. Static unified avatar frames.
3. Animated avatar frames.
4. Gift Lottie for a small approved catalog subset.
5. Restricted MP4 for one full-screen gift only if Wave 0/2 gates passed.
6. Entry motion.
7. Additional user cosmetic categories one at a time.
8. Reactions and animated themes.
9. Couple cosmetics.
10. Custom submissions for a small allowlist.

Each stage has an independent flag, explicit observation window, and rollback
decision. Deployment does not imply enablement.

### Exit gate

- All automated and physical-device gates pass.
- Operational staff can approve, reject, suspend, roll back, and investigate
  assets without a mobile release.
- Production metrics remain within approved thresholds through every rollout
  stage.
- Legacy fields are removed only after a separately approved migration gate.

### Rollback

- Disable the affected presentation/category flag.
- Preserve economy and ownership state.
- Fall back to bundled/static presentations.
- Suspend a bad asset/version rather than mutating or deleting it.
- Ship a forward fix for schema or cache defects; never roll back issued
  ownership or ledger history destructively.

---

## Proposed feature flags and kill switches

Exact names should follow the existing server configuration naming convention:

- `cosmetics_asset_registry`
- `cosmetics_shared_renderer`
- `cosmetics_lottie`
- `cosmetics_video`
- `cosmetics_effect_audio`
- `cosmetics_avatar_frames_unified`
- `cosmetics_avatar_frames_animated`
- `cosmetics_profile_skins`
- `cosmetics_chat_bubbles`
- `cosmetics_nameplates`
- `cosmetics_badges`
- `cosmetics_seat_effects`
- `cosmetics_couple_effects`
- `room_gift_animations`
- `room_gift_video`
- `room_entry_motion`
- `room_reactions`
- `room_animated_themes`
- `cosmetics_custom_submissions`
- `cosmetics_custom_rendering`

An asset-level `renderingEnabled`/suspension decision remains independent of
global feature flags.

---

## Required design and asset handoff

Every delivered package includes:

- stable proposed asset name and category;
- intended surface and canvas size;
- source format from the approved list;
- static preview and required fallback;
- optional separate M4A/AAC sound;
- duration, loop behavior, transparency, and safe-area notes;
- version number;
- Arabic and English display names;
- reduced-motion presentation;
- copyright/ownership declaration for custom work; and
- test evidence or a request for platform device validation.

Files outside the approved policy are rejected at intake rather than repaired
manually by the application team. Conversion into an approved format is a
separate content-production task, not runtime behavior.

---

## Explicitly deferred

- Open custom uploads for every user.
- User-authored executable or interactive effect code.
- Transparent video.
- GIF, animated WebP, APNG, SVG, MOV, WebM, and HEVC playback.
- Theme audio.
- Marketplace resale or trading of custom assets.
- User-to-user transfer of custom assets.
- Game-board, game-piece, and gameplay skins; each game requires a separate
  gameplay-specific visual and fairness plan even if it later reuses this asset
  registry.
- Arbitrary external/CDN URLs supplied by clients.
- Cosmetics that imitate staff, verification, representative, ownership,
  moderation, or safety status.
- More than one simultaneous major effect.
- Removing compatibility fields before minimum-client enforcement.

---

## Implementation start point

Begin with Wave 0. Do not install animation/video dependencies or migrate
production catalog records before the physical-device feasibility gates and
contract fixtures pass. Once Wave 0 closes, Wave 1 and the non-visual parts of
Wave 2 may proceed in sequence. Wave 3 is the first user-visible rollout and
should complete before adding new cosmetic categories.
