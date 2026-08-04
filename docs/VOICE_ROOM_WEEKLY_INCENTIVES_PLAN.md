# Weekly Room Incentives — Waves 1–10

## Status

Waves 1 through 9 are complete locally as of 2026-07-30. Wave 5's
trusted-attendance production and physical-device exit gates remain open. The
shared contracts, settlement engine, permission boundaries, disabled feature
flags, exactly-once gift projections, sharded supporter totals, compact
leaderboards, recurring Rocket publication, immutable per-room cycle snapshots,
goal crossing, reconciliation-gated podium selection, reward settlement, and
post-settlement notification workers are in place. The admin dashboard now has
an Incentives workspace for the recurring Rocket campaign, visual/reduced-motion
previews, liability and operational metrics, and recent-cycle inspection. The
room has a non-displacing Rocket control, live weekly progress, exact prizes,
Today/This Week podiums, and a deduplicated goal effect with a built-in offline
fallback. Wave 5 now adds signed LiveKit webhook ingestion, authoritative
server-side microphone reconciliation, verified mute/unmute hints, server-owned
seat joins, five-minute mute grace, overlap-unioned daily shadow reports,
outage-window contracts, and payroll-operator evidence UI. No production data
was changed, no new worker was deployed, and all eight new flags remain off.
Wave 9 adds backend-only integrity evidence, automated abuse scoring and payout
holds, audited review/repair controls, gift and reward reconciliation, worker
health and liability reporting, bounded retention, hardened rules, and an admin
integrity panel. Wave 10 dark deployment started on 2026-07-30: rules, indexes,
Storage rules, the admin dashboard, and all scheduled/HTTP incentive services
are live with every incentive flag off. Two optional Firestore Eventarc
accelerators remain blocked by `me-central2` trigger-creation permission, and
campaign publication plus physical/synthetic acceptance remain open. Publishing an
animated Rocket remains
fail-closed until its asset has the required Expo SDK 56 physical Android
memory, decoding, reduced-motion, and fallback approval evidence.

## Scope

This initiative adds three independent weekly systems:

1. **Rocket / Top Supporters**
   - Every eligible room gift contributes.
   - The room shows Top Supporters for Today and This Week.
   - The weekly ranking determines configured rank rewards.
   - Reaching the weekly goal plays the configured Rocket effect once and
     unlocks settlement.

2. **Automatic Staff Payroll**
   - Separate plans support Super Admins, employees/workers, and approved
     female hosts.
   - A plan controls the coin/diamond salary, daily microphone minimum, and
     required days.
   - Attendance counts while connected in a speaker seat and pauses after five
     continuous muted minutes.
   - Missing any required day prevents that week's automatic deposit.

3. **Owner-selected Room Target**
   - The room owner is enrolled automatically and selects the additional
     eligible users.
   - Only gifts sent in that room by the locked weekly roster contribute.
   - Reaching the combined target unlocks a configured return on each enrolled
     user's own qualifying spending.
   - Ordinary users' gifts do not contribute to this target.
   - The Room Target button appears directly beneath the Rocket button.

## Shared product rules

- Use one configurable weekly calendar, defaulting to Monday 00:00 in
  `Asia/Baghdad`. "Today" uses midnight in the same calendar.
- A current template repeats every week until the Platform Owner changes it.
- Every cycle stores an immutable copy of the effective template.
- Mid-cycle configuration changes apply to the next cycle.
- Gift eligibility comes only from committed, server-authored room gift events.
- Only gifts sent in active public rooms qualify.
- Economic rankings, goals, and percentage returns use the amount actually
  debited for the committed gift. Catalog display score remains available for
  social levels but cannot silently change a cash-like incentive result.
- Self-gifts, free/promotional gifts, transfers, game wagers, reversals, and
  administrative credits do not qualify.
- A Room Target "return" is a new promotional reward credit with its own ledger
  source; it never reverses or edits the original gift, recipient earning, or
  platform commission.
- Rocket rewards, Room Target returns, and earned payroll may stack. The
  dashboard must price their combined worst-case liability before publication.
- All settlements are automatic, idempotent, ledgered, and retry-safe.
- A target reached during a week unlocks a payout but does not finalize winners
  before the weekly close.
