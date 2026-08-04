# Voice Room Wave 15 — Staged launch and production acceptance

## Status

Wave 15 is **deployed and enabled for controlled production testing** as of
2026-07-27. It is not approved for broad public release.

- Active technical stage: **10 — public development testing**
- Audience: every authenticated account in the development app
- Minimum client version: `1.0.0`
- Recording: permanently rejected, flag forced off, authenticated endpoint returns
  `410 RECORDING_REJECTED`
- New joins: enabled for the approved test audience
- Enforcement: Firestore rules, LiveKit token issuance, and every room command
  endpoint
- Production read-back: `highestReadyStageId=10`,
  `broadReleaseReady=false`

The app has no real users yet, so a release allowlist would only obstruct
development. `public` in this policy means all signed-in development accounts;
it does not mean the app has been submitted to an app store or accepted for a
real-user release.

## What Wave 15 now guarantees

1. Stages are cumulative. A late feature flag cannot make a later stage ready
   while an earlier capability is missing.
2. A stage is ready only when its exact policy, audience, minimum client
   version, recording decision, new-join state, and feature flags agree.
3. Server access is fail-closed when the launch policy is absent, paused, or
   invalid.
4. Firestore room discovery and membership mutations enforce the same audience
   policy as token and command endpoints.
5. Production builds cannot silently use mock rooms, a mock voice provider, or
   the voice debug panel.
6. Unknown room IDs render an unavailable/not-found state; they never generate
   a fake room.
7. Broad-release evidence is tracked separately from controlled-test readiness.
8. Recording is not a future launch dependency. Stage 9 is permanently
   `STAGE_REJECTED`.

## Stage matrix

| Stage | Name | Cumulative scope |
| --- | --- | --- |
| 1 | staff-only | Room v2, mutations, and seats |
| 2 | internal-native-matrix | + Command Center and media |
| 3 | invited-cohort | Same capabilities, explicit invited allowlist |
| 4 | one-region-core | + Super Moderator controls |
| 5 | chat-ownership | + chat, safety, and ownership transfer |
| 6 | gifts-effects | + gifts and entry effects |
| 7 | games | + room-linked games |
| 8 | music | + shared music |
| 9 | recording-rejected | Permanently unavailable by product decision |
| 10 | scale-out | Current all-account development test; store release gates remain open |

## Operations

```powershell
# Live read-only status
npm --prefix functions run rooms:launch:status

# Single-stage detail
npm --prefix functions run rooms:launch:status -- --stage 10

# Dry-run the current controlled-test policy
npm --prefix functions run rooms:wave15:enable -- `
  --actor-uid <platform-owner-uid> `
  --audience public `
  --minimum-client-version 1.0.0

# Apply only after reviewing the dry run and assigning a unique request ID
npm --prefix functions run rooms:wave15:enable:apply -- `
  --actor-uid <platform-owner-uid> `
  --audience public `
  --minimum-client-version 1.0.0 `
  --request-id <unique-audit-id>
```

Every apply checks the active Platform Owner, uses Firestore preconditions,
commits features/policy/audit atomically, and is idempotent by request ID.

## Verified evidence

- [x] 778 application/backend tests
- [x] 61 focused Wave 15 tests
- [x] Firestore and Storage emulator suites
- [x] TypeScript
- [x] Expo Doctor (`21/21`)
- [x] Expo production configuration evaluation
- [x] Functions syntax validation
- [x] Admin dashboard typecheck, tests, production build, and bundle budgets
- [x] Functions deployed in `us-central1`
- [x] Firestore rules compiled and released
- [x] Live unauthenticated probes reject access with `401`
- [x] Production launch-policy read-back

The patched Sharp release removed the high-severity production image-processing
advisory. Remaining production audit findings are moderate transitive issues in
the Firebase Admin dependency tree and require a separately tested major
upgrade; no forced upgrade was applied during launch.

## Broad-release gates still open

- Android physical-device matrix
- iOS physical-device matrix
- measured load and chaos exercises
- accessibility acceptance
- gift/wallet reconciliation under production traffic
- rollback rehearsal
- product, engineering, moderation operations, and support sign-offs
- EAS production environment values and a signed production build

Until every item is recorded as true, `broadReleaseReady` must remain false and
the audience must not become `public`.

## Rollback

1. Set `voice_room_new_joins=false` for an immediate admission freeze.
2. Pause the launch policy or remove affected users from the allowlist.
3. Disable the affected capability flag.
4. Keep reads/audio for existing sessions where incident safety permits.
5. Use audited, idempotent reconciliation for economy or ownership incidents.
6. Never remove room-v2 fields while supported clients depend on them.

## Related

- Production plan: `docs/VOICE_ROOM_PRODUCTION_WAVE_PLAN.md`
- Hardening: `docs/VOICE_ROOM_WAVE14_HARDENING.md`
