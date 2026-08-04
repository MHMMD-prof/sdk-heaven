# Voice Room Wave 6 — Chat and safety

## Status

Wave 6 backend deployment and engineering are complete and remain dark behind two independent,
fail-closed production flags:

- `appConfig/voiceRoomFeatures.voice_room_chat`
- `appConfig/voiceRoomFeatures.voice_room_safety`

The Node.js 22 command and retention functions, Firestore Rules, and both
message indexes are live in production. Deployment did not activate either
flag or any room/cohort.

## Delivered

- Server-authoritative room chat through `roomChatCommand`:
  - NFKC normalization, control-character removal, and a 280-character limit;
  - five-message/ten-second burst protection plus owner slow mode;
  - `everyone`, owner-friends-only, and `off` chat modes;
  - dashboard-managed server keyword terms and fail-closed filtering;
  - idempotent commands and stable message IDs for safe network retry;
  - server timestamps, stable ordering, real-time delivery, and 50-message
    pagination.
- Message lifecycle:
  - optimistic `pending`, `failed`, and `sent` presentation;
  - retry reuses the original request ID and cannot duplicate the message;
  - sender or authorized room staff can soft-delete;
  - deleted messages keep a tombstone and moderation context;
  - owner/moderator pin and unpin;
  - ordinary messages expire after 30 days;
  - reported message evidence is held and excluded from retention cleanup.
- History privacy:
  - `everyone` permits the retained room history;
  - `after-join` permits only messages at or after membership creation;
  - `hidden` permits only messages at or after the current presence session;
  - Firestore Rules enforce these cutoffs independently of the client.
- User safety:
  - backend-managed block/unblock dissolves existing friendship/request state;
  - users can read only their own block list;
  - ordinary chat from blocked users is hidden locally;
  - staff moderation and system safety notices are never hidden by a user block;
  - structured reports cover user, message, room, room image, gift, and voice
    behavior;
  - report categories, content excerpts, target context, severity, and immutable
    message snapshots feed the existing admin report workflow;
  - voice reports record an evidence-preservation request for the future
    recording/evidence wave.
- Authority:
  - message owners may delete their own messages;
  - Room Moderators and the Room Owner can delete and pin;
  - region-scoped Super Moderators and the Platform Owner retain higher
    operational authority;
  - every moderation mutation creates an audit event.

## Security boundary

- Clients cannot write messages, chat state, chat request records, chat rate
  limits, blocks, reports, or room safety rate limits.
- The command service independently validates active profile, room membership,
  room state, flags, chat mode, rate limits, content, target existence, and
  authority.
- Firestore message reads require an active member and the chat flag.
- Both flags default to absent/false.

## Rollout and rollback

Inspect without mutation:

```powershell
npm --prefix functions run rooms:chat:flags
```

Activation and rollback require an active Platform Owner:

```powershell
npm --prefix functions run rooms:chat:enable -- --actor-uid <uid>
npm --prefix functions run rooms:chat:disable -- --actor-uid <uid>
```

Roll out to internal rooms only after physical Android/iOS testing covers RTL,
large fonts, keyboard avoidance, screen readers, pagination, slow mode, weak
networks, duplicate retry, block visibility, deletion races, and report
triage.