- A missed target resets without payment or rollover.
- Ownership transfer does not erase active room progress.
- Deleted, suspended, or investigation-held rooms do not settle automatically.
- Feature visibility/accrual and actual payout execution have independent kill
  switches.

## Existing foundations to reuse

- `functions/roomGiftService.js` already creates immutable, idempotent gift
  events containing sender, recipient, room, price, score value, commission,
  recipient credit, and platform share.
- `walletSummaries`, `walletTransactions`, economy ledgers, and store
  entitlements provide the authoritative payout destinations.
- Firebase scheduled functions already run with an `Asia/Baghdad` timezone.
- The admin dashboard already has explicit role permissions, audit views,
  economy history, gift catalog management, and room inspection.
- The room already has an effects queue, command endpoints, presence leases,
  seats, feature flags, and owner-authorized commands.

The gift payment transaction must remain focused and bounded. New rankings and
campaigns consume its immutable event rather than independently debiting or
crediting a wallet.

---

## Wave 1 — Weekly calendar, reward contracts, and settlement ledger

### Contracts

- Add a shared `WeeklyCycleV1` contract with cycle ID, timezone, start/end
  timestamps, state, and immutable template version.
- Add a validated `RewardBundleV1` supporting:
  - coins
  - diamonds
  - one or more catalog items
  - a configured permanent-item duplicate fallback
- Add stable settlement IDs derived from feature, cycle, room/plan, rank, and
  recipient UID.
- Add explicit settlement states: `preview`, `eligible`, `held`, `paying`,
  `paid`, `ineligible`, `reversed`, and `failed`.
- Define one canonical gift fact with both actual debited spend and immutable
  support-point value. Never recalculate historical points from the current
  catalog.
- Create room cycles lazily on the first eligible event/read instead of scanning
  every room at the weekly boundary.

### Authority and flags

- Add dedicated dashboard permissions:
  - `incentives:view`
  - `incentives:manage`
  - `payroll:view`
  - `payroll:manage`
- Platform Owner receives all mutation permissions; auditor receives read-only
  access. Super Moderator status alone does not grant economy authority.
- Add independent flags:
  - `voice_room_supporter_rankings`
  - `voice_room_rocket_rewards`
  - `voice_room_payroll_tracking`
  - `voice_room_payroll_payouts`
  - `voice_room_owner_targets`
  - `voice_room_owner_target_payouts`

### Shared payout engine

- Credit coins/diamonds through the existing wallet mutation primitives.
- Grant catalog rewards through the existing entitlement model.
- Store a reward settlement plus the corresponding wallet/economy/entitlement
  ledger records in one authoritative operation.
- Make retrying the same settlement return the original result without paying
  again.
- Process weekly settlement through leased, cursor-based, bounded batches so a
  timeout or deployment cannot skip rooms or restart the entire population.
- Add dry-run settlement and reconciliation reports before any payout flag can
  be enabled.

### Exit gate

- Boundary/timezone, reward validation, item fallback, duplicate retry,
  partial-failure recovery, and ledger-balance tests pass.
- No client can create a cycle, settlement, reward, or wallet credit.

---

## Wave 2 — Exactly-once gift projections

### Projection pipeline

- Consume committed `rooms/{roomId}/giftEvents/{eventId}` documents.
- Deduplicate every projection using the immutable event ID.
- Project per-room/per-user aggregates for:
  - current app day
  - current app week
  - actual eligible spend
  - support points
  - first qualifying contribution timestamp for deterministic ties
- Derive the incentive spend value from the committed debit snapshot, not from
  the mutable gift catalog or client-provided points.
- Keep raw events immutable and make every projection rebuildable from them.
- Use partitioned/sharded room totals and per-user aggregates to avoid turning a
  busy room into one Firestore hot document.
- Materialize compact top-ranker views for mobile reads instead of listening to
  an unbounded contribution collection.

### Reconciliation

- Add a scheduled reconciler that compares projected totals with gift events
  and repairs safe drift idempotently.
- Record projection lag, duplicate delivery, repair count, and unrecoverable
  mismatch alerts.
- Retain sufficient event history to reconstruct every unsettled cycle.

### Exit gate

- Duplicate, delayed, out-of-order, burst, midnight, weekly-boundary, and
  projection-rebuild tests produce identical totals.
- The existing gift debit, recipient credit, and platform commission remain
  unchanged and balanced.

