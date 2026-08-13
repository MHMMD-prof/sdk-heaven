# Personal Chats Wave 6B — Staff review, evidence viewer, and enforcement

Status: implemented locally. Wave 6A captured direct-chat reports and evidence but had
no reader; 6B adds the audited staff path over it. Retention, scheduled cleanup, and
copying media bytes into `direct-chat-evidence/` remain Wave 6C.

## Who can read direct-message content

A new `reports:evidence` permission is granted to `owner` and `super-moderator` only,
and both new dashboard actions require it:

| Role | `report-action` (triage) | `direct-chat-evidence` / `direct-chat-action` |
| --- | --- | --- |
| owner | yes | yes |
| super-moderator | yes | yes |
| moderator | yes | no |
| support | yes | no |
| catalog-manager | no | no |
| auditor | no | no |

Triage and reading private message content are deliberately different capabilities:
`moderator` and `support` keep the full six-action report workflow on DM cases and never
see message text. This mirrors `resolveStaffAuthority` in `roomRecordingCore.js`, which
already restricts voice-recording playback the same way.

Enforcement actions require `reports:evidence` too, not just `reports:manage`, because
each one is a judgement about content that only those two roles may read.

## Delivered

- `functions/adminClaimsCore.js` and `functions/adminDashboardCore.js`: the
  `reports:evidence` permission, and `direct-chat-evidence` / `direct-chat-action`
  registered in both the action allow-list and the permission map. The existing
  contract test that asserts those two maps have identical keys keeps them in step.
- `functions/directChatModerationCore.js` (pure): request and action normalization,
  the `directChatRestrictions` document builders, the removal tombstone patch, the
  legal-hold retention math, and the check that a removal target was actually reported.
- `functions/directChatModerationService.js`: `resolveDirectChatEvidence` and
  `executeDirectChatModerationAction`.
- `functions/index.js`: two dispatch branches beside `report-action`, passing
  `assertReportInOperatorScope` in as a dependency so the service stays importable and
  testable without pulling in `index.js`.
- `admin-dashboard/src/adminDashboardApi.ts`: `requestAdminDirectChatEvidence`,
  `executeAdminDirectChatAction`, response types, and type guards. Neither action is in
  `readOnlyActions`, so neither is ever auto-retried — a retried evidence `requestId`
  would be a 409 by design.
- `admin-dashboard/src/ReportsPanel.tsx`: a DM-only section in `ReportDrawer` behind a
  reason-gated reveal, the snapshot list with inline image and audio players, the four
  action controls, a `direct-chat-safety-v1` source label, and an explicit 403 state.

## Safety properties

- **No view goes unlogged.** `resolveDirectChatEvidence` writes
  `adminAuditEvents/direct_chat_evidence_view_{requestId}` with the reason, actor role,
  region codes, `snapshotCount`, and `mediaGranted` on *every* call. Unlike
  `executeAdminReportAction`, a replayed `requestId` is **not** treated as a replay that
  returns the same payload — it is rejected with 409, because a replay path would let a
  second view of private content happen against a single log entry.
- **Content is never fetched incidentally.** Opening a report loads no message content.
  The dashboard only calls the endpoint from an explicit reveal control that requires a
  reason of at least two characters, so the audit trail always has a stated purpose.
- **The endpoint cannot be aimed at another report class.** Both actions load
  `reports/{reportId}` first and reject with 400 unless
  `source === 'direct-chat-safety-v1'`, then apply `assertReportInOperatorScope` and
  `assertFreshAdminAuth` before reading anything from `directChatReports`.
- **Removal is confined to what was reported.** `remove-direct-message` requires every
  requested `messageId` to appear in the case's `selectedMessageIds`, so staff with
  evidence access still cannot reach into arbitrary messages in the conversation.
- **Removal does not touch the evidence.** The live message gets
  `visibilityState: 'removed'`, empty `text`, and `moderationRemovedBy`; the immutable
  snapshot under `directChatReports/{reportId}/evidence` is left exactly as captured.
  Conversation previews and both members' unread projections are refreshed the same way
  `unsend-direct-message` does.
