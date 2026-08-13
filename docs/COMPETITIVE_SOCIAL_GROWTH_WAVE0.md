# Competitive Social Growth — Wave 0

Status: **implemented locally** (stage tooling, telemetry stubs, overview KPIs).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## What shipped

| Piece | Location |
|-------|----------|
| Stage matrix `dark → closed-beta → public-partial → public` | `functions/growthRolloutCore.js` |
| Runtime stage doc | `appRuntime/growthRollout` |
| Reserved Wave 1+ flags (all false in Wave 0) | `appConfig/growthFeatures` |
| Apply stage + patch bounded flags | `functions/scripts/setGrowthRolloutStage.js` |
| Status readout | `functions/scripts/growthRolloutStatus.js` |
| Telemetry stubs | `appRuntime/growthTelemetry` via `growthTelemetryCore.js` |
| Admin Growth health KPIs | Overview payload + dashboard card strip |

## Flag matrix (Wave 0 controlled)

### `appConfig/socialFeatures` (patched by stage)

| Flag | dark | closed-beta | public-partial | public |
|------|------|-------------|----------------|--------|
| `pushNotifications` | false | true | true | true |

### `appConfig/voiceRoomFeatures` (patched by stage)

| Flag | dark | closed-beta | public-partial | public |
|------|------|-------------|----------------|--------|
| `voice_room_gifts` | false | true | true | true |
| `voice_room_supporter_rankings` | false | true | true | true |
| `voice_room_shared_music` | false | false | true | true |

### `appConfig/growthFeatures` (Wave 0 reserved; Wave 1 enables match keys)

Through Wave 0 **public**, all reserved keys stayed false. Wave 1 flips
`quickMatch` / `luckyBag` (and `maskedMatch` from public-partial) — see
[`COMPETITIVE_SOCIAL_GROWTH_WAVE1.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE1.md).

Still dark after Wave 1 public: `leaderboards`, `vipTiers`, `roomPk`,
`crossRoomPk`, `giftCombos`, `luckyGifts`, `families`, `opsEvents`,
`dailyMissions`, `watchTogether`, `softOneToOneMatch`

## Safe enablement checklist (ops)

Before `--apply --stage closed-beta`:

1. **Push** — Expo project id present; device registration path tested on one
   Android/iOS build (not Expo Go for Android).
2. **Room gifts** — gift catalog has at least one `available` item; wallet
   balances exist for beta UIDs.
3. **Supporter rankings** — rocket/room-target **display** acceptable; payouts
   remain off (`voice_room_rocket_rewards` / `owner_target_payouts` untouched).
4. **Shared music** — only required before `public-partial`; confirm fail path
   when catalog empty / LiveKit music disabled.
5. **Gift presentation cosmetics** — optional; Wave 0 does not force
   `cosmeticsFeatures` theater flags. Enable separately via cosmetics rollout.

Rollback anytime:

```bash
node functions/scripts/setGrowthRolloutStage.js --stage dark --actor-uid OWNER_UID --apply
```

This forces the Wave 0-controlled social/voice flags off in one transaction.

## Ops commands

```bash
# Dry-run
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta

# Apply (owner only)
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply

# Status + telemetry
node functions/scripts/growthRolloutStatus.js
```

## Telemetry counters (stubs)

Stored at `appRuntime/growthTelemetry`:

- `emptyRoomJoins` / `nonemptyRoomJoins` → `emptyRoomJoinRate`
- `matchAttempts` / `matchRoomLandings` → `matchToRoomRate`
- `giftGmvCoins` / `giftGmvDiamonds`
- `vipConversions`

Wave 0 exposes `incrementGrowthTelemetry` for later call-site wiring. Counters
may remain zero until Waves 1–2 attach emitters.

## Exit criteria check

- [x] Flag matrix published (this doc + `growthRolloutCore`)
- [x] Closed-beta enables push + room gifts + rankings without PK/VIP
- [x] Stage → `dark` restores Wave 0-controlled flags in one write
- [x] Admin overview shows Growth health
- [x] Telemetry stubs readable when dark

## Non-goals (still Wave 1+)

Quick Match UI, VIP boards, room PK, families, events calendar, watch-together.