---

## Wave 3 — Rocket campaign and Top Supporters backend

### Recurring campaign

- Add a Platform Owner-managed recurring Rocket template containing:
  - weekly support target
  - Rocket name and static appearance
  - launch/explosion animation and optional sound
  - independent first/second/third reward bundles
  - enabled ranks: first only, first and second, or all top three
  - safety status, cost valuation, and next effective cycle
- Snapshot the template for every room cycle. Reuse it automatically when the
  owner does not publish a change.
- Validate and version assets at immutable Storage paths.
- Select the final animation format only after Expo SDK 56 physical-device
  memory, decoding, reduced-motion, and fallback tests.

### Ranking and goal

- Provide Today and This Week leaderboards, each with deterministic ties.
- Rank supporters by their total committed eligible spend.
- Today resets at the configured app midnight and is informational only.
- This Week controls weekly rewards.
- Emit one idempotent goal-crossed event when the weekly room total first
  reaches the target.
- Continue weekly ranking after goal crossing until settlement time.

### Weekly settlement

- At cycle close, verify target, room status, gift reconciliation, winner
  eligibility, configured ranks, reward cost, and fraud holds.
- Move a disqualified winner out and promote the next eligible supporter.
- Pay only the configured rank bundles.
- Preserve the completed podium and reward result for a limited history view.
- Notify rewarded users only after the authoritative settlement is committed;
  notification retries must not retry the economic credit.

### Exit gate

- Goal-crossing, ties, rank promotion, first-only/first-two/top-three rewards,
  coins, diamonds, items, missing assets, duplicate items, and repeated
  scheduler execution all pass.

### Implemented locally

- `RoomRocketTemplateV1` validates the recurring target, localized identity,
  immutable static/animated/sound assets, enabled rank rewards, minimum client
  version, timezone, and physical-device animation approval evidence.
- Platform Owner mutations support draft, next-cycle publish, emergency
  rendering disable, rollback-as-a-new-version, optimistic revisions,
  idempotent request IDs, and immutable audit records.
- The dashboard `/incentives` workspace can upload bounded immutable assets,
  configure first/second/third coin, diamond, and item rewards, preview the
  per-room worst-case liability, save a draft, publish for the next weekly
  cycle, emergency-disable, and rollback.
- Every canonical eligible gift advances one room-owned Rocket cycle through a
  separate exactly-once receipt. The effective global template is copied into
  the cycle and cannot change mid-week.
- The first target crossing creates one stable room event. Ranking continues
  through the weekly close.
- Settlement waits for the closed support period's reconciliation watermark
  and also verifies that no delayed canonical gift was projected after that
  watermark.
- Final podium selection uses spend descending, first contribution ascending,
  then UID ascending. Missing, suspended, or held candidates are recorded and
  the next eligible supporter is promoted.
- Configured currency/item liability is derived at publication, snapshotted,
  and checked again before settlement. Room holds, emergency campaign disable,
  invalid liability, and no eligible winners fail closed.
- Payout jobs reuse the Wave 1 idempotent wallet/item settlement engine.
  Notifications are queued only after all authoritative settlements are paid,
  and push retries cannot enqueue or repeat a payout.
- Firestore and Storage rules keep templates, projection receipts, holds,
  payout jobs, and notification jobs backend-only; active room members can read
  only the safe cycle result while supporter rankings are enabled.
- Verification: 148 non-emulator test files / 852 tests, TypeScript, full
  Functions syntax checks, admin typecheck/tests/production build/bundle
  budget, Firestore and Storage emulator suites, index JSON parsing, and an
  Expo SDK 56 Android export all pass.

---

## Wave 4 — Rocket dashboard and room experience

**Implementation status (2026-07-29):** complete locally. Application,
Functions, and dashboard tests, both TypeScript projects, Functions syntax
checks, and the Expo SDK 56 Android production export pass. Firestore emulator
re-verification and the dashboard production bundle are still required before
rollout because this Codex desktop run could not access the pinned emulator/CLI
download or the build tool's parent-directory read permission. Physical compact
and tall Android checks, TalkBack/RTL, reduced motion, offline asset failure,
and live reconnect checks remain release evidence rather than code-complete
claims.

### Admin dashboard

