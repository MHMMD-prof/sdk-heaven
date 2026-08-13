# Cross-Room PK — Production Plan

Status: **Waves 0-3 implemented locally; feature remains dark**

Parent plan: [`COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE_PLAN.md)

Existing in-room implementation: [`COMPETITIVE_SOCIAL_GROWTH_WAVE3.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE3.md)

This document plans a production-safe room-versus-room gift battle on top of
Heaven's existing in-room PK, room gift ledger, voice-room authority model,
push stack, growth rollout flags, and administrator observability. It does not
enable a feature flag, deploy Firebase resources, mutate production data, or
change the existing in-room PK contract by itself.

Before implementing any Expo-facing notification or linking changes, use the
exact SDK 56 documentation:

- Expo SDK 56 reference: <https://docs.expo.dev/versions/v56.0.0/>
- Expo SDK 56 Notifications: <https://docs.expo.dev/versions/v56.0.0/sdk/notifications/>
- Expo SDK 56 Linking: <https://docs.expo.dev/versions/v56.0.0/sdk/linking/>

---

## 1. Objective

Allow the authorized host of one active public voice room to challenge another
active public voice room to a timed gift battle. Both rooms remain separate
LiveKit rooms. Gifts committed in each room increase that room's score, while
both audiences observe the same authoritative countdown, live score, and final
result.

The implementation must preserve the properties of the current PK system:

- server-authoritative commands and scoring;
- committed gift ledger value as the only score source;
- idempotent request and gift processing;
- deterministic finalization;
- fail-closed feature flags;
- no VIP, SVIP, Aristocracy, family, or moderator bypass of safety rules;
- clean rollback without damaging gift, wallet, or room history.

## 2. Success definition

Cross-room PK is production-ready only when all of the following are true:

1. A host can challenge an eligible room and the target host can accept or
   decline without leaving their room.
2. Acceptance atomically reserves both rooms and starts exactly one shared PK
   session.
3. Every qualifying committed room gift is attributed to the correct room side
   exactly once.
4. The final score reconciles exactly with committed gift events for the
   session window, even if a live projection is delayed or retried.
5. Expiry, surrender, room closure, moderation lockdown, reconnect, duplicate
   requests, and feature rollback all resolve deterministically.
6. Members of either participating room can read the shared session; outsiders
   cannot read private PK state and no client can write authoritative state.
7. Existing in-room PK remains backward-compatible and independently usable.
8. Physical-device acceptance passes in two simultaneously active rooms.

---

## 3. Existing baseline to extend

| Capability | Current implementation | Cross-room work |
|---|---|---|
| PK command endpoint | `functions/roomPkService.js` through `roomPkCommand` | Extend actions and two-room transactions |
| PK contract/core | `functions/roomPkCore.js` | Add challenge, room-side, surrender, and V2 session contracts |
| Room pointer | `rooms/{roomId}.activePkSessionId` | Point both rooms to the same session |
| Gift scoring | Best-effort post-commit `applyRoomPkGiftContribution` | Add durable projection and authoritative final reconciliation |
| Gift idempotency | `roomPkGiftFacts/{eventId}` plus session event arrays | Keep fact documents; retire unbounded event arrays |
| Finalization | Scheduled expiry and flag-off finalizer | Clear both rooms and support surrender/forfeit/settling |
| Client subscription | `useRoomPkSession` follows the room pointer | Reuse pointer; map V1 and V2 sessions |
| Scoreboard | `RoomPkScoreboardCard` | Add room-vs-room presentation variant |
| Feature flags | `roomPk`, reserved `crossRoomPk` | Require both; never enable automatically |
| Rules | Session readable through one `roomId` membership | Permit active membership in either participating room |

The current code appends every gift event ID and distinct gifter UID to arrays
inside the session document. Cross-room PK increases traffic and contention, so
those unbounded arrays must not be the production idempotency mechanism. Gift
facts and bounded counters become authoritative instead.

---

## 4. Locked V1 product decisions

These decisions remove ambiguity from implementation and testing.

### 4.1 Challenge model

- V1 uses a direct room challenge and explicit target-host acceptance.
- No random opponent matchmaking in V1.
- A challenge targets a room, not a permanently captured user. Acceptance
  re-resolves the room's current owner/host so ownership or host transfer does
  not leave a stale authority path.
- The challenge expires after **60 seconds**.
- A room may participate in at most one pending challenge and one active PK.
- Challenger room is the red side; opponent room is the blue side. This mapping
  is immutable for the session.

### 4.2 Eligible rooms

Both rooms must be:

- different room IDs;
- `status == active` and not removed;
- public and discoverable;
- running the supported voice-room engine/client floor;
- represented by a current active owner or host;
- outside PK cooldown;
- free of another pending challenge or active PK;
- not under staff lockdown;
- not gift-paused;
- not running an active room game or watch-together lease that would compete
  for the primary live-activity surface.

Shared music may continue because it does not replace the PK activity surface.
Private, soft-match, deleted, quarantined, or unsupported legacy rooms are not
eligible in V1.

The server must also exclude a candidate if the two current room authorities
have a bidirectional block or either authority profile is not active. A paid
status can never bypass this exclusion.

### 4.3 Authority

- Current room owner or host may challenge, accept, decline, cancel, or
  surrender for their room.
- A room moderator may not start or accept a cross-room PK in V1.
- A platform moderation action may terminate a session but must record an audit
  reason.
- Client input never selects a winner, score, host UID, or room snapshot.

### 4.4 Battle behavior

- Default duration is **3 minutes**, reusing the current PK clamp of 1–10
  minutes for internal testing.
- The session starts only when the target room accepts.
- Every active member remains on their room's side automatically. Cross-room PK
  has no `join-room-pk-team` step.
- Only a successfully committed room gift contributes.
- Score contribution equals the authoritative gift event's committed
  `priceCoins`. In the existing room-gift contract this value is already the
  full debit for the selected quantity, so PK code must **not multiply it by
  quantity again**.
- Recipient identity does not change the side; the gift event's room decides
  the side.
- Gifts committed before `startedAt` or after `endsAt` do not count.
- Rooms keep separate LiveKit audio. V1 does not relay the opponent room's
  audio, mix tracks, or move members between rooms.

