# Personal Chats Wave 8 — Emergency runbook

Owner-only controls for Direct Chat kill switches, retention, and reconcile.
Prefer the admin dashboard when available; CLI remains the fallback and the only
reconcile apply path.

## Kill switches

### Dashboard (Settings → مفاتيح المنصة)

| Goal | Flag | Effect |
| --- | --- | --- |
| Stop all private chats | `directMessages` → off | Server rejects DM commands; Chats tab stays visible with unavailable empty state |
| Stop new requests only | `directMessageRequests` → off | Accepted chats keep working |
| Stop media only | `directMessageMedia` → off | Text still works |

Each toggle requires a reason and writes an audited `feature-flag-update`.

### CLI stage 0 (full dark)

```bash
cd functions
npm run direct-chat:rollout -- --stage=0 --actor-uid=<OWNER_UID> --apply
npm run direct-chat:status
```

Stage 0 sets all three flags false. Confirm client: with `directMessages`
false, the Chats tab remains visible and shows the unavailable empty state
(listeners off; no sends). Deep links may open the thread screen but do not
load or send while the flag is off.

## Retention

### Dashboard

Settings → سياسة احتفاظ الرسائل: edit message / evidence / legal-hold days,
review the clamped preview, apply with reason.

### CLI

```bash
cd functions
npm run direct-chat:retention -- --message-days=90 --evidence-days=90 --legal-hold-days=180 --actor-uid=<OWNER_UID>
# dry-run prints current vs clamped requested
npm run direct-chat:retention -- --message-days=90 --evidence-days=90 --legal-hold-days=180 --actor-uid=<OWNER_UID> --apply
npm run direct-chat:retention:status
```

## Reconcile (CLI only)

```bash
cd functions
npm run direct-chat:reconcile
npm run direct-chat:reconcile -- --actor-uid=<OWNER_UID> --apply
```

Dry-run first. Apply is owner-gated and writes `direct-chat-reconcile` audit.
Dashboard ops status shows the latest reconcile id/time read-only.

## Ops status

Settings → حالة الرسائل المباشرة (owner / `flags:manage`): stage, flags,
retention + sweep cursor, restricted-account sample ≤100, last reconcile.

## User restriction context

User detail → moderation context shows current `directChatRestrictions/{uid}`
and recent restrict/clear audits. Restrict/clear remain on the report evidence
path only — no unrestricted “restrict anyone” dashboard action.
