# Admin Dashboard Plan Implementation Tracker

This file tracks the production admin dashboard as a separate Vite React website, plus role authorization, moderation tooling, analytics, and audit coverage waves.

# Architecture guardrails
Status: ACTIVE

The dashboard is a separate Vite React web app, not an Expo screen. Keep dashboard code, dependencies, TypeScript config, tests, and build output under a dedicated `admin-dashboard/` package, with root scripts only delegating through `npm --prefix admin-dashboard ...` if needed. Do not import React Native, Expo UI components, mobile navigation, LiveKit client UI, or mobile-only modules into the dashboard.

Firebase custom claims are the source of truth for admin authority. Firestore may store admin profile metadata or audit records, but no client-writable Firestore document can grant admin access. All privileged writes, role changes, broad user reads, exports, moderation actions, and audit writes must go through backend code that verifies the signed-in user's ID token and admin claim.

The Vite app may read only narrowly scoped admin dashboard documents allowed by Firestore rules. Prefer backend-computed aggregates, paginated callable Function results, and explicit query limits over broad client collection scans. Environment variables must use Vite `VITE_` names and must contain only public Firebase web config, never service account credentials, private keys, LiveKit secrets, or admin bootstrap secrets.

# Wave 0 - Admin authority foundation
Status: COMPLETE
Checkpoint commit: cbf0139f4561bee4da304bcc47e5bb47d2466573
Implementation commit: 566c6955f7fbf0a838cc36efc185ec0218857748
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add Firebase custom claims as the only admin role authority, set through trusted backend tooling or a protected one-time bootstrap path. Optionally add read-only admin profile metadata for display and audit context, but never let a client-writable Firestore document grant access. Document the first-admin bootstrap process, required Firebase Auth state, and how to revoke an admin.

Wave 0 implementation plan:
- Touched files: add a focused Firebase Functions helper for admin custom claim validation/claim payload creation, add tests for that helper, add a trusted local admin-claim management script under `functions/`, add a root/admin docs page for bootstrap and revoke operations, and update `functions/package.json` scripts only if needed.
- Risks: accidentally creating a public privilege-escalation path, overwriting existing custom claims, committing secrets, or coupling dashboard authority to Firestore metadata. Keep authority in Firebase Auth custom claims and make the script require trusted Firebase Admin credentials outside the client apps.
- Required tests/checks: run the new helper tests, existing Functions core tests, `npm --prefix functions run lint`, and relevant root Vitest tests if shared code is touched.
- Rollback considerations: revert the implementation commit to remove the helper, script, docs, and script entry; the checkpoint commit remains a clean restore point for the pre-dashboard state.

Verification notes:
- PASSED: `npx vitest run functions\adminClaimsCore.test.mjs`
- PASSED: `npx vitest run functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm test` after the in-progress auth Wave 6 room-presence fixture stopped blocking the suite.
- PASSED after review fix: `npx vitest run functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED after review fix: `npm --prefix functions run lint`
- PASSED after review fix: `npm test`

Review notes:
- PASSED: Admin authority remains Firebase custom claims only; no public grant endpoint was added.
- PASSED: Claim updates preserve unrelated existing custom claims.
- PASSED after fix: CLI argument parsing now rejects multiple modes, missing flag values, and unknown arguments.

# Wave 1 - Firestore and Function access model
Status: COMPLETE
Checkpoint commit: d07b025da4e7c1f93a543b812bee4f59e2974e8f
Implementation commit: 60e6b2ce2fb39f480590195c3f5958436a365c73
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add admin-only Firestore rules and callable Function guards for dashboard reads and privileged mutations. Keep existing owner profile and room membership rules intact, and route sensitive actions through backend code instead of direct client writes.

Wave 1 implementation plan:
- Touched files: add a focused admin dashboard Function core guard, expose one minimal `adminDashboard` HTTP Function that verifies a Firebase ID token and requires `admin === true`, update Firestore rules with admin-only dashboard/audit metadata read paths and no client writes, add Function guard tests, and update Functions lint coverage.
- Risks: accidentally allowing non-admin reads, allowing client writes to admin/audit collections, broadening existing `users` or `rooms` access, or coupling Wave 1 to later dashboard UI/metrics. Keep this wave to access boundaries only.
- Required tests/checks: run new admin dashboard Function core tests, existing Functions core tests, `npm --prefix functions run lint`, and full `npm test`.
- Rollback considerations: revert the Wave 1 implementation commit to remove the Function guard, rules additions, tests, and tracker updates; checkpoint `d07b025da4e7c1f93a543b812bee4f59e2974e8f` preserves the pre-Wave 1 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm test`

