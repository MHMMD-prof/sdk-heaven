# Personal Chats Wave 6C — Retention, cleanup, tombstones, and evidence media isolation

Status: implemented locally. This closes Wave 6. Wave 6A captured reports and evidence,
6B added the audited staff reader, and 6C gives both a lifecycle: an owner-configurable
retention policy, a scheduled three-pass cleanup, and reported media copied into an
isolated prefix so evidence outlives the conversation it came from.

Exit gate: **retention cleanup never removes active legal-hold evidence.** It is enforced
three times over — the expiry query excludes `legalHold == true`, the sweep loop re-checks
each case, and the transaction re-reads the case so a hold applied mid-sweep still wins.

## The retention policy document

`directChatRetention/current`, already client-deny at `firestore.rules`:

| Field | Default | Hard bounds |
| --- | --- | --- |
| `messageRetentionDays` | 365 | 30–730 |
| `evidenceRetentionDays` | 90 | 30–365 |
| `legalHoldRetentionDays` | 180 | 90–730 |

Defaults are derived from the Wave 6A/6B constants (`DIRECT_CHAT_EVIDENCE_RETENTION_MS`,
`DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS`) so an absent document behaves exactly as before this
wave. Bounds are clamped server-side and cannot be widened from configuration.

Cutoffs are computed from each message's `createdAt` at sweep time rather than from a
precomputed `expireAt`. This deliberately differs from `roomChatService.js`: a stamped
field freezes the policy that was in force when the message was sent, so lowering retention
would never reach existing messages. A service test asserts that lowering the policy purges
a message that survived the previous run, with no per-message backfill.

## The three passes

`cleanupDirectChatRetention` runs every 60 minutes on `Asia/Baghdad` and runs all three
passes in one schedule, like `cleanupRoomRecordingEvidence`.

**Pass A — `copyDirectChatEvidenceMedia`.** Collection-group query for evidence snapshots
with `evidenceMediaState == 'pending'`, then `bucket.file(src).copy(dest)` into
`direct-chat-evidence/{reportId}/{messageId}/{asset}`. Sets `'copied'` plus `evidencePath`,
or `'missing'` when the source is gone. This is the repo's first Storage-to-Storage copy.
It runs first on purpose: it is what releases held media, so ordering it ahead of the purge
means reported bytes are isolated before the originals become eligible.

**Pass B — `cleanupDirectChatMessages`.** Round-robin conversation sweep reusing the walk
from `directChatReconciliationService.js` (`orderBy('conversationId')` plus a cursor), with
the cursor persisted in `directChatRetention/sweepState`. Because eligibility is not an
indexed field, conversations written before this wave need no backfill. Per conversation it
deletes the contiguous expired prefix in one transaction, raises the watermark, decrements
unread counts and `directChatInboxSummaries`, and deletes unheld upload documents and
objects.

**Pass C — `cleanupDirectChatEvidence`.** `directChatReports` where `legalHold == false`
and `retentionUntilMs <= now`, then tombstones the case (`status: 'expired'`, `deletedAtMs`,
cleared `attachmentIds`) and deletes the snapshots and copied objects.

## Expired messages are hard-deleted behind one watermark

Rather than a tombstone per message, a single conversation-level
`retentionPurgedThroughSequence` explains the gap, mirroring how `clearedThroughSequence`
already works. Document counts stay bounded and storage is reclaimed. The watermark is
threaded through:

- `baseConversationDocument` — carried forward explicitly, not defaulted. That document is
  re-merged into the conversation on **every** send, so a plain `retentionPurgedThroughSequence: 0`
  there would have silently un-purged history on the next message.
- `buildDirectChatProjection` and `mapDirectChatProjection` — both member projections carry
  it, and `resolveDirectChatProjectionDrift` reports it as a drift reason when the
  projection and conversation disagree.
- `directChatQueryService.js` — the thread floor is now
  `resolveDirectChatThreadFloor(projection, conversation)`, the higher of the member's own
  cleared marker and the watermark.
- `directChatReconciliationService.js` — the same floor feeds the unread recount so the
  reconciler agrees with the sweep.
- When the purge removes the conversation's current `lastMessageId`, the preview fields are
  cleared on the conversation and rebuilt into both projections, keeping the exact-field
  drift check clean.

`lastSequence` never regresses. It is the allocator for new messages and the ceiling every
projection clamps against, so `buildDirectChatReconciliation` now floors it at the
watermark — otherwise a fully purged conversation would have had `lastSequence` reset to 0
by the reconciler and reused sequence numbers.

## Two failure modes found while building this