- Add an Incentives workspace with Rocket draft, preview, validation, publish,
  next-cycle scheduling, disable, and rollback.
- Preview the Rocket appearance, explosion, reduced-motion fallback, reward
  cards, and Today/This Week podiums.
- Show the reward's normalized cost, worst-case cost relative to the target,
  active cycle snapshot, qualifying-room count, and settlement totals.
- Require a reason and immutable audit event for publication or emergency
  changes.

### Mobile room

- Add the Rocket button and progress treatment without moving stable room
  header, chat, seats, or Command Center controls.
- Add a sheet with:
  - weekly progress and countdown
  - Today / This Week tabs
  - decorated top-three podium
  - exact configured prizes
  - locked/unlocked/settled state
- Play the goal-crossed effect once per event ID for users present in the room.
- Users joining later see Reward Unlocked without replaying the explosion.
- Respect reduced motion/effects settings and use a bundled static fallback.

### Exit gate

- RTL, compact/tall Android, screen reader, reduced motion, reconnect, offline
  assets, effect deduplication, and live ranking refresh pass.

---

## Wave 5 — Trusted microphone attendance

### Source of truth

- Add a signed LiveKit webhook or equivalently authoritative server integration
  for participant connection and audio-track state.
- Combine LiveKit connection state with server-owned room seat membership; do
  not trust a client timer or a direct client presence write for salary.
- Open/close attendance intervals when the enrolled user:
  - connects/disconnects
  - takes/leaves a speaker seat
  - mutes/unmutes
  - changes rooms
- Pause the interval after five continuous muted minutes. Do not record,
  transcribe, or inspect speech content.
- Union overlapping intervals by UID so two rooms/devices cannot double-count.
- Split intervals correctly across the configured daily boundary.

### Integrity and device enrollment

- Prove an Android device-attestation path compatible with the Expo SDK 56
  development build before enforcing it.
- Bind one active female-host payroll identity to one trusted device
  enrollment, with audited replacement/recovery.
- Never collect IMEI or another invasive hardware identifier.
- Treat device uniqueness as an abuse-control signal with a manual review path,
  not an impossible guarantee.

### Shadow reporting

- Run attendance in report-only mode first.
- Show raw interval evidence, daily qualified minutes, mute grace, reconnect
  merge, and exclusion reasons to authorized payroll operators.
- Add platform-outage windows that can excuse affected attendance automatically.
- Flag repeated mute/unmute patterns designed to reset the five-minute grace
  without requiring speech analysis.

### Exit gate

- Physical Android tests cover mute at 4:59/5:00, reconnects, app background,
  network switches, midnight, concurrent rooms, device replacement, stale
  events, and webhook replay.

---

## Wave 6 — Automated payroll

**Implementation status (2026-07-30): complete locally behind disabled
tracking and payout flags.** Plans, one-per-UID enrollments, next-cycle
snapshots, trusted-attendance qualification, audited exceptions, holds,
resumable settlement, ledger reconciliation, dashboard operations, employee
self-progress, rules, indexes, and schedulers are implemented. Application,
dashboard, Functions, and emulator verification pass. No deployment occurred.
Physical Expo SDK 56 device-attestation and Android acceptance remain rollout
gates. See `docs/VOICE_ROOM_WEEKLY_INCENTIVES_WAVE6.md`.

### Plans and enrollment

- Add recurring salary plans for:
  - Super Admin
  - employee/worker
  - approved female host
- Each plan configures currency, weekly amount, daily minimum, required days,
  timezone, mute grace, effective cycle, and enabled state.
- Keep employment/payroll enrollment separate from application authorization
  roles; granting Super Admin permissions does not silently enroll a salary.
- Provide the requested quick dashboard flow:
  1. find/enter UID
  2. enter salary amount
  The current payroll tab supplies plan defaults and currency.
- New enrollments and changes begin next cycle; midweek partial salary is not
  automatic.

### Qualification and settlement

- Snapshot plan and enrollment at cycle start.
- Require every configured day to meet its minimum.
- Support audited excused days, service-outage treatment, suspension, start/end
  dates, and manual holds.
- Pay qualified users automatically with stable settlement IDs.
- Record explicit outcomes: paid, missed day, insufficient time, suspended,
  device conflict, held, or failed.

### Experience and operations

