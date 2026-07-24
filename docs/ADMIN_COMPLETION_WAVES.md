# Admin Dashboard Completion Waves

## Objective

Finish the remaining Store and user-operations work, verify it against realistic states, and
release only the required Firebase backend changes. Dashboard Hosting is explicitly outside this
plan and must not be deployed as part of any wave below.

## Delivery status

- Wave 4 — Store operational completion: complete
- Wave 5 — Complete user operational context: complete
- Wave 6 — Pagination, integration, and authenticated UX QA: complete
- Wave 7 — Rules verification and backend release: partially complete (backend deployed; Storage setup and direct production conflict replay remain)

## Release boundary

Allowed after verification:

- The `adminDashboard` Cloud Function and any other backend function proven to have changed.
- Required Firestore rules and indexes.
- Required Firebase Storage rules.

Explicitly excluded:

- Firebase Hosting deployment.
- Any `firebase deploy --only hosting` command.
- Any combined deployment command that implicitly includes Hosting.
- Destructive catalog bulk changes or unaudited user-data mutations.

## Wave 4 — Store operational completion

### 4A — Item intelligence

- Add a protected item-detail contract with purchase count, gift count, ownership count, active
  ownership count, expired ownership count, revenue by currency, and remaining-stock context.
- Add item-scoped history combining catalog edits, purchases, gifts, and stock movement.
- Add item inspector links from catalog rows and transaction records.
- Distinguish complete metrics from safely sampled metrics in both API and UI.

### 4B — Complete exports and cleanup

- Replace visible-row CSV export with a backend-generated export using the active filters.
- Apply export row limits, truncation reporting, spreadsheet-formula protection, and audit logging.
- Add safe cleanup for newly uploaded assets when catalog writes fail.
- Define a conservative orphan-asset cleanup path that never removes URLs referenced by a live
  catalog record.
- Add retry, stale-conflict, partial-error, empty-result, and large-result tests.

### Wave 4 exit criteria

- Every catalog item can be traced through edits, sales, gifts, ownership, stock, and revenue.
- CSV represents the full filtered backend result up to a documented safe limit.
- Failed catalog mutations do not leave a visible partial edit or untracked asset.
- Store permission variants and all new contracts have automated coverage.

## Wave 5 — Complete user operational context

### 5A — Safety, rooms, and reports

- Add report summaries where the user is reporter or target, including open, urgent, and recent
  resolved counts plus direct report links.
- Add current/recent room membership, hosting context, room moderation history, and room links.
- Add friendship, incoming/outgoing request, block, couple-request, and recent social-gift context.
- Keep sensitive data behind `users:view`; keep all mutations behind their existing action-level
  permissions.

### 5B — Store and economy ownership

- Add owned and equipped Store items, acquisition source, state, and expiration.
- Add Store gifts sent and received.
- Add wallet recharge receipts and representative transfer history.
- Add direct links from ownerships, gifts, and transactions back to Store records and Audit events.
- Return bounded section payloads rather than making the initial identity request unbounded.

### Wave 5 exit criteria

- The dossier provides a coherent path through identity, safety, rooms, reports, relationships,
  Store ownership, gifts, receipts, transfers, notes, and audit context.
- Read-only administrators see complete context without mutation controls.
- Missing optional collections produce explicit empty states rather than failing the whole dossier.
- Every new query has required indexes, limits, mapping tests, and authorization tests.

## Wave 6 — Pagination, integration, and authenticated UX QA

### 6A — Scalable history and navigation

- Add cursor pagination for notes, administrative activity, room history, reports, ownerships,
  gifts, receipts, and transfers where the safe recent limit can be exceeded.
- Preserve user, section, filters, cursor context, and list scroll position across cross-links.
- Complete deep links among Users, Store, Reports, Rooms, and Audit.
- Add retry boundaries so one failed operational section does not hide the rest of the dossier.

### 6B — Professional-state verification

- Verify loading, empty, filtered-empty, permission-limited, stale-conflict, partial-error, retry,
  long-ID, long-Arabic-copy, and large-data states.
