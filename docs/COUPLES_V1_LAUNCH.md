# Couples V1 launch enablement

Thin couples launch: mutual pairing + optional owner-uploaded couple cosmetics. No CP, intimacy levels, ranks, rings, or couple seats.

## Enable social couples

1. Set Firestore `appConfig/socialFeatures.couples` to `true`.
2. Confirm client reads the flag via `src/social/featureFlags.ts` (default remains fail-closed `false` until the doc is true).

## Optional couple cosmetics (owner)

Only enable cosmetics after assets exist.

1. In admin **Cosmetics asset registry**, upload a `couple-effect` asset (PNG or Lottie), approve a version.
2. In admin **Store catalog**, create a `couple-effects` item bound to that approved asset version and set presentation modes (profile / paired border / entrance).
3. Publish the catalog item.
4. Enable cosmetics flags only when ready:
   - `cosmetics_couple_effects`
   - `cosmetics_couple_entrances` (also needs voice entry-effects + couple effects)

Soft launch without cosmetics is fine: pairing works with cosmetics flags left off.

## V1 product surface

- Request / accept / decline / cancel / dissolve
- Couples hub + profile actions
- Profiles show **حالة الارتباط**: `مرتبط` / `غير مرتبط` (not a numeric level)
- Backend may still store `coupleLevel` as `0` or `1` as a coupled flag

## Explicitly not in V1

- CP / intimacy points
- Level-up ladders
- Couple leaderboards
- Rings / paid wedding
- Couple seats / private couple rooms