### 4.5 Ending and rewards

- Natural expiry produces the higher-score winner or a draw.
- A host cannot end early while leading and claim a scored victory. The host's
  early-exit action is **surrender**, which awards the opponent a forfeit win.
- Closing, removing, or staff-locking one room causes that room to forfeit.
- If both rooms become invalid in the same termination transaction, the session
  is void.
- Disabling the feature is an operational termination, not a competitive
  surrender: active sessions settle from committed gifts when possible and are
  marked with `feature_flag_off`; ambiguous sessions become void.
- V1 grants no coins, cash, diamonds, inventory, ranking multipliers, or family
  rewards. The result is scoreboard, banner, telemetry, and retained history.

---

## 5. State machines

### 5.1 Challenge states

```text
pending
  ├── accepted  -> creates one active session
  ├── declined
  ├── cancelled -> challenger authority only
  └── expired   -> scheduler or command-path cleanup
```

Terminal challenge documents are immutable except for retention metadata.
Accept, decline, cancel, and expiry must be idempotent.

### 5.2 Session states

```text
active
  ├── endsAt reached -> settling -> ended | void
  ├── red surrenders/closes -> forfeited (blue wins)
  ├── blue surrenders/closes -> forfeited (red wins)
  ├── both rooms invalid -> void
  └── operational kill -> settling -> ended | void
```

`settling` is required because the live scoreboard is a projection. The final
winner must wait for a short ingestion grace and then be recomputed from the
committed gift source of truth. The UI shows “finalizing result” during this
bounded state rather than announcing an unverified winner.

Recommended defaults:

- challenge TTL: 60 seconds;
- score ingestion grace after `endsAt`: 15 seconds;
- pending challenge cleanup cadence: every minute;
- score shard count per session side: 16;
- reconciliation page size: 100 committed gift events;
- reconciliation lease: 60 seconds, renewable by the active worker;
- maximum reconciliation scan: 50,000 events per room, followed by an
  `attention-required` alert instead of a guessed winner;
- recent result pointer lifetime: 2 minutes;
- existing session retention: 7 days;
- existing command retention: 24 hours;
- room cooldown after any terminal PK: 2 minutes.

---

## 6. Firestore data contracts

All authoritative writes are Admin SDK-only.

### 6.1 `roomPkChallenges/{challengeId}`

```ts
type CrossRoomPkChallengeV1 = {
  schemaVersion: 1;
  challengeId: string;
  mode: 'cross-room';
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

  challengerRoomId: string;
  opponentRoomId: string;
  challengerAuthorityUid: string;
  acceptedByUid?: string;

  durationMs: number;
  requestId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  resolvedAt?: Timestamp;
  resolutionReason?: string;
  sessionId?: string;

  // Presentation snapshots only; never authorization sources.
  challengerRoomSnapshot: RoomPkPresentationSnapshot;
  opponentRoomSnapshot: RoomPkPresentationSnapshot;

  purgeAfter: Timestamp;
};
```

Use a deterministic ID derived from challenger room, opponent room, and the
create request ID. Do not use a user-controlled document path.

### 6.2 Room pointers

Each participating room may contain:

```ts
{
  pendingPkChallengeId: string | null;
  activePkSessionId: string | null;
  recentPkSessionId: string | null;
  recentPkExpiresAt: Timestamp | null;
  lastPkEndedAtMs: number;
}
```

The pending pointer is written on both rooms so either room can recover the
challenge after reconnect. It is cleared conditionally only when it still
matches the challenge being resolved. The active pointer follows the same
compare-before-clear rule. Finalization moves the matching active session ID to
`recentPkSessionId` for two minutes before clearing it. This lets connected and
reconnecting clients render the verified terminal result after
`activePkSessionId` is cleared. Starting a new PK clears an older recent-result
pointer; cleanup clears an expired pointer only when it still matches the same
session.

### 6.3 `roomPkSessions/{pkId}` V2

Keep V1 in-room documents readable. Cross-room sessions use schema version 2:

```ts
type CrossRoomPkSessionV2 = {
  schemaVersion: 2;
  pkId: string;
  mode: 'cross-room';
  status: 'active' | 'settling' | 'ended' | 'forfeited' | 'void';

  roomId: string; // challenger/red compatibility alias
  redRoomId: string;
  blueRoomId: string;
  roomIds: [string, string];

  createdByUid: string;
  acceptedByUid: string;
  challengeId: string;

  startedAt: Timestamp;
  startedAtMs: number;
  endsAt: Timestamp;
  endsAtMs: number;
  settleAfter: Timestamp;
  scoringEndsAt?: Timestamp; // early forfeit/operational cutoff; defaults to endsAt
  durationMs: number;

  teams: {
    red: RoomPkSide;
    blue: RoomPkSide;
  };
  scoreShardCount: 16;
  distinctGifterCount: number;

  winner: 'red' | 'blue' | 'draw' | 'void' | null;
  winnerReason: string;
  scoreVerifiedAt?: Timestamp;
  endedAt?: Timestamp;
  endedBy?: string;
  endReason?: string;
  purgeAfter: Timestamp;
};

type RoomPkSide = {
  roomId: string;
  roomTitle: string;
  roomImageUrl?: string;
  authorityUid: string;
  // Zero while active; verified terminal values after reconciliation.
  score: number;
  distinctGifterCount: number;
};
```

Do not place member UID lists, all gift event IDs, or all distinct gifter UIDs
in the session document. Cross-room membership is derived from the gift event's
room, and idempotency belongs in fact documents.

While a session is active, the live score is read from its score shards rather
than the parent session. The parent `teams.*.score` fields are the verified
terminal totals and must not be incremented per gift.

### 6.4 Gift event PK context

When a room gift transaction sees an `activePkSessionId`, snapshot only the
minimal server-derived context into the committed gift event:

```ts
{
  pkContext?: {
    pkId: string;
    mode: 'in-room-teams' | 'cross-room';
  };
}
```

This binds the gift to the session active at commit time. The projection still
revalidates the session, room side, and event timestamp; the snapshot is not
trusted when malformed.

### 6.5 Idempotency facts and gifter markers

- `roomPkGiftFacts/{eventId}` remains the one-fact-per-gift idempotency record.
- `roomPkSessions/{pkId}/gifters/{side}_{uid}` records first contribution by a
  gifter without growing the parent session document.
