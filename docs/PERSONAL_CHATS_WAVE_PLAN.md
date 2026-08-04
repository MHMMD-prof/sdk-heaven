# Personal Chats - Production Wave Plan

## Objective

Add safe one-to-one personal messaging to the existing mature social and voice-room
application. Personal chat must feel native to the current ruby-and-gold product,
remain synchronized across devices, and reuse the existing friendship, blocking,
public-profile, push-notification, reporting, audit, and administrator systems.

This is not a general-purpose encrypted messenger. Messages are private between
the two participants in the client, encrypted in transit and at rest by the
platform infrastructure, and available to platform staff only when a participant
submits selected content as report evidence. The product must not claim end-to-end
encryption.

## Locked product decisions

- Add **Chats** as a fifth bottom-navigation tab without replacing Home, Rooms,
  Games, or Me. RTL order is Home, Rooms, Chats, Games, Me, with Chats centered.
- Friends may begin a conversation immediately.
- A non-friend may send one text-only message request. The recipient may accept,
  reject, block, or report it.
- One deterministic conversation exists for each unordered user pair. Retries,
  devices, profile entry points, and friendship changes cannot create duplicates.
- V1 message kinds are text, emoji, image, voice note, and existing catalog
  sticker. Message requests remain text-only.
- V1 supports reply, copy, delete-for-me, and a short server-enforced unsend
  window. Editing is excluded.
- Private calls, video messages, group DMs, disappearing messages, and gifts
  inside personal chat are deferred.
- Blocking prevents new messages, requests, invitations, and recommendations,
  but preserves each participant's existing history. It does not eject either
  user from public rooms.
- Room owner, moderator, representative, employee, super-moderator, and platform
  roles never bypass message requests or blocks.
- Official staff accounts show an unforgeable verified role marker in chat.
- Staff cannot browse private conversation history. A report creates an immutable,
  bounded snapshot of only the evidence deliberately selected by the reporter.
- Deleted users appear as a tombstoned "Deleted user" identity while the other
  participant retains their own conversation history.
- No paid privilege may bypass requests, rate limits, privacy settings, or blocks.
- Read receipts, online visibility, and notification previews are user-controlled.
- Retention is policy-configurable; reported evidence has a separate legal and
  safety retention policy.

## Architecture and contracts

### Feature and emergency controls

Add independent fail-closed controls to `appConfig/socialFeatures`:

- `directMessages`: opens existing accepted/friend conversations and permits text.
- `directMessageRequests`: permits a non-friend to create a message request.
- `directMessageMedia`: permits image and voice-note uploads and sends.

Add runtime safety controls:

- global claims: `active`, `paused`, and `emergencyDisabled` semantics;
- separate emergency switches for all sends, new requests, and media uploads;
- per-user direct-message restriction with reason, actor, start, and optional end;
- dashboard-configurable soft limits bounded by immutable server hard caps.

The entire client must remain usable when all three feature flags are false.

### Deterministic identities

- `conversationId = SHA-256("direct-chat-v1\0" + sortedUidA + "\0" + sortedUidB)`.
- Client-generated `requestId` values identify commands and survive offline retry.
- Server-generated message IDs are deterministic from conversation, sender, and
  request ID.
- Upload and report IDs are separately scoped and cannot be reused as message IDs.
- Every command stores an input fingerprint. Reusing a request ID with different
  content returns a conflict and never mutates state.

### Firestore model

All economic, moderation, conversation, message, read-marker, and request-state
writes are backend-only unless explicitly described as ephemeral presence.

- `directConversations/{conversationId}`
  - sorted `memberUids`, creation source, lifecycle state, request state,
    requester/recipient, last sequence, last-message safe preview, and timestamps;
  - never stores role authority that can bypass policy;
  - contains no mutable public-profile copy used for authorization.
- `directConversations/{conversationId}/messages/{messageId}`
  - immutable sender, kind, sequence, body or approved attachment reference,
    optional reply reference, server timestamp, and visibility state;
  - unsend changes visibility to `unsent`; it does not erase audit/report evidence;
  - no client-controlled sender name, avatar, role, read state, or timestamps.
