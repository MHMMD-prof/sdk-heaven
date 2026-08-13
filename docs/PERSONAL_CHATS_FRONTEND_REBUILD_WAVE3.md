# Personal Chats Frontend Rebuild — Wave 3 Thread

Status: COMPLETE LOCALLY  
Completed: 2026-08-09  
User-visible cutover: guarded  
Production presentation flag: off by default

## Delivered

### New Modern Royal conversation shell

`DirectChatScreen` now selects `DirectChatScreenModernRoyal` only when
`personalChatsFrontendV2` is explicitly enabled. All fail-closed states continue
to render the legacy thread.

The replacement screen uses the Wave 1 chat-local oxblood, royal red, and warm
gold system. The header has a stable single-line identity/status layout, reduced
avatar cosmetics, presence and typing state, profile navigation, and existing
conversation safety actions. It does not import the legacy velvet stage, leather
card, crest artwork, or image backdrop.

### Grouped message timeline

The timeline now renders:

- adjacent same-sender groups within the five-minute window;
- localized date separators;
- one unread boundary at the captured initial read sequence;
- explicit system-event pills;
- text, emoji, sticker, image, voice-note, sending, sent, read, failed, unsent,
  removed, and retention states;
- reply context with a clear unavailable source after moderation or retention;
- equipped chat-bubble cosmetics beneath content at capped opacity.

Each message exposes one composed accessibility label containing sender, content
type/text, time, and delivery state, avoiding repeated screen-reader output.

### Stable history and realtime behavior

Older-page insertion uses `maintainVisibleContentPosition` and does not force a
scroll to the bottom. Realtime messages auto-scroll only when the reader is near
the bottom; otherwise a new-message pill appears. Messages sent by the current
user still follow the send action to the newest item.

### Message action sheet

Long-press message alerts were replaced in the Modern Royal thread with a bottom
action sheet. Availability is derived from message ownership and state:

- Reply for ordinary messages;
- Copy for visible text through Expo Clipboard;
- Retry for the sender's failed optimistic message;
- Unsend for the sender's visible sent message, with confirmation;
- Report for a peer message.

`expo-clipboard` `~56.0.4`, the Expo SDK 56-compatible version, was added for the
universal copy action.

### Preserved contracts and Wave 4 boundary

The screen continues to use `useDirectChatThread`; no realtime query, cursor,
command, moderation, report, media, receipt, presence, storage, or navigation
contract changed. The existing attachment tools and composer behavior are
intentionally retained. Wave 4 replaces requests, composer, and attachment entry.

## Main files

- `src/screens/DirectChatScreenModernRoyal.tsx`
- `src/screens/DirectChatScreen.tsx`
- `src/personalChat/ui/ChatThreadTimeline.tsx`
- `src/personalChat/ui/ChatThreadCanvas.tsx`
- `src/personalChat/ui/ChatMessageActionSheet.tsx`
- `src/personalChat/ui/buildMessageActions.ts`
- `src/personalChat/ui/index.ts`
- `src/personalChat/__tests__/chatThreadWave3.test.ts`
- `package.json`
- `package-lock.json`

## Verification

Passed:

- Personal-chat suite: 10 files, 47 tests.
- Wave 3 contract tests: 6 tests.
- Full suite with a 20-second per-test ceiling: 274 files and 1,499 tests passed.
- Copy encoding scan: passed.
- Android Expo SDK 56 export: 2,338 modules bundled successfully.
- New Wave 3 files have no TypeScript diagnostics.

The full suite retains two unrelated pre-existing stale expectations in
`socialNotificationsService.test.mjs` (`follows`) and
`socialProfileCore.test.mjs` (`followerCount`/`followingCount`). Repository-wide
TypeScript remains red only on unrelated existing worktree diagnostics in
Battleship, Me profile, room rocket artwork, Drawing Guess, legacy chat styles,
Home, social profile mapping, and room watch video.

## Exit gate record

- [x] Required message, attachment, visibility, delivery, system, and retention
      states have explicit visual treatment.
- [x] Older-page insertion preserves the visible position.
- [x] Realtime messages do not interrupt a reader browsing history.
- [x] Header status remains within a reserved one-line layout.
- [x] Reply sources remain connected and fail gracefully when unavailable.
- [x] Chat-bubble cosmetic layers are capped below message content.
- [x] Long-press actions use a bottom sheet, with destructive confirmation.
- [x] Message accessibility combines sender, content, time, and delivery once.
- [x] Legacy presentation remains available through the fail-closed flag.

## Wave 4 handoff

Wave 4 can replace the incoming-request decision surface, composer, reply bar,
and attachment tray. It should reuse the existing send/upload implementations,
preserve the one-message outgoing-request rule, and harden keyboard/safe-area
behavior without changing any backend policy checks.
