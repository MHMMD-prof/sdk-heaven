# Cosmetics and Room Effects — Wave 4 Gift Presentation

Status: local implementation complete on 2026-08-02. Gift presentation remains
dark. No Firebase deployment, catalog mutation, campaign publication, migration,
or feature-flag write was performed.

## Authoritative boundary

The existing room-gift transaction remains the only financial authority. A quote
freezes price, quantity, commission policy, recipient credit, platform share, gift
score, presentation tier, and exact asset versions. Send revalidates the quote,
recipient/block state, and every presentation approval inside the same transaction
that debits the sender and writes both immutable receipts.

Animation success, first frame, sound, haptics, queue admission, client
compatibility, reduced motion, blocking, or a presentation kill switch can never
change, repeat, reverse, or delay that transaction. Every result retains a compact
static gift receipt based on the bundled gift icon and text.

## Presentation contract

Each gift may declare schema-version 1 presentation metadata:

- tier: `inline`, `targeted`, `major`, or `global`;
- exact visual and required static fallback `{assetId, assetVersionId}`;
- optional exact M4A/AAC audio reference;
- duration from 1,500 through 6,000 ms;
- minimum client and `low`/`standard`/`high` performance tier;
- `off`/`soft`/`full` sound and `off`/`light`/`success` haptics; and
- an immutable physical-approval receipt ID.

Animated visuals are restricted to approved published Lottie or restricted opaque
MP4 from the canonical registry. The declared fallback must be the exact approved
static PNG/JPEG/legacy-WebP reference embedded in that visual version. Optional
audio must be the exact approved M4A/AAC reference embedded in the visual version.
Checksums, categories, publication state, rendering state, approval IDs, and exact
versions are checked at admin save, quote, and send.

Legacy catalog records map to `animationEnabled: false`, `tier: inline`, and keep
working through their bundled icon. A paid gift can therefore remain sellable
without motion, but motion cannot be published without the approved fallback and
receipt.

## Admin and physical receipt

The gift editor now exposes tier, duration, performance, minimum client, sound,
haptics, and exact visual/fallback/audio references. Enabling motion requires an
Android pass, iOS pass, both tested device names, tested client version, and notes.
The server creates `giftPresentationApprovalReceipts/{receiptId}` once with the
reviewer identity and exact checksums. The record is client-inaccessible and
immutable; later catalog edits may reuse it only while every exact reference still
matches and tier, duration, compatibility, performance, sound, and haptics remain
unchanged. Changing an approved presentation requires a new visual asset version
and a new physical pass.

User-derived/custom assets follow the same path. They cannot be attached to a gift,
quoted, or rendered until the canonical version is validated, administrator
approved, published, rendering-enabled, and represented by the matching physical
receipt.

## Combo and delivery runtime

The send transaction updates one private bounded combo record per sender, target,
gift, and room. The four-second window and maximum cumulative count of 999 are
server-authored. Events carry a sequence plus cumulative count, so clients update a
compatible active animation instead of replaying one major animation for every
quantity. Duplicate request IDs return the original event and cannot debit or
advance the combo twice.

Mobile behavior:

- inline gifts use the compact receipt surface;
- targeted gifts attach the shared renderer and visible receipt label to the
  recipient seat;
- major gifts use one pointer-transparent overlay that leaves room controls usable;
- global gifts use the same bounded queue and are accepted only by rooms matching
  the campaign's snapshotted visibility/country audience; and
- reduced/off mode, incompatibility, missing assets, decode failure, or low memory
  always preserves compact text.

The block list is loaded before room/global decorative listeners start. Blocking a
sender removes their queued decoration but does not remove either party's private
financial receipt.

Global fan-out additionally requires an active
`appConfig/roomGiftGlobalCampaign` whose time window, gift allowlist, source-room
visibility, and optional country allowlist match. Without it, a `global` catalog
gift safely degrades to an inline receipt.

## Dark switches and rollback

All new values in `appConfig/cosmeticsFeatures` default to false:

```text
room_gift_animations
room_gift_video
room_gift_audio
room_gift_global_effects
```

Each gift also has its own `presentation.animationEnabled` switch. The owner-only
dark script writes these and all earlier renderer flags as false; it has no enable
mode.

Rollback order is audio, video, global fan-out, then all gift motion. The gift
catalog, quotes, wallet ledgers, commission snapshots, score, receipts, and compact
notices remain active throughout.

## Verification recorded

- Exact Expo SDK 56 video, audio, image, and haptics documentation rechecked.
- App TypeScript passed.
- Focused gift contract/economy/client/queue tests passed.
- Full Vitest suite passed: 197 files and 1,065 tests.
- Firestore and Storage emulator rule suites passed.
- New and touched Cloud Functions syntax checks passed.
- Admin dashboard Vite production build passed.
- Android Expo production export passed. Expo still reports the known missing
  local `GoogleService-Info.plist`, so no physical/local iOS build was claimed.
- Admin dashboard standalone typecheck continues to report only the pre-existing
  `DailyLoginRewardsPanel.tsx` errors.

## Remaining acceptance gate

Keep every Wave 2–4 renderer/presentation switch false until approved assets exist
and the Wave 0/2 physical Android and iOS gates pass. Then exercise every tier on
real low/mid/high devices with LiveKit audio, headphones/Bluetooth changes, calls,
background/foreground, reduced motion, low memory, corrupt/slow/missing media,
rapid 20-quantity sends, replayed requests, blocking, controls, and each rollback
switch. Record those results in the immutable physical receipts before enabling a
paid animated gift.
