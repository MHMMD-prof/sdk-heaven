# Cross-room PK Wave 0 Product Contract

Status: implemented locally; feature remains disabled

Version: `cross-room-pk-wave0-1`

Completed: 2026-08-13

Parent plan: [CROSS_ROOM_PK_PRODUCTION_PLAN.md](CROSS_ROOM_PK_PRODUCTION_PLAN.md)

Executable contract: [`functions/crossRoomPkContract.js`](../functions/crossRoomPkContract.js)

Contract tests: [`functions/crossRoomPkContract.test.mjs`](../functions/crossRoomPkContract.test.mjs)

## Wave boundary

Wave 0 freezes compatibility and product behavior before any service, rules,
index, scheduled-function, client, notification, admin, or feature-flag change.
It creates no production data, makes no external call, and does not enable
`crossRoomPk`.

Wave 1 must consume this contract. A change to authority, scoring, surrender,
rollback, retention, error semantics, or the V1/V2 discriminator requires a
contract revision and test update before implementation.

## Locked product decisions

- A challenge is room-to-room and starts only after the current target owner or
  host accepts it.
- The current owner or host may challenge, accept, decline, cancel, or surrender
  for their room. Moderators cannot do so in V1.
- The red side is always the challenger room; the blue side is always the
  opponent room. `roomId` remains a compatibility alias for `redRoomId`.
- Every active member belongs to their room's side automatically. Cross-room PK
  has no team-join action.
- Only committed room gifts inside `[startedAt, endsAt]` score. The authoritative
  score contribution is `priceCoins`; quantity is not applied again.
- The parent V2 session never stores member UID, gift event ID, or distinct
  gifter UID arrays. Live values come from 16 shards per side; terminal values
  are written only after committed-gift reconciliation.
- Natural expiry enters `settling` for a 15-second ingestion grace, then becomes
  `ended` or `void`. The client cannot announce a winner during settlement.
- Surrender, room closure, room removal, or staff lockdown forfeits the affected
  room. Simultaneous invalidation is `void`.
- Turning off `crossRoomPk` cancels pending challenges and settles active
  cross-room sessions while preserving in-room PK. Turning off `roomPk`
  terminates both modes.
- V1 awards no currency, inventory, multiplier, rank, family, or status benefit.
  VIP, SVIP, and Aristocracy cannot alter eligibility, scoring, limits, blocks,
  moderation, or outcomes.

## Compatibility contract

| Concern | In-room PK | Cross-room PK |
|---|---|---|
| Session discriminator | `schemaVersion: 1`, mode absent or `in-room-teams` | `schemaVersion: 2`, `mode: cross-room` |
| Room identity | `roomId` | `redRoomId`, `blueRoomId`, ordered `roomIds`; `roomId == redRoomId` alias |
| Authority snapshot | `hostUid` | `createdByUid`, `acceptedByUid`, per-side `authorityUid` |
| Team membership | `teams.*.memberUids` | Derived from gift event room; no member arrays |
| Live score | Existing parent team scores | Sum of 16 immutable shards per side |
| Idempotency | Existing event/fact behavior | Fact document per gift event plus side-specific gifter markers |
| Distinct gifters | UID array | Bounded counts and marker documents |
| Ending | Existing `ended`/`void` behavior | `settling`, verified `ended`/`void`, or immediate `forfeited` |
| Client read | Existing room membership | Active membership in red or blue room; rules work lands in Wave 3 |

Fail-closed classification rules:

1. V1 is accepted only when `schemaVersion == 1` and the mode is not
   `cross-room`.
2. V2 is accepted only when `schemaVersion == 2`, mode is `cross-room`, both
   room IDs are distinct and correctly ordered, and `roomId == redRoomId`.
3. V2 must use exactly 16 shards, exact duration/timestamp relationships, valid
   status/winner combinations, and no unbounded V1 arrays.
4. Mixed, unknown, or malformed schema/mode combinations are invalid; they are
   never guessed into a compatible shape.

Canonical fixtures live in `functions/fixtures/crossRoomPk/`:

