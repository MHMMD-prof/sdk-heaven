# Weekly Incentives Wave 6 — Automated Payroll

**Status (2026-07-30): implemented and verified locally; not deployed.**

Both payroll feature flags remain disabled. No production salary accrual or
payout was enabled by this work.

## Delivered behavior

- Platform Owner payroll plans support Super Admin, employee/worker, and
  approved female-host categories.
- Each plan fixes its currency, weekly amount, daily minimum, required
  weekdays, Baghdad timezone, five-minute mute grace, enabled state, revision,
  and effective cycle.
- Payroll enrollment is a separate record from authorization claims. Giving or
  removing an application admin role does not create, remove, or change salary.
- One payroll enrollment document exists per UID, preventing accidental salary
  stacking across plans.
- Plan, amount, resume, end, and enrollment changes are pending until the next
  Baghdad weekly cycle. Safety suspension and payout holds are immediate.
- Plans and enrollments are copied into immutable per-cycle snapshots before
  qualification.
- Qualification requires every configured day. Outcomes distinguish paid,
  missed day, insufficient time, suspension, ineligible profile, device
  conflict, hold, and settlement failure.
- Approved outage windows add excused time. Platform Owner day exceptions are
  limited to the active cycle and create immutable audit evidence.
- Stable settlement IDs reuse the common transaction engine, so scheduler
  retries cannot create a duplicate wallet credit or item entitlement.
- Releasing a payroll hold requeues held payroll settlement jobs. Paid outcomes
  are reconciled against the wallet and entitlement ledgers.

## Attendance contract

Salary time comes only from backend-owned attendance intervals:

1. the LiveKit participant is connected;
2. the user occupies a server-owned speaker seat;
3. a microphone track is published;
4. counting stops after five continuous muted minutes.

Intervals are unioned by UID before daily evaluation, so concurrent rooms do
not double-count. Open intervals are counted only while the matching
authoritative attendance session still identifies them as active. The system
does not record, transcribe, or inspect speech.

Female-host enrollment additionally requires a female public profile and an
active trusted-device enrollment belonging to the same UID. Device attestation
enforcement remains gated because Expo SDK 56 App Integrity is alpha. It must
not be enabled until a production development build passes the physical-device
replacement, recovery, conflict, and false-positive test matrix.

## Admin experience

The Incentives workspace now includes:

- projected weekly coins and diamonds;
- plan creation/editing with all seven required-day controls;
- the requested quick flow: plan, UID, and optional salary override;
- a roster whose state is independent of app authorization roles;
- immediate suspend, hold, and release actions;
- next-cycle resume and end actions;
- active-cycle audited day exceptions;
- recent qualification outcomes and per-day completion;
- settlement failure codes and ledger reconciliation status;
- the existing trusted-attendance evidence inspector for raw daily minutes,
  intervals, reconnects, mute grace, and outage windows.

Only Platform Owners have `payroll:manage`. Platform Owners and auditors can
read payroll operations through `payroll:view`.

## Employee experience

An authenticated user can request only their own payroll progress. When
enrolled, the Me page shows:

- plan and weekly amount;
- required days;
- qualified versus required minutes for each day;
- completed-day count;
- the fixed mute-grace explanation.

The endpoint derives from `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` by default.
`EXPO_PUBLIC_PAYROLL_PROGRESS_ENDPOINT` is an optional explicit override.

## Backend data

All collections are backend-only in Firestore Rules:

- `payrollPlans`
- `payrollEnrollments`
- `payrollCycles/{cycle}/enrollments/{uid}`
- `payrollOutcomes`
- `payrollExceptions`
- `payrollAdminCommands`
- shared `weeklyIncentiveHolds`
- shared `rewardSettlementJobs` and `rewardSettlements`

The admin API and employee self-progress endpoint are the only supported read
paths. Every economic write remains authoritative backend code.

## Schedulers

- `processPayrollCycles`: hourly; snapshots the active cycle, settles the prior
  cycle in resumable UID batches, and synchronizes payout outcomes.
- `processWeeklyIncentiveSettlements`: every five minutes; leases and pays
  eligible common settlement jobs only when the feature-specific payout flag
  is enabled.

Cycle pagination is persisted on each plan cycle. Repeated and overlapping
invocations are safe because snapshots, outcomes, settlement jobs, and wallet
credits all use deterministic identifiers.

## Feature gates and rollout

The independent gates are:

- `voice_room_payroll_tracking`
- `voice_room_payroll_payouts`

Required order:

1. deploy Functions, indexes, and Rules while both flags are false;
2. deploy the client and dashboard;
3. complete physical Expo SDK 56 attendance/device testing;
4. seed plans and enroll test UIDs for the next cycle;
5. enable tracking only and compare one full shadow week;
6. obtain finance, privacy/legal, worker-classification, fraud, and marketplace
   approval;
7. reconcile projected versus expected salary manually;
8. enable payouts for a tightly controlled test cycle;
9. verify every ledger result before wider rollout.

Never enable payouts before a complete tracking cycle has closed successfully.

## Verification evidence

- Application: 154 test files / 877 tests passed.
- Wave 6 focused: 4 files / 17 tests passed.
- Functions Wave 6 syntax checks passed.
- Application and dashboard TypeScript checks passed.
- Admin dashboard: 8 files / 20 tests, production build, and bundle budgets
  passed. Payroll CSS is emitted with the lazy Incentives chunk.
- Firestore and Storage emulator rule suites passed.
- Expo SDK 56 Android export passed (2,161 modules). Expo also reported the
  existing missing iOS `GoogleService-Info.plist`; it did not fail the Android
  export and remains an iOS configuration task.
- No deployment or feature-flag mutation was performed.

Physical Android, app-background, network-switch, midnight, device replacement,
TalkBack/RTL, and real wallet test-cycle evidence remain rollout gates, not
local-code claims.
