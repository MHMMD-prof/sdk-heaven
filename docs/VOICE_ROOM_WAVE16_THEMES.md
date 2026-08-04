# Voice Room Wave 16 — Extensible room themes

## Status

Wave 16 is **deployed and enabled for controlled production rendering tests** as
of 2026-07-28.

- `voice_room_themes`: enabled
- `voice_room_theme_purchases`: disabled
- Default/fallback: `majlis-default`
- Seeded paid themes: `royal-theater`, `ruby-constellation`
- Test room: `representative-test-qLaisDcEGpcp5XIJ8XqHpigZqDJ3`
- The test room owns both paid themes.

Purchases remain disabled until physical Android checks confirm live switching,
RTL layout, reduced motion, custom-background precedence, and user-owned avatar
frames.

## Non-negotiable border ownership

An occupied user’s border is selected only from that user’s equipped
`avatar-frames` store item. A room-theme manifest cannot define, replace, tint,
or suppress an occupied avatar border.

Themes may style:

- room background and stage
- normalized seat positions and empty-seat treatment
- panels, badges, dock, drawer, ornaments, and approved ruby/gold tokens

Owner, moderator, and representative indicators remain separate status badges.

## Production architecture

- Published manifests: `roomThemes/{themeId}`
- Immutable versions: `roomThemes/{themeId}/versions/v{revision}`
- Room-owned entitlements:
  `rooms/{roomId}/themeEntitlements/{themeId}`
- Immutable assets:
  `room-theme-assets/{themeId}/v{revision}/{assetName}`
- Commands:
  `purchase-room-theme`, `equip-room-theme`,
  `get-room-theme-inventory`
- Timed entitlement expiry transactionally restores Majlis when the expired
  theme is equipped.

The mobile client bundles Majlis and renders it immediately. Invalid,
unpublished, disabled, incompatible, offline, or failed remote themes fall back
without a blank room. An approved custom room image replaces only the
background. A customization suspension forces the complete Majlis appearance.

## Publishing a fourth theme

Create a matching **Room Themes** catalog item, reopen it in the admin catalog,
then use the manifest editor to:

1. Upload immutable theme assets.
2. Define approved color tokens.
3. Position every seat for 5, 10, 15, and 20 seats.
4. Review compact and tall phone previews.
5. Save a draft, publish, emergency-disable, or roll back.

No application rebuild is required for another valid V1 manifest.

## Verified gates

- 137 application test files and 796 tests
- 8 admin-dashboard test files and 19 tests
- Firestore and Storage emulator rule suites
- Mobile and admin TypeScript
- Function syntax checks
- Admin production build and bundle budgets
- Android Expo export
- Production manifest and entitlement read-back

The Android export passed. Expo also reported the existing, Android-irrelevant
warning that `GoogleService-Info.plist` is not present for an iOS export.
