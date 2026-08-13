# Competitive Social Growth — Wave 4

Status: **implemented locally** (incentive payout ladder fixed + host/agency UX).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

Incentive baseline: [`VOICE_ROOM_WEEKLY_INCENTIVES_WAVE10.md`](./VOICE_ROOM_WEEKLY_INCENTIVES_WAVE10.md)
(prod often sits at stage **4 `payroll-report-only`** until economic ack).

## Locked product decisions (Wave 4)

4. **No new growth feature flags** for host pay — use existing
   `appConfig/voiceRoomFeatures` rails and `appRuntime/weeklyIncentiveRollout`.
5. **Agency light** = room-owner roster recruit on Room Target (no separate
   agency product graph).
6. **Admin “reverse” in V1** = hold / reject / suspend before pay, or emergency
   payout flags off. Post-settlement clawback remains out of scope.

## What shipped

| Piece | Location |
|-------|----------|
| Stages 5–7 **accumulate** payout rails (bugfix) | `weeklyIncentiveRolloutCore.js` |
| Payout readiness helper | `summarizeWeeklyIncentivePayoutReadiness` |
| Me salary: live vs report-only + next settlement estimate | `payrollService.getPayrollProgress` + `SalaryProgressModal` |
| Room Target payout mode + host recruit copy | `RoomTargetSheet` + `VoiceRoomScreen` |
| Admin hold / release-hold (unchanged) | `PayrollPanel` → `mutateAdminPayroll` |

### Economic stage matrix (after Wave 4)

| Stage | Name | Rocket rewards | Target payouts | Payroll payouts |
|------:|------|:--------------:|:--------------:|:---------------:|
| 4 | payroll-report-only | off | off | off (tracking on) |
| 5 | rocket-synthetic-payout | **on** | off | off |
| 6 | target-synthetic-payout | **on** | **on** | off |
| 7 | payroll-synthetic-payout | **on** | **on** | **on** |

Stages 0–4 unchanged (report/display only).

## Ops checklist

```bash
# Dry-run then apply; economic stages need the ack flag.
node functions/scripts/setWeeklyIncentiveRolloutStage.js --stage 5 --actor-uid OWNER_UID
node functions/scripts/setWeeklyIncentiveRolloutStage.js --stage 5 --actor-uid OWNER_UID --acknowledge-economic-impact --apply

# Advance to target payouts, then payroll:
node functions/scripts/setWeeklyIncentiveRolloutStage.js --stage 6 --actor-uid OWNER_UID --acknowledge-economic-impact --apply
node functions/scripts/setWeeklyIncentiveRolloutStage.js --stage 7 --actor-uid OWNER_UID --acknowledge-economic-impact --apply
```

Before each economic step:

1. Confirm attendance / gift projection workers healthy.
2. Confirm enrolled payroll plans and Room Target / Rocket campaigns published.
3. Start with a tiny closed-beta cohort; verify one settlement ledger-balanced.
4. Admin can **حجز دفع** / **رفع الحجز** on Payroll panel for contested hosts.

### Rollback

- Immediate: `--stage 0 --apply` (dark — all incentive flags off).
- Soft: leave tracking on by writing payout flags false via
  `setWeeklyIncentiveFlags.js` / manual `voiceRoomFeatures` merge, or roll back
  one stage at a time is **not** supported (transitions are sequential forward
  or jump to 0). Prefer stage 0 or flag kill-switches for emergencies.

## Exit criteria

- Stage 6/7 enablement does not clear rocket rewards.
- Enrolled host Me card shows settlement estimate and live vs report-only copy.
- Owner Room Target sheet shows recruit UX + payout mode notice.
- Admin hold blocks payout path for held UIDs.
- Rollback to stage 0 or payout flags off stops new economic settlements;
  tracking can remain if flags left on.

## Out of scope

- Post-pay clawback / ledger reverse after `settled`
- Dedicated agency org / commission trees
- Cross-room agency dashboards
- Push fan-out for “payroll paid” (ops may use admin push manually)
