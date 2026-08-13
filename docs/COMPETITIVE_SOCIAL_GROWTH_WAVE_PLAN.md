# Competitive Social Growth — Production Wave Plan

## Objective

Close the retention and monetization gaps versus MENA voice-social peers
(Salam, Hilo, and similar party apps) without abandoning Heaven’s existing
voice-room, gift, wallet, representative, payroll, and cosmetics foundations.

Peers win on **strangers → status → spend spikes → paid hosts**. Heaven already
has much of the plumbing (rooms, gifts, store, reps, rockets/targets, payroll,
cosmetics) but under-delivers on:

1. cold-start stranger acquisition;
2. platform-wide status ladders people buy into;
3. room PK / gift battles;
4. live host/agency payout loops;
5. in-room party games tied to the economy;
6. gift theater and luck mechanics;
7. families / tribes and an always-on events calendar;
8. optional watch-together and soft 1:1 matching.

Every wave is a releasable vertical slice: server-authoritative contracts,
fail-closed flags, mobile UX, admin/ops where needed, tests, device acceptance,
observability, rollout, and rollback.

This plan targets Expo SDK 56. Re-check
<https://docs.expo.dev/versions/v56.0.0/> before Expo media, animation, or
notification changes.

---

## Locked product decisions

- Heaven remains a **voice-first social party app**, not a casino and not a
  dating app. Party games and luck gifts may use coins/diamonds for entry or
  cosmetic outcomes; they must not advertise real-money gambling odds.
- Prefer **turning on and completing existing systems** (rocket, room target,
  payroll payouts, gift presentation, shared music) before inventing parallel
  ones.
- All new growth surfaces are **fail-closed** behind `appConfig` flags.
- No paid VIP tier may bypass blocks, DM requests, rate limits, or moderation.
- Arabic-first RTL UX; numbers use `ar-IQ` where the dashboard already does.
- Admin can compose/ops announce via the existing admin push page; event
  campaigns still need their own product calendar, not only push blasts.
- Couples V1 stays relationship status; **families/tribes are a separate graph**.
- Soft video 1:1 matching (Hilo skew) is **Wave 10 optional** and must not block
  voice-core waves.

---

## Current baseline (do not rebuild)

| Area | Exists today | Gap for peers |
|------|--------------|---------------|
| Voice rooms, seats, chat, gifts | Yes (mostly flag-gated) | Fill empty rooms; PK |
| Wallet, store, cosmetics | Yes | VIP ladder + gift theater |
| Representatives | Yes | Tied to agency/host ops |
| Rocket / room target | Yes; **payouts often dark** | Public status + battles |
| Payroll / host salary | Tracking; **payouts staged** | Live creator economy |
| Daily login | Currency claim | Full event calendar |
| Games tab | Thin, mostly local | In-room economy games |
| Discovery / match | Weak | Lucky bag / match / mask |
| Families / clans | No | Belonging + wars |
| Watch-together | Music only (gated) | Co-watch video |
| Admin push | New | Ops, not product loop |

---

## Wave map

```text
Wave 0  Foundations & enablement gates
Wave 1  Stranger acquisition (match / lucky bag / room fill)
Wave 2  Platform status (VIP + wealth/charm boards)
Wave 3  Room PK / gift battles
Wave 4  Host & agency live payouts
Wave 5  In-room party games + coin loop
Wave 6  Gift theater (combo, lucky, magic)
Wave 7  Families / tribes
Wave 8  Events calendar & missions
Wave 9  Watch-together
Wave 10 Optional soft 1:1 match (Hilo skew)
```

Waves 1–3 are **survival**. Waves 4–6 are **ARPU**. Waves 7–9 are
**retention**. Wave 10 is **optional expansion**.

---

## Wave 0 — Foundations and enablement

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE0.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE0.md).

**Goal.** Make existing dark systems operable so later waves build on live
primitives, not mocks.

### Scope

- Inventory and document current flags under `socialFeatures`,
  `voiceRoomFeatures`, `cosmeticsFeatures`, and incentive rollout docs.
- Define a single **growth rollout stage** doc on `appConfig` (or extend the
  incentives/cosmetics stage pattern) with ordered enablement:
  `dark → closed-beta → public-partial → public`.