- `v1-in-room-session.json`
- `v1-pending-challenge.json`
- `v2-cross-room-session.json`

## State machines

Challenge transitions:

```text
pending -> accepted | declined | cancelled | expired
```

Every same-state retry is idempotent. No terminal state can return to pending
or transition to a different terminal state.

Session transitions:

```text
active -> settling -> ended | void
active -> forfeited | void
```

Every same-state retry is idempotent. `forfeited`, `ended`, and `void` are
terminal. A normal score cannot override a forfeit. Operational termination
enters `settling` and uses committed gifts when the source remains available.

## API actions and authority

| Action | Read/mutation | Authority |
|---|---|---|
| `list-cross-room-pk-opponents` | Read | Current owner/host |
| `challenge-cross-room-pk` | Mutation | Challenger current owner/host |
| `get-room-pk-challenge-status` | Read | Active member of either room |
| `accept-cross-room-pk` | Mutation | Opponent current owner/host |
| `decline-cross-room-pk` | Mutation | Opponent current owner/host |
| `cancel-cross-room-pk` | Mutation | Challenger current owner/host |
| `surrender-cross-room-pk` | Mutation | Current owner/host of that side |
| `get-room-pk-status` | Existing read | Active member of either room for V2 |

All mutations require authentication, App Check, a valid request ID, replay
fingerprinting, room-scoped limits, and revalidation inside the authoritative
transaction. Client-provided scores, winner, side, authority, or snapshots are
never trusted.

## Error contract

The server retains `{ ok, status, error: { code, message } }`. The client maps
the stable code to the frozen Arabic copy below and never displays backend
English text directly.

| Code | HTTP | Arabic copy |
|---|---:|---|
| `INVALID_REQUEST` | 400 | بيانات طلب التحدي غير صالحة. |
| `FEATURE_DISABLED` | 503 | تحدي الغرف غير متاح حالياً. |
| `ROOM_NOT_ACTIVE` | 409 | إحدى الغرف لم تعد نشطة. |
| `ROOM_NOT_ELIGIBLE` | 409 | لا يمكن بدء التحدي بين هاتين الغرفتين الآن. |
| `SAME_ROOM_FORBIDDEN` | 400 | لا يمكنك تحدي غرفتك نفسها. |
| `MEMBERSHIP_REQUIRED` | 403 | يجب أن تكون عضواً نشطاً في الغرفة. |
| `FORBIDDEN` | 403 | هذا الإجراء متاح لمالك الغرفة أو مضيفها فقط. |
| `BLOCKED_RELATIONSHIP` | 403 | لا يمكن إنشاء تحدٍ بين هاتين الغرفتين. |
| `CHALLENGE_NOT_FOUND` | 404 | لم يعد هذا التحدي متاحاً. |
| `CHALLENGE_NOT_PENDING` | 409 | تم الرد على هذا التحدي بالفعل. |
| `CHALLENGE_EXPIRED` | 409 | انتهت مهلة قبول التحدي. |
| `ROOM_ALREADY_RESERVED` | 409 | إحدى الغرف مرتبطة بتحدٍ آخر حالياً. |
| `SESSION_ALREADY_ACTIVE` | 409 | إحدى الغرف تشارك في تحدٍ مباشر حالياً. |
| `COOLDOWN_ACTIVE` | 409 | يجب الانتظار قليلاً قبل بدء تحدٍ جديد. |
| `SESSION_NOT_ACTIVE` | 409 | انتهى هذا التحدي أو لم يعد نشطاً. |
| `REQUEST_ID_CONFLICT` | 409 | تعذر إعادة الطلب لأن بياناته تغيّرت. |
| `RATE_LIMITED` | 429 | تم تجاوز حد المحاولات. حاول لاحقاً. |

Opponent discovery silently omits ineligible rooms. It does not reveal whether
privacy, blocks, moderation, cooldown, client version, or another activity made
a room ineligible.

## Arabic UI copy

