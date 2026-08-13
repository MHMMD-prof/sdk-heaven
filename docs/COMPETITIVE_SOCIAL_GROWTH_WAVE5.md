# Competitive Social Growth — Wave 5

Status: **implemented locally** (Drawing Guess coin tables + Games tab CTA).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

Room games baseline: [`VOICE_ROOM_WAVE10_GAMES.md`](./VOICE_ROOM_WAVE10_GAMES.md).

## Locked product decisions (Wave 5)

7. **Deepen Drawing Guess**, not Carrom multiplayer / Ludo / UNO.
8. **Coin entry is optional entertainment**: fixed fees `0 | 10 | 25 | 50`
   coins; prize is a **server raffle** among remaining players at end
   (not skill-score settlement — LiveKit scores stay client-trust).
9. **Kill switches**: `voice_room_games` stops new tables; `roomGameEconomy`
   stops new paid fees (existing paid sessions still settle).

## What shipped

| Piece | Location |
|-------|----------|
| `roomGameEconomy` from closed-beta+ | `growthRolloutCore.js` + client `featureFlags` |
| Entry debit / refund / raffle prize via wallet ledger | `roomGameCore.js` + `roomGameService.js` |
| Invite UX: fee picker, pool copy, spectator alert | `VoiceRoomScreen`, `RoomGameInviteCard` |
| Games tab “العب في غرفة” → quick match or Rooms | `GamesScreen` |
| Expire refunds / raffles unpaid pools | `expireRoomGameSessions` |

## Economy rules

- Only `drawing-guess` (`supportsCoinEntry`) may charge.
- Host pays on create; joiners pay the same fee on join.
- Lobby leave → refund entry; active leave → forfeit to pool.
- `end-room-game` on active → deterministic raffle of `poolCoins` (cap
  `MAX_REWARD_CREDIT`).
- End/expire on lobby → refund remaining paid entries.
- Ledger IDs: `walletTransactions/rge_*` keyed by kind+session+uid+requestId.

## Ops

```bash
# Ensure tables are on (Wave 10)
npm run rooms:games:enable --prefix functions -- --actor-uid OWNER_UID

# Enable Wave 5 economy with growth stage (closed-beta+)
node functions/scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid OWNER_UID --apply
```

Emergency:

- `roomGameEconomy: false` on `appConfig/growthFeatures` → no new paid creates.
- `voice_room_games: false` → no new/list/join; leave/end still work; expire settles.

## Exit criteria

- Paid Drawing Guess table debits and settles to ledger without client-trusted scores.
- Spectator non-players can watch via invite card without paying.
- Games tab routes into a room (match or browse).
- Flag off disables fees and/or new tables as above.

## Out of scope

- Skill-based prize from Drawing Guess scores
- Carrom / Naval real multiplayer economy
- LiveKit spectator canvas transport
- Cosmetic crumb prizes (later theater waves)
