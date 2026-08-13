# Personal Chats Wave 10 — Deployment and staged rollout

Status: flags **enabled at stage 3** on `yallgame-ebd19` for closed/dev
(no production users). Operator checklist below still applies if you need
redeploy, reconcile, or rollback.

Product decision: the Chats tab **stays visible** when `directMessages` is
false (unavailable empty state). Kill switches:
[PERSONAL_CHATS_WAVE8_RUNBOOK.md](./PERSONAL_CHATS_WAVE8_RUNBOOK.md).

Project: `yallgame-ebd19`.

## Current enablement (2026-08-05)

Closed/dev choice: skip staying dark. Applied owner-gated stages **1 → 2 → 3**:

| Stage | Audit event |
| --- | --- |
| 1 friends-text | `qygQfROyhawGdV7iQPFA` |
| 2 text-and-requests | `e5QDERV9QC4iespd4bdq` |
| 3 text-requests-and-media | `YNQQ1qrdhiFd8GhxKzoi` |

Live flags: `directMessages`, `directMessageRequests`, `directMessageMedia` all
**true**. Reload the app to pick them up.

Also deployed to `yallgame-ebd19` (same session):

- `firestore:indexes`, `firestore:rules`, `storage`
- Functions: `directChatCommand`, `expireDirectMessageRequests`,
  `cleanupDirectChatCommands`, `cleanupDirectChatUploads`,
  `cleanupDirectChatRetention`
- Command URL:
  `https://us-central1-yallgame-ebd19.cloudfunctions.net/directChatCommand`

## Preflight

- Deploy a **clean Personal Chats slice**. Do not ship unrelated cosmetics/voice
  WIP from a mixed dirty worktree.
- Ensure rollout stage is **0 (dark)** before and after the first deploy:
  `directMessages`, `directMessageRequests`, `directMessageMedia` all false.
- Owner UID available for CLI `--actor-uid` and dashboard `flags:manage`.

## 1. Dark deploy order

```powershell
npx firebase-tools deploy --project yallgame-ebd19 --only firestore:indexes
npx firebase-tools deploy --project yallgame-ebd19 --only firestore:rules
npx firebase-tools deploy --project yallgame-ebd19 --only storage
npx firebase-tools deploy --project yallgame-ebd19 --only functions
# Admin UI (Wave 8 Settings / retention / ops) when ready:
# npm --prefix admin-dashboard run build
# npx firebase-tools deploy --project yallgame-ebd19 --only hosting
```

Schedules that must be live with functions: `expireDirectMessageRequests`,
`cleanupDirectChatCommands`, `cleanupDirectChatUploads`,
`cleanupDirectChatRetention`.

## 2. Verify dark (stage 0)

```powershell
cd functions
npm run direct-chat:status
# If not dark:
npm run direct-chat:rollout -- --stage=0 --actor-uid=<OWNER_UID> --apply
npm run direct-chat:status
```

Client checks:

- Chats tab is **visible**.
- Opening Chats shows unavailable title/body (Arabic/English copy).
- Deep link to a chat shows unavailable UI; composer hidden; no sends.
- `directChatCommand` returns `FEATURE_DISABLED` / rejects when flag off.
- Home, rooms, games, wallet, store, friends remain usable.

## 3. Dev accounts

Manual: two accounts as friends; one non-friend. No allowlist required (no
production users yet).

## 4. Stage 1 — friends-text

```powershell
cd functions
npm run direct-chat:rollout -- --stage=1 --actor-uid=<OWNER_UID> --apply
npm run direct-chat:status
```

Verify: friend text send/receive, block, unsend window, multi-device read,
push privacy (hidden preview / mute), report evidence path.

```powershell
npm run direct-chat:reconcile
npm run direct-chat:reconcile -- --actor-uid=<OWNER_UID> --apply
```

Require zero unexplained conversation / projection / command / notification /
report drift before continuing.

## 5. Stage 2 — text-and-requests

```powershell
npm run direct-chat:rollout -- --stage=2 --actor-uid=<OWNER_UID> --apply
```

Verify: non-friend request, accept/reject/expire; no request bypass via rank;
spam/reject smoke. Reconcile again if needed.

## 6. Stage 3 — media (last)

```powershell
npm run direct-chat:rollout -- --stage=3 --actor-uid=<OWNER_UID> --apply
```

Operator on **physical Android**: protected image/voice upload, rejection,
cleanup, evidence isolation. Do not enable media until those pass.

## 7. Rollback (any stage)

```powershell
cd functions
npm run direct-chat:rollout -- --stage=0 --actor-uid=<OWNER_UID> --apply
```

Or dashboard Settings flags (independent toggles; prefer stage CLI so
`appRuntime/directChatRollout` stays consistent). See Wave 8 runbook for
retention and reconcile.

## Stages reference

| Stage | Name | Flags |
| --- | --- | --- |
| 0 | dark | all false |
| 1 | friends-text | `directMessages` only |
| 2 | text-and-requests | + `directMessageRequests` |
| 3 | text-requests-and-media | + `directMessageMedia` |

Forward skip forbidden; rollback to a lower stage (including 0) allowed.

## Local verification (this wave)

Evidence recorded in the Wave 10 implementation session (no firebase deploy):

- `npx vitest run src/personalChat/__tests__/wave10ChatsTabVisible.test.ts` —
  pass (Chats in `MAIN_SHELL_TAB_KEYS`; unavailable copy present).
- Feature-flag closed mapping covered by existing
  `directChatContract.test.ts` (`mapDirectChatFeatureFlags` / disabled defaults).
- `npx tsc --noEmit` — pass.
- `npx expo export --platform android --output-dir dist-wave10-android-export`
  — pass (2265 modules). Existing iOS `GoogleService-Info.plist` parse note
  does not block Android export.
- Live deploy / stage apply: **operator**, not run in this session.

## Explicitly deferred

Hiding the Chats tab; App Check / TalkBack leftovers from Wave 9; soft-limit UI
from Wave 8; full final-acceptance matrix as automated CI.