- `directConversationMembers/{uid}/items/{conversationId}`
  - server-maintained inbox projection with peer UID, last safe preview,
    last sequence, last-read sequence, unread count, mute/archive state, and time;
  - supports a fast paginated inbox without cross-user collection scans.
- `directMessageRequests/{conversationId}`
  - one request per pair with pending, accepted, rejected, expired, blocked states;
  - stores request cooldown and expiry, but no separate duplicate conversation.
- `directChatCommands/{uid}/requests/{requestId}`
  - idempotency response, fingerprint, status, and bounded retention.
- `directChatRateLimits/{uid}`
  - separate counters for sends, new recipients, requests, reports, and media.
- `directChatRestrictions/{uid}`
  - backend-only platform restriction, independent from public profile status.
- `directChatReports/{reportId}` and evidence subcollection
  - reporter, target, category, selected message IDs, immutable bounded snapshots,
    attachment evidence references, status, and audit metadata;
  - client read is denied after submission; dashboard access requires report scope.
- `directChatRetention/current`
  - owner-controlled policy version used by scheduled cleanup and legal holds.

Use collection-group indexes only where an operational or reconciliation query
requires them. Do not add broad client list permissions to make a query convenient.

### Commands

Expose one authenticated `directChatCommand` endpoint in `us-central1` with
versioned normalized requests:

- `get-direct-chat-inbox`
- `get-direct-chat-thread`
- `get-direct-chat-status`
- `send-direct-message`
- `send-message-request`
- `accept-message-request`
- `reject-message-request`
- `unsend-direct-message`
- `delete-conversation-for-me`
- `mark-direct-chat-read`
- `set-direct-chat-mute`
- `create-direct-chat-upload`
- `finalize-direct-chat-upload`
- `report-direct-chat`

Existing social commands remain authoritative for friendship and blocking.
Starting a chat from a profile or room participant menu resolves status first and
never writes a conversation optimistically.

### Policy defaults and hard limits

Initial dashboard defaults may be adjusted later within server hard caps:

- text: 2,000 Unicode characters after NFKC normalization;
- inbox page: 30 conversations; thread page: 40 messages using opaque cursors;
- unsend window: 5 minutes;
- request expiry: 30 days;
- rejected-request cooldown: 30 days;
- at most 5 new non-friend recipients per account per Baghdad day;
- image source: JPEG/PNG/WebP, at most 6 MB before processing;
- voice note: M4A/AAC, at most 120 seconds and 5 MB;
- one active upload authorization per media object with a short expiry;
- safe preview never includes image bytes, voice URLs, or reported content.

Rate limits must account for device switching and concurrent requests. Platform
hard caps cannot be raised from the dashboard.

### Protected media pipeline

- Request upload authorization only after friendship/request, block, restriction,
  account, and feature checks pass.
- Write sources to immutable private paths under the conversation and media ID.
- Storage Rules validate authenticated uploader, short-lived authorization,
  content type, size, path identity, and create-only semantics.
- Message requests cannot attach media.
- Quarantine uploads until backend validation completes.
- Decode images instead of trusting file extensions, strip EXIF and location
  metadata, normalize orientation, create a bounded derivative, and scan through
  the configured safety adapter.
- Validate voice-note container, codec, and duration; reject malformed or
  disguised files.
- A message may reference only an approved attachment owned by its sender and
  bound to the same conversation.
- Participant reads use protected paths and membership checks. Reports copy or
  retain evidence under a separate non-client-readable safety path.
- Failed, abandoned, rejected, or expired uploads are removed by scheduled cleanup.

### Privacy and presence

- "Sent" means the server committed the message; "read" means the recipient
  advanced their read sequence. Do not claim device delivery without an actual
  device acknowledgement.
- Read sequence is monotonic and cannot move backwards or beyond the latest
  visible message.
- Read-receipt privacy hides the receipt from the peer without disabling the
  server's unread calculation.
- Typing and online indicators are ephemeral, self-owned, membership-protected,
  TTL-bound records. They cannot authorize sends or affect unread counts.
- Online visibility defaults to friends-only and supports an off setting.
- Notification preview defaults to hidden for requests and follows the recipient's
  privacy choice for accepted conversations.
- Logout and account switching clear cached private attachments and thread data.

