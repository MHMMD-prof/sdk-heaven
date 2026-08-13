# Personal Chats Frontend Rebuild — Wave 6 Staged Cutover

Status: STAGING INFRASTRUCTURE COMPLETE; NOT ACTIVATED  
Prepared: 2026-08-09  
Production rollout: not applied  
Legacy deletion: blocked

## Delivered

### Reversible rollout policy

The presentation selector is no longer an all-or-nothing boolean. It now
requires two independent, fail-closed inputs:

1. `appConfig/socialFeatures.personalChatsFrontendV2` is the master switch and
   immediate rollback control.
2. `appConfig/personalChatsFrontendRollout` selects `off`, `internal`,
   `percentage`, or `global`.

Internal rollout is restricted to builds compiled with
`EXPO_PUBLIC_PERSONAL_CHATS_INTERNAL_PREVIEW=1`. Percentage rollout uses a
stable UID-and-salt bucket, so a user does not move between the old and new
frontend across sessions. Missing users, invalid configuration, subscription
errors, malformed values, and a dark master switch all resolve to legacy.

Forward promotion can advance only one stage at a time. Any stage can roll back
directly to `off`.

### Operations controls

Added owner-gated, audited scripts:

- `npm --prefix functions run personal-chats-frontend:status`
- Dry-run: `npm --prefix functions run personal-chats-frontend:rollout -- --stage=internal`
- Apply internal: add `--actor-uid=<owner uid> --apply`
- Percentage: use `--stage=percentage --percentage=<1-100> --salt=<stable salt>`
- Global: use `--stage=global`
- Immediate rollback: use `--stage=off --actor-uid=<owner uid> --apply`

The setter updates the rollout document and master switch in one audited
transaction. It requires an active Platform Owner for every applied mutation.
No script was applied to a live Firebase project during this wave.

### Rules and compatibility

Signed-in clients can read the rollout document and cannot write it.
Unauthenticated reads remain denied. The master flag is now preserved by social
feature merge/update tooling and is approved for emergency darkening in the
admin feature-flag path.

Routes, push/deep-link payloads, providers, message contracts, storage paths,
authorization, and chat data are unchanged.

## Verification

Passed:

- Personal-chat and social focused suites: 14 files, 69 tests.
- Wave 6 client rollout suite: 5 tests.
- Wave 6 server rollout core: 3 tests.
- Server rollout script syntax/lint.
- Browser QA of the staged Arabic inbox and accepted thread at 320×568.
- Expo SDK 56 web export: 2,168 modules.
- Expo SDK 56 Android export: 2,354 modules.
- Full suite: 286 files and 1,568 tests passed.
- TypeScript produced no Wave 6 diagnostics.

Recorded unrelated repository failures:

- Full unit suite retains the two previously recorded stale expectations in
  `socialNotificationsService.test.mjs` and `socialProfileCore.test.mjs`.
- The rules suite passed 69 of 70 tests. Its remaining failure is the existing
  unrelated Wave 6 cosmetics-authority expectation at
  `firestore.rules.emulator.test.mjs:168`; the new rollout read/write assertions
  passed within the same run.
- Repository-wide TypeScript remains red on unrelated existing worktree errors.

## Gates that still block deletion

The following work requires real devices, populated accounts, production
telemetry, or explicit operational authority and was not simulated:

- Android/iOS keyboard, camera, library, microphone, voice-note, safe-area,
  TalkBack, and VoiceOver acceptance from Wave 5.
- Arabic product approval on real populated chat data.
- Applied internal stage and an observation window with inbox-open, send-ack,
  crash-free, report-access, and attachment-failure monitoring.
- Applied percentage cohort and another clean observation window.
- Global rollout and its acceptance window.

Only after those gates pass may the legacy `LegacyChatsScreen`,
`LegacyDirectChatScreen`, obsolete decorative assets/imports, temporary rollout
selector, and V2-specific names be deleted. Until then the current implementation
keeps instant presentation-only rollback without changing chat data.
