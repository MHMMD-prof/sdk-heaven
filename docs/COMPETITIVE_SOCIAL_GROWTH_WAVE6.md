# Competitive Social Growth — Wave 6

Status: **implemented locally** (gift theater: combos, storms, lucky crumbs, magic frames).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

Cosmetics gift baseline: [`COSMETICS_ROOM_EFFECTS_WAVE4_GIFT_PRESENTATION.md`](./COSMETICS_ROOM_EFFECTS_WAVE4_GIFT_PRESENTATION.md).

## Locked product decisions (Wave 6)

10. **Combos** only accumulate when `growthFeatures.giftCombos` is true.
11. **Storm** = catalog tag `storm` and/or presentation tier `major`/`global`.
12. **Lucky gifts** roll server-side from a published (or default) odds table;
    outcome is a **display crumb** (entertainment), not inventory grant V1.
13. **Magic gift** = user picks an **approved frame template** (default set if
    `appConfig/magicGiftFrameTemplates` empty); no freeform UGC.
14. Rolls are idempotent on gift `requestId` (`sha256` seed).

## What shipped

| Piece | Location |
|-------|----------|
| Theater core + defaults | `functions/giftTheaterCore.js` |
| Combo gate + lucky/magic on send | `functions/roomGiftService.js` |
| Catalog `theater.tags` | `socialGiftsCore.js` + admin gift editor |
| Growth flags from closed-beta+ | `giftCombos`, `luckyGifts`, `magicGiftTemplates` |
| Overlay storm / lucky / magic UX | `RoomEffectOverlay.tsx` |
| Gift sheet template + odds copy | `RoomGiftSheet.tsx` |
| Audit docs | `rooms/{roomId}/luckyGiftOutcomes/{requestId}` |

## Catalog tags

Admin gift editor checkboxes: `combo` | `storm` | `lucky` | `magic`.

Lucky gifts should also use a visible presentation tier; magic gifts require a
template on send when the flag is on.

## Ops

```bash
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Optional publishes:

- `appConfig/giftLuckyTable` — override default odds
- `appConfig/magicGiftFrameTemplates` — `{ templates: [...] }`

Emergency: set `giftCombos` / `luckyGifts` / `magicGiftTemplates` false on
`appConfig/growthFeatures` (or stage → `dark`). Presentation falls back to
static/tier cosmetics delivery without theater extras.

## Exit criteria

- Queue still capped at 8; combo merge unchanged under flag.
- Lucky roll for same `requestId` is stable and audited.
- Flag off disables combo accumulation / lucky / magic template requirement.

## Out of scope

- Inventory grant of lucky cosmetics
- Freeform magic UGC video
- Separate storm particle system beyond major/global overlay banner