### Blocking, friendship, and account lifecycle

- Every send and upload-finalize transaction rechecks blocks, restrictions,
  moderation status, and feature controls.
- Removing a friendship does not destroy an accepted conversation, but subsequent
  behavior follows the non-friend request policy chosen by the owner. Initial
  policy: an already accepted conversation may continue until blocked or deleted.
- Blocking atomically rejects pending requests and prevents future sends. Existing
  history remains readable to each participant.
- Unblocking never reopens a rejected request or sends a notification.
- If the pair becomes friends while a message request is pending, the next
  authoritative friendship/direct-chat synchronization promotes the same
  deterministic conversation to accepted; it never creates a second thread.
- Delete-for-me clears the participant's projection through a server sequence.
  A later accepted message may return the conversation to that participant's
  inbox without restoring messages hidden by their clear marker.
- Account suspension immediately prevents sends and media access creation.
- Account deletion tombstones the identity, revokes uploads and push delivery,
  removes the deleted user's inbox projection, and preserves the peer's history
  according to retention policy.

### Moderation and administrator boundary

- Reuse the existing report categories and add direct-chat source metadata.
- A report may include a bounded contiguous context window plus specifically
  selected messages and attachments; the backend captures the evidence, not the
  client payload.
- Dashboard report detail shows only captured evidence, participant public safety
  context, related report counts, and audited actions.
- Supported actions: dismiss, remove reported message, restrict personal chat,
  suspend account, escalate, and apply a legal hold where authorized.
- Room moderators and room owners have no personal-chat moderation powers.
- Super-moderators need existing report scope and regional authorization; platform
  owners remain audited and cannot open unreported conversations.
- Every evidence view and action produces an audit event with actor and case ID.

## Implementation waves

## Wave 1 - Contracts, flags, and security skeleton

- Add direct-chat domain types and pure normalization functions on backend/mobile.
- Implement deterministic conversation, message, report, and command identifiers.
- Add three independent feature flags and direct-chat restriction model.
- Add deny-by-default Firestore and Storage paths before any client code can use
  them.
- Add required indexes and emulator fixtures.
- Define error codes with Arabic user-safe messages and no private-data leakage.
- Add rollout/status tooling with all flags disabled by default.

### Wave 1 exit gate

- Contract fixtures parse identically on backend and mobile.
- Cross-user reads, direct writes, forged membership, forged sender, and attachment
  path guessing fail in emulator tests.
- Existing social, room chat, and notification suites remain green.

### Wave 1 implementation record - 2026-08-02

Status: complete locally; not deployed and not user-visible.

- Added the shared V1 command, payload, identifier, error, restriction, and
  fail-closed feature-flag contracts with one fixture corpus consumed by backend
  and mobile tests.
- Added rollout stages 0-3, audited owner-only mutation tooling, configuration
  status checks, unsupported-state rejection, and stage 0 as the default.
- Reserved direct-chat Firestore, Storage, command, upload, report, restriction,
  presence, and retention paths behind explicit deny-by-default rules.
- Added the initial composite indexes and emulator attack fixtures for participant,
  peer, staff, forged sender, forged membership, attachment guessing, quarantine,
  and evidence access attempts.
- Verification evidence: 184 application test files / 1,016 tests passed; focused
  Wave 1 contract and rollout tests passed; Functions lint passed; TypeScript
  passed; Firestore and Storage emulator rule suites passed.
- Production behavior is unchanged. Missing flags map to false, no direct-chat
  navigation or service is enabled, and rollout requires a later explicit owner
  action.

## Wave 2 - Authoritative text conversations and requests

- Implement deterministic conversation creation and exactly-once text sends.
- Implement friends-direct and non-friend request state machines.
- Enforce blocks, moderation status, chat restriction, expiry, cooldown, and
  non-friend limits inside transactions.
- Implement accepted/rejected/expired request behavior and safe system messages.
- Implement reply validation, 5-minute unsend, and delete-for-me projection state.
- Reuse the existing blocked-word policy through a direct-chat-specific adapter.
- Add scheduled expiration of pending requests and bounded command cleanup.

### Wave 2 exit gate