- Both collections are backend-only and expire with the session retention
  policy.

### 6.6 Mandatory score shards

Every schema-V2 session creates 16 deterministic shards per side:

`roomPkSessions/{pkId}/scoreShards/{side}_{00..15}`

```ts
type RoomPkScoreShard = {
  schemaVersion: 1;
  pkId: string;
  side: 'red' | 'blue';
  shard: number;
  score: number;
  giftCount: number;
  distinctGifterCount: number;
  updatedAt: Timestamp;
  purgeAfter: Timestamp;
};
```

Choose the score shard with a stable hash of `eventId` modulo 16. When a gift
creates the side-specific gifter marker for the first time, increment
`distinctGifterCount` on that gift's shard in the same transaction. The live
score is the sum of the 16 shards for the relevant side.

Score sharding is mandatory in V1, not a post-load-test fallback. It avoids a
transactional write hotspot on the parent session while keeping live updates
bounded to 32 small documents. Active members of either room may read score
shards; all clients are denied writes. Final reconciliation writes the verified
aggregate totals to the parent session.

### 6.7 Reconciliation job and markers

`roomPkReconciliations/{pkId}` stores a restart-safe job:

```ts
type RoomPkReconciliation = {
  schemaVersion: 1;
  pkId: string;
  status: 'pending' | 'running' | 'attention-required' | 'complete';
  leaseOwner?: string;
  leaseExpiresAt?: Timestamp;
  red: ReconciliationSideCheckpoint;
  blue: ReconciliationSideCheckpoint;
  scannedEventCount: number;
  failureCode?: string;
  updatedAt: Timestamp;
  purgeAfter: Timestamp;
};

type ReconciliationSideCheckpoint = {
  roomId: string;
  cursorCreatedAt?: Timestamp;
  cursorEventId?: string;
  done: boolean;
  eventCount: number;
  score: number;
  distinctGifterCount: number;
};
```

`roomPkReconciliations/{pkId}/gifters/{side}_{uid}` records unique gifters while
the source events are paged. These markers are reconciliation-owned and are
separate from the low-latency projection markers, so a missed live projection
cannot corrupt the verified distinct-gifter count.

---

## 7. Command API

Extend the existing authenticated, App Check-protected `roomPkCommand` endpoint.
Every mutation requires a valid request ID and retains the existing fingerprint
and replay behavior.

| Action | Required input | Authority | Result |
|---|---|---|---|
| `list-cross-room-pk-opponents` | `roomId`, optional country cursor | Current owner/host | Bounded sanitized eligible-room list |
| `challenge-cross-room-pk` | `roomId`, `opponentRoomId`, `durationMs` | Challenger owner/host | Pending challenge |
| `get-room-pk-challenge-status` | `roomId`, optional `challengeId` | Active room member | Current pending challenge or null |
| `accept-cross-room-pk` | `roomId`, `challengeId` | Opponent owner/host | Shared active session |
| `decline-cross-room-pk` | `roomId`, `challengeId` | Opponent owner/host | Terminal declined challenge |
| `cancel-cross-room-pk` | `roomId`, `challengeId` | Challenger owner/host | Terminal cancelled challenge |
| `surrender-cross-room-pk` | `roomId`, `pkId` | Owner/host of that side | Opponent forfeit win |
| `get-room-pk-status` | Existing input | Active member of either room | V1 or V2 mapped session |

`start-room-pk` remains the in-room action. A cross-room client cannot start a
session directly; only challenge acceptance creates it.

### 7.1 Candidate discovery

Opponent discovery must be server-filtered. Use a bounded active-public-room
query, prefer the current room's country/language, validate every candidate,
return at most 20 sanitized rows, and use a stable cursor. Do not expose invite
codes, private metadata, moderation state, member UIDs, or raw room documents.

### 7.2 Atomic challenge creation and reservation

`challenge-cross-room-pk` reserves both rooms in one Firestore transaction. It
must not create a challenge first and attach room pointers afterward.

The transaction reads before writing:

1. request replay and user/room/opponent-pair rate-limit records;
2. `roomPk`, `crossRoomPk`, required gift flags, and cross-room rollout policy;
3. both room documents and current authority membership/profile records;
4. both rooms' pending and active session pointers;
5. both block directions and cooldown state;
6. any referenced challenge/session required to prove a pointer is stale.

It then revalidates eligibility, creates the deterministic pending challenge,
sets the same `pendingPkChallengeId` on both rooms, and writes replay, rate, and
audit records atomically. Any conflict leaves both rooms unreserved. When a
stale pointer is found, the transaction may repair it only after proving its
referenced record is terminal or missing and only if the pointer value has not
changed.

Required race tests include A→B and C→B challenge creation at the same time,
opposite A→B and B→A creation, replay of the same request, and creation racing
with room closure or an in-room PK start.

### 7.3 Atomic acceptance

Acceptance runs in one Firestore transaction and reads before writing:

1. request replay record and rate-limit record;
2. `roomPk` and `crossRoomPk` flags plus required voice gift flags;
3. the challenge document;
4. both room documents;
5. accepting membership and current authority data for both rooms;
6. both rooms' pending/active pointers;
7. any referenced active session required to repair a stale pointer.

The transaction then:

1. revalidates both rooms and current authorities;
2. verifies challenge status and expiry;
3. verifies both pending pointers still reference the challenge;
4. verifies neither room has a live PK;
5. creates one schema-V2 session;
6. creates all 32 zero-valued score shards with the session's immutable shard
   count and retention deadline;
7. sets the same `activePkSessionId` on both rooms and clears any older
   recent-result pointers;
8. clears both pending pointers;
9. marks the challenge accepted with `sessionId`;
10. writes command replay and audit records.

Any eligibility change rejects acceptance without partially reserving a room.

### 7.4 Error contract

Keep the endpoint's existing `{ ok, status, error: { code, message } }` shape
and add stable machine-readable codes. User-facing clients map codes to Arabic
copy; they do not display backend English messages directly.

