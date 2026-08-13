# Personal Chats Frontend Rebuild — Wave 2 Inbox

Status: COMPLETE LOCALLY  
Completed: 2026-08-09  
User-visible cutover: guarded  
Production presentation flag: off by default

## Delivered

### New Modern Royal inbox

`ChatsScreen` now selects a completely new `ChatsScreenModernRoyal` when
`personalChatsFrontendV2` is explicitly enabled. Missing, false, malformed, or
failed flag state still renders the legacy screen.

The new inbox uses the app's royal language through an oxblood/red canvas, fine
gold rails, restrained garnet emphasis, and flat conversation rows. It does not
reuse the legacy velvet/leather salon, crest artwork, image backdrop, or stacked
framed-card composition.

The inbox includes:

- All, Unread, and Requests filters;
- normalized name/identifier search;
- a compact incoming-request summary;
- draft-first, media-aware conversation previews;
- clear unread, muted, deleted-profile, request, offline, loading, error, empty,
  and no-results states;
- swipe and accessibility actions for mute and archive;
- long-press row actions;
- cached/offline recovery and retry;
- bounded list rendering and a 760px wide-layout cap.

Friends are no longer mixed into the conversation list.

### New-chat sheet

The compose flow is a new keyboard-safe Modern Royal bottom sheet. It separates
recent contacts from remaining friends, preserves recent-contact order, supports
normalized search, exposes discovery as an escape hatch, and returns
accessibility focus to the compose button when dismissed.

Friend overview data is requested only while the compose sheet is open. Inbox
construction accepts conversations, profiles, and drafts—not a friends list.

### Preserved contracts

Realtime conversation ownership, availability, commands, navigation routes,
archive/mute behavior, profile projection, cosmetics, and stored data are
unchanged. Selecting a person still opens the existing `DirectChat` route.
`DirectChatScreen` intentionally remains legacy until Wave 3.

## Main files

- `src/screens/ChatsScreenModernRoyal.tsx`
- `src/screens/ChatsScreen.tsx`
- `src/personalChat/DirectChatComposeSheetModernRoyal.tsx`
- `src/personalChat/useDirectChatInboxDrafts.ts`
- `src/personalChat/ui/buildComposeSections.ts`
- `src/personalChat/ui/ChatRequestSummary.tsx`
- `src/personalChat/ui/ChatConversationRow.tsx`
- `src/personalChat/ui/ChatSearchField.tsx`
- `src/personalChat/ui/ChatTopBar.tsx`
- `src/personalChat/directChatCopy.ts`
- `src/personalChat/__tests__/chatInboxWave2.test.ts`

## Verification

Passed:

- Personal-chat suite: 9 files, 41 tests.
- Wave 2 contract tests: 6 tests.
- Full suite: 273 files and 1,493 tests passed; the same two unrelated existing
  expectations remain stale in `socialNotificationsService.test.mjs` (`follows`)
  and `socialProfileCore.test.mjs` (`followerCount`/`followingCount`).
- Android Expo SDK 56 production export: 2,325 modules bundled successfully.
- New Wave 2 files have no TypeScript diagnostics.

Repository-wide `tsc --noEmit` remains red on unrelated pre-existing worktree
errors in Battleship, Me profile, room rocket artwork, Drawing Guess, legacy
chat styles, Home, social profile mapping, and room watch video. The web export
is also blocked by the existing missing `@lottiefiles/dotlottie-react` package;
the Android export is green.

## Exit gate record

- [x] Unread, muted, request, draft/media preview, and deleted-user states are
      visible without opening the thread.
- [x] Search composes with All, Unread, and Requests filters and provides an
      explicit no-results state.
- [x] Friends exist only in the compose flow.
- [x] Legacy salon imagery and repeated framed cards are absent from the Modern
      Royal inbox render tree.
- [x] Initial loading uses lightweight skeletons and does not replace cached
      conversations during refresh/recovery.
- [x] Compose dismissal returns accessibility focus deterministically.
- [x] Legacy presentation remains available through the fail-closed flag.

## Wave 3 handoff

Wave 3 can replace the thread header and message timeline behind the same
presentation selector. It should retain this inbox, keep the existing command
and realtime contracts, and add message grouping, unread boundaries, stable
pagination anchors, and non-interruptive new-message handling.