- Concurrent first sends create one conversation and one economic-free message.
- Same request replay is identical; changed payload reuse conflicts.
- Block/request/friendship races fail closed with no orphan thread.
- Staff roles cannot bypass any participant policy.

### Wave 2 implementation record - 2026-08-02

Status: complete locally; backend endpoint and schedules are not deployed, and all
direct-chat rollout flags remain off.

- Added the authoritative `directChatCommand` service and `us-central1` HTTP entry
  point for status, text/emoji send, text-only request, accept, reject, unsend,
  and delete-for-me commands.
- Added one deterministic conversation per unordered pair, immutable sequenced
  messages, safe system events, server timestamps, five-minute unsend, reply
  validation, clear markers, and seven-day idempotency records.
- Enforced bilateral blocks, active public-profile moderation, independent chat
  restrictions, accepted-conversation continuity, pending-request promotion after
  friendship, 30-day request expiry/cooldown, a five-recipient Baghdad-day limit,
  and transactional send-rate limits without examining or trusting staff roles.
- Reused the existing room keyword policy through a direct-chat adapter and kept
  media, inbox, pagination, read state, presence, notifications, and reports dark
  for their later waves.
- Extended the existing room block transaction to close a pending private request
  and conversation state atomically, preventing block/send races from leaving an
  open request.
- Added hourly pending-request expiration, daily bounded command cleanup, and the
  required composite cleanup index.
- Verification evidence: 189 application test files / 1,039 tests passed;
  Functions lint passed; TypeScript passed; focused concurrency, replay,
  friendship, block, restriction, request, reply, unsend, clear-marker, expiry,
  cleanup, and staff-neutrality tests passed; Firestore and Storage emulator rule
  suites passed.

## Wave 3 - Inbox projection, pagination, unread, and multi-device sync

- Build server-maintained member inbox projections.
- Implement opaque cursor pagination for inbox and chronological thread history.
- Implement monotonic mark-read, unread counts, mute, archive, and delete-for-me.
- Add participant-only realtime listeners for the active page and thread tail.
- Add ephemeral typing and online-presence records with TTL cleanup.
- Add reconciliation tooling for conversations, projections, sequence numbers,
  unread counts, and orphan commands.

### Wave 3 exit gate

- Two devices converge on the same ordering, read state, and unread count.
- Offline retry cannot duplicate or reorder a message.
- A 10,000-message fixture remains paginated and does not load unbounded history.
- Reconciliation reports zero unexplained projection drift.

### Wave 3 implementation record - 2026-08-02

Status: complete locally; backend, rules, indexes, and TTL policies are not
deployed, and all direct-chat rollout flags remain off.

- Added backend-owned inbox projections for both members, transactional unread
  accounting, monotonic tail-based read receipts, mute/archive preferences, and
  delete-for-me clear markers. New activity restores archived threads without
  changing mute state.
- Added signed opaque, account/conversation-scoped cursors and bounded inbox and
  chronological history commands. A 10,000-message fixture was read in 40-item
  pages without an unbounded query.
- Added bounded realtime listeners for the visible inbox and active thread tail,
  plus accepted-participant typing and current-friend online records with short
  leases and Firestore TTL cleanup. Blocked users and outsiders cannot read or
  forge presence.
- Kept all persistent conversation, message, projection, request, sequence, and
  read-state writes backend-only. Firestore exposes only participant history and
  each user's own inbox projection while the direct-messages flag is enabled.
- Added deterministic projection/sequence/unread reconciliation, bounded dry-run
  and platform-owner apply tooling, concurrent-change protection, orphan-command
  detection, and an audited apply path.
- Verification evidence: 197 application test files / 1,065 tests passed;
  TypeScript and Wave 3 Functions syntax checks passed; the full Firestore and
  Storage rules suite passed, followed by focused participant, forgery, bounded
  presence, friendship, and block-privacy rule checks.

## Wave 4 - Mobile Chats experience and entry points

- Add Chats as the centered fifth bottom-navigation tab with total unread badge.
- Build a ruby-and-gold Chats page with conversations and requests sections,
  empty/loading/offline/error states, search over loaded conversations, mute and
  archive gestures, and accessible unread indicators.
- Build the thread screen with safe peer header, role badge, bubbles, timestamps,
  reply preview, composer, retry state, typing/read indicators, and pagination.
