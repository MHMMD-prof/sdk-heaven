# Competitive Social Growth — Wave 1

Status: **implemented locally** (server match + lucky bag, client CTAs, stage flags).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 1)

1. **Quick Match geography:** prefer the user’s country (profile / Home filter), then
   Arabic-global public pool. Scoring boosts same-country and empty/quiet rooms
   with a live host (room fill assist).
2–5. VIP / PK / lucky gifts / Wave 10 remain deferred (not required for this wave).

## What shipped

| Piece | Location |
|-------|----------|
| Stage enables `quickMatch` + `luckyBag` from closed-beta; `maskedMatch` from public-partial | `functions/growthRolloutCore.js` |
| Match eligibility + scoring | `functions/growthMatchCore.js` |
| `quick-match` / `claim-lucky-bag` | `functions/growthMatchService.js` via `socialCommand` |
| Client growth flags | `src/growth/featureFlags.ts` → `appConfig/growthFeatures` |
| Match CTA | Home rail + Rooms header |
| Lucky Bag CTA | Home banner when `luckyBag` |
| Soft mask session | `src/growth/matchSession.ts` (in-memory until reveal UI) |
| Telemetry | `matchAttempts`, `matchRoomLandings`, empty/nonempty join counters |

## Flag matrix (Wave 1)

### `appConfig/growthFeatures`

| Flag | dark | closed-beta | public-partial | public |
|------|------|-------------|----------------|--------|
| `quickMatch` | false | true | true | true |
| `luckyBag` | false | true | true | true |
| `maskedMatch` | false | false | true | true |
| PK / VIP / families / … | false | false | false | false |

Wave 0 social/voice flags unchanged.

## Contracts

### `socialCommand` → `quick-match`

- Payload optional: `{ preferredCountryCode?: 'IQ' | … }`
- Result: `{ roomId, title, countryCode, participantCount, masked, mask }`
- Client **must** still `joinRoom(roomId)` after success (server does not join).
- Fail-closed on `growthFeatures.quickMatch !== true`
- Rate limit: 20 / 10 min per uid
- Idempotent on `requestId` → `growthMatchRequests/{requestId}`

### `socialCommand` → `claim-lucky-bag`

- Soft daily credit: **25 coins** (Asia/Baghdad day bucket)
- Idempotent claim doc: `growthLuckyBagClaims/{uid}/days/{dayId}`
- Copy must stay non-gambling (“هدية المنصة” / free daily coins)

## Ops

```bash
# Enable Wave 1 surfaces (requires sequential advance from current stage)
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply

# Status
node functions/scripts/growthRolloutStatus.js
```

Rollback:

```bash
node functions/scripts/setGrowthRolloutStage.js --stage dark --actor-uid OWNER_UID --apply
```

## Exit criteria (closed-beta)

- Match UI hidden when flags off; app otherwise unchanged.
- Target (measure in telemetry after beta): ≥40% of Match taps that return a room
  land in a room with ≥1 other participant within 30s of join (`matchToRoomRate`
  + nonempty join share).
- Empty-room join rate should trend down vs Wave 0 baseline as fill-assist scores.

## Out of scope

- In-room mask reveal UI (session stored only).
- Push deep-link auto-match.
- Paid lucky odds / VIP / PK.
