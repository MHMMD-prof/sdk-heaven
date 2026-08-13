# VIP, SVIP, and Aristocracy — Wave 4 presentation

Status: implemented locally on 2026-08-13; not deployed or enabled.

Wave 4 adds the bounded public presentation layer and the client-approved
two-card Me-page composition. It does not add a subscription, recurring
billing, Apple/Google purchase flow, price, catalog, or Status Center purchase
screen.

## Implemented surfaces

- Me: one two-card row directly below the existing profile summary and above
  Quick Access. SVIP is the left visual card and Aristocracy is the right.
- Me and public profile: compact public status badges and optional canonical
  status frame overlay.
- Discovery: compact status badges without replacing representative identity.
- Voice room: seat and participant-row badges plus a dedicated frame overlay.
  Owner, moderator, mute, representative, and safety layers remain above art.
- Room chat and direct chat: compact badges and a dedicated optional chat
  benefit layer. User-selected chat cosmetics remain intact underneath.
- Room entry: the backend may select a public, platform canonical
  `entryEffect` status slot only while the shared registry is enabled. Hidden,
  expired, malformed, or arbitrary-URL projections render nothing.

## Public projection and expiry

`statusPresentation` remains the only public status source. Each active VIP or
Aristocracy projection may expose `assets` with the fixed keys `badge`,
`frame`, `nameplate`, `chatBubble`, and `entryEffect`. Every value is an exact
`assetId`/`assetVersionId` pair. Firestore rules and both server/client mappers
reject unknown fields and URLs.

Projection removal or expiry removes only the status overlay. The user's
permanent store ownership and equipped avatar frame, nameplate, chat bubble,
badge, seat effect, and entry item are never changed by the renderer.
Aristocracy wins only when both statuses target the same dedicated status
slot; it does not replace user equipment.

## Flags

All flags default off and require `schemaVersion: 1`:

- `statusPresentation`: master presentation switch;
- `svipCard`: independent Me SVIP-card visibility;
- `aristocracyCard`: independent Me Aristocracy-card visibility;
- `statusAnimations`: remains off until approved motion assets exist.

Card taps are accessible buttons but intentionally perform no purchase action
until Wave 5 owns the Status Center route. This avoids a fake or unsafe
purchase destination.

## Bundled static card artwork

Both original, text-free assets are fixed at 1088×320 (3.4:1), under 1 MiB,
and pinned in `statusCardAssets.ts`:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/status/svip-card-v1.png` | 573,481 | `c5e97c3c6699e7c0846451a0e643cf0214ba08817f242cc83a134b904a8da100` |
| `assets/status/aristocracy-card-v1.png` | 687,075 | `06e18b88526d3f8a81dcfa22910b84cf9431f92c19f5ddc58803ca28f04b927a` |

Live labels remain native text for Arabic RTL, scaling, localization, and
screen readers. The bundled artwork is decorative and static, which is also
the reduced-motion and low-memory-safe card fallback.

### Image-generation record

Mode: built-in image generation, using the supplied screenshot only as a
composition reference.

SVIP prompt:

> Create one original production raster asset for a mobile app status card.
> Use the attached screenshot only as a composition reference for the small
> left-side "SVIP" landscape card: compact horizontal premium card, hero
> ornament entering from the lower-left, clear negative space for live app
> text. Do not reproduce the screenshot's diamond, lettering, ribbon, colors
> exactly, page layout, logo, or any other UI. Asset requirements: Type:
> decorative background artwork for an Expo React Native pressable card; no UI
> chrome outside the card. Composition: very wide compact landscape card,
> target aspect ratio about 3.4:1. Put an original faceted emerald-and-ruby star
> gemstone held by a slim antique-gold geometric pedestal at the far left/lower
> edge. Keep the center and right half calm and dark for runtime label text.
> Style: polished premium 3D illustration, restrained jewelry reflections,
> modern Arabic social voice app, original ruby-and-gold house style with deep
> emerald-to-near-black background, subtle burgundy undertone, fine gold
> highlight, sophisticated rather than flashy. Edges: artwork must fill the
> entire canvas; rounded corners are rendered by the app, so do not bake a card
> outline or rounded transparent corners into the image. Safety/performance:
> static composition, no motion cues requiring animation, readable at very
> small mobile size. Strictly no words, letters, numerals, labels, ribbon,
> logo, watermark, crown, people, interface controls, or copied brand/trade
> dress. Deliver a clean final asset only.

Aristocracy prompt:

> Create one original production raster asset for a mobile app Aristocracy
> status card. Use the attached screenshot only as a composition reference for
> the small right-side "Noble" landscape card: compact horizontal premium card,
> a royal ornament entering from the lower-left, clear negative space for live
> app text. Do not reproduce the screenshot's crown, lettering, page layout,
> logo, or any other UI. Asset requirements: Type: decorative background
> artwork for an Expo React Native pressable card; no UI chrome outside the
> card. Composition: very wide compact landscape card, target aspect ratio
> about 3.4:1. Put an original antique-gold laurel medallion with a small ruby
> signet and abstract architectural coronet motif at the far left/lower edge.
> It must not resemble or recreate the reference crown. Keep the center and
> right half calm and dark for runtime label text. Style: polished premium 3D
> illustration, restrained jewelry reflections, modern Arabic social voice
> app, original ruby-and-gold house style with midnight
> royal-blue-to-near-black background, subtle burgundy undertone, fine gold
> highlight, elegant and authoritative rather than flashy. Edges: artwork must
> fill the entire canvas; rounded corners are rendered by the app, so do not
> bake a card outline or rounded transparent corners into the image.
> Safety/performance: static composition, no motion cues requiring animation,
> readable at very small mobile size. Strictly no words, letters, numerals,
> labels, ribbon, logo, watermark, traditional crown, people, interface
> controls, or copied brand/trade dress. Deliver a clean final asset only.

## Verification completed

- TypeScript no-emit compilation.
- Focused status, projection, entry, social-profile, and asset tests.
- Expo SDK 56 web bundle and runtime smoke check (login shell loaded; no new
  status runtime error).

## Remaining exit gate

The full Wave 4 exit remains pending until an authenticated Android and iOS
physical-device pass verifies the Me card row, public/profile/chat/room
surfaces, large font scaling, screen reader order, reduced motion, low-memory
fallback, and expiry restoration. No physical approval receipt is fabricated.