Review notes:
- PASSED: `adminDashboard` requires a verified Firebase ID token with boolean `admin === true`.
- PASSED: Firestore dashboard, audit, and admin profile paths are admin-read-only with client writes denied.
- PASSED: Existing owner profile, room, membership, moderation, and presence rules were not broadened.

# Wave 2 - Vite React dashboard foundation
Status: COMPLETE
Checkpoint commit: 60d77293e1ad882e61581db6404bf0a5b84dcc25
Implementation commit: 586ca816cc0c21c1378908fab64f639e16edf7fa
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Create a separate Vite React website under `admin-dashboard/`, with isolated dependencies, package scripts, TypeScript config, routing, Firebase web client initialization, environment documentation, and a web-only auth gate. Keep web dependencies out of the Expo app unless they are already shared safely, and do not add dashboard routes, tabs, or screens to the mobile app.

Wave 2 implementation plan:
- Touched files: add an isolated `admin-dashboard/` Vite React package with package scripts, TypeScript config, Vite config, HTML entry, React source, Firebase web client setup, auth/admin route gate, environment example/docs, and root delegation scripts if useful.
- Risks: leaking secrets through Vite env vars, importing Expo/React Native/mobile modules, coupling dashboard routing to the mobile app, or adding dependencies to the root app instead of the dashboard package. Keep all web code and dependencies inside `admin-dashboard/`.
- Required tests/checks: run dashboard package install if needed, dashboard typecheck/build, any dashboard tests added, root `npm test`, and `npm --prefix functions run lint` to ensure prior waves still pass.
- Rollback considerations: revert the Wave 2 implementation commit to remove `admin-dashboard/` and root script additions; checkpoint `60d77293e1ad882e61581db6404bf0a5b84dcc25` preserves the pre-Wave 2 state.

Verification notes:
- PASSED: `npm --prefix admin-dashboard install`
- PASSED: `npm --prefix admin-dashboard run typecheck`
- PASSED: `npm --prefix admin-dashboard run build` after sandbox denial was rerun with approved filesystem access.
- PASSED: `npm test`
- PASSED: `npm --prefix functions run lint`
- PASSED after review routing/copy fixes: `npm --prefix admin-dashboard run typecheck`
- PASSED after review routing/copy fixes: `npm --prefix admin-dashboard run build`
- PASSED after review routing/copy fixes: `npm --prefix functions run lint`
- PASSED after review routing/copy fixes: `npm test`

Review notes:
- PASSED: Dashboard remains isolated under `admin-dashboard/` and imports no Expo, React Native, mobile navigation, or mobile UI modules.
- PASSED: Vite env example contains only public Firebase web config names and no secrets.
- PASSED after fix: section navigation uses browser history routes and placeholder copy is operational empty-state text, not future-feature instructions.

# Wave 3 - Admin overview metrics
Status: COMPLETE
Checkpoint commit: 192ec5947aa7310f1caa993eafe2deafe7dd2fec
Implementation commit: 17a2168865c96970a1c601ce20d458c61acc6fbe
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Build the first web dashboard screen with operational summaries for users, active rooms, game sessions, moderation actions, and recent system health. Prefer aggregate documents or backend-computed summaries so the Vite site does not need broad collection scans.