| Code | HTTP | Meaning |
|---|---:|---|
| `FEATURE_DISABLED` | 503 | `roomPk` or `crossRoomPk` is off |
| `ROOM_NOT_ACTIVE` | 409 | Either room is unavailable |
| `ROOM_NOT_ELIGIBLE` | 409 | Visibility, lockdown, gifts, activity, or client floor rejects the room |
| `SAME_ROOM_FORBIDDEN` | 400 | Challenger and opponent IDs are identical |
| `MEMBERSHIP_REQUIRED` | 403 | Actor is not an active member of their room |
| `FORBIDDEN` | 403 | Actor is not the current owner/host for this action |
| `BLOCKED_RELATIONSHIP` | 403 | Current room authorities have a block relationship |
| `CHALLENGE_NOT_FOUND` | 404 | Challenge does not exist or is not visible to the actor's room |
| `CHALLENGE_NOT_PENDING` | 409 | Challenge is already terminal |
| `CHALLENGE_EXPIRED` | 409 | Acceptance arrived after `expiresAt` |
| `ROOM_ALREADY_RESERVED` | 409 | Either room has another pending challenge |
| `SESSION_ALREADY_ACTIVE` | 409 | Either room already has a live PK |
| `COOLDOWN_ACTIVE` | 409 | Either room is still in PK cooldown |
| `SESSION_NOT_ACTIVE` | 409 | Surrender/status mutation targets a non-live session |
| `REQUEST_ID_CONFLICT` | 409 | Request ID fingerprint differs from its first use |
| `RATE_LIMITED` | 429 | User, room, or opponent-pair rate limit is exhausted |

For discovery, silently omit ineligible opponents instead of leaking their
moderation, blocking, private-room, or cooldown reason. Mutation commands may
return a generic eligibility code to the authorized actor, while detailed
reasons remain in restricted logs and audit records.

---

## 8. Scoring and settlement architecture

### 8.1 Live projection

The existing post-response fire-and-forget call must not be the only scoring
path. Add cross-room PK projection to the retry-enabled Firestore gift-event
trigger. The trigger receives the committed event, validates `pkContext`, and
calls the idempotent PK projector.

For each qualifying gift, one transaction:

1. reads `roomPkGiftFacts/{eventId}`;
2. reads the referenced session;
3. verifies the event room is exactly `redRoomId` or `blueRoomId`;
4. verifies the committed event time is inside `[startedAt, scoringEndsAt]`,
   where `scoringEndsAt` defaults to the scheduled `endsAt`;
5. reads the side-specific gifter marker;
6. creates the gift fact;
7. creates the marker when this is the gifter's first side contribution;
8. selects `hash(eventId) % 16` for the room side;
9. increments only that deterministic score shard's score/gift count and, for
   a new marker, its distinct-gifter count.

Duplicate delivery returns the existing fact without changing the score.

A best-effort immediate projection may remain for low-latency UI only if the
durable trigger is also present. Both paths must call exactly the same
idempotent service. Gift success must never be rolled back because a PK
projection is temporarily unavailable.

### 8.2 Authoritative final reconciliation

The live score is a projection; the final winner is computed from committed
gift events.

At `endsAt`, move the session to `settling`, create an idempotent
`roomPkReconciliations/{pkId}` job, and wait for the ingestion grace. A bounded
worker then acquires a 60-second renewable lease and processes each room in
pages of at most 100 gift events ordered by `(createdAt, documentId)`.

Each page query may run outside the transaction, but committing it requires one
transaction that re-reads the reconciliation job, proves the same worker still
owns an unexpired lease, and proves the persisted cursor still matches the
page's starting cursor. It deduplicates gifter UIDs within the page, reads their
reconciliation markers before any writes, and then:

1. resumes strictly after the persisted `(cursorCreatedAt, cursorEventId)`;
2. reads committed events bound to the session `pkId` and the relevant room;
3. retains only valid events inside `[startedAt, endsAt]`;
4. sums authoritative `priceCoins` into the side checkpoint;
5. creates reconciliation-owned `{side}_{uid}` gifter markers and increments
   the unique count only on first create;
6. persists score, counts, cursor, scan count, and renewed lease atomically.

If either lease or cursor precondition fails, the page is discarded and read
again from the persisted checkpoint. The worker may therefore be retried or
replaced after lease expiry without restarting the scan or double-counting a
page. It stops after 50,000 scanned events per room.
Hitting the cap, losing required source data, or exceeding the settling retry
budget sets `attention-required`, raises an alert, keeps the session result
unannounced, and requires an audited operator retry after the cause is fixed;
the system must never guess a winner.

When both side checkpoints are complete, one final transaction:

1. sums all live score shards for drift comparison;
2. writes verified side totals/counts, winner, drift metadata, and
   `scoreVerifiedAt` to the parent session;
3. conditionally clears both `activePkSessionId` values;
4. writes the session ID plus two-minute expiry to both rooms'
   `recentPkSessionId`/`recentPkExpiresAt` fields;
5. applies cooldown to both rooms;
6. marks reconciliation complete;
7. emits final telemetry and queues idempotent result notifications.

Final reconciliation changes PK score only. It never replays, reverses, or
creates wallet transactions because the gifts are already settled.

### 8.3 Winner rules

- Normal settlement retains the existing minimum-distinct-gifter anti-farm
  requirement unless product explicitly changes it before implementation.
- Below the threshold: `winner = void`.
- Equal verified totals: `winner = draw`.
- Higher verified total: corresponding room side wins.
- A single-room surrender/closure overrides score and awards the other room a
  forfeit win.
- Simultaneous invalidation or platform-wide emergency termination may produce
  `void`.

### 8.4 Contention gate

V1 always uses the 16-shard-per-side contract above. Load testing selects
whether 16 remains sufficient; it may increase the count only before any
session using that catalog/schema version is created. Required target:

- sustained 20 qualifying gift events/second across both rooms for 3 minutes;
- no lost or duplicated score;
- no exhausted Firestore transaction retries;
- p95 live score projection delay at or below 2 seconds;
- final reconciliation drift equals zero.

If the target fails, increase the versioned shard count or reduce the allowed
gift throughput before beta rather than reverting to a parent-document counter
or raising transaction retries indefinitely.

---

## 9. Lifecycle integration

Cross-room PK must integrate with every room termination path, not only its own
endpoint.

