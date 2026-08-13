# Voice Room Reference Parity — Wave 5 Production Themes

## Status

Implemented locally. Wave 5 produces the three final environment-only stage
artworks and replaces generic seat rows with responsive, theme-specific
production layouts.

## Production assets

Generated with the built-in image generation tool using the approved concepts
as composition references and the existing V1 backgrounds as palette/style
references:

- `assets/room-themes/majlis-default/stage-v2.png`
- `assets/room-themes/royal-theater/stage-v2.png`
- `assets/room-themes/ruby-constellation/stage-v2.png`

The existing V1 full-room backgrounds remain intact. V2 assets are stage-only,
immutable siblings; no prior production asset was overwritten.

Every V2 stage is a tall high-resolution PNG and contains no baked people,
avatars, frames, text, numbers, microphone icons, buttons, controls, logos or
watermarks. Occupied avatar borders therefore remain entirely user-owned.

## Responsive layout production

`roomThemeProductionLayouts` now defines matching mobile and backend layouts:

- topology: `1 + 4 + 5 + 5 + 5`
- complete 5, 10, 15 and 20-seat projections
- distinct Majlis horseshoe, Theater curve and Constellation grid coordinates
- separate compact, standard and tall seat scales and vertical spacing
- seat 1 as a visual focal anchor only
- numeric seat IDs and accessibility order preserved

The seed script publishes manifest revision 2, uploads each stage to
`room-theme-assets/{themeId}/v2/stage.png`, and publishes separate V3 layouts
for every viewport profile. Existing V1 backgrounds stay at their immutable V1
paths. Store thumbnails/previews use the stage artwork.

## Runtime production behavior

- Bundled Majlis renders its V2 stage offline.
- Bundled stage resolution supports all three built-in themes.
- Stage media uses `contain` so landmarks are not destructively cropped.
- Expo Image uses memory/disk caching and a revision-keyed recycling key.
- Stage changes crossfade for 140 ms and become immediate under reduced motion.
- Missing remote stage artwork leaves the safe full-room background visible.

## Verification

- Mobile/backend layout parity for all 3 themes × 3 viewport profiles.
- Manifest V3 validation for every theme.
- Complete topology and stable seat numbering.
- Pixel-box bounds and collision checks on compact (308×480), standard
  (341×524) and tall (341×600) Android stage canvases with 20 seats.
- PNG signature, minimum dimensions and portrait aspect checks.
- Focused room-theme, stage-renderer and seat-contract suites.
- Function syntax and Wave 16 lint.
- Android Expo production export.

No ADB device was connected during this implementation. A final visual sign-off
on the user's physical `expo run:android` device remains a release observation,
not an unimplemented engineering dependency.

## Final image prompt set

All prompts used the `stylized-concept` taxonomy and required environment-only
artwork, tall portrait composition, dark quiet header/dock regions, near-black,
ruby and antique-gold color, and explicitly prohibited people, faces, avatars,
avatar frames, UI, microphones, text, numbers, logos and watermarks.

1. **Majlis:** furnished continuous ruby horseshoe sofa, integrated round
   cushions, carved dark wood, brass lanterns, patterned central rug and low tea
   table; one focal position, four surrounding positions and five-seat tiers.
2. **Royal Theater:** empty upper-center throne dais, four curved first-tier
   positions and successive five-position ruby theater tiers with restrained
   warm footlights.
3. **Ruby Constellation:** one upper focal alcove, four upper architectural
   modules and successive five-module tiers using restrained nebula threads,
   gold constellation lines and Islamic geometric tracery.
