# Weekly Room Incentives — Wave 9

## Result

Wave 9 is implemented locally. It adds the security, abuse prevention,
reconciliation, observability, recovery, and retention layer required before a
staged payout rollout. It does not deploy services, enable flags, or modify
production data.

## Financial integrity

- Every eligible settlement is evaluated before lease acquisition or payout.
- High-risk and critical signals move the job to `held`; no wallet or item
  destination is written.
- The bounded detector covers self/circular gifting, rapid pass-through,
  refund/reversal events, shared-device clusters, selected-member churn,
  reward stacking beyond retained commission, and mute-grace cycling.
- An owner may approve or reject a held settlement through an idempotent,
  audited dashboard command. Approval resumes the existing exactly-once worker.
- Gift reconciliation checks sender debit against recipient credit and platform
  share. Paid reward reconciliation checks exactly one settlement against every
  wallet ledger, item ledger, and active entitlement.
- Existing projection reconciliation continues comparing immutable canonical
  gift facts with room totals and public leaderboard projections.

## Security

- Raw room gift events and contribution documents are backend-only.
- Published Rocket and Room Target manifests require an active public profile.
- Risk assessments, integrity alerts, reconciliation reports, roster churn,
  device evidence, attendance evidence, payroll records, settlements, wallets,
  and entitlements are denied to mobile clients.
- Dashboard access is permission based: auditors can inspect; only
  `incentives:manage` operators can review or apply repairs. Payroll/device
  evidence remains behind the separate payroll permission.

## Operations

- `monitorWeeklyIncentiveIntegrity` reconciles bounded gift and paid-settlement
  pages every 15 minutes and persists its cursor and health.
- Settlement and attendance workers publish last-run, lag, processed, held, and
  failure health.
- The dashboard reports scheduler lag, held count/value, failed payouts,
  reconciliation drift, and estimated liability.
- `reconcileWeeklyIncentives.js` defaults to dry-run. `--apply` requires an
  explicit Platform Owner UID and writes an audit record.
- A daily retention worker removes only expired, non-legal-hold records in
  bounded batches and records the deletion paths. Financial ledgers use a
  seven-year policy; canonical gift facts two years; attendance/device evidence
  six months; public leaderboard history 90 days; audit evidence one year.

## Verification

- Functions/core/admin tests: 905 passing in the full application suite.
- Focused Wave 9/admin tests: 48 passing.
- Firestore and Storage emulator rules suites: passing.
- Admin dashboard: typecheck, 20 tests, production build, and bundle budget
  passing.
- Root TypeScript and Wave 9 function syntax checks: passing.

## Rollout boundary

All incentive flags remain off. Wave 10 must deploy indexes/rules/functions and
the dashboard first, then run synthetic dry-run and apply reconciliation before
any payout flag is enabled.
