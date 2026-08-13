# Voice Room Reference Parity — Wave 2 Shared Shell

## Status

Implemented locally. Wave 2 changes the shared room shell only; theme-specific
scene coordinates and seat presentation remain assigned to Waves 3–5.

## Implemented

- Rebuilt the RTL header with a bounded two-level identity hierarchy.
- Added the room owner's avatar and real equipped user frame to the header.
- Kept the full Firestore room ID for accessibility while shortening only its
  visual presentation.
- Replaced the ticker with a dedicated announcement/status component with fixed
  truncation and ornamental end caps.
- Removed the fixed `top: 118` incentive overlay.
- Added a bounded stage shell with a dedicated 52-point incentive rail.
- Made Rocket and Room Target compact launchers; Room Target is always below
  Rocket when both are enabled.
- The stage automatically regains the rail width when both features are hidden.
- Notices remain in normal layout flow and cannot be covered by incentives.

## Preserved behavior

- Leaving, sharing and participant navigation are unchanged.
- Rocket and Room Target open the same existing sheets.
- Audio, seat IDs, permissions, gifts and room ownership are unchanged.
- User-owned avatar frames remain sourced from the user's cosmetics projection.
- No backend documents, rules, flags or catalog records are modified.

## Acceptance checks

- Long technical room IDs do not consume the title row.
- Full IDs remain exposed to assistive technology.
- Long announcements truncate to one line inside their own bounded region.
- Rocket precedes Room Target in a vertical rail.
- Incentives are not absolutely positioned over the screen or seats.
- The owner header uses the actual equipped frame rather than theme artwork.

## Verification

- Wave 2 shell, Wave 1 visual-contract and existing theme-contract suites pass
  together: 20 tests.
- Expo SDK 56 Android export completes successfully with 2,308 bundled modules.
- Expo reports the existing `ios.googleServicesFile` config parse warning during
  Android export; it does not prevent the Android bundle from being produced.
- The repository-wide TypeScript command still reports unrelated pre-existing
  errors outside the Wave 2 files. No Wave 2 file appears in that error set.
