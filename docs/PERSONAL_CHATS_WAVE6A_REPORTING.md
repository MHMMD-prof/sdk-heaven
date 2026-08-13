# Personal Chats Wave 6A — Direct-chat reporting and server-captured evidence

Status: implemented locally; reporting is reachable only once `directMessages` is
enabled in Wave 10. Dashboard review, staff actions, retention, and legal hold are
deferred to Wave 6B.

## Storage shape

Reports use split storage that mirrors the voice-room precedent:

- `reports/{reportId}` holds the triage case with `source: 'direct-chat-safety-v1'`
  and `subjectType: 'direct-message'`, so Wave 6B extends the existing dashboard
  queue instead of building a second one. `contentExcerpt` is deliberately empty,
  because that field renders in the unaudited queue list.
- `directChatReports/{reportId}` holds the staff-only case record, and
  `directChatReports/{reportId}/evidence/{messageId}` holds one immutable snapshot
  per captured message. Both remain deny-all for every client.

`reportId` is `createDirectChatReportId({ conversationId, reporterUid, requestId })`,
so a retried submission resolves to the same case document.

## Delivered

- `functions/directChatReportCore.js`: report access, report rate limiting, bounded
  evidence window selection, the snapshot builder, and severity mapping that matches
  `reportSeverity` in `roomChatService.js` so dashboard severity badges behave
  identically.
- `functions/directChatReportService.js`: `submitDirectChatReport` runs as one
  transaction that writes the triage case, the staff-only case, the evidence
  snapshots, `evidenceHold` on every referenced upload, an `adminAuditEvents` entry,
  and the idempotency record. The response carries only `reportId`,
  `capturedMessageCount`, and `status`; no captured content is echoed back.
- `report-direct-chat` is dispatched in `executeDirectChatCommand` before the
  mutation-action gate that previously made it fall through to `FEATURE_DISABLED`.
- `EVIDENCE_UNAVAILABLE` (422) added to `DIRECT_CHAT_ERRORS` on both the Functions
  and mobile sides of the contract.
- `src/personalChat/DirectChatReportSheet.tsx`: a modal sheet over the 10 report
  categories with an optional 500-character details field. A sheet rather than
  `Alert.alert`, because Android renders more than three alert buttons poorly.
- `useDirectChatThread.report(...)` builds the standard command envelope, and
  `DirectChatScreen` replaces the Wave 4 placeholder with the real sheet plus an
  "إبلاغ" long-press action on peer messages only.

## Safety properties

- **Reporting survives blocks.** `resolveDirectChatReportAccess` deliberately does
  not reuse `resolveDirectChatPairAccess`. It requires only that the actor is one of
  `conversation.memberUids` and that the actor's own account is not `removed`. It
  ignores block state in both directions, the peer's `moderationStatus`, the actor's
  own `directChatRestrictions` entry, and the `directMessages` flag, so a victim who
  blocked their abuser can still report them and an emergency feature shutdown never
  disables the safety valve.
- **Evidence capture is bounded.** The context query is constrained to the selected
  sequence range widened by 10 either side and limited to 30 documents; the merged
  window is hard-capped at 30 snapshots with every selected message retained and the
  nearest context preferred. A report can never scan a whole thread.
- **Snapshots are immutable.** Each snapshot is a separate created document, so a
  later unsend clears `text` on the live message while the captured evidence keeps
  what was sent. Note the converse limit: a message already unsent before the report
  has no recoverable text, and its snapshot records `visibilityState: 'unsent'` with
  empty text.
- **Reported media is retained.** Every referenced `directChatUploads/{uploadId}`
  gains `evidenceHold: true` so Wave 6B retention cleanup skips it.
- **Rate limited.** Five reports per rolling hour per reporter, plus a one-hour
  per-conversation cooldown tracked in a list bounded to 10 entries. Both return
  `RATE_LIMITED`.

## Rules and indexes

No relaxation was needed. `directChatReports/{reportId}/{document=**}` and
`direct-chat-evidence/{reportId}/{allPaths=**}` were already deny-all, `reports` has
no client rule at all, and all staff access flows through the Admin SDK behind the
dashboard HTTP endpoint. Wave 6A adds zero client read surface; the new emulator
assertions lock that in rather than open it up.

## Verification

- Full non-emulator suite: 1,131/1,131 pass, including 11 new
  `directChatReportCore` cases and 5 new `directChatService` report cases covering
  submission, replay, changed-payload conflict, non-member denial, blocked-reporter
  success, media `evidenceHold`, cooldown, and absence of evidence in the response.
- Root TypeScript: pass.
- Functions lint: pass. `directChatReportCore.js` and `directChatReportService.js`
  were added to the explicit `node --check` list. Note that the Wave 4/5 modules
  `directChatMediaCore.js`, `directChatMediaService.js`, `directChatQueryService.js`,
  and `directChatProjectionCore.js` are still absent from that list; they parse
  cleanly today but are not gated.
- Android Expo SDK 56 export: pass (2,255 modules).
- **Firebase rule emulator now runs to completion.** This was the gate that stalled
  in Waves 4 and 5. The cause was the emulator JAR download, not a hang: the runner
  redirected `XDG_CACHE_HOME` to a throwaway directory on every run, and although
  firebase-tools resolves emulator binaries from `os.homedir()/.cache/firebase/emulators`
  rather than `XDG_CACHE_HOME`, the ~190 MB of JARs were simply not present locally.
  `scripts/run-firestore-rules-tests.mjs` now pins `FIREBASE_EMULATORS_PATH` to the
  shared user cache and passes `--non-interactive` so a fresh CLI config home can
  never block on a consent prompt. Result: 59/60 rule assertions pass, including all
  Wave 6A ones.
- One pre-existing rule failure remains and is **not** Wave 6A scope:
  `accepts bounded Wave 6 projections but rejects unrecognized cosmetic authority fields`
  fails at `HEAD` too (verified by running the unmodified test file). It expects
  `hasActivePublicProfile()` to reject a reader whose own profile carries an
  unrecognized `equippedCosmetics` slot such as `staffBadge`, but that helper checks
  only `uid` and `moderationStatus` and never applies the `validPublicProfile`
  structural validation that does reject the forged slot. Fixing it changes a read
  gate used across the whole rule file, so it belongs to the cosmetics wave that
  owns it.

## Deferred to Wave 6B

Dashboard evidence viewer with per-view audit events;
`dismiss`/`remove-direct-message`/`restrict-direct-chat`/`set-direct-chat-legal-hold`
actions with role and regional scope; the first production writer for
`directChatRestrictions/{uid}`; `directChatRetention/current` plus scheduled cleanup;
deletion tombstones; legal-hold exclusions; and copying reported media bytes into
`direct-chat-evidence/{reportId}/`.

Multi-select reporting is also additive UI deferred past 6A: the contract and server
already accept up to 10 selected messages and capture the surrounding context
regardless, so 6A ships single-message long-press reporting plus request-panel
reporting.