- Add start-chat actions to user profiles and room participant menus.
- Add accept, reject, report, and block actions to the request experience.
- Restore unsent composer text locally per account and conversation without
  storing it in public Firestore.
- Add RTL Arabic, English fallback, large text, keyboard avoidance, screen-reader
  labels, reduced motion, and compact/standard/tall Android layouts.

### Wave 4 exit gate

- Home, Rooms, Games, and Me retain their existing state when switching tabs.
- Deep links and room/profile entry points resolve the same conversation.
- No private content appears in screenshots/previews generated by app-switcher
  privacy mode.

## Wave 5 - Images, voice notes, emoji, and store stickers

- Add upload authorization, immutable private storage, validation, quarantine,
  derivative generation, safety adapter, and cleanup.
- Add image picker/capture integration and upload progress/cancel/retry.
- Add press-and-hold voice recording, duration/size limits, preview, upload,
  playback progress, audio-focus handling, and accessibility controls.
- Add emoji and owned catalog sticker picker. Verify ownership and availability
  authoritatively when sending a sticker.
- Render safe placeholders for pending, rejected, expired, missing, and older
  unsupported attachments.
- Media feature shutdown must leave text chat operational.

### Wave 5 exit gate

- Spoofed MIME types, oversized files, EXIF location data, reused uploads, and
  cross-conversation attachment references are rejected.
- Blocking or suspension during upload prevents finalization.
- Media failures never produce a broken committed message.

## Wave 6 - Reporting, evidence, retention, and staff controls

- Implement selected-message reporting with bounded server-captured context.
- Protect evidence in non-client-readable Firestore/Storage paths.
- Extend the existing Reports dashboard for direct-chat cases without adding a
  conversation-browser endpoint.
- Add direct-chat restriction, reported-message removal, escalation, dismissal,
  and legal-hold actions with role scope and regional checks.
- Add audit events for evidence views and moderation actions.
- Add configurable retention, expired-message/upload cleanup, deletion tombstones,
  and legal-hold exclusions.

### Wave 6 exit gate

- Admins cannot access an unreported conversation through API, rules, or guessed
  identifiers.
- Reports contain exactly the permitted evidence window and immutable snapshots.
- Retention cleanup never removes active legal-hold evidence.

## Wave 7 - Push notifications and privacy settings

- Extend notification preferences with direct messages, message requests, preview
  visibility, read receipts, and online visibility.
- Send one idempotent push per accepted message or request, respecting mute,
  preview privacy, block state, and global switches.
- Route notification taps to the deterministic conversation or request.
- Coalesce high-frequency message pushes and reconcile Expo delivery receipts.
- Add chat privacy controls to Notification/Privacy settings.

### Wave 7 exit gate

- Hidden-preview notifications reveal neither sender nor content.
- Muted, blocked, rejected, suspended, and logged-out states receive no improper
  push.
- Replayed sends do not generate duplicate notifications.

## Wave 8 - Admin configuration, integrity, and operations

- Add owner dashboard settings for flags, hard-bounded limits, request expiry,
  unsend window, retention, text filtering, and media availability.
- Add operational metrics without exposing message content: active conversations,
  sends, request acceptance/rejection, blocks, reports, failures, latency, upload
  rejection, push delivery, and reconciliation health.
- Add individual chat restriction and history to the existing user context.
- Add integrity reconciliation and safe repair for projections, unread counts,
  orphan uploads, expired commands, and evidence references.
- Add emergency runbooks for disabling requests, media, all sends, and rolling
  back client presentation.

### Wave 8 exit gate

- Every setting and moderation mutation is owner/role checked, idempotent, and
  audited.
- Dashboard contains no endpoint that lists ordinary private messages.
- Dry-run and applied reconciliation are deterministic and produce an audit event.

## Wave 9 - Hardening, performance, accessibility, and regression

- Add per-IP/app-check-aware outer throttles without trusting them as identity.
- Bound all queries, listeners, arrays, text, evidence, and audit payloads.
- Add malformed Unicode, bidi-control, link, spam, replay, clock-skew, concurrent
  device, block-race, deletion-race, and notification-flood tests.