| Event | Pending challenge | Active session |
|---|---|---|
| Challenge TTL | Expire and clear both pointers | N/A |
| Challenger cancels | Cancel and clear both pointers | N/A |
| Opponent declines | Decline and clear both pointers | N/A |
| One room closes/removes | Cancel as ineligible | Closing room forfeits |
| One room enters staff lockdown | Cancel as ineligible | Locked room forfeits; audit reason retained |
| Gifts paused in one room | Reject acceptance | Operationally terminate or forfeit according to actor/reason |
| Host transfers before acceptance | Re-resolve current authority | Session continues; presentation snapshot stays historical |
| Host disconnects | Keep pending until TTL if room remains eligible | Session continues; reconnect restores it |
| Room pointer is stale | Repair conditionally during command | Never clear another session's pointer |
| `crossRoomPk` false | Cancel pending cross-room challenges | Settle/void cross-room sessions; preserve in-room PK |
| `roomPk` false | Cancel all pending PK work | Terminate both PK modes |
| Terminal result | N/A | Move ID to two-minute recent-result pointer on both rooms |

Required integration points include owner room commands, administrator room
closure, room removal finalization, staff lockdown, and the scheduled PK
finalizer. A later scheduler is not an acceptable substitute for immediate
room-closure handling.

---

## 10. Firestore rules and indexes

### 10.1 Rules

`roomPkSessions/{pkId}` reads must be mode-aware:

- in-room V1: preserve active membership check against `resource.data.roomId`;
- cross-room V2: allow an active member of `redRoomId` **or** `blueRoomId`,
  including for the two-minute terminal-result window after either room closes;
  use a dedicated membership helper rather than `canReadPresence`, because that
  existing helper also requires `room.status == active`;
- deny all client creates, updates, and deletes.

`roomPkChallenges/{challengeId}` reads are allowed only to active members of
the challenger or opponent room while the challenge is retained. The client
receives presentation-safe snapshots only. All writes remain denied.

Gift facts, gifter markers, rate limits, reconciliation records, and command
request records remain backend-only. Score-shard reads use the parent session's
two-room authorization and deny all client writes.

The existing client room create/update allowlists must continue rejecting all
PK pointer and recent-result fields. Only Admin SDK command/finalizer paths may
write `pendingPkChallengeId`, `activePkSessionId`, `recentPkSessionId`, or
`recentPkExpiresAt`.

Rules must fail closed for malformed legacy or V2 documents. Do not rely on the
client feature flag for authorization.

### 10.2 Indexes

Add and deploy the indexes needed by the final implementation, including:

- challenges by `status + expiresAt`;
- sessions by `status + settleAfter`;
- sessions by `mode + status` for isolated flag rollback;
- reconciliation jobs by `status + leaseExpiresAt` and `status + updatedAt`;
- candidate rooms for active/public/country discovery if the selected query
  shape requires a composite index;
- committed gift reconciliation by `pkContext.pkId + createdAt + documentId` for
  the selected collection-group query shape.

The deployment checklist must wait until every required index reports `READY`.

---

## 11. Mobile UX

### 11.1 Entry and opponent picker

Add “Challenge another room” to the existing room Command Center only when:

- `roomPk` and `crossRoomPk` are true;
- the local user is current owner/host;
- the room is eligible;
- no pending challenge or active PK exists.

The opponent picker displays sanitized server results:

- room title and approved room image;
- host display name;
- country/language;
- live participant count;
- availability state.

Selection requires confirmation and explains duration, gift scoring, and that
the opponent host must accept.

### 11.2 Pending challenge states

- Challenger sees a waiting card with opponent room, expiry countdown, and
  cancel action.
- Opponent room sees an incoming challenge card. Members may see the state;
  only the current owner/host sees accept and decline controls.
- Reconnect restores the state from `pendingPkChallengeId`; local state is not
  authoritative.
- Expired, declined, cancelled, or concurrently invalid challenges leave an
  explicit short-lived result state, then return to the normal room UI.
- `useRoomPkSession` follows `activePkSessionId` first and then a non-expired
  `recentPkSessionId`, so clearing the active pointer cannot erase the final
  result before clients render it.

### 11.3 Active scoreboard

Extend `RoomPkScoreboardCard` with a cross-room variant:

- approved image/title for both rooms;
- red/blue room identity and verified side mapping;
- synchronized server-clock countdown;
- live score and leader indication;
- “your room” marker;
- surrender action for authorized local owner/host;
- no team-join buttons in cross-room mode;
- settling state without premature winner copy;
- final win/loss/draw/void/forfeit banner.

Maintain Arabic-first RTL layout, `ar-IQ` number formatting, screen-reader
labels that announce room names and scores, large-text resilience, reduced
motion, and the existing bounded activity/effect budgets.

### 11.4 Notifications and navigation

In-app challenge state is authoritative. Push improves response rate but does
not accept, decline, or mutate a challenge.

Add a `roomChallenges` notification preference with a schema-versioned,
backwards-compatible default. Recommended kinds:

- `room-pk-challenge-received`;
- `room-pk-challenge-accepted`;
- `room-pk-challenge-declined`;
- `room-pk-result`.

Use the existing delivery/idempotency pipeline. Notification data contains only
the known route, room ID, challenge/session ID, and sanitized display copy. A
tap routes through the existing notification response listener to
`VoiceRoom({ roomId })`; the screen then reloads authoritative room state.

The existing full-object notification update is not safe for this migration:
an older client can submit its older normalized preference set and overwrite a
newer's `roomChallenges: false` choice. Before exposing the toggle:

- add `preferenceSchemaVersion` and an update contract of
  `{ patch: Partial<NotificationPreferences>, expectedUpdatedAt }`;
- reject unknown keys and non-boolean values;
- merge only supplied known keys into the current server document;
- preserve keys unknown to an older client;
- retry or return `PREFERENCE_CONFLICT` on stale `expectedUpdatedAt`;
- keep legacy full-object requests compatible by treating only keys explicitly
  present in their original payload as a patch, never their default-filled
  normalized result.

Audience policy is locked: `room-pk-challenge-received` goes only to the
current opponent owner/host; accepted/declined goes only to the challenger
authority; result goes only to the two current room authorities in V1. Members
observe authoritative in-app state and do not receive fan-out push. All four
kinds honor global `pushNotifications` and `roomChallenges`.

