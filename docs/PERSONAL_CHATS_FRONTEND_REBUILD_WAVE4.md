# Personal Chats Frontend Rebuild — Wave 4 Composer

Status: COMPLETE LOCALLY  
Completed: 2026-08-09  
User-visible cutover: guarded  
Production presentation flag: off by default

## Delivered

### Anchored incoming-request decision card

Incoming requests now render a width-bounded Modern Royal decision card directly
under the thread header. Accept is the only gold primary action. Reject, Report,
and Block remain visible secondary actions. Reject and Block require destructive
confirmation; reporting continues through the existing scoped report sheet and
backend policy.

The composer is simultaneously locked with a clear explanation, so the request
card and input state cannot contradict one another.

### New Modern Royal composer

`DirectChatComposerModernRoyal` replaces the legacy composer only in the guarded
Modern Royal thread. It provides:

- one attachment entry;
- an independently expanding multiline input capped at 132px;
- connected reply context and a 44px cancellation target;
- a character warning after 1,800 characters and a hard 2,000-character limit;
- visible enabled/disabled send state;
- keyboard-safe iOS padding and Android height avoidance;
- safe-area bottom padding;
- composer-height tracking that keeps the newest message visible only when the
  reader is already at the bottom.

The composer state is derived by `buildComposerState`, covering loading,
accepted, initial request, incoming pending, and outgoing pending modes. Before
acceptance, a user can send one text request and cannot attach media. After that
request is sent, the input is replaced by an explicit waiting explanation rather
than an apparently enabled field.

### Consolidated attachment tray

`ChatAttachmentTray` moves emoji, owned stickers, protected images, and hold-to-
record voice notes into one bottom sheet. It reuses the existing
`beginDirectChatUpload` authorization/upload/finalization contract and existing
thread emoji/sticker commands.

The tray preserves:

- camera and photo-library permissions and pending picker recovery;
- JPEG, PNG, and WebP validation with the 6 MB limit;
- Expo Audio high-quality recording with a 120-second and 5 MB limit;
- local image/voice preview before upload;
- visible upload progress, cancellation, failure, and retry;
- active-owned-sticker filtering;
- reply-to attachment association;
- non-blocking selection, success, and warning haptics paired with visible state.

Audio, image-picker, filesystem, image, haptic, media upload, store ownership, and
messaging dependencies were already present; Wave 4 adds no new package.

### Preserved contracts

No messaging authorization, request rule, moderation policy, upload path,
attachment size limit, command action, realtime listener, navigation route, or
stored data changed. The legacy composer remains untouched for the fail-closed
legacy presentation.

## Main files

- `src/screens/DirectChatScreenModernRoyal.tsx`
- `src/personalChat/ui/DirectChatComposerModernRoyal.tsx`
- `src/personalChat/ui/ChatAttachmentTray.tsx`
- `src/personalChat/ui/ChatRequestDecisionCard.tsx`
- `src/personalChat/ui/buildComposerState.ts`
- `src/personalChat/ui/index.ts`
- `src/personalChat/__tests__/chatComposerWave4.test.ts`

## Verification

Passed:

- Personal-chat suite: 11 files, 53 tests.
- Wave 4 contract tests: 6 tests.
- Full suite with a 20-second per-test ceiling: 276 files and 1,510 tests passed.
- Copy encoding scan: passed.
- Android Expo SDK 56 export: 2,344 modules bundled successfully.
- New Wave 4 files have no TypeScript diagnostics.

The full suite retains two unrelated pre-existing stale expectations in
`socialNotificationsService.test.mjs` (`follows`) and
`socialProfileCore.test.mjs` (`followerCount`/`followingCount`). Repository-wide
TypeScript remains red only on unrelated existing worktree diagnostics in
Battleship, Me profile, room rocket artwork, Drawing Guess, legacy chat styles,
Home, social profile mapping, and room watch video.

## Exit gate record

- [x] Request acceptance, rejection, reporting, and blocking remain wired to the
      existing policy-protected commands.
- [x] Accept is the only primary incoming-request action.
- [x] Outgoing pending requests explain and enforce the single-message rule.
- [x] One attachment entry owns emoji, sticker, image, and voice-note selection.
- [x] Upload selection, progress, cancellation, error, and retry have visible
      states.
- [x] Composer growth preserves the bottom only for a reader already at bottom.
- [x] Haptics are non-blocking and paired with visible feedback.
- [x] Legacy presentation and composer remain available through the fail-closed
      flag.

Physical iOS/Android checks for keyboard transitions, camera/library selection,
microphone recording, safe areas, and screen readers require target devices and
remain an explicit Wave 5 gate.

## Wave 5 handoff

Wave 5 should run Arabic-first visual and copy QA, mixed-direction testing,
dynamic type and screen-reader audits, small/standard/large/wide layouts,
reduced-motion checks, performance profiling, stable visual fixtures, and target-
device keyboard/media/voice smoke tests before staged cutover.
