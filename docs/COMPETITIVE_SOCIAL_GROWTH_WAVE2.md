# Competitive Social Growth — Wave 2

Status: **implemented locally** (wealth/charm boards, VIP unlock-by-recharge, Me entry).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 2)

2. **VIP model:** cumulative **recharge unlock** via `walletSummaries.lifetimeCredit.coins`
   (no paid subscription in this wave). Display-only status; **no moderation bypass**.

## What shipped

| Piece | Location |
|-------|----------|
| Stage enables `leaderboards` + `vipTiers` from closed-beta | `functions/growthRolloutCore.js` |
| Score periods + board IDs | `functions/growthLeaderboardCore.js` |
| Gift → score projection + materialize + VIP sync | `functions/growthLeaderboardService.js` |
| VIP default catalog | `functions/growthVipCore.js` + `scripts/seedVipTierCatalog.js` |
| `socialCommand` `get-leaderboard` / `get-vip-status` | `functions/index.js` |
| Scheduler `refreshGrowthLeaderboards` (every 5 min) | `functions/index.js` |
| Hooks after social + room gifts | `socialGiftsService.js`, `roomGiftService.js` |
| Client boards screen “المتصدرون” | `src/screens/LeaderboardsScreen.tsx` |
| Me shortcut + VIP chip on profile | `MeProfilePage` / `MeProfileScreen` |

## Boards

- **Wealth:** coins spent on gifts (sender `priceCoins`)
- **Charm:** gift `scoreValue` received
- Windows: `daily` / `weekly` / `all` (Asia/Baghdad)
- Scopes: `global` + country code
- Snapshots: `leaderboards/{kind}_{window}_{scope}` (top 50, stale ≤5 min)
- Scores: `leaderboardPeriods/{periodId}/users/{uid}`
- Freeze: `appRuntime/growthLeaderboards.frozen === true`

## VIP tiers (default)

| Tier | min lifetimeCredit coins |
|------|--------------------------|
| bronze | 1_000 |
| silver | 5_000 |
| gold | 20_000 |
| platinum | 50_000 |
| diamond | 150_000 |

Projection: `publicProfiles/{uid}.vipTier` `{ id, nameAr, accentColor, rank }`.

## Ops

```bash
# Seed VIP catalog (optional; defaults used if empty)
node functions/scripts/seedVipTierCatalog.js --actor-uid OWNER_UID --apply

# Enable Wave 2 surfaces with closed-beta+
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Rollback: stage → `dark` clears growth feature flags including boards/VIP UI.

## Exit criteria

- Boards refresh within ~5 minutes via queue + scheduler (or on read if stale).
- VIP appears on Me after `get-vip-status` / enough lifetime credit; seat/profile read from public projection.
- Flags off → Me entry and boards screen hidden; historical snapshots retained.

## Out of scope

- Paid VIP subscription
- Admin VIP catalog UI (seed script + defaults only)
- Rank score boost that changes board totals (display badge only)
- Wave 3 room PK — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE3.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE3.md)