- Finish safe enablement checklists for:
  - gift presentation tiers already in cosmetics waves;
  - rocket / room-target **display** (payouts stay Wave 4);
  - push notifications (required for match and PK alerts);
  - shared music fail path (needed before Wave 9).
- Add growth telemetry counters: room join empty rate, gift GMV, VIP conversion,
  match→room conversion (stubs OK if flags dark).
- Admin: read-only “Growth health” KPIs on overview (reuse existing overview
  patterns).

### Exit criteria

- Flag matrix published; no wave depends on an undocumented switch.
- Closed-beta can enable push + room gifts + supporter rankings without
  enabling PK/VIP.
- Rollback: stage → `dark` restores prior behavior within one config write.

### Out of scope

New user-facing acquisition UX (Wave 1).

---

## Wave 1 — Stranger acquisition

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE1.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE1.md).

**Goal.** Put strangers into live rooms without needing a public ID.

### Product

- **Quick Match:** one tap → join an eligible public room (language/country
  preference, min seats free, not full, not locked, not staff-lockdown).
- **Lucky Bag (soft):** limited daily free coin/cosmetic crumb or room invite
  from “platform”; never paid-odds gambling copy.
- **Room Fill Assist:** empty public rooms with an active host are prioritized
  in match.
- Optional **Masked icebreak** in match queue only: temporary display mask until
  user reveals (no fake accounts).

### Technical sketch

- `appConfig/growthFeatures.quickMatch`, `.luckyBag`, `.maskedMatch`
  (reserved under growth rollout; not `socialFeatures`).
- Callable `socialCommand`: `quick-match`, `claim-lucky-bag`.
- Matching is server-authoritative; client never picks arbitrary room IDs from a
  raw list for match.
- Rate limits + abuse caps; own rooms / lockdown / private excluded.
- Deep link from push: `Rooms` or direct `VoiceRoom` (ops follow-up).

### Exit criteria

- Closed-beta: ≥X% of new sessions that tap Match land in a room with ≥1 other
  participant within 30s (define X in rollout doc).
- Empty-room join rate drops vs baseline.
- Flags off → Match UI hidden; app otherwise unchanged.

### Depends on

Wave 0 push + room join policy.

---

## Wave 2 — Platform status ladder

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE2.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE2.md).

**Goal.** Make spending and presence **publicly ranked** so the store has a
reason to exist beyond cosmetics browsing.

### Product

- **Wealth board** (spend/gift sent) and **Charm board** (gifts received),
  windows: daily / weekly / all-time; scopes: global + country.
- Profile + seat badges for top ranks (reuse badge/nameplate cosmetics where
  possible).
- **VIP / nobility tiers** purchased or unlocked by cumulative recharge:
  visible frame accent, entry toast, ranking boost *display only* (no moderation
  bypass).
- Home or Me entry: “المتصدرون”.

### Technical sketch

- `appConfig/growthFeatures.leaderboards`, `.vipTiers`
- Projections from gift events (not a second ledger); snapshots
  `leaderboards/{kind}_{window}_{scope}`
- Scheduled refresh every 5 minutes + on-read rematerialize when stale
- Admin: seed VIP catalog script; emergency freeze via
  `appRuntime/growthLeaderboards.frozen`

### Exit criteria

- Boards update within agreed lag (e.g. ≤5 minutes).
- VIP purchase appears on profile/seat without client trust.
- Rollback: flags off hides boards/VIP; historical snapshots retained.

### Depends on

Wave 0; gift + wallet ledgers stable.

---

## Wave 3 — Room PK / gift battles

**Status:** implemented (in-room teams) — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE3.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE3.md).

**Goal.** Create the peak spend ritual peers use.

### Product

- Host starts a **timed PK** (room vs room, or red/blue teams in one room).
- Gift value contributes to team score; live scoreboard; winner banner.
- Optional reward: cosmetic crumb, room badge, or ranking points (no cash).
- Cross-room PK: two rooms linked for the battle window.

### Technical sketch

- `appConfig/growthFeatures.roomPk` (+ `crossRoomPk` reserved/stub)
- `roomPkSessions/{pkId}` + `rooms/{roomId}.activePkSessionId`
- HTTP `roomPkCommand` (mirror room games); gift pipeline post-commit score hook
- Scheduler finalize + flag-off force finalize
- Push start/end deferred in V1

### Exit criteria

