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
Status: INCOMPLETE

Add admin-only Firestore rules and callable Function guards for dashboard reads and privileged mutations. Keep existing owner profile and room membership rules intact, and route sensitive actions through backend code instead of direct client writes.

# Wave 2 - Vite React dashboard foundation
Status: INCOMPLETE

Create a separate Vite React website under `admin-dashboard/`, with isolated dependencies, package scripts, TypeScript config, routing, Firebase web client initialization, environment documentation, and a web-only auth gate. Keep web dependencies out of the Expo app unless they are already shared safely, and do not add dashboard routes, tabs, or screens to the mobile app.

# Wave 3 - Admin overview metrics
Status: INCOMPLETE

Build the first web dashboard screen with operational summaries for users, active rooms, game sessions, moderation actions, and recent system health. Prefer aggregate documents or backend-computed summaries so the Vite site does not need broad collection scans.

# Wave 4 - User management tools
Status: INCOMPLETE

Add searchable user profile review with account status, profile metadata, recent room activity, and safe admin actions. Support limited actions first, such as profile review flags or account notes, and defer destructive account actions until lifecycle flows are fully designed.

# Wave 5 - Room and voice moderation console
Status: INCOMPLETE

Add admin room discovery across active and recently closed rooms, including host, participant counts, member status, moderation history, and room close/remove actions. Reuse existing room moderation events where possible and write every admin action to an audit trail.

# Wave 6 - Reports and abuse workflow
Status: INCOMPLETE

Add a report intake model for users, rooms, games, and voice behavior. Build triage states, assignment metadata, resolution notes, and links back to user and room records so admin moderation is trackable instead of one-off.

# Wave 7 - Audit log and accountability
Status: INCOMPLETE

Create immutable admin audit events for role changes, user actions, room actions, report resolutions, and dashboard data exports. Restrict audit writes to backend services and allow admin reads with filters for actor, target, action type, and date.

# Wave 8 - Dashboard UI polish and responsive states
Status: INCOMPLETE

Design the Vite React dashboard as a dense operational web surface that matches the existing dark luxury brand without using marketing-style sections. Add loading, empty, error, permission denied, refresh, responsive desktop/tablet layouts, and pagination states for every dashboard view.

# Wave 9 - Emulator and unit test coverage
Status: INCOMPLETE

Add Firebase rules emulator tests for admin reads, denied non-admin access, denied client role escalation, privileged Function guards, audit immutability, and dashboard aggregate access. Add focused Vite/Vitest tests for role mapping, dashboard data normalization, route guards, and admin action request helpers.

# Wave 10 - Release and operations checklist
Status: INCOMPLETE

Add a manual admin web QA checklist covering first-admin bootstrap, admin login, non-admin denial, user search, room moderation, report resolution, audit review, sign-out, responsive layout, production build, and offline/error behavior. Keep mobile app release validation separate from the dashboard website.
