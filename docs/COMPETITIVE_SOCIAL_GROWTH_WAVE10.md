# Competitive Social Growth — Wave 10

Status: **implemented locally** (optional soft voice 1:1 lobby; safety-first; independently killable).

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md).

## Locked product decisions (Wave 10)

33. **Go:** ship a voice-only peer lobby beside Wave 1 Quick Match (room fill).
34. Framing is party icebreak (“محادثة صوتية سريعة” / Home **صوت سريع**) — not dating / Like-Next cards.
35. Flag is **`growthFeatures.softOneToOneMatch`**; enabled from closed-beta+; still killable alone.
36. **Voice only** — no video, blur, or face checks in V1.
37. Blocks + `moderationStatus === 'active'` are absolute; VIP cannot bypass.
38. Optional `preferGender` filter only; never invent gender; missing gender is ineligible for a set preference.
39. Reports reuse in-room `report-content` once both peers join the private soft-match room.
40. Paid unlocks deferred.

## What shipped

| Piece | Location |
|-------|----------|
| Core (prefs, pick, room builder) | `functions/softOneToOneMatchCore.js` |
| Enqueue / cancel / status + private room pair | `functions/softOneToOneMatchService.js` |
| `socialCommand` actions | `soft-match-enqueue`, `soft-match-cancel`, `soft-match-status` |
| Stage enable from closed-beta | `functions/growthRolloutCore.js` |
| Telemetry | `softMatchAttempts`, `softMatchPaired` (+ admin overview pair rate) |
| Admin-SDK-only paths + index | `firestore.rules`, `firestore.indexes.json` |
| Cleanup schedule | `cleanupSoftMatch` every 5m (`expireSoftMatchQueueAndSessions` + purge) |
| Home + Games CTA | `HomeScreen.tsx`, `GamesScreen.tsx` (**صوت سريع**) |
| Client API | `src/social/requestSocialCommand.ts` |

## Flag matrix

| Flag | dark | closed-beta | public-partial | public |
|------|------|-------------|----------------|--------|
| `softOneToOneMatch` | false | true | true | true |
| `crossRoomPk` | false | false | false | false |

Emergency kill (no stage rollback):

```bash
# Set softOneToOneMatch: false on appConfig/growthFeatures
# Or stage → dark
node functions/scripts/setGrowthRolloutStage.js --stage dark --actor-uid OWNER_UID --apply
```

Flag off only blocks **new** enqueue/status/cancel commands (`FEATURE_DISABLED`).
It does **not** auto-drain waiting tickets or force-close active soft-match rooms on the command path;
waiting tickets expire by queue TTL (3 min), sessions by session TTL (30 min).
The scheduled job `cleanupSoftMatch` (every 5 minutes) marks expired waiting tickets / sessions,
closes soft-match rooms for expired sessions, and deletes records after a 24h `purgeAfterMs` retention.
Stage → `dark` still forces the flag false.

## Deploy checklist (closed-beta)

1. **Indexes** — deploy `firestore.indexes.json` (softMatchQueue `status+expiresAtMs`, softMatchSessions `status+expiresAtMs`, purgeAfterMs on queue/sessions). Wait until indexes are `READY`.
2. **Rules** — deploy `firestore.rules` (Admin-SDK-only softMatch* paths; deny client member **create** when `room.softMatch == true`).
3. **Functions** — deploy Cloud Functions including `socialCommand` soft-match actions and scheduled `cleanupSoftMatch`.
4. **Rollout** — stage ≥ closed-beta so `softOneToOneMatch` is true, or set the flag explicitly on `appConfig/growthFeatures`.
5. **Smoke** — two accounts enqueue → private soft-match room; flag off → Home hides CTA / `FEATURE_DISABLED`; admin overview shows soft-match pair rate (may be 0 until traffic).
6. **Kill** — set `softOneToOneMatch: false` or stage → `dark` (does not force-drain live rooms; TTL + cleanup job handle leftovers).

## Contracts

### `soft-match-enqueue`

- Payload optional: `{ preferGender?: 'male' | 'female' }`
- Result:
  - `{ status: 'waiting', expiresAtMs, preferGender }`
  - `{ status: 'matched', roomId, sessionId, inviteCode, peerLabelAr, sessionExpiresAtMs }`
- Fail-closed on flag; rate **15 / 10 min**; queue TTL **3 min**; session TTL **30 min**
- Candidate query: `status == waiting` **and** `expiresAtMs > now` (expired tickets cannot starve the window)
- Idempotent on `requestId` → `softMatchRequests/{requestId}`
- On pair: creates private `rooms/{roomId}` with `softMatch: true`, both members pre-seeded (host = finder, speaker = waiting peer); `seatMode: 'locked'`; `participantCount: 2`
- Pair commit re-checks bidirectional blocks + peer `moderationStatus` inside the transaction
- Live waiting/matched replay skips rate limiting
- Client member **create** on soft-match rooms is denied in rules (pre-seeded peers refresh/join only)
- Concurrent enqueue recovers live `matched`/`waiting` tickets instead of clobbering them
- Client joins via `joinRoom` (members exist) or `joinPrivateRoom` + invite fallback
- Home poll: single-flight join; leaving Home while waiting cancels the queue ticket
- Flag kill / `FEATURE_DISABLED` clears Home soft-match UI; cancel stays available while `isSoftMatching`

### `soft-match-cancel` / `soft-match-status`

- Cancel drains **waiting** tickets only (does not force-close an active room)
- Status returns idle / waiting / matched for the caller’s queue doc

## Safety checklist (V1)

- [x] Flag fail-closed on all entrypoints
- [x] Bidirectional block exclusion before pair
- [x] Suspended/removed profiles denied
- [x] Server-authoritative pairing (client cannot pick peer UID)
- [x] Voice-only private room; no camera path
- [x] Non-dating Arabic copy on Home + room title/welcome
- [x] In-room report/block available after join (existing room chat safety)
- [ ] Product/safety review sign-off before broad public marketing of the CTA

## Exit criteria

- Soft-match UI hidden when flag off; Quick Match unchanged.
- Flag off → `FEATURE_DISABLED` on soft-match commands; no new queue tickets.
  Existing rooms/tickets are not force-drained (TTL / leave). Stage→dark forces flag false.
- Telemetry: `softMatchPairRate` = paired / attempts (health summary).

## Out of scope

- Video lobby / face checks / blur
- Like/Next card stack
- Paid unlocks / gender paywalls
- Cross-room PK (`crossRoomPk` stays dark)