- PK completes with correct totals matching gift ledger sums.
- Disconnect / room close ends or forfeits deterministically.
- Flag off: host UI hidden; in-flight sessions force-finalize safely.

### Depends on

Waves 0–2 (status makes PK outcomes matter).

---

## Wave 4 — Host and agency live loop

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE4.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE4.md).

**Goal.** Supply-side creators earn for filling rooms.

### Product

- Enable **payroll payouts** and **room-target / rocket payouts** under the
  existing staged incentive architecture (exit `report-only` where policy
  allows).
- Agency light: owner/representative can recruit hosts, see target progress,
  and receive ops push (reuse admin/rep surfaces where possible).
- Host Me card: salary progress + next payout estimate (already partial).

### Technical sketch

- Prefer completing current incentive wave docs over new collections.
- Harden payout idempotency, holds, and admin reversal.
- Flags already exist (`payrollPayouts`, `rocketRewards`,
  `ownerTargetPayouts`) — this wave is **enablement + agency UX**, not greenfield.

### Exit criteria

- At least one closed-beta cohort receives a correct weekly settlement.
- Admin can hold/reverse; ledger balanced.
- Rollback: payout flags off; tracking remains.

### Depends on

Wave 0; existing incentives Wave 10 baseline.

---

## Wave 5 — In-room party games + economy

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE5.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE5.md).

**Goal.** Keep rooms warm between gift spikes.

### Product

- Promote **in-room** Carrom / Ludo / UNO-class tables (start with one new or
  deepen Carrom) with mic still on.
- Optional **coin entry** (small) with cosmetic or coin-pool prize capped and
  disclosed as entertainment, not gambling.
- Games tab surfaces “play in a room” CTA → Match or current room.

### Technical sketch

- Extend `voice_room_games`; authoritative match state server-side.
- Economy entries go through wallet ledger; no client-trusted balances.
- Spectator mode for non-players in the room.

### Exit criteria

- One production game completable in-room with voice.
- Entry fee + payout reconcile to ledger; abuse caps work.
- Flag off disables entry fees and new tables.

### Depends on

Wave 1 (fill) helpful but not hard-required; Wave 0 games flag.

---

## Wave 6 — Gift theater

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE6.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE6.md).

**Goal.** Make gifts feel like a show.

### Product

- Combo banners (same gift streak), full-room storms, lucky gift (random cosmetic
  crumb from a published table — odds shown; no real-money prize framing).
- “Magic gift” v1: user-selected approved photo frame template (not freeform
  UGC video until moderation capacity exists).
- Catalog tags in store/gift admin for theater tier.

### Technical sketch

- Build on cosmetics gift presentation + room effect queue caps.
- Server rolls lucky outcomes; client only animates.
- Flags: `giftCombos`, `luckyGifts`, `magicGiftTemplates`.

### Exit criteria

- Effect queue never exceeds existing caps under storm spam.
- Lucky rolls auditably seeded/idempotent per send requestId.
- Flag off falls back to current static/tier presentations.

### Depends on

Cosmetics gift presentation waves; Wave 3 benefits from theater.

---

## Wave 7 — Families / tribes

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE7.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE7.md).

**Goal.** Mid-term belonging beyond couples.

### Product

- Create/join family (size cap), family badge on profile/seat, family chat light
  or family room shortcut.
- Weekly family charm/wealth aggregate on boards (Wave 2 extension).
- Optional family war (simplified PK between families) — only if Wave 3 stable.

### Technical sketch

- `families/{familyId}`, membership docs, role owner/elder/member.
- Fail-closed `growthFeatures.families` (not `socialFeatures`).
- Blocks and bans still apply; family cannot bypass DM rules.

### Exit criteria

- Join/leave/kick deterministic; badge projects to public profile.
- Flag off hides family UX; data retained.

### Depends on

Wave 2; Wave 3 optional for wars.

---

## Wave 8 — Events calendar and missions

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE8.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE8.md).

**Goal.** Replace “only daily login” with always-on ops.

### Product

- Home **Events** strip: daily missions (send N gifts, stay M minutes, win a
  game), weekly theme, limited-time board boosts.
- Admin event publisher (title, window, reward table, audience).
- Push hooks via existing admin push + automated event reminders.

### Technical sketch

- `opsEvents/{eventId}`, `userMissionProgress/{uid}`.
- Rewards through existing grant/ledger paths only.
- Flags: `opsEvents`, `dailyMissions`.