- Dashboard shows projected payroll cost, enrollment roster, daily minutes,
  qualification state, exceptions, and settlement ledger.
- Add an employee-facing read-only progress view to reduce payout disputes.

### Exit gate

- Seven-of-seven qualification, one missed day, plan changes, device conflicts,
  exceptions, role changes, payout retries, and ledger reconciliation pass.

---

## Wave 7 — Owner-selected Room Target backend

**Implementation status (2026-07-30): complete locally behind disabled
accrual and payout flags.** Recurring templates, stacked-liability validation,
next-cycle owner rosters, cycle-boundary locking, ownership-transfer
preservation, exact-once selected-sender projection, capped deterministic
returns, staff holds, and retry-safe settlement are implemented. No deployment
occurred. See `docs/VOICE_ROOM_WEEKLY_INCENTIVES_WAVE7.md`.

### Recurring template

- Add a Platform Owner-managed recurring template with:
  - weekly support-point target
  - return percentage in basis points
  - payout currency/conversion rule
  - maximum selected-user count
  - per-user and per-room return caps
  - eligible gift rules
  - effective cycle and enabled state
- Reuse the template until changed and snapshot it per weekly room cycle.
- Validate the return against platform commission and worst-case stacked rewards.

### Weekly roster

- Automatically include the current room owner.
- Allow the owner to prepare the next cycle's selected-user list through an
  authoritative command.
- Require active, unrestricted accounts and reject duplicates.
- Lock the roster at cycle start. Current-week removal is a staff hold or
  disqualification action, not a silent owner edit.
- Notify selected users of their next-cycle enrollment and the exact target,
  return rule, caps, and effective dates.
- Preserve the active roster and progress through ownership transfer; the new
  owner becomes automatic only in the next cycle.

### Projection and return

- Only gift events whose sender is in the locked roster and whose room matches
  the roster count toward this target.
- Keep each enrolled user's eligible spend/support total separate.
- Ordinary users remain excluded even when their gifts count toward Rocket.
- Goal crossing unlocks returns; final eligible amounts continue growing until
  weekly close.
- Compute each return from that user's own qualifying total, configured rate,
  conversion rule, and caps. The qualifying total is the amount actually
  debited for that user's committed gifts; support/display score is not the
  rebate basis.
- Store the currency conversion snapshot with the cycle so a later dashboard
  change cannot rewrite an earned estimate or settlement.
- Missed target means no return and no rollover.

### Exit gate

- Non-roster exclusion, roster locking, ownership transfer, individual totals,
  target crossing, missed target, caps, conversion rounding, disqualification,
  and payout retry tests pass.

---

## Wave 8 — Room Target dashboard and mobile experience

**Implementation status (2026-07-30): complete locally behind disabled
accrual and payout flags.** The safe public projection, owner-only next-cycle
roster preview/search/edit flow, room UI, dashboard template editor, next-cycle
publication, risk view, holds, operational reports, and historical rollback are
implemented. No deployment occurred. See
`docs/VOICE_ROOM_WEEKLY_INCENTIVES_WAVE8.md`.

### Admin dashboard

- Add Room Target template management, next-cycle preview, conversion examples,
  margin/risk warnings, qualifying-room counts, holds, and settlement reports.
- Make changes recurring until replaced and retain every historical snapshot.

### Mobile room

- Add a dedicated Room Target button directly beneath Rocket.
- Everyone may view:
  - goal progress and countdown
  - locked roster
  - each roster member's qualifying total
  - estimated return
  - locked/unlocked/settled state
- Only the room owner may prepare next week's roster.
- Show clearly that ordinary gifts do not count and current-week membership is
  locked.
- Search/select accounts safely without exposing private profile data.

### Exit gate

- Owner/non-owner authorization, next-week editing, current-week lock, RTL,
  accessibility, empty/partial/full roster, and ownership-transfer UI pass.

---

## Wave 9 — Security, abuse, reconciliation, and cost controls

### Rules and permissions

- Clients may read only the minimum published campaign/ranking/progress data.
- Public ranking projections expose only public profile fields and aggregate
  totals; payroll, device, risk, and private account data never enter them.
- All campaign, payroll, roster, attendance aggregate, settlement, wallet, and
  entitlement writes remain backend-only.
- Restrict payroll/device information to Platform Owner and explicitly
  authorized payroll operators.
