# Competitive Social Growth — Wave 8

Status: **implemented locally** (ops events calendar + daily gift mission + Home strip + admin publisher).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 8)

22. Flags: **`growthFeatures.opsEvents`** + **`growthFeatures.dailyMissions`**
    (fail-closed; enabled from closed-beta+).
23. V1 mission: **send 3 gifts today** → **50 coins** via wallet ledger
    (`source: 'ops-mission'`).
24. Progress lives at `userMissionProgress/{uid}/days/{dayId}` (survives reconnect).
25. Claim is idempotent on `requestId` + settlement claim doc.
26. Admin publishes event title / theme / window; retired or expired events
    stop appearing on Home (missions still claimable for the day if flag on).
27. Board boosts, stay-minutes / win-game missions, and automated push
    reminders are **deferred** (manual Admin Push remains available).

## What shipped

| Piece | Location |
|-------|----------|
| Core schema | `functions/opsEventsCore.js` |
| Status / claim / progress / admin mutate | `functions/opsEventsService.js` |
| Gift progress hooks | `roomGiftService.js`, `socialGiftsService.js` |
| socialCommand | `get-ops-missions`, `claim-ops-mission` |
| Home strip | `src/opsEvents/EventsHomeStrip.tsx` |
| Admin tab | Incentives → `ops-events` (`OpsEventsPanel.tsx`) |
| Rules | Admin SDK–only ops collections |

## Ops

```bash
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Publish an event from Admin → Incentives → فعاليات ومهام.

Emergency: set `opsEvents` / `dailyMissions` false on `appConfig/growthFeatures`
(or stage → `dark`). Home strip hides; progress docs retained.

## Exit criteria

- Progress survives reconnect via day docs.
- Claim replay with same `requestId` returns prior settlement; second claim conflicts.
- Flag off disables overview/claim (`FEATURE_DISABLED`).

## Out of scope

- Limited-time leaderboard boosts
- Automated event reminder pushes
- stay_minutes / win_game mission kinds