- **An orphaned media object.** The first implementation deleted an expired message row
  while retaining its held-but-uncopied object. The row is the only pointer to that object,
  so nothing would ever have revisited it and the bytes would have leaked forever. The purge
  now stops at such a row entirely: `resolveDirectChatMessagePurge` treats an unresolved
  evidence hold as a hard stop, and the next sweep retries once the copy lands. A service
  test asserts the row survives the first pass, then both the row and the object go on the
  pass after the copy.
- **Tombstones starving the expiry queue.** `retentionUntilMs` is *removed* when a case is
  tombstoned, not left in the past. A document missing the ordered field drops out of the
  range query, so expired cases cannot sit at the head of every later sweep and starve cases
  that are only now coming due. `cleanupExpiredRoomEvidence` re-tombstones the same rows
  every hour for exactly this reason; that behaviour was not copied.

A held attachment's live object is released once the copy lands **or** once the snapshot is
resolved as `'missing'` — a source that no longer exists cannot be preserved by holding an
object that is already gone, and without that release the hold would block the purge
forever.

## The evidence viewer prefers the copy

`resolveEvidenceMedia` now signs `snapshot.evidencePath` when
`evidenceMediaState === 'copied'`, falling back to the Wave 6B held live-media path while
the copy is still pending. The copy is authoritative once it exists: it outlives both the
hold and the message. Snapshots expose `mediaIsolated` and `mediaState`, and the dashboard
labels each attachment so staff know whether they are looking at the preserved copy, a
temporarily held live object, or a lost one.

## Owner tooling

The dashboard settings UI for retention is Wave 8 scope, so the writer is a CLI script
modelled on `setDirectChatRolloutStage.js`:

- `npm --prefix functions run direct-chat:retention` — dry run by default, printing current
  policy, requested policy after clamping, and the hard bounds. `--apply` requires
  `--actor-uid=`, gates on an active `owner` `adminProfiles` document, and writes a
  `before`/`after` `adminAuditEvents` record in the same transaction. An unchanged policy is
  a no-op rather than an audit entry.
- `npm --prefix functions run direct-chat:retention:status` — policy, resolved message
  cutoff, sweep cursor state, pending-copy sample count, and legal-hold case sample count.

## Mobile

The realtime listener floor is now the higher of the member's cleared marker and the
watermark, so it never asks for rows retention has already deleted.
`DirectChatScreen.tsx` renders one bilingual line — "أُزيلت الرسائل الأقدم وفق سياسة
الاحتفاظ." / "Older messages were removed under the retention policy." — in place of the
"load older" control once the watermark is non-zero.

## Rules and indexes: no relaxation

`directChatRetention/**` and `direct-chat-evidence/**` were already backend-only, so no rule
changed. New emulator assertions confirm it: the policy and sweep documents deny read,
write, and delete to members and to `owner` claims alike, the watermark is read-only on both
the conversation and the projection, and the per-message evidence object path denies every
caller including `owner` and `super-moderator`. Three indexes were added —
`directChatReports (legalHold, retentionUntilMs)` mirroring `roomEvidence`, and two on the
`evidence` collection group for the copy queue and the hold-release check.

## Verification

- Full non-emulator suite: **1,220/1,220 pass**, including 13 new
  `directChatRetentionCore` cases and 11 new `directChatRetentionService` cases, plus 3 new
  `directChatModerationService` cases for copy preference, live fallback, and the missing
  case. Coverage includes policy clamping and defaults, cutoff math, contiguous-prefix
  purge, the held-row hard stop, unread decrements against member floors, watermark
  non-regression, path-traversal rejection on evidence object paths, copy idempotence across
  reruns, missing-source handling, legal-hold survival past `retentionUntilMs`, tombstone
  non-reselection, and sweep cursor advance and wrap.
- Root TypeScript: no error in any direct-chat or Personal Chats file. One unrelated error
  appeared late in the run in `src/components/CustomCosmeticsPanel.tsx`, an untracked file
  belonging to the concurrent cosmetics wave and untouched here. Functions lint: pass, with
  both modules and both scripts added to the explicit `node --check` list.
- Admin dashboard typecheck: no new errors. The seven pre-existing
  `DailyLoginRewardsPanel.tsx` errors are unchanged.
- Android Expo SDK 56 export: pass.
- Firestore and Storage rule emulators: **64/65 pass**, including the new Wave 6C
  assertions. The one failure,
  `accepts bounded Wave 6 projections but rejects unrecognized cosmetic authority fields`,
  is the same pre-existing cosmetics-wave failure documented in Waves 6A and 6B and is
  unrelated to this wave.

## Test-double additions

`functions/directChatTestSupport.mjs` gained `copy` and `exists` on the fake Storage file
(with a `copies` log for idempotence assertions) and non-transactional `set`, `update`, and
`delete` on fake document references, all of which the Admin SDK supports and the retention
passes use outside transactions.
