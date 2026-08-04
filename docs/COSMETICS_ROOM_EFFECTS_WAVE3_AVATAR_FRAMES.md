# Cosmetics and Room Effects — Wave 3 Avatar Frames

Status: local implementation complete on 2026-08-02. Production rendering is
still dark. No Firebase deployment, migration, catalog mutation, or feature-flag
write was performed.

## Delivered contract

- Store catalog, ownership, equipment, and public profiles support an exact
  `{assetId, assetVersionId}` avatar-frame reference while retaining the legacy
  `{itemId, assetUrl}` projection for old clients and rollback.
- Purchase, gift, and equip transactions accept a canonical frame only when the
  exact immutable version is approved, published, render-enabled, categorized
  as `avatar-frame`, uses an allowed frame format, and matches its approval
  checksum. An admin catalog save can bind a published approved asset with the
  same ID as the store item; API callers may send an explicit exact reference.
- User-owned/custom assets cannot enter equipment or a public projection before
  admin approval and publication. Client URLs and client-authored equipment
  remain rejected.
- Expiry clears the equipment and both public projections atomically. A public
  profile moderation transition clears a suspended user's frame promptly. A
  bounded scheduled reconciliation also clears or repairs expired, refunded or
  unknown-state, disabled, suspended, missing, malformed, mismatched, or
  no-longer-approved frames.

## Mobile surfaces

The reusable avatar presentation/frame layer is connected to:

- Me and public profiles;
- home and rooms discovery cards;
- user discovery, friends, and couples;
- voice-room seats, participant sheet, people management, and ownership sheet;
- room chat identities with profile navigation;
- social gift history;
- room supporter/rocket leaderboards; and
- room target rosters and target-user search.

Representative and room-authority badges remain separate from the decorative
frame. Gameplay-only local identities are not connected to public cosmetics;
those surfaces do not have a trusted server-backed public-profile identity and
gameplay skins remain explicitly deferred.

Room chat stores an immutable validated frame snapshot on each message. Loading
50 historical messages therefore creates no public-profile listener per sender.
Live room/home/rooms identities use a deduplicated projection hook capped at 64
UIDs. Canonical registry lookups use a bounded 64-entry, five-minute shared
promise cache so repeated identities reuse the same exact-version lookup.

## Flags and rollback

Wave 3 adds two independent dark-by-default values:

```text
cosmetics_animated_avatar_frames
cosmetics_unified_avatar_frames
```

The dark-only owner script writes these and all Wave 2 renderer flags as
`false`. There is no enable command while physical acceptance remains open.

Rollback order:

1. disable `cosmetics_animated_avatar_frames`;
2. disable `cosmetics_unified_avatar_frames`;
3. if necessary, keep the Wave 2 registry/shared renderer disabled.

The existing static occupied-seat frame remains available when unified frames
are disabled, and the fixed profile borders remain unchanged.

## Verification recorded

- App TypeScript: passed.
- Focused Wave 3 contract tests: passed.
- Full Vitest suite: 190 files and 1,040 tests passed.
- Firestore and Storage emulator rule suites: passed.
- New and touched Cloud Functions syntax checks: passed.
- Admin dashboard Vite production build: passed.
- Android Expo export: passed. Expo still reports the known missing local
  `GoogleService-Info.plist`, so no physical/local iOS build was claimed.

The standalone admin-dashboard typecheck still reports existing errors in
`DailyLoginRewardsPanel.tsx`; none point to the Wave 3 catalog types or code.

## Remaining acceptance gate

Keep every Wave 2 and Wave 3 production flag off until the previously open
physical Android and iOS renderer gates pass. Then verify static and animated
frames on all surfaces above, immediate equip/swap/expiry/suspension behavior,
long Arabic names, large font, reduced motion, missing assets, offline fallback,
50-message chat history, room join/audio controls, and both rollback steps.