- Verify client cache isolation between accounts and private-data clearing on
  logout.
- Profile inbox/thread render cost on compact and low-memory Android devices.
- Run Firestore and Storage rule emulators, backend transaction tests, complete
  application tests, TypeScript, Android export, RTL/accessibility checks, and
  physical `expo run:android` acceptance.

### Wave 9 exit gate

- No unbounded reads or listeners exist in inbox, thread, reports, or operations.
- P95 send acknowledgement and inbox-open targets are defined and met in the
  production-like fixture.
- All existing wallets, store, rooms, voice, games, friendships, blocks, reports,
  and push flows remain green with direct chat disabled.

## Wave 10 - Deployment and staged rollout

1. Deploy indexes, rules, storage protections, backend, cleanup jobs, dashboard,
   and all flags disabled.
2. Ship the fallback-capable client with Chats hidden while disabled.
3. Create two development accounts as friends and a third non-friend account;
   no user allowlist is required because the application has no real users yet.
4. Enable text conversations globally and verify friends, requests, blocking,
   multi-device read state, unsend, push privacy, and report evidence.
5. Reconcile and require zero unexplained conversation, projection, command,
   notification, or report drift.
6. Enable requests after text acceptance; monitor spam and rejection metrics.
7. Enable media last, after protected upload, rejection, cleanup, and evidence
   checks pass on a physical Android device.
8. Keep independent emergency rollback switches available throughout rollout.

### Wave 10 final acceptance

- One user pair has exactly one conversation across all entry points and devices.
- One accepted command produces at most one message and one notification.
- Non-friends cannot bypass requests; any rank cannot bypass a block.
- Cross-user history, attachments, inbox projections, and report evidence remain
  inaccessible.
- Staff see only reported evidence and every evidence access is audited.
- Images and voice notes cannot be committed before validation and approval.
- Unread/read state converges across devices and survives offline retry.
- Deleted/suspended/blocked account behavior matches the locked lifecycle policy.
- The dashboard can stop requests, media, or all sends without an app rebuild.
- Disabling the entire feature leaves all existing app areas operational.

## Required automated test matrix

- Contract parsing and unknown-field rejection across backend/mobile fixtures.
- Deterministic IDs, request replay, changed-payload conflict, and concurrent send.
- Friend, non-friend, incoming request, accepted, rejected, expired, and cooldown.
- Bidirectional block, unblock, suspension, deletion, and friendship removal.
- Staff-role non-bypass and verified-role badge projection.
- Text normalization, bidi controls, links, blocked words, spam, and hard caps.
- Reply, unsend boundary, delete-for-me, pagination, sequence, read, and unread.
- Two-device and offline retry ordering.
- Image/voice MIME spoof, size, duration, quarantine, scan, finalize, and cleanup.
- Sticker ownership, expiry, disabled catalog item, and replay.
- Report selection, server evidence capture, regional scope, action, audit, and
  legal hold.
- Notification preferences, hidden preview, mute, coalescing, route, receipt, and
  duplicate suppression.
- Firestore/Storage rules for participants, strangers, blocked peers, admins,
  suspended users, deleted users, and guessed paths.
- Compact/standard/tall Android RTL, keyboard, large text, TalkBack, reduced
  motion, low memory, and app background/restore.

## Monitoring and rollback

- Monitor send volume, unique recipients, new requests, request rejection and
  block rates, failed sends, conflict/replay rate, latency, unread drift, upload
  rejection, report rate, push failures, and cleanup backlog.
- Never log message bodies, attachment URLs, voice data, access tokens, or report
  evidence in ordinary function logs or analytics.
- Emergency-disable new requests first during spam events, media first during
  attachment incidents, and all sends during a broad safety or integrity event.
- Rollback never deletes conversation history or rewrites messages. It disables
  new operations while reads remain available to participants unless a legal or
  security incident requires a separate owner-approved action.

## Deferred extensions

- Private voice or video calls
- Group personal chats
- Video messages and arbitrary files
- Disappearing messages
- Message editing
- Gifts and wallet transfers inside chat
- End-to-end encryption
- Automated translation
- Cross-room shared inboxes or business accounts

Each deferred capability requires its own privacy, safety, abuse, storage, and
moderation review.