- Add Firestore and Storage emulator coverage for cross-room, cross-user,
  operator-role, roster, and asset-path attacks.

### Economy abuse

- Detect circular gifting, related-account clusters, rapid pass-through,
  refund/reversal patterns, selected-member churn, device conflicts, and
  abnormal reward stacking or mute-grace cycling.
- Block self-gifts at the payment layer as today.
- Compare configured returns and rewards with retained platform commission.
- Hold suspicious settlements for review instead of silently paying or deleting
  progress.

### Reconciliation and observability

- Reconcile gift debit = recipient credit + platform share.
- Reconcile projection totals to immutable gift events.
- Reconcile every reward to exactly one settlement and destination ledger.
- Report scheduler lag, webhook lag, projection drift, held value, payout
  failures, and estimated liability.
- Provide dry-run repair scripts with explicit apply mode and audit records.
- Apply separate retention policies to public leaderboard history, attendance
  evidence, device bindings, financial ledgers, and audit records; deletion and
  access remain role-scoped and logged.

### Exit gate

- Rules suites, abuse simulations, load/contention tests, scheduler replay,
  reconciliation, and recovery drills pass with zero duplicate deposits.

---

## Wave 10 — Staged rollout and acceptance

### Deployment order

1. Deploy contracts, indexes, rules, backend services, dashboard, and flags with
   every new flag off.
2. Enable gift projection and rankings in shadow mode.
3. Run one full synthetic weekly cycle and reconcile against gift events.
4. Enable Rocket UI and effect for the test room with payouts still off.
5. Enable trusted attendance in report-only mode for test payroll accounts.
6. Compare a full attendance week with controlled physical-device sessions.
7. Enable Room Target for the test room with settlement preview only.
8. Run all three settlement jobs in dry-run and review projected liability.
9. Enable each payout flag independently for synthetic wallets.
10. Enable development testing broadly only after live read-back and audit
    verification.

### Acceptance matrix

- Firebase function/core tests and syntax checks
- Firestore and Storage emulator rule suites
- Admin dashboard typecheck, tests, production build, and bundle budget
- Mobile TypeScript and full Vitest suite
- Android Expo export and physical `expo run:android`
- Compact, standard, and tall Android RTL/accessibility review
- Reduced motion/effects and failed-asset behavior
- Gift burst/contention and duplicate-event tests
- Daily/weekly/timezone boundary tests
- Wallet, economy, item entitlement, and settlement reconciliation
- LiveKit attendance webhook replay and outage recovery
- Feature-flag rollback with rooms, gifts, audio, and historical ledgers intact
- Bounded settlement-worker resume after timeout, crash, and redeployment
- Notification failure without economic settlement replay

### Final gate

- Accrual can be disabled without affecting ordinary room gifts.
- Payouts can be frozen without losing earned progress or settlement evidence.
- No feature trusts client totals, client clocks, or client attendance timers.
- No scheduler retry can create a duplicate wallet credit or item entitlement.
- The dashboard explains every qualification, exclusion, hold, and payment.
- Product, finance/accounting, privacy/legal, worker-classification, and app
  marketplace reviews approve the final salary and virtual-reward policies
  before real-user payouts are enabled.

---

## Dependency map

| Wave | Depends on | May be tested independently? |
| --- | --- | --- |
| 1 Shared foundation | Existing wallet/store/admin systems | Yes, dark |
| 2 Gift projections | 1 and existing room gifts | Yes, shadow |
| 3 Rocket backend | 1–2 | Yes, payouts off |
| 4 Rocket UI/admin | 3 | Yes |
| 5 Attendance | 1 and existing seats/LiveKit | Yes, report-only |
| 6 Payroll | 1 and 5 | Yes, payouts off |
| 7 Room Target backend | 1–2 | Yes, payouts off |
| 8 Room Target UI/admin | 7 | Yes |
| 9 Hardening | 1–8 | Required before real payout |
| 10 Rollout | 9 | Final staged gate |

Critical path for the first visible feature:
**1 → 2 → 3 → 4 → 9 → 10**.

Payroll can proceed after the shared foundation:
**1 → 5 → 6 → 9 → 10**.

Room Target can proceed after trusted gift projections:
**1 → 2 → 7 → 8 → 9 → 10**.