- Perform authenticated inspection at desktop, tablet, and mobile breakpoints.
- Verify keyboard navigation, focus restoration, Escape handling, RTL order, text isolation,
  reduced motion, and touch target sizes.
- Fix visual regressions while preserving the established black, bronze, burgundy, and gold style.

### Wave 6 exit criteria

- All paginated sections remain stable without duplicated or skipped records.
- Cross-links restore the intended user, section, and filters.
- The protected Store and user workspaces pass authenticated responsive and accessibility review.
- No loading or partial-error state produces a blank workspace or an actionable control without
  permission.

## Wave 7 — Rules verification and backend release

### 7A — Emulator and release verification

- Make the pinned Firebase CLI available locally without changing the production project.
- Run Firestore and Storage emulator suites, including versioned Store assets and unauthorized
  access cases.
- Run dashboard typecheck, dashboard tests, all function tests, Functions lint, production build,
  and bundle budgets from a clean verification pass.
- Review the exact backend and rules diff and identify the minimum deploy target list.

### 7B — Backend-only deployment

- Deploy only the changed function targets, expected to include `functions:adminDashboard`.
- Deploy only required Firestore rules/indexes and Storage rules.
- Do not deploy Hosting, even if `firebase.json` contains a Hosting configuration.
- Smoke-test authenticated read operations, permission denial, one reversible mutation path,
  conflict handling, and Audit creation against the production backend.
- Record deployed targets, Firebase project, verification results, and rollback notes.

### Wave 7 exit criteria

- Emulator suites and the full automated verification matrix pass.
- Production backend contracts match the dashboard client.
- Rules deny unauthorized reads and writes while allowing verified administrators as intended.
- Production smoke tests pass and generate expected Audit records.
- No Hosting deployment occurs.

### Wave 7 release record — 2026-07-22

- Firebase project: `yallgame-ebd19`.
- Deployed targets: `functions:adminDashboard`, `firestore:rules`, and `firestore:indexes`.
- Explicitly not deployed: Firebase Hosting, Firebase Storage rules, and all other Cloud Functions.
- Automated verification passed: 76 application test files / 486 tests, Functions lint,
  dashboard typecheck, 8 dashboard test files / 19 tests, production build, bundle budget,
  Firestore rules emulator suite, and Firebase rules/index/function dry runs.
- Authenticated production reads passed for Overview, Users, the full user operations inspector,
  Rooms, Reports, Store, Store item editor, Audit, Audit event detail, and Settings.
- Authenticated RTL responsive checks passed at desktop, tablet, and mobile widths. The mobile
  Settings and Users workspaces, including the user inspector, had no document-level horizontal
  overflow.
- Reversible production mutation passed: `reduceMotion` was enabled and restored to its original
  disabled state. Both operations produced completed `admin-settings-update` Audit records.
- The restored Users history initially showed the pre-deployment empty result; the explicit refresh
  correctly loaded both production users. This was cached navigation state, not an API contract
  failure.
- Remaining release gates: Firebase Storage is not initialized for this project, so `storage.rules`
  cannot be emulator/deployment-completed against the production project until a bucket is created;
  the duplicate-request conflict path passed automated tests but has not been replayed directly in
  production because the dashboard UI intentionally generates a fresh request ID for every action.
- Non-blocking Firebase warning: cleanup of old function build images failed after the successful
  deployment and may leave billable images in the project's GCR repository.
- Deferred maintenance: `firebase-functions` is behind the current major version; upgrade separately
  because Firebase reports breaking changes.
- Rollback: redeploy the prior `adminDashboard` source and prior Firestore rules/index file set with
  the same explicit `--only` boundary. Never include Hosting in a rollback command.

## Required sequence

1. Complete Store metrics, history, exports, and asset safety.
2. Complete user safety, social, room, report, Store, and economy context.
3. Add scalable pagination and finish authenticated responsive QA.
4. Verify rules in emulators.
5. Deploy and smoke-test only the required backend functions and rules.

Wave 7 must not begin deployment until Waves 4–6 meet their exit criteria. A Firebase CLI setup or
administrator sign-in may be requested earlier for verification, but neither authorizes Hosting.
