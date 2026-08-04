# Cosmetics and Room Effects Wave 6: equipment cosmetics

## Outcome

Wave 6 adds five independently gated equipment categories:

- profile skins;
- chat bubbles;
- nameplates;
- cosmetic badges; and
- seat effects.

The implementation is local only. No function, rules, catalog, asset, or app
configuration was deployed, and every new renderer flag defaults to false.
The administrator can add catalog items and approved files later without a
code change.

## Safe asset policy

Persistent equipment accepts only exact immutable, approved, published asset
versions from the canonical registry. PNG and approved Lottie JSON are the
normal formats. Profile skins also allow JPEG, and the legacy migration path
may read WebP. Persistent equipment rejects MP4 and audio references: those
formats add unnecessary player, lifecycle, memory, and mixing risk for UI that
can remain visible for a long time.

User-owned files use the same registry path as platform files. They remain
private and non-renderable until validation, immutable administrator approval,
separate publication, and exact checksum matching all succeed.

Nameplate and cosmetic-badge approval additionally requires immutable reviewer
attestations that:

- the real name remains readable and selectable; and
- the artwork cannot resemble staff, moderator, verification,
  representative, or safety authority.

The exact approval receipt is checked again when a catalog item is assigned,
purchased, gifted, equipped, and reconciled.

## Server authority and reconciliation

The existing store equipment document remains the ownership/equip authority.
The new store-category to public-slot mapping is fixed in code:

| Store category | Registry category | Public projection |
| --- | --- | --- |
| `profile-skins` | `profile-skin` | `profileSkin` |
| `chat-bubbles` | `chat-bubble` | `chatBubble` |
| `nameplates` | `nameplate` | `nameplate` |
| `cosmetic-badges` | `cosmetic-badge` | `cosmeticBadge` |
| `seat-effects` | `seat-effect` | `seatEffect` |

`publicProfiles/{uid}.equippedCosmetics` contains only `itemId`, `assetId`,
and `assetVersionId`. It never exposes storage paths, submission records,
moderation notes, approval internals, prices, or receipts.

Purchase, gift, and equip reject missing, malformed, category-mismatched,
unapproved, unpublished, disabled, checksum-mismatched, or unsafe references.
Expiry clears equipment and public projections. A scheduled reconciler also
clears expired, refunded/unknown-state, suspended-profile, disabled-catalog,
suspended-asset, missing, and malformed equipment. A public-profile moderation
trigger clears all five slots immediately when a profile leaves active status.

## Mobile surfaces and hierarchy

- Profile skins render only inside the Me-profile card and public-profile hero.
- Room and direct-chat bubbles render as decorative backgrounds; native text,
  delivery, deletion, moderation, reply, and action UI remains above them.
- Nameplates never replace a display-name string. Names stay native,
  selectable where applicable, font-scaled, and truncated by the existing
  surface policy.
- Cosmetic badges are separate components from representative, owner,
  moderator, mute, speaking, reconnecting, and retiring indicators.
- Seat effects render below the avatar/status halo. Trusted room state retains
  the higher layer and cannot be hidden by the cosmetic.
- Visible room/chat projection subscriptions are sorted, deduplicated, and
  capped at twenty users.
- Reduced/off viewer modes and lookup/renderer failures remove decoration and
  leave the existing native UI intact.

The implementation follows the Expo SDK 56
[Image](https://docs.expo.dev/versions/v56.0.0/sdk/image/),
[Video](https://docs.expo.dev/versions/v56.0.0/sdk/video/),
[Audio](https://docs.expo.dev/versions/v56.0.0/sdk/audio/), and
[Haptics](https://docs.expo.dev/versions/v56.0.0/sdk/haptics/) contracts. Wave 6
does not invoke persistent video, audio, or haptic playback.

## Dark rollout and rollback

`appConfig/cosmeticsFeatures` adds five fail-closed switches:

- `cosmetics_profile_skins`;
- `cosmetics_chat_bubbles`;
- `cosmetics_nameplates`;
- `cosmetics_badges`; and
- `cosmetics_seat_effects`.

`functions/scripts/setCosmeticsRendererFlags.js` can only write them as false.
Each category can be rolled back independently. Disabling a flag preserves
ownership, equipment, purchases, gifts, and audit history while clients show
the existing bundled UI.

## Verification and release gate

Local verification completed:

- root TypeScript compilation;
- Wave 6 authority, projection, feature-flag, profile mapping, store equip,
  expiry, refund, suspension, and reconciliation tests;
- existing renderer fallback tests in the main suite;
- JavaScript syntax checks for the new authority/service and function wiring.

The main non-emulator suite passes 207 files and 1,100 tests. The admin
standalone typecheck is still blocked only by the pre-existing
`DailyLoginRewardsPanel.tsx` errors. Firebase emulator verification was
attempted separately and twice through the combined runner; the local emulator
stalled before Vitest began, so rules are not recorded as passing in this wave.

Before enabling any category, supply at least twenty approved representative
assets and physically verify Android and iOS for Arabic/English RTL, large
font, long names, reduced motion, low-memory behavior, missing assets, room
theme combinations, twenty visible users, and every trusted room-state layer.
