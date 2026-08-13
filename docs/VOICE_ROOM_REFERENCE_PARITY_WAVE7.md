# Voice Room Reference Parity — Wave 7 Theme Publishing Studio

## Status

Implemented locally. Wave 7 replaces the dashboard's raw full-phone seat canvas
with a production-shell simulator that uses the same normalized room regions
and stage-relative coordinates as the Expo client.

## Production-shell preview

- Renders the shared room header, announcement, theme stage, incentive rail,
  activity card and Command Center in their real normalized regions.
- Background and stage assets are separate layers with independent
  `cover`/`contain` and focal-point controls.
- Uploaded background, stage and dock files preview immediately through
  revocable object URLs; immutable published URLs remain supported.
- Dock artwork remains decorative and cannot replace or reorder controls.
- The preview avatar uses an application-owned example border only; theme data
  never controls user-owned avatar frames.

## Responsive seat editor

- Supports compact (360×640), standard (390×780) and tall (390×844) phones.
- Edits the matching Manifest V3 profile independently.
- Drags seats relative to the stage canvas instead of the whole phone.
- Keeps the legacy fallback layout synchronized from the standard profile.
- New and legacy manifests are upgraded in memory to V3 with independent
  profile copies and safe default media settings.

## Publication gates

- Requires explicit review of 5, 10, 15 and 20 seats on all three phone
  profiles (12 previews total) before publication.
- Mirrors backend seat-count, numbering, bounds, scale, z-layer and overlap
  validation and reports the first blocking issue before upload/publication.
- Draft saving remains available while work is incomplete.
- Existing save, publish, rollback and emergency-disable operations remain
  authoritative backend commands with audit reasons.

## Dashboard hardening found during verification

- Corrected a syntax error in the gift presentation editor that prevented Vite
  from booting any dashboard page.
- Completed gift presentation format typings.
- Completed push and operations API request typings.
- Fixed the operations-event mutation envelope so the dashboard route action
  is no longer overwritten by the publish/retire operation.
- Added the same backward-compatible `operation` handling to the backend core.
- Tightened Daily Login draft parsing for missing rows and incomplete item
  fallback values.
- Rebased bundle ceilings to the measured responsive dashboard shell while
  retaining strict raw-size caps.

## Verification

- Dashboard TypeScript: pass.
- Dashboard tests: 14 files, 39 tests passing.
- Operations-event core/service tests: 2 files, 6 tests passing.
- Vite production build: pass, 100 modules transformed.
- Bundle budget check: pass; entry 405,900 bytes, CSS 155,612 bytes, Store
  Catalog lazy panel 43,759 bytes.
- Local browser boot: pass with no console warnings/errors after compilation.
- The theme editor itself remains correctly protected by the dashboard's admin
  authentication gate, so final authenticated visual sign-off requires an
  active admin browser session.

## Acceptance boundary

The editor and runtime accept catalog IDs and immutable remote manifest assets,
so a fourth valid published theme does not require an application rebuild.
Actually publishing a fourth production record is an authenticated external
mutation and is not performed by this local implementation wave.

