# Voice Room Reference Parity — Wave 3 Responsive Scene Runtime

## Status

Implemented locally. Wave 3 establishes the responsive coordinate and media
runtime. It does not yet replace the three production artworks or restyle the
seat component.

## Manifest V3

V3 retains the complete V2 surface, including legacy layouts and bounded motion,
then adds a declarative `scene` object:

- Background fit and normalized focal point.
- Stage fit and normalized focal point.
- Independent compact, standard and tall profiles.
- Complete 5/10/15/20-seat layouts inside every profile.

Mobile and backend validators reject missing profiles, invalid focal points,
duplicate seats, overlaps and incomplete seat-count layouts. No executable
theme code is accepted.

## Runtime

- V1 and V2 adapt to centered `cover` media and their existing layouts.
- V3 selects a profile from the real phone aspect ratio.
- Existing V2 animated background and ambient slots continue rendering in V3.
- The full-room background uses the selected scene focal point.
- Optional stage artwork is rendered inside the same measured `View` used to
  convert normalized seat coordinates into pixels.
- Stage artwork and seats therefore share one crop, width and height instead of
  using unrelated full-screen and leftover-flex coordinate spaces.
- Bundled Majlis renders immediately, but the runtime now also listens for a
  published Majlis revision and falls back to the bundle if it is unavailable.
- Missing stage artwork leaves the canvas transparent without hiding seats.

## Backend and dashboard compatibility

- Theme purchase, equipment, inventory and admin publication accept V3.
- Admin save, publish, rollback and emergency disable preserve V3.
- The existing compact/tall editor edits the matching responsive profile while
  also updating the legacy fallback layout.
- The seed script now creates safe V3 manifests with identical initial layouts
  in all profiles. Theme-specific tuning remains Wave 5.
- The full production-shell dashboard preview and standard-canvas editor remain
  assigned to Wave 7.

## Preserved invariants

- Seat IDs, occupants, actions, roles and permissions are unchanged.
- Theme changes do not reconnect or replace the voice session.
- User-owned avatar borders remain outside the theme contract.
- Custom approved room images still replace only the background.
- V1/V2 published themes remain renderable.