| Stable key | Copy |
|---|---|
| `actionChallenge` | تحدي غرفة أخرى |
| `incomingChallengeTitle` | تحدٍ جديد بين الغرف |
| `waitingForOpponent` | بانتظار رد الغرفة الأخرى… |
| `actionAccept` | قبول التحدي |
| `actionDecline` | رفض |
| `actionCancel` | إلغاء التحدي |
| `actionSurrender` | انسحاب |
| `surrenderConfirmation` | سيُحتسب الانسحاب فوزاً للغرفة المنافسة. هل تريد المتابعة؟ |
| `settling` | جارٍ اعتماد النتيجة… |
| `resultWin` | فازت غرفتك! |
| `resultLoss` | فازت الغرفة المنافسة. |
| `resultDraw` | انتهى التحدي بالتعادل. |
| `resultVoid` | لم تُحتسب نتيجة التحدي. |
| `resultForfeitWin` | فازت غرفتك بالانسحاب. |
| `resultForfeitLoss` | خسرت غرفتك بالانسحاب. |
| `challengeDeclined` | رفضت الغرفة الأخرى التحدي. |
| `challengeCancelled` | تم إلغاء التحدي. |
| `challengeExpired` | انتهت مهلة التحدي. |
| `yourRoom` | غرفتك |
| `scoreLabel` | النقاط |

Wave 4 must verify this Arabic-first copy under RTL, supported font scaling,
screen reader, reduced motion, and narrow Android layouts before release.

## Timing, retention, and load constants

| Contract | Value |
|---|---:|
| Challenge TTL | 60 seconds |
| Pending cleanup cadence | 60 seconds |
| Default duration | 3 minutes |
| Allowed duration | 1–10 minutes |
| Score ingestion grace | 15 seconds |
| Reconciliation lease | 60 seconds |
| Reconciliation page | 100 events |
| Maximum reconciliation scan | 50,000 events per room |
| Score shards | 16 per side |
| Recent result pointer | 2 minutes |
| Room cooldown | 2 minutes |
| Repeat-opponent cooldown | 10 minutes |
| Outgoing room limit | 5 challenges per 10 minutes |
| Opponent page | At most 20 sanitized rooms |
| Command retention | 24 hours |
| Challenge/session/shard/fact/marker/reconciliation retention | 7 days |

Every retained document receives `purgeAfter`. TTL cleanup is eventual and is
never used as the correctness mechanism; commands and scheduled cleanup still
resolve expired state and clear matching pointers conditionally.

## Telemetry contract

Event and metric names are snake case and start with `cross_room_pk_`:

- `candidate_search`
- `challenge_created`, `challenge_accepted`, `challenge_declined`,
  `challenge_cancelled`, `challenge_expired`
- `session_started`, `session_completed`, `session_voided`,
  `session_forfeited`
- `gift_gmv_coins`, `gift_scored`, `gift_duplicate_ignored`
- `projection_delay_ms`
- `reconciliation_drift_count`, `reconciliation_drift_coins`
- `finalizer_latency_ms`, `settling_stuck`
- `command_denied`
- `push_queued`, `push_delivered`, `push_failed`, `push_opened`

Allowed bounded dimensions are `appVersion`, `challengeStatus`, `countryPair`,
`denialCode`, `endReason`, `platform`, `rolloutStage`, `sessionStatus`, and
`winner`. Raw UID, room ID, challenge ID, PK ID, request ID, room title, and
error message are forbidden as metric dimensions. Those identifiers belong in
restricted structured logs and audit records with the existing retention and
access controls.

## Wave 0 verification

The executable tests prove:

- the current V1 in-room fixture remains readable without V2 fields;
- valid V1 challenge and V2 session fixtures map deterministically;
- mixed schemas, reversed sides, wrong alias, wrong shard count, invalid timing,
  and V1 arrays in V2 fail closed;
- challenge and session transition tables are immutable and idempotent;
- surrender, dual invalidation, and operational rollback outcomes are fixed;
- every error has stable HTTP status and Arabic copy; and
- action, retention, limit, timing, UI copy, and telemetry constants are frozen.

No service mutation or feature enablement belongs to Wave 0.