### Exit criteria

- Mission progress survives reconnect; claim idempotent.
- Expired events stop grants.
- Rollback via flags.

### Depends on

Waves 1–2; admin push helpful.

---

## Wave 9 — Watch-together

**Status:** implemented — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE9.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE9.md).

**Goal.** Salam-style shared living-room media.

### Product

- Host starts a **watch session** (approved stream URL or platform catalog).
- Synchronized play/pause/seek within tolerance; voice continues.
- Respect DRM: no arbitrary device-file pirate sources (align with existing
  music feasibility constraints).

### Technical sketch

- Extend shared-music lease pattern (server clock); not LiveKit data sync for V1.
- Flag `growthFeatures.watchTogether` (not `voice_room_watchTogether`).
- Reuse shared-music permissions patterns (host/DJ).

### Exit criteria

- Two clients stay within sync tolerance; late joiners catch up.
- Flag off removes host control; active sessions end cleanly.

### Depends on

Wave 0 media baseline; not blocking ARPU waves.

---

## Wave 10 — Optional soft 1:1 match (Hilo skew)

**Status:** implemented (voice-only soft lobby) — see [`COMPETITIVE_SOCIAL_GROWTH_WAVE10.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE10.md).

**Goal.** Only if product explicitly wants dating-adjacent funnel.

### Product

- Like/Next card queue or random voice/video lobby with strong safety:
  reports, blur, face checks if video, gender prefs, paid unlocks optional.
- Must not weaken blocks or age/safety policy.

### Exit criteria

- Safety review signed off; feature remains independently killable.
- If skipped, plan closes at Wave 9 with no debt.

### Depends on

Waves 1 + moderation maturity. **Explicit go/no-go gate.**

### V1 shipped notes

- Go taken as voice-only peer lobby (not video / not dating cards).
- Flag `softOneToOneMatch` on from closed-beta+; independently killable.
- Safety review marketing sign-off still required before promoting the CTA broadly.

---

## Cross-cutting requirements (every wave)

- **Flags:** fail-closed; documented in wave exit + admin Settings.
- **AuthZ:** no VIP/family/PK bypass of blocks, bans, or DM request rules.
- **Ledgers:** every coin/diamond move is immutable and reversible by admin
  policy already used for reps/store.
- **Push:** new kinds register in notification preferences where user-facing.
- **Admin:** audit `requestId` idempotency; reason required for catalog/VIP
  mutations.
- **Tests:** core unit + service tests; rules tests for any new client-readable
  paths (prefer Admin SDK–only).
- **Rollout:** closed-beta UIDs → country cohort → public; rollback stage.
- **Telemetry:** conversion funnels listed in each wave exit.

---

## Suggested sequencing and staffing bias

| Phase | Waves | Focus |
|-------|-------|--------|
| Now | 0 → 1 → 2 | Fill rooms + status |
| Next | 3 → 4 | Spend spikes + host supply |
| Then | 5 → 6 | Retention between spikes + spectacle |
| Later | 7 → 8 → 9 | Belonging + ops + co-watch |
| Optional | 10 | Hilo video/match skew |

Do **not** start families or watch-together before Match + VIP boards
+ PK are live in closed beta. Wave 10 soft voice lobby may ship after Wave 1
+ moderation maturity (implemented; remain independently killable).

---

## Explicit non-goals

- Real-money wagering, sportsbook, or concealed RNG cashouts.
- Replacing voice rooms with TikTok-style feed-first video.
- End-to-end encrypted DMs or staff browsing private chats without reports.
- Rebuilding wallet/gift/store from scratch.
- Broadcast-to-all-users marketing spam without audience controls (use admin
  push audiences).

---

## Open decisions (resolve before later waves)

1. ~~Quick Match geography~~ → locked (Wave 1).
2. ~~VIP~~ → locked (Wave 2): recharge unlock.
3. ~~PK rewards~~ → locked (Wave 3 V1): scoreboard only; no cash/coin pool.
4. Lucky gifts: cosmetic-only prize table (recommended) vs coin recirculation.
5. ~~Wave 10 go/no-go~~ → locked go as **voice-only soft lobby** (Wave 10 doc);
   video/dating cards remain out of scope.

Waves 0–3 may ship without resolving 4–5. Cross-room PK remains a later flag.
