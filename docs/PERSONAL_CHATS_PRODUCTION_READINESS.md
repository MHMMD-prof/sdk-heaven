# Personal Chats Production Readiness

This runbook is the release contract for the Android/iOS personal-chat launch. It intentionally does not add chat features or alter message, route, deep-link, push, draft, report, retention, or moderation schemas.

## Repository controls

- Production app configuration fails closed when either native Firebase file, Firebase public configuration, chat/LiveKit endpoint, legal/support URL, or Sentry build configuration is missing.
- `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICES_INFO_PLIST` are EAS file variables. The checked-in Android file remains a local fallback; the Apple plist must remain an EAS secret and is ignored by Git.
- Production rejects mock voice providers/rooms, debug panels, visual-fixture routing, store/cosmetics fixtures, and App Check debug tokens.
- Production artifacts are Android App Bundles and iOS store archives with automatic build-number/version-code incrementing. Preview artifacts remain internal APK/archive builds.
- App Check initializes before Firebase-backed rendering. Production selects Play Integrity on Android and App Attest with DeviceCheck fallback on Apple. Preview/development uses only explicitly registered debug tokens.
- The native token is bridged into Firebase JS App Check through a `CustomProvider`. The HTTP command sends `X-Firebase-AppCheck` and refreshes the token once after an invalid-token response.
- `DIRECT_CHAT_APP_CHECK_MODE=monitor` records missing/invalid/verified traffic. Set it to `enforce` before a percentage rollout. Never enforce project-wide Firestore/Storage until authenticated Android and iOS smoke traffic is at least 99.5% verified.
- `directMessageMedia=false` prevents new media authorization/finalization while previously approved attachments remain readable. `directMessages=false` denies Firestore message access and all direct-chat Storage reads/writes.
- Sentry excludes default PII, screenshots, view hierarchy, and replay. Event/breadcrumb/span filters redact message bodies, drafts, names, email/UID fields, targets, tokens, request IDs, report evidence, media paths, and URLs. Personal-chat telemetry contains only bounded action, platform, presentation/cohort, outcome, and error-code fields.

## Required release commands

Run from the repository root and retain the output with the release record:

```powershell
npx tsc --noEmit
npm test
npm run test:rules
npm run functions:lint
npx expo-doctor
npx expo export --platform android --output-dir dist/android
npx expo export --platform ios --output-dir dist/ios
eas build --profile preview --platform android
eas build --profile preview --platform ios
eas build --profile production --platform android
eas build --profile production --platform ios
```

Web export is a regression check only and is not a launch artifact. EAS commands require the project owner’s credentials, signing access, Firebase file variables, and Sentry variables.

## Monitoring contract

Create log-based counters from the structured `functions.directChatCommand` events:

| Metric | Filter signal | Alert |
|---|---|---|
| Command failure | `request:denied` or `request:error` | >1% for 10 min |
| Rate limiting | `rate-limit:error` or bounded rate-limit denial code | unexpected increase over 15 min |
| App Check invalid | `app-check` with `verified=false` | >0.5% after enforcement |
| Media rejection | direct-chat media safety/finalize denial code | >3%, excluding deliberate safety rejection |
| Push failure | `notification:error` | >1% for 10 min |
| Report submission | action `report-direct-chat`, success/denial | availability <99% |
| Reconciliation drift | reconciliation summary with nonzero drift | any unexplained drift |
| Cleanup failure | retention/cleanup scheduled-function error | any failure or overdue run |

The release dashboard must show Sentry crash-free sessions and P95 spans for inbox commands and send acknowledgements, plus command/media failure rates, report-path availability, App Check verified/invalid traffic, push failures, reconciliation drift, and cleanup freshness. Do not promote if a panel is missing or stale.

## Human and physical acceptance

Before internal rollout, record named primary and backup moderator/owner coverage, verify evidence access plus restrict/clear workflows, verify retention status, and name the rollback operator. Use two populated accounts and one non-friend on minimum-memory/minimum-OS Android, mainstream Android, iOS 16.4, and current standard/large iPhones.

Run Arabic RTL and English LTR for text, reply, retry, unsend, requests, receipts, typing, push open, image upload, voice record/playback, block, report, moderation removal, retention, offline recovery, keyboard/safe areas, 200% text, reduced motion, TalkBack/VoiceOver, a 150-row inbox, and a 200-message thread.

Hard gates are zero wrong-recipient, unauthorized-read, evidence-access, or reconciliation defects; crash-free sessions at least 99.5%; send-ack P95 at most 2.5 s; inbox-open P95 at most 1.5 s; send failure at most 1%; attachment failure at most 3% excluding deliberate safety rejection; and no unexplained App Check rejection or cleanup backlog.

## Controlled rollout

1. Put chat and presentation at stage 0. Deploy indexes, rules, functions, and the monitored build.
2. Complete live two-account text/media/push/report/reconciliation smoke tests.
3. Confirm at least 99.5% verified App Check traffic, enforce `directChatCommand`, then separately approve project-wide Firebase enforcement after app-wide smoke tests.
4. Enable Modern Royal internally for 24 hours, then 5% for 24 hours, then 25% for 48 hours.
5. Promote globally and observe for seven days.
6. On a performance/reliability breach, restore the legacy presentation. On any privacy, authorization, wrong-target, or evidence-path incident, set `directMessages=false` immediately.
7. Only after seven clean global days: delete the legacy frontend, remove the selector, neutralize V2 names, rerun every gate, and ship the cleanup build.

Each promotion requires a signed record of the dashboard snapshot, smoke result, moderator coverage, rollback owner, and approver. Console enforcement, EAS secrets/builds, store signing, physical-device acceptance, and cohort promotion are operator actions and cannot be proven by repository tests.