Wave 3 implementation plan:
- Touched files: extend the admin dashboard Function core and HTTP handler with a narrow `overview` action that returns backend-computed summary counts, add focused tests for the overview payload shape and admin guard, and update the Vite dashboard to fetch and render those summaries on the Overview route with loading/error/refresh states.
- Risks: broad client collection scans, exposing non-admin metrics, making the Vite app depend on mobile modules, or treating placeholder data as authoritative. Keep all data reads inside the backend Function and return only aggregate counts.
- Required tests/checks: run focused Functions tests, `npm --prefix functions run lint`, `npm --prefix admin-dashboard run typecheck`, `npm --prefix admin-dashboard run build`, and root `npm test`. Do not run Firebase emulator commands in this wave.
- Rollback considerations: revert the Wave 3 implementation commit to remove the overview Function action, tests, and dashboard overview UI; checkpoint `192ec5947aa7310f1caa993eafe2deafe7dd2fec` preserves the pre-Wave 3 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- FAILED then fixed: `npm --prefix admin-dashboard run typecheck` initially failed on missing `error` response fields in dashboard API types.
- PASSED after fix: `npm --prefix admin-dashboard run typecheck`
- BLOCKED: `npm --prefix admin-dashboard run build` could not run because the app approval gate rejected the required filesystem escalation after the account usage limit was reached. Resume verification here before review or commit.
- PASSED after resume: `npm --prefix admin-dashboard run build`
- PASSED after resume: `npm --prefix admin-dashboard run typecheck`
- PASSED after resume: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED after resume: `npm --prefix functions run lint`
- PASSED after resume: `npm test`
- PASSED after overview payload review fix: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED after overview payload review fix: `npm --prefix functions run lint`
- PASSED after overview payload review fix: `npm --prefix admin-dashboard run typecheck`
- PASSED after overview payload review fix: `npm --prefix admin-dashboard run build`
- PASSED after overview payload review fix: `npm test`

Review notes:
- PASSED: Overview data is fetched through the admin-only backend Function; the Vite client does not scan Firestore collections.
- PASSED after fix: Overview payload includes user, active-room, game-room, moderation, report, audit, generated timestamp, and system status fields.
- PASSED: No Expo, React Native, mobile navigation, secrets, or emulator commands were added for this wave.

Review notes:
- PASSED: overview metrics are fetched through the admin-only Function, not direct client collection scans.
- PASSED: the Vite dashboard remains isolated from Expo/React Native modules.
- PASSED: loading, error, refresh, and ready states are represented on the overview panel.

# Wave 4 - User management tools
Status: COMPLETE
Checkpoint commit: 6de0b5b2e7b5aa8f42df7292e973f60a054ea89f
Implementation commit: 00f97938e89fb276d897d2e54fe4ee598157f0af
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add searchable user profile review with account status, profile metadata, recent room activity, and safe admin actions. Support limited actions first, such as profile review flags or account notes, and defer destructive account actions until lifecycle flows are fully designed.

Wave 4 implementation plan:
- Touched files: extend the admin dashboard Function core and HTTP handler with `users` and `user-note` actions, add tests for user query/note normalization and user row mapping, update Firestore rules for explicit admin note access boundaries, and update the Vite Users route with backend-limited search, refresh, loading/error/empty states, and note submission.
- Risks: broad client collection scans, exposing private user data, destructive account operations, or client-side writes to admin note collections. Keep user reads/writes behind the admin-only Function, return safe profile fields only, cap result limits, and support notes as append-only backend writes.
- Required tests/checks: run focused Functions tests, `npm --prefix functions run lint`, `npm --prefix admin-dashboard run typecheck`, `npm --prefix admin-dashboard run build`, and root `npm test`. Do not run Firebase emulator commands in this wave.
- Rollback considerations: revert the Wave 4 implementation commit to remove user search/note actions, tests, and dashboard Users UI; checkpoint `6de0b5b2e7b5aa8f42df7292e973f60a054ea89f` preserves the pre-Wave 4 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm --prefix admin-dashboard run typecheck`
- PASSED: `npm test`
- BLOCKED then passed after resume: `npm --prefix admin-dashboard run build` initially could not run because the app approval gate rejected the required filesystem escalation after the account usage limit was reached; rerun passed.
- PASSED after review fix: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED after review fix: `npm --prefix functions run lint`
- PASSED after review fix: `npm --prefix admin-dashboard run typecheck`
- PASSED after review fix: `npm --prefix admin-dashboard run build` with approved filesystem access after sandbox denial.
- PASSED after review fix: `npm test`

Review notes:
- NOTE: The main Wave 4 user-management code was already captured in commit `012ce98` during a later checkpoint before this resume; implementation commit `00f97938e89fb276d897d2e54fe4ee598157f0af` finalizes the wave with tracker updates and explicit admin note rules.
- PASSED after fix: user search keeps returned rows capped at 25 while scanning a bounded 100 rows when a search term is present, avoiding a misleading first-page-only search.
- PASSED: user reads and note writes remain behind the admin-only Function; the Vite client does not scan Firestore or write notes directly.
- PASSED after final review fix: `adminUserNotes` has explicit Firestore admin-read/client-write-denied rules.
- PASSED: no destructive account actions, mobile app imports, Expo dependencies, or emulator-only requirements were added.

# Wave 5 - Room and voice moderation console
Status: COMPLETE
Checkpoint commit: 446afc44dbd345b95682af2e526886cafcf6d29d
Implementation commit: 0d1825703b97f74bb21bd90fe140e3e752c548ad
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add admin room discovery across active and recently closed rooms, including host, participant counts, member status, moderation history, and room close/remove actions. Reuse existing room moderation events where possible and write every admin action to an audit trail.

Wave 5 implementation plan:
- Touched files: extend the admin dashboard Function core and HTTP handler with room discovery and safe room moderation actions, add focused Functions tests for room row/action normalization, update Firestore rules for explicit admin audit/moderation boundaries if needed, and update the Vite Rooms route with backend-limited filters, refresh, loading/error/empty states, room metadata, and safe close/remove controls.
- Risks: broad client collection scans, destructive room changes without audit records, exposing private room invite data beyond admin-only responses, duplicating existing room moderation logic, or importing Expo/mobile modules into the Vite dashboard. Keep room reads and writes behind the admin-only Function, cap result sizes, write backend audit events for every moderation action, and avoid emulator-only flows in this wave.
- Required tests/checks: run focused Functions tests, `npm --prefix functions run lint`, `npm --prefix admin-dashboard run typecheck`, `npm --prefix admin-dashboard run build`, and root `npm test`. Do not run Firebase emulator commands in this wave.
- Rollback considerations: revert the Wave 5 implementation commit to remove admin room discovery/action APIs, tests, rules updates, and dashboard Rooms UI; checkpoint `446afc44dbd345b95682af2e526886cafcf6d29d` preserves the pre-Wave 5 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm --prefix admin-dashboard run typecheck`
- PASSED: `npm --prefix admin-dashboard run build`
- PASSED: `npm test`
- PASSED after review fix: `npm --prefix functions run lint`
- PASSED after review fix: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED after review fix: `npm test`