Expo SDK 56 constraints are release gates:

- Android remote push cannot be validated in Expo Go; use a development build
  and a release build.
- Test foreground receipt, background tap, terminated-app tap, expired
  challenge tap, and duplicate response handling.
- Never put authorization decisions in notification payloads.

---

## 12. Abuse prevention and safety

- Reuse authenticated App Check-protected HTTP handling.
- Keep the current per-user PK command rate limit and add room-scoped challenge
  throttling.
- Recommended initial limits: five outgoing challenges per room per 10 minutes,
  one pending challenge per room, and a 10-minute repeat-opponent cooldown
  after decline/cancel.
- Rate-limit denied attempts as well as successful challenges.
- Exclude bidirectional blocks and inactive/restricted authorities at discovery,
  challenge creation, and acceptance; recheck inside the acceptance transaction.
- Suppress repeated notifications through the existing delivery idempotency and
  coalescing pattern.
- Record challenger, accepting authority, both room IDs, request IDs, outcome,
  and reason in backend audit history.
- Do not expose private-room data or opponent member lists.
- VIP/SVIP/Aristocracy may affect presentation in their own plan but cannot
  alter eligibility, scoring, rate limits, blocks, surrender, or moderation.

---

## 13. Observability and administration

Add bounded counters or period aggregates rather than writing every event to a
single hot telemetry document.

Required metrics:

- candidate searches;
- challenges created, accepted, declined, cancelled, and expired;
- challenge acceptance rate and median response time;
- sessions started, completed, voided, and forfeited;
- cross-room PK gift GMV;
- gifts scored and duplicate facts ignored;
- live projection delay p50/p95/p99;
- final reconciliation drift count and amount;
- finalizer latency and sessions stuck in `settling`;
- command denials by reason;
- push queued, delivered, failed, and opened.

Administrator surfaces should provide:

- read-only cross-room PK health summary;
- searchable session/challenge history by room, PK ID, and status;
- verified score versus live projection drift;
- emergency `crossRoomPk` kill control through the approved audited flag path;
- forced termination restricted to appropriate platform authority with a
  mandatory reason;
- no score or winner editing UI.

### 13.1 Server-enforced cohort rollout

The global kill switch and rollout eligibility are separate controls:

- `appConfig/growthFeatures.crossRoomPk == true` is the emergency/global code
  gate. If it is not exactly true, every new cross-room action fails closed and
  cleanup drains existing work.
- `appRuntime/crossRoomPkRollout` determines who may create or accept when the
  global gate is true.

```ts
type CrossRoomPkRolloutPolicy = {
  schemaVersion: 1;
  stage: 'dark' | 'internal' | 'closed-beta' | 'country-cohort' | 'public';
  allowedRoomIds: string[];       // bounded internal/closed-beta override
  allowedAuthorityUids: string[]; // bounded internal operator override
  countryCodes: string[];         // ISO country cohorts
  percentageBasisPoints: number;  // 0..10000, stable room-pair hash
  updatedAt: Timestamp;
  updatedBy: string;
};
```

The server evaluates the policy at discovery, challenge creation, and
acceptance. Percentage rollout uses a stable hash of the sorted room-ID pair so
both rooms receive the same decision. Both rooms must satisfy country/public
policy unless explicitly allowlisted. Lists are bounded and mutated only
through an owner-only, reason-required, audited admin/script path.

The existing growth-stage presets intentionally write `crossRoomPk: false`.
Applying any current preset is therefore an emergency kill and starts drain
behavior; it must not silently re-enable from the cohort policy. Enabling
requires a dedicated cross-room rollout command that atomically verifies the
base `roomPk`/gift prerequisites, writes the rollout policy, sets the global
boolean true, and records one audit event. Disabling sets the boolean false
first; changing the policy alone can never bypass the kill switch.

Alert conditions before public rollout:

- any nonzero score reconciliation drift;
- any room pointing to multiple or missing active sessions;
- any session stuck in `settling` beyond 2 minutes;
- any reconciliation in `attention-required` or over its scan cap;
- sustained projection failure above 1%;
- finalizer backlog or push failure above the platform's existing threshold;
- unexpected spike in repeated-opponent challenges or denials.

---

## 14. Implementation waves

Each wave is independently reviewable and keeps `crossRoomPk` false.

### Wave 0 — Product contract and compatibility

Status: **implemented locally on 2026-08-13**. The frozen contract, fixtures,
and verification record are in
[`CROSS_ROOM_PK_WAVE0_PRODUCT_CONTRACT.md`](CROSS_ROOM_PK_WAVE0_PRODUCT_CONTRACT.md).
No service, rules, index, client, notification, admin, or feature-flag behavior
was changed, and `crossRoomPk` remains disabled.

Deliver:

- freeze this document's product decisions and state machines;
- document V1 in-room versus V2 cross-room session mapping;
- specify error codes, Arabic copy, retention, and telemetry keys;
- add contract tests before service mutations.

Exit:

- no unresolved authority, scoring, surrender, or rollback behavior;
- existing in-room PK tests remain green.

### Wave 1 — Core schemas and challenge service

Status: **implemented locally on 2026-08-13**. See
[`CROSS_ROOM_PK_WAVE1_FOUNDATION.md`](CROSS_ROOM_PK_WAVE1_FOUNDATION.md) for
the delivered contracts, verification, and intentional Wave 2 boundaries.
The feature remains dark in every supported rollout preset.

Primary files:

- `functions/roomPkCore.js`
- `functions/roomPkService.js`
- `functions/roomPkCore.test.mjs`
- new `functions/roomPkService.test.mjs`

Deliver:

- challenge normalization and state transitions;
- server-filtered eligible opponent discovery;
- create/accept/decline/cancel/status commands;
- atomic two-room challenge reservation, acceptance, and idempotent replay;
- V1/V2 session mapping.

Exit:

- concurrent challenge creation reserves a room exactly once;
- concurrent acceptance creates exactly one session;
- neither room can be double-booked;
- stale challenge and stale pointer cases are deterministic.

### Wave 2 — Durable scoring and verified settlement

