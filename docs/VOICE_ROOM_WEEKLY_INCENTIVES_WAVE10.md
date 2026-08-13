# Weekly Room Incentives — Wave 10 rollout

## Current production state

Wave 10 dark deployment started on 2026-07-30 against
`yallgame-ebd19`. No incentive or payout flag was enabled.

Deployed successfully:

- Firestore rules and indexes
- Storage rules
- Node.js 22 scheduled and HTTP incentive functions
- Admin dashboard and its integrity workspace
- Gift/period reconciliation worker
- Rocket and Room Target cycle/notification workers
- LiveKit attendance webhook, attendance command, and one-minute reconciler
- Payroll cycle/progress workers
- Exactly-once settlement worker
- Integrity monitor and bounded retention worker

Production read-back:

- Admin Hosting returned HTTP 200 with `X-Frame-Options: DENY`.
- Incentive flag fields were absent, which is the fail-closed dark state.
- Gift/settlement dry-run reconciliation scanned zero records with zero drift.
- Gift projection, period reconciliation, attendance reconciliation, and
  settlement runtime documents reported healthy zero-work executions.
- There are no published Rocket or Room Target campaigns yet.
- The room gift commission policy exists at version 1 with 10% commission.

Production verification repeated on 2026-07-30:

- All nine scheduled Wave 10 functions are deployed on Node.js 22.
- Attendance, settlement, and integrity runtime documents reported `ok`.
- The integrity monitor scanned zero records with zero unbalanced records.
- A manual dry-run reconciliation scanned zero gift/settlement records and
  reported zero drift.
- All eight incentive flags resolved to false and no rollout-stage document
  existed, which is Stage 0 by contract.

## Current rollout stage

Wave 10 advanced sequentially from Stage 0 through Stage 1, Stage 2, Stage 3,
and Stage 4 on
2026-07-30 using active Platform Owner
`loVyyTeaNOQTJNSaNyOgtrVTB622`.

Current production state:

- Stage ID: `4`
- Stage name: `payroll-report-only`
- `voice_room_supporter_rankings`: enabled
- `voice_room_attendance_shadow`: enabled
- `voice_room_owner_targets`: enabled
- `voice_room_payroll_tracking`: enabled
- Rocket payout, Room Target payout, payroll payout, and device-attestation
  flags: disabled
- The LiveKit attendance reconciler reports `ok`.

Stage 1 synthetic acceptance used:

- Room: `representative-test-qLaisDcEGpcp5XIJ8XqHpigZqDJ3`
- Sender: `qLaisDcEGpcp5XIJ8XqHpigZqDJ3`
- Recipient: `oyYzJ9D5SdPpwTCEHS6SMXIaiNo2`
- Gift: `wave8_test_rose`
- Immutable event: `rge_96beeed7f1394031b7fa6e1e`
- Economy result: 10 coins debited, 9 gift-earning coins credited, and 1
  platform-commission coin credited
- Scheduled projection result: one canonical fact and matching daily/weekly
  aggregates
- Leaderboard result: the sender ranked first for 10 eligible-spend points in
  both periods
- Final dry-run reconciliation: one balanced event, zero discrepancies

The reusable `rooms:incentives:synthetic-gift` command requires explicit
`--apply` and a caller-provided stable run ID. Production credentials and ID
tokens are never printed.

Initial development campaign defaults were recorded through
`rooms:incentives:defaults`:

- Room Target revision 1 is published for
  `weekly_2026-08-03_asia-baghdad`.
- Weekly target: 500,000 support points.
- Return: 5% in coins.
- Maximum selected users: 3.
- Per-user return cap: 10,000 coins.
- Per-room return cap: 30,000 coins.
- Minimum qualifying gift: 10 coins.
- Publication risk: 50,000 estimated commission, 30,000 maximum liability,
  20,000 remaining margin, viable.
- Rocket revision 1 is draft-only with proposed coin rewards of 10,000, 5,000,
  and 2,500 for ranks 1 through 3.
- Rocket publication remains blocked until genuine immutable assets and
  physical-device animation approval exist.

## Eventarc regional limitation and accepted fallback

The two Firestore accelerators `projectRoomGiftSupport` and
`projectRoomAttendanceSeatState` were not created. Google returned 403 while
validating their Eventarc triggers in `me-central2`.

IAM and location diagnostics completed on 2026-07-30:

- The Firebase deployer has Eventarc Admin.
- The Google-managed Eventarc service identity exists and has Eventarc Service
  Agent.
- Cloud Functions lists `me-central2` as available to this project.
- The effective `gcp.resourceLocations` policy is `allowAll`.
- Eventarc does not list `me-central2` as an available project location even
  though it is a documented public Eventarc region.

The remaining failure is therefore a Google regional-service availability
limitation for this project, not an application IAM or organization-policy
misconfiguration.

The scheduled fallback path is accepted for development rollout because it is
authoritative and idempotent:

- `reconcileRoomSupportProjections` scans immutable gift events every 10
  minutes and projects them idempotently.
- `reconcileLiveKitAttendance` re-reads authoritative membership and LiveKit
  state every minute.

No data is lost. Development UI must tolerate up to ten minutes of supporter,
Rocket, and Room Target projection delay and up to one minute of attendance
delay. Eventarc remains a future latency optimization. If Google exposes
`me-central2` to this project later, deploy only:

```powershell
npx firebase-tools deploy --project yallgame-ebd19 --force `
  --only functions:projectRoomGiftSupport,functions:projectRoomAttendanceSeatState
```

## Staged controller

`weeklyIncentiveRolloutCore.js` and
`scripts/setWeeklyIncentiveRolloutStage.js` define audited stages:

0. Dark
1. Rankings/Rocket presentation, all payouts off
2. Attendance report-only
3. Room Target preview
4. Payroll report-only
5. Rocket synthetic payout (**keeps tracking flags**)
6. Room Target + Rocket synthetic payout (**accumulates stage 5**)
7. Payroll + Room Target + Rocket synthetic payout (**accumulates stage 6**)

Stages must advance sequentially. Economic stages require
`--acknowledge-economic-impact`. Stage 0 is always available as an immediate
rollback. Missing rollout state is treated as Stage 0.

Wave 4 (competitive growth) fixed stages 5–7 so advancing no longer clears
earlier payout rails. See
[`COMPETITIVE_SOCIAL_GROWTH_WAVE4.md`](./COMPETITIVE_SOCIAL_GROWTH_WAVE4.md).

## Gates before Stage 1

- Keep both scheduled fallback workers healthy; Eventarc is not a Stage 1 gate.
- Run one isolated gift cycle in the representative test room and reconcile its
  immutable gift, projection, commission, wallet, and public aggregate records.

These Stage 1 gates are complete.

## Gates before Stage 3

- Platform Owner publishes the Room Target campaign.
- Platform Owner publishes the Rocket campaign before Rocket presentation,
  including approved appearance, fallback, animation evidence, goal, and rank
  rewards.
- Complete controlled physical-device attendance sessions before using
  attendance evidence for payroll qualification.

The Room Target publication gate is complete. Rocket assets are not required
for Stage 3 because Rocket payouts remain disabled.

## Gates before Stage 4

- Create reviewed payroll plans for super admins, employees, and female hosts.
- Enroll only explicit development accounts.
- Record controlled physical-device attendance evidence before relying on
  report-only qualification results.
- Keep `voice_room_payroll_payouts` disabled.

The configuration portion of this gate is complete with editable development
placeholders effective from `weekly_2026-08-03_asia-baghdad`:

- Super Admin: 500 diamonds weekly, 60 minutes daily, all seven days.
- Employee: 400 diamonds weekly, 60 minutes daily, all seven days.
- Female Host: 700 diamonds weekly, 120 minutes daily, all seven days.
- All plans use the mandatory five-minute continuous-mute grace.
- `qLaisDcEGpcp5XIJ8XqHpigZqDJ3` is enrolled as an Employee development
  account.
- `oyYzJ9D5SdPpwTCEHS6SMXIaiNo2` is enrolled as a Super Admin development
  account.
- Female Host enrollment remains intentionally empty until a female-classified
  development profile is bound from a physical device.

Stage 4 is active in report-only mode. These values are placeholders, not
approved compensation, and must be reviewed before any payout stage.

## Gates intentionally still open

- Physical `expo run:android` RTL, TalkBack, reduced-motion, audio, reconnect,
  memory, and animation verification.
- iOS Firebase plist and native test matrix.
- Load/contention and chaos tests.
- Rollback rehearsal.
- Product, engineering, moderation, support, finance/privacy, and marketplace
  sign-offs.
- Synthetic campaign and payout cycles.

No broad release or real-user payout is permitted until those gates are
recorded.