- **The restriction blast radius is stated in the UI.** An active
  `directChatRestrictions/{uid}` entry fails both `resolveDirectChatActorAccess` and the
  `targetRestriction` branch of `resolveDirectChatPairAccess`, so the user can neither
  send nor receive any direct message from anyone. The confirm dialog says that
  explicitly rather than implying a per-conversation mute. Reporting still works, because
  Wave 6A's `resolveDirectChatReportAccess` deliberately ignores restrictions.

## Two shape details that would have failed silently

- `directChatRestrictions` documents are written through
  `buildDirectChatRestrictionDocument`, which produces exactly the shape
  `mapDirectChatRestriction` accepts. That mapper returns `undefined` for anything it
  does not recognise, and an unrecognised restriction *allows* direct messages, so a
  near-miss shape would have written an enforcement record that enforced nothing. A core
  test round-trips the document through the mapper to `active: true`.
- `startsAt` and `endsAt` are stored as Firestore `Timestamp`s, not millis. `firestore.rules`
  compares `endsAt` against `request.time` in `hasActiveDirectChatRestriction()`, which
  gates typing and online presence; a raw number makes that comparison a rules evaluation
  error, which denies rather than allows — meaning a bounded restriction would have kept
  blocking presence forever after expiry. The emulator suite now asserts that an expired
  restriction lets presence through again.

## Mobile change (small, and outside the plan's "no mobile changes" note)

`mapRealtimeMessage` previously dropped any message whose `visibilityState` was not
`visible` or `unsent`, so a moderation-removed message would have silently disappeared
from both participants' threads. `removed` is now part of the union and renders the
tombstone "تمت إزالة هذه الرسالة بقرار الإشراف", matching how `unsent` behaves.

## Rules and indexes: no relaxation

`directChatReports/**`, `directChatRestrictions/{uid}`, and `reports` all stay
client-deny; every staff read flows through the Admin SDK behind the dashboard endpoint.
The new emulator assertions confirm that gaining a production writer did not open
`directChatRestrictions` to clients, staff claims included. No index is needed for the
`evidence` subcollection because it is a single-field `sequence` ordering.

## Media in the viewer

Wave 6A already sets `evidenceHold: true` on every referenced
`directChatUploads/{uploadId}`, so 6B mints 5-minute V4 signed URLs for exactly those
objects under `direct-chat-media/` and counts them in the view audit event. Snapshots
whose upload is missing, not `finalized`, or not held return no URL rather than a broken
one. Wave 6C's byte copy then becomes purely about isolation from conversation deletion.

## Verification

- Full non-emulator suite: 1,163/1,163 pass, including 7 new
  `directChatModerationCore` cases and 11 new `directChatModerationService` cases
  covering per-view audit on every view, two views writing two events, replay 409,
  non-DM source rejection, region denial for both endpoints, fresh-auth denial,
  removal restricted to `selectedMessageIds`, preview and unread refresh, a restriction
  blocking a later `send-direct-message` in both directions while reporting still works,
  dismiss closing both documents, legal-hold retention extension, and action replay
  returning the same `eventId`.
- Root TypeScript: pass. Functions lint: pass, with both new modules added to the
  explicit `node --check` list.
- Admin dashboard typecheck: no new errors. The seven pre-existing
  `DailyLoginRewardsPanel.tsx` errors are unchanged.
- Android Expo SDK 56 export: pass (2,258 modules).
- Firestore and Storage rule emulators: 60/61 pass, including the new Wave 6B
  assertions. The one failure,
  `accepts bounded Wave 6 projections but rejects unrecognized cosmetic authority fields`,
  is the same pre-existing cosmetics-wave failure documented in Wave 6A and is unrelated
  to this wave.

## Test-double refactor

The in-memory Firestore and Storage doubles moved from `directChatService.test.mjs` into
`functions/directChatTestSupport.mjs` so the moderation suites exercise the same
semantics rather than a second, subtly different fake. `createFakeBucket` gained
`getSignedUrl`. `directChatService.test.mjs` is otherwise unchanged and still passes at
19/19.

## Deferred to Wave 6C

`directChatRetention/current` policy, the scheduled cleanup that honours `legalHold` and
`evidenceHold`, retention deletion tombstones, expiring evidence cases, and copying
reported media bytes into `direct-chat-evidence/{reportId}/`. `set-direct-chat-legal-hold`
has no consumer until that cleanup job exists; it is written now so the flag and the
extended `retentionUntilMs` are already correct when the job arrives.