Status: **implemented locally on 2026-08-13**. See
[`CROSS_ROOM_PK_WAVE2_SETTLEMENT.md`](CROSS_ROOM_PK_WAVE2_SETTLEMENT.md) for
the delivered paths, verification, and intentional Wave 3 boundaries.
No supported rollout preset enables `crossRoomPk`.

Primary files:

- `functions/roomGiftService.js`
- `functions/roomPkCore.js`
- `functions/roomPkService.js`
- `functions/index.js`
- scoring/reconciliation tests

Deliver:

- server-authored gift `pkContext`;
- retryable gift-event projection;
- mandatory 16-shard-per-side live counters;
- fact and projection/reconciliation gifter-marker idempotency;
- `settling` state and ingestion grace;
- leased, paginated, checkpointed committed-gift final reconciliation;
- removal of unbounded event/gifter arrays from new sessions;
- bounded scan failure/alert path and load-test harness.

Exit:

- duplicate/reordered/delayed events cannot alter the final total;
- worker lease expiry/restart resumes without double-counting;
- verified result equals committed gift-event sums;
- gift settlement never depends on PK projection availability.

### Wave 3 — Lifecycle, rules, indexes, and rollback

Status: **implemented locally on 2026-08-13**. See
[`CROSS_ROOM_PK_WAVE3_LIFECYCLE.md`](CROSS_ROOM_PK_WAVE3_LIFECYCLE.md) for
the lifecycle, authorization, index/TTL, rollback, and verification record.
No supported rollout preset enables `crossRoomPk`.

Primary files:

- `functions/roomPkService.js`
- `functions/roomCommandCore.js`
- `functions/roomCommandService.js`
- administrator room-action service paths
- `firestore.rules`
- `firestore.indexes.json`
- `firestore.rules.emulator.test.mjs`

Deliver:

- challenge expiry and session finalizers;
- close/remove/lockdown/surrender handling;
- isolated `crossRoomPk` rollback;
- two-minute recent-result projection and cleanup;
- two-room read authorization;
- required indexes and cleanup retention.

Exit:

- all lifecycle paths clear both room pointers safely;
- terminal results remain recoverable after active pointers clear;
- outsiders cannot read and clients cannot write;
- flag-off leaves in-room PK operational.

### Wave 4 — Mobile challenge and scoreboard UX

Primary files:

- `src/voice/requestRoomPkCommand.ts`
- `src/voice/useRoomPkSession.ts`
- new challenge subscription/controller modules
- `src/components/voice-room/RoomPkScoreboardCard.tsx`
- new opponent picker and challenge cards/sheets
- `src/screens/VoiceRoomScreen.tsx`

Deliver:

- opponent picker;
- incoming/outgoing challenge states;
- accept/decline/cancel/surrender flows;
- cross-room scoreboard and settling/result states;
- reconnect and stale-state recovery;
- RTL/accessibility/reduced-motion coverage.

Exit:

- no client-trusted authority or score;
- V1 in-room UI remains unchanged;
- two-room flow works without push.

### Wave 5 — Notifications, telemetry, and admin operations

Primary files:

- `functions/socialNotificationsCore.js`
- `functions/socialNotificationsService.js`
- `src/notifications/usePushNotificationCoordinator.ts`
- `src/screens/NotificationSettingsScreen.tsx`
- dedicated cross-room rollout core/service/script
- growth telemetry/admin dashboard modules

Deliver:

- versioned partial notification preference updates and challenge kinds;
- idempotent push delivery and VoiceRoom routing;
- server-enforced room/UID/country/percentage rollout policy;
- cross-room PK funnels, drift, and latency metrics;
- health/history/admin termination surfaces;
- production alerts.

Exit:

- expired push taps recover safely;
- push failure never blocks in-app challenge handling;
- admin can observe and kill but cannot edit scores.

### Wave 6 — Production verification and controlled rollout

Deliver:

- automated suites, rules emulator, typecheck, and builds;
- two-room native acceptance matrix;
- stress and chaos testing;
- dark deployment and production read-back;
- closed-beta enablement and monitored expansion.

Exit:

- all release gates below pass;
- rollback drill completes without dangling pointers or wallet impact.

---

## 15. Verification matrix

### 15.1 Core tests

- normalize and reject malformed challenge/cross-room commands;
- deterministic IDs and fingerprints include both room IDs;
- duration clamp and TTL boundaries;
- eligibility reasons for every excluded room state;
- side derivation from room ID;
- natural winner, draw, void, red/blue forfeit, and dual-invalid void;
- V1 in-room session mapping remains unchanged;
- V2 mapping never trusts presentation snapshots for authority.

### 15.2 Service transaction tests

- create, replay, conflict, decline, cancel, expiry, and accept;
- simultaneous A→B/C→B and A→B/B→A challenge creation;
- simultaneous challenges involving one room;
- simultaneous acceptance requests;
- host transfer between create and accept;
- room closure or flag change during accept;
- stale pending and active pointers;
- one active session ID written to both rooms;
- surrender and every lifecycle termination;
- isolated `crossRoomPk` kill while in-room PK stays active.

### 15.3 Scoring tests

- qualifying gifts from each room map to the correct side;
- recipient does not change side;
- duplicate event replay is ignored;
- gift before start or after end is excluded;
- delayed valid event during settling is included;
- malformed or mismatched `pkContext` is rejected;
- first-gifter marker increments once;
- deterministic shard selection and 16-shard live aggregation;
- live projection failure does not fail a committed gift;
- reconciliation pagination resumes after lease loss without double-counting;
- reconciliation scan cap produces `attention-required` and no winner;
- final reconciliation corrects projection drift;
- no wallet or gift ledger mutation occurs during reconciliation.

### 15.4 Rules emulator tests

- active red-room member can read session/challenge;
- active blue-room member can read session/challenge;
- removed, stale, unauthenticated, and outsider users cannot read;
- every client write to challenge/session/fact/gifter/rate-limit paths is denied;
- malformed V2 room IDs fail closed;
- V1 in-room read behavior is preserved.

### 15.5 Client tests

- opponent list loading/empty/error states;
- challenge countdown and terminal states;
- authority controls visible only to owner/host;
- reconnect restores pending and active state;
- reconnect after finalization follows the recent-result pointer;
- V1 scoreboard still shows team joins;
- V2 scoreboard never shows team joins;
- active, settling, ended, draw, void, and forfeit copy;
- push route handles valid, expired, duplicate, and unauthorized room targets;
- old/new notification clients preserve `roomChallenges: false` across partial
  and legacy preference updates;
