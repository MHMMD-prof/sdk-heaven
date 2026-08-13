# Personal Chats Wave 8 — Admin configuration, integrity, and operations

Status: implemented locally. Salam/Hilo-simple model: wire existing DM flags,
retention, and restriction state into the owner dashboard; add a light ops
status readout; ship an emergency runbook. No soft-limit config, metrics
warehouse, or reconcile UI.

Exit gate: owner/role checked, idempotent audited mutations; no endpoint that
lists ordinary private messages; reconcile stays deterministic via existing CLI
dry-run/apply audit.

## Delivered

### 1. DM feature flags in Settings

`APPROVED_ADMIN_FEATURE_FLAGS` includes `directMessages`,
`directMessageRequests`, `directMessageMedia`. Owner (`flags:manage`) can
emergency-toggle each via the existing `feature-flag-update` path (reason +
`expectedUpdatedAt` + audit). Labels keep independent semantics (media off
leaves text; requests off leaves accepted chats).

### 2. Retention policy UI

Owner actions:

| Action | Permission |
| --- | --- |
| `direct-chat-retention-get` | `flags:manage` |
| `direct-chat-retention-set` | `flags:manage` |

Reads/writes `directChatRetention/current` through `mapDirectChatRetentionPolicy`
clamp + hard bounds. Set is requestId-idempotent and audits `before`/`after` in
one transaction (`kind: direct-chat-retention`). Settings shows current days,
version, dry-run clamp preview, and apply-with-reason.

### 3. User DM restriction context

`user-detail` operational context includes:

- Current `directChatRestrictions/{uid}` mapped for admin (state, active,
  reason, endsAt, actor, reportId link)
- Recent `adminAuditEvents` with `kind: direct-chat-moderation` filtered to
  restrict/clear actions (bounded; no message bodies)

Restrict/clear remain on the Wave 6B report evidence path.

### 4. Light ops status

`direct-chat-ops-status` (owner) assembles from existing docs only:

- Rollout stage from flags + `appRuntime/directChatRollout`
- Retention policy + sweep cursor
- Restricted-account sample (same safe query as rollout status CLI, limit 100)
- Last `direct-chat-reconcile` audit id/time if present

Compact Settings card; no charts, no content, no conversation lists.

### 5. Runbook

See [`PERSONAL_CHATS_WAVE8_RUNBOOK.md`](./PERSONAL_CHATS_WAVE8_RUNBOOK.md).

## Explicitly deferred

Soft-limit config UI; ops metrics warehouse; dashboard reconcile apply;
keyword-term editor; append-only restriction history; Wave 7 leftovers
(notification defaults, push metrics, server online rules).

## Verification

- Full non-emulator suite: **1,251/1,251 pass** (flags allow-list, retention
  normalize/permissions, clamp+audit, ops status shape, restriction mapping).
- Functions lint: pass (includes `directChatAdminOpsService.js`).
- Root TypeScript: pass.
- Admin dashboard typecheck: only the seven known `DailyLoginRewardsPanel.tsx`
  errors.
- Android Expo SDK 56 export: pass (2,264 modules).
- Index: `adminAuditEvents` `action` + `createdAt` added for last-reconcile
  readout; restriction audit uses existing `targetUid` + `createdAt`.
