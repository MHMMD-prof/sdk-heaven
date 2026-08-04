# Weekly Incentives Wave 7 — Owner-selected Room Target Backend

**Status (2026-07-30): implemented and verified locally; not deployed.**

Both Room Target feature flags remain disabled. No production accrual or payout
was enabled by this work.

## Delivered behavior

- A Platform Owner-managed, immutable-version recurring template defines the
  weekly support target, return rate in basis points, payout currency and
  conversion, selected-user limit, per-user and per-room caps, eligible gift
  rules, timezone, and safety valuations.
- Publishing always targets the next weekly cycle. The latest effective
  published template is reused until replaced, and every room cycle stores its
  own complete economic snapshot.
- Publishing fails closed unless the current room-gift commission policy can
  fund the worst-case Room Target liability plus the Rocket rewards effective
  for the same cycle. Diamond and item liabilities require explicit coin
  valuations; unknown Rocket items block publication.
- Emergency disable is separate from the two runtime feature flags and creates
  immutable Platform Owner audit evidence.

## Locked weekly roster

- The owner prepares only the next cycle through the authenticated
  `roomTargetCommand` endpoint.
- The owner is included automatically and cannot be duplicated in the selected
  list.
- Selected accounts must exist, be active, have no incentive restriction, and
  have no active global payout hold.
- Replacing a draft cancels notifications for removed users and queues updated
  notifications for the resulting roster.
- At cycle start, the roster is copied into the room cycle and becomes
  immutable. A paginated scheduler initializes every active public room rather
  than repeatedly scanning only the first page.
- If ownership transfers after the weekly boundary, the prior owner remains
  the automatic member for the active cycle. The new owner becomes automatic
  in the next cycle.
- Platform staff can apply or release an audited current-cycle member hold.
  Owners cannot silently remove a member after the boundary.

## Trusted gift projection

- Room Target consumes only immutable canonical facts produced from committed,
  balanced room gifts.
- Canonical fact creation now runs when either supporter rankings or Room Target
  accrual is enabled, so Room Target is not accidentally coupled to leaderboard
  visibility.
- Each gift has a deterministic Room Target projection receipt.
- A receipt is also written for an excluded ordinary sender, preventing a later
  retry from counting the same gift after configuration changes.
- Only a sender in the locked roster, in the matching room and weekly cycle,
  contributes. Self-gifts and gifts below the snapshotted minimum remain
  excluded.
- The cycle tracks support points for target progress and separately tracks the
  actual debited coin amount for each roster member's return.
- The first crossing creates one deterministic room event. Eligible totals keep
  growing until the weekly close.

## Returns and settlement

- A missed goal closes with no payout and no rollover.
- Returns use integer basis-point math, the snapshotted conversion, floor
  rounding, and the actual debited amount.
- Per-user caps apply first. If the sum still exceeds the room cap, a
  deterministic proportional largest-remainder allocation applies; UID order
  resolves equal remainders.
- BigInt intermediate math prevents unsafe JavaScript-number rounding in
  high-value calculations.
- Suspended, restricted, globally held, or cycle-held members receive no
  return. Their value is not reassigned to another user.
- Deterministic `owner-targets` settlement IDs reuse the common leased,
  retry-safe settlement worker. Enabling payouts later resumes cycles that
  closed in preview-ready state without creating duplicate wallet credits.
- Finalization waits for the canonical room-gift reconciliation watermark.
  Target-met cycles with no eligible positive returns are held explicitly
  instead of looping indefinitely.

## Backend data and access

These collections and subcollections are backend-only in Firestore Rules:

- `roomTargetCampaign/current/versions/{version}`
- `roomTargetPublicVersions/{version}`
- `rooms/{roomId}/targetRosterDrafts/{cycle}`
- `rooms/{roomId}/targetCycles/{cycle}/members/{uid}`
- `roomTargetProjectionReceipts/{receipt}`
- `roomTargetCommandRequests/{uid}/requests/{request}`
- `roomTargetRosterNotifications/{notification}`

Signed-in clients may read only `roomTargetPublicVersions/{version}`, the safe
published template projection with internal risk valuations removed.

Wave 8 will materialize the safe room progress/roster view needed by the mobile
sheet rather than exposing the finance and risk snapshot directly.

## Admin API

The existing dashboard API now authorizes these backend operations:

- `room-target-campaign`
- `room-target-campaign-mutate`
- `room-target-member-hold`

Only roles with `incentives:manage` can publish, disable, roll back, or hold a
member. `incentives:view` can inspect campaign versions and operational
settlement summaries. The visual dashboard editor and reports are Wave 8.

## Schedulers

- `startRoomTargetCycles`: every ten minutes, with a persisted room cursor.
- `processRoomTargetCycles`: every ten minutes; closes active/unlocked cycles
  and advances ready/settling cycles to missed, settled, or held outcomes.
- `processRoomTargetRosterNotifications`: every ten minutes; notification
  retry never invokes an economic write.
- The existing gift reconciler repairs both Rocket and Room Target secondary
  projections.
- The common five-minute settlement worker pays only when
  `voice_room_owner_target_payouts` is enabled.

## Feature gates and rollout

The independent gates remain:

- `voice_room_owner_targets`
- `voice_room_owner_target_payouts`

Required order:

1. deploy Functions, Rules, and indexes with both flags false;
2. publish a viable next-cycle template;
3. ship the Wave 8 safe progress projection, dashboard, and mobile experience;
4. enable accrual only for a controlled development cycle;
5. reconcile every canonical fact, selected-member total, cap, and return;
6. run dry settlement previews and review stacked Rocket liability;
7. enable payouts only for synthetic wallets after Wave 9 hardening.

## Verification evidence

- Application: 158 test files / 892 tests passed.
- Focused Room Target tests cover template validation, unique rosters,
  non-matching facts, goal crossing, actual-debit return math, conversion
  rounding, per-user and per-room caps, deterministic allocation, large-number
  safety, stable settlement IDs, stacked Rocket risk, and ownership transfer.
- Full Functions syntax checks passed.
- Firestore and Storage emulator suites passed after stopping an orphaned local
  emulator and rerunning on isolated ports.
- Dashboard TypeScript, 8 test files / 20 tests, production build, and bundle
  budgets passed.
- Expo SDK 56 Android export passed (2,161 modules). Expo reported the existing
  missing iOS `GoogleService-Info.plist`; it did not fail the Android export and
  remains an iOS configuration task.
- No deployment or feature-flag mutation was performed.

Physical Android and the Wave 8 RTL/accessibility experience are later release
gates, not Wave 7 backend claims.