- cohort policy produces stable pair eligibility and cannot bypass the global
  kill switch;
- Arabic RTL, large text, screen reader, reduced motion, and low-end Android.

### 15.6 Native two-room acceptance

Use two active public rooms with at least two accounts in each:

1. Room A challenges Room B; all clients see the correct pending state.
2. Room B accepts; both rooms receive one shared session and synchronized timer.
3. Gifts in Room A score red; gifts in Room B score blue.
4. Duplicate/retry sends do not double-score.
5. Background and reconnect one device; state and score recover.
6. Let one battle expire; verified totals match committed gifts.
7. Reconnect after both active pointers clear and verify the final result is
   restored from `recentPkSessionId` until expiry.
8. Run draw and anti-farm void cases.
9. Surrender from each side and verify opponent forfeit result.
10. Close and staff-lock each side and verify lifecycle behavior.
11. Disable `crossRoomPk`; pending and active work drains safely while in-room
    PK still functions.
12. Validate challenge push in Android development and release builds, not Expo
    Go, plus the active iOS release target when available.

---

## 16. Rollout and rollback

### 16.1 Deployment order

1. Deploy Firestore indexes and wait for `READY`.
2. Deploy rules that are backward-compatible with existing V1 sessions.
3. Deploy backend challenge/scoring/finalization code with
   `crossRoomPk == false`.
4. Run production read-back and dark command-denial tests.
5. Ship the compatible mobile client.
6. Publish `appRuntime/crossRoomPkRollout` at `internal` with bounded room/UID
   allowlists while the global boolean remains false; verify the policy read-back.
7. Use the dedicated audited rollout command to validate prerequisites and set
   `crossRoomPk == true` for that internal policy.
8. Complete two-room native acceptance and load testing.
9. Expand the policy to a small country/percentage cohort.
10. Expand only when reconciliation, latency, abuse, and crash metrics remain
   within thresholds.
11. Set public rollout only through the dedicated audited rollout command.

Do not change the existing growth-stage presets to enable cross-room PK. They
remain broad rollback tools and continue to write `crossRoomPk: false`. The
dedicated rollout command is the only approved enable path; every application
of an existing growth preset must be surfaced in operations as disabling and
draining cross-room PK regardless of the retained cohort policy.

### 16.2 Emergency rollback

Set `appConfig/growthFeatures.crossRoomPk` to false.

Expected behavior:

- new discovery, challenge, and acceptance commands reject fail-closed;
- pending cross-room challenges become cancelled/expired and both pointers
  clear;
- active cross-room sessions enter bounded settlement or void when verification
  cannot complete;
- both rooms clear only matching active pointers and enter cooldown;
- historical challenge/session/fact documents remain until retention cleanup;
- gift, wallet, receipts, in-room PK, shared music, and unrelated room activity
  remain intact.

Rollback validation must prove there are no rooms with dangling
`pendingPkChallengeId` or `activePkSessionId` references. The rollout policy may
remain for forensic/read-back purposes but cannot authorize anything while the
global boolean is false. Re-enablement always requires a fresh audited command.

---

## 17. Release gates

All boxes are required before public enablement.

### Product and safety

- [ ] Challenge/accept/surrender behavior approved.
- [ ] Public-room-only policy approved.
- [ ] Arabic copy avoids gambling or cash-return framing.
- [ ] Blocks, moderation, and paid-status non-bypass reviewed.
- [ ] No rewards are enabled in V1.

### Backend and data

- [x] Challenge and session state-machine tests pass locally.
- [x] Service concurrency/idempotency tests pass locally.
- [x] Durable gift projection and final reconciliation pass locally.
- [x] Mandatory score sharding and its synthetic load gate pass locally.
- [x] Paginated reconciliation lease/restart/scan-cap tests pass locally.
- [x] Lifecycle and isolated rollback tests pass locally.
- [x] Cleanup and retention paths are bounded locally; production monitoring remains a release gate.

### Security

- [x] Rules emulator covers members of both rooms and outsiders.
- [x] All authoritative client writes are denied.
- [x] Candidate discovery exposes sanitized public fields only.
- [x] App Check, auth, authority, blocks, and rate limits are enforced server-side locally.

### Client

- [ ] In-app flow works with push disabled.
- [ ] V1 in-room PK is regression-tested.
- [ ] Android and active iOS native acceptance pass.
- [ ] RTL, accessibility, reduced motion, reconnect, and terminated-app routes pass.
- [ ] Expo Go is not used as the Android remote-push release signal.
- [ ] Legacy/new notification preference updates preserve explicit opt-outs.

### Operations

- [ ] Indexes report `READY`.
- [ ] Dark deployment and production read-back pass.
- [ ] Drift, latency, stuck-settlement, abuse, and push alerts are active.
- [ ] Dedicated cohort rollout policy and audited enable/disable commands pass.
- [ ] Admin can inspect and terminate but cannot edit results.
- [ ] Closed-beta rollout and emergency rollback drills pass.

---

## 18. Explicit non-goals

- Cross-room audio mixing, video, screen sharing, or LiveKit room bridging.
- Random opponent matchmaking.
- Multi-room tournaments or more than two rooms per session.
- Coin pools, cash rewards, wagers, concealed odds, or real-money prizes.
- VIP/SVIP/Aristocracy scoring multipliers or moderation privileges.
- Family wars; they may reuse this foundation in a later separately flagged
  product plan.
- User-created PK rules, arbitrary durations in public UI, or client-selected
  winner corrections.
- Historical score editing by administrators.

---

## 19. Post-V1 candidates

Consider only after V1 is stable and measured:

- opt-in random opponent matching by country/language and room size;
- rematch flow with mutual acceptance;
- family-versus-family battles using the same room-session authority;
- seasonal PK boards and non-economic cosmetic badges;
- limited opponent-room audio preview using an explicitly designed native media
  architecture;
- tournament brackets;
- spectator discovery links after a battle begins;
- cosmetic result celebrations that obey existing effect budgets.

None of these should block the direct challenge, correct scoring, lifecycle,
and rollback foundation in this plan.
