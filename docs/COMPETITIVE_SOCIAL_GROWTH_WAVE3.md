# Competitive Social Growth — Wave 3

Status: **implemented locally** (in-room red/blue PK; cross-room stubbed).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 3)

3. **PK rewards:** none in V1 (scoreboard + winner banner only; no cash / coin pool).
   Cosmetic crumbs deferred.

## What shipped

| Piece | Location |
|-------|----------|
| Stage enables `roomPk` from closed-beta; `crossRoomPk` stays false | `growthRolloutCore.js` |
| Session core + scoring | `roomPkCore.js` / `roomPkService.js` |
| HTTP `roomPkCommand` + 1-min finalize scheduler | `functions/index.js` |
| Gift score hook (priceCoins) | `roomGiftService.js` post-commit |
| Client command + live card | `requestRoomPkCommand.ts`, `RoomPkScoreboardCard`, `VoiceRoomScreen` |
| Firestore read rules | `roomPkSessions/{pkId}` for room members |

## Product (V1)

- Host/owner starts **3-minute** (clamped 1–10 min) in-room **red vs blue** PK.
- Members join a team; gifts from teamed senders add **`priceCoins`** to that team.
- Live scoreboard on room overlay; host can end early.
- Winner / draw / void (anti-farm if &lt;2 distinct gifters).
- Flag off → scheduler force-finalizes in-flight sessions.

## Ops

```bash
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Emergency freeze is “stage → dark” or leave `roomPk: false` on `appConfig/growthFeatures`
(scheduler force-finalizes).

## Exit criteria

- Gift totals on session match committed room gift `priceCoins` for teamed senders.
- Room close / expiry / flag-off ends deterministically.
- UI hidden when `roomPk` false.

## Out of scope

- Cross-room PK (`crossRoomPk` rejects)
- Push fan-out on start/end
- Cosmetic / coin rewards