Review notes:
- PASSED: Room discovery and close/remove-member actions are routed through the admin-only Function; the Vite client does not scan Firestore directly.
- PASSED: Room rows omit invite codes and private secrets while preserving operational room metadata.
- PASSED after fix: expected admin room action conflicts return clear 4xx responses instead of generic 500s.
- PASSED: Successful room actions write both room moderation events and immutable admin audit events.
- PASSED: No Expo, React Native, mobile navigation, destructive deletes, or emulator commands were added for this wave.

# Wave 6 - Reports and abuse workflow
Status: COMPLETE
Checkpoint commit: 6268204ae8550816fc6cb4438bf9f7835b79d315
Implementation commit: f70d484832ce218f6d78d5e5f4b43a635f5f1ec4
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Add a report intake model for users, rooms, games, and voice behavior. Build triage states, assignment metadata, resolution notes, and links back to user and room records so admin moderation is trackable instead of one-off.

Wave 6 implementation plan:
- Touched files: extend the admin dashboard Function core and HTTP handler with `reports` and `report-action` actions, add focused tests for report query/action normalization and safe row mapping, and update the Vite Reports route with backend-limited status filters, refresh, loading/error/empty states, report metadata, assignment/resolution controls, and audit-backed action submission.
- Risks: broad client collection scans, exposing private report details beyond admin-only responses, letting clients mutate report documents directly, weakening immutable audit posture, or mixing the Vite dashboard with Expo/mobile code. Keep all report reads/writes behind the admin-only Function, cap results, normalize notes/status transitions, and write admin audit events for each report action.
- Required tests/checks: run focused Functions tests, `npm --prefix functions run lint`, `npm --prefix admin-dashboard run typecheck`, `npm --prefix admin-dashboard run build`, and root `npm test`. Do not run Firebase emulator commands in this wave.
- Rollback considerations: revert the Wave 6 implementation commit to remove admin report APIs, tests, and dashboard Reports UI; checkpoint `6268204ae8550816fc6cb4438bf9f7835b79d315` preserves the pre-Wave 6 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm --prefix admin-dashboard run typecheck`
- PASSED: `npm --prefix admin-dashboard run build`
- PASSED: `npm test`

Review notes:
- NOTE: Wave 6 implementation files were captured in commit `f70d484832ce218f6d78d5e5f4b43a635f5f1ec4` while this run was in progress; this tracker update records that commit as the Wave 6 implementation commit.
- PASSED: Report intake is created from the backend `report-member` room command and dashboard report reads/actions are routed through the admin-only Function.
- PASSED: Report rows expose bounded operational fields only, and the Vite dashboard does not scan Firestore directly or write report documents directly.
- PASSED: Assign/resolve report actions normalize status transitions, write admin audit events, and return clear validation errors for expected bad requests.
- PASSED: No Expo, React Native, mobile navigation, client-side role grants, secrets, destructive deletes, or emulator commands were added for this wave.

# Wave 7 - Audit log and accountability
Status: COMPLETE
Checkpoint commit: f6522ea3ac8f2de8f994f2f4bf4c430bcaad1dbb
Implementation commit: dc6520f809b30f920561862bbc7218ffe32e27f5
Plan: COMPLETE
Implementation: COMPLETE
Verification: PASSED
Review: PASSED
Commit: COMPLETE

Create immutable admin audit events for role changes, user actions, room actions, report resolutions, and dashboard data exports. Restrict audit writes to backend services and allow admin reads with filters for actor, target, action type, and date.

Wave 7 implementation plan:
- Touched files: extend the admin dashboard Function core and HTTP handler with an `audit-events` action, add focused tests for audit query normalization and safe audit row mapping, and update the Vite Audit route with backend-limited filters, refresh, loading/error/empty states, actor/target/action/date fields, and links back to related room/report/user identifiers when available.
- Risks: exposing private payload details, allowing client-side audit writes, broad client collection scans, mixing audit records with mutable workflow state, or importing Expo/mobile modules into the Vite dashboard. Keep audit reads behind the admin-only Function, return bounded rows, keep writes backend-only, and preserve Firestore rules that deny client writes.
- Required tests/checks: run focused Functions tests, `npm --prefix functions run lint`, `npm --prefix admin-dashboard run typecheck`, `npm --prefix admin-dashboard run build`, and root `npm test`. Do not run Firebase emulator commands in this wave.
- Rollback considerations: revert the Wave 7 implementation commit to remove admin audit listing APIs, tests, and dashboard Audit UI; checkpoint `f6522ea3ac8f2de8f994f2f4bf4c430bcaad1dbb` preserves the pre-Wave 7 state.

Verification notes:
- PASSED: `npx vitest run functions\adminDashboardCore.test.mjs functions\adminClaimsCore.test.mjs functions\livekitTokenCore.test.mjs functions\roomCommandCore.test.mjs`
- PASSED: `npm --prefix functions run lint`
- PASSED: `npm --prefix admin-dashboard run typecheck`
- PASSED: `npm --prefix admin-dashboard run build`
- PASSED: `npm test`

Review notes:
- PASSED: Audit event reads are routed through the admin-only Function and return bounded rows from `adminAuditEvents`.
- PASSED: The Vite dashboard does not read Firestore directly or write audit documents.
- PASSED: Audit row mapping exposes operational actor, target, kind, action, and timestamp fields without arbitrary private payloads.
- PASSED: Firestore rules continue to deny client writes to audit paths; no destructive delete or emulator command was added.
- PASSED: No Expo, React Native, mobile navigation, service credentials, or Vite secret variables were added.

# Wave 8 - Dashboard UI polish and responsive states
Status: INCOMPLETE

Design the Vite React dashboard as a dense operational web surface that matches the existing dark luxury brand without using marketing-style sections. Add loading, empty, error, permission denied, refresh, responsive desktop/tablet layouts, and pagination states for every dashboard view.

# Wave 9 - Emulator and unit test coverage
Status: INCOMPLETE

Add Firebase rules emulator tests for admin reads, denied non-admin access, denied client role escalation, privileged Function guards, audit immutability, and dashboard aggregate access. Add focused Vite/Vitest tests for role mapping, dashboard data normalization, route guards, and admin action request helpers.

# Wave 10 - Release and operations checklist
Status: INCOMPLETE

Add a manual admin web QA checklist covering first-admin bootstrap, admin login, non-admin denial, user search, room moderation, report resolution, audit review, sign-out, responsive layout, production build, and offline/error behavior. Keep mobile app release validation separate from the dashboard website.
