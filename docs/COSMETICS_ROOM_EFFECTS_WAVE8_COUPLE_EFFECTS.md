# Cosmetics and Room Effects Wave 8: couple effects

## Outcome

Wave 8 is implemented locally behind fail-closed flags. It adds:

- a shared couple entitlement where one current partner purchases a
  pair-scoped, non-transferable `couple-effects` store item for the exact
  relationship instance;
- server-authoritative `get-couple-effects`, `purchase-couple-effect`,
  `equip-couple-effect`, and `unequip-couple-effect` social commands;
- identical minimal `coupleEffect` projections on both public profiles;
- profile treatment, paired-border treatment, and one coalesced synchronized
  room entrance through the existing room-entry queue and shared renderer;
- independent dark gates for `cosmetics_couple_effects` and
  `cosmetics_couple_entrances`; and
- admin catalog authoring, false-only emergency rollback, and sanitized pair
  telemetry.

No function, rule, catalog record, flag, or asset was deployed. Both couple
flags default to false.

## Ownership model

Ownership follows the familiar shared-couple-theme pattern: one member pays,
both linked members receive the presentation while that exact relationship
remains active. Ownership is bound to a `relationshipId` that does not carry
to a later relationship, including a later relationship between the same two
users. Gifting, transfer, resale, and ordinary per-user store purchase/equip
paths are blocked for `couple-effects`.

## Presentations

1. Profile treatment on Me and public profiles.
2. Paired borders only where both identities are co-visible and share the same
   server-authored `coupleIdHash` (for example Couples screen).
3. One deterministic pair room-entry event when both members have fresh
   presence in the same active room inside the eight-second window. Concurrent
   second commands coalesce onto the same event. Failures fall back to each
   user's individual cosmetics.

Public projections never contain partner UIDs, private couple IDs, purchaser
identity, wallet facts, or entitlement history.

## Current acceptance status

Local verification on 2026-08-04:

- root TypeScript compilation passed;
- the main non-emulator suite passed 218 files and 1,178 tests;
- Functions syntax/lint checks passed;
- admin production build passed; and
- focused Wave 8 backend, frontend, admin-policy, entrance, and telemetry
  suites passed earlier in the wave.

The Firestore/Storage emulator suite retains the pre-existing Wave 6 public
profile projection expectation failure. Physical Android/iOS acceptance,
approved production assets, relationship-ID backfill review, deployment, and
flag enablement remain open release gates.
