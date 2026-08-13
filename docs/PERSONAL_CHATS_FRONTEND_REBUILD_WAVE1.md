# Personal Chats Frontend Rebuild — Wave 1 Foundation

Status: COMPLETE LOCALLY  
Completed: 2026-08-09  
User-visible cutover: no  
Production presentation flag: off by default

## Delivered

### Fail-closed presentation selection

`personalChatsFrontendV2` is now an independent field in the existing
`appConfig/socialFeatures` projection. Missing, false, malformed, or subscription
failure values select `legacy`; only explicit `true` selects `modern-royal`.

The selector changes presentation only. `DirectChatProvider` remains the sole
owner of messaging availability through `directMessages` and related safety
flags. Wave 1 does not change subscriptions, commands, authorization, routes,
or stored data.

### Modern Royal chat-local system

Added `src/personalChat/ui/chatTheme.ts` with the approved oxblood/garnet canvas,
royal red hierarchy, warm gold actions and dividers, accessible text colors,
layout metrics, typography roles, and motion duration.

These tokens intentionally do not modify the global theme.

### Shared primitives

- `ChatIcon`: named cross-platform Expo Symbols with iOS/Android/web mappings
  and a visible fallback for the SDK 56 beta package.
- `ChatRoyalBackdrop`: code-native red tonal atmosphere; no velvet/leather card.
- `ChatTopBar`: compact header, optional count/action, fine gold rail.
- `ChatSearchField`: 44dp searchable control with clear action.
- `ChatFilterBar`: All/Unread/Requests tab semantics.
- `ChatAvatar`: gold identity ring, reduced cosmetic rendering, online state.
- `ChatConversationRow`: flat 76dp row with unread, mute, preview, and time.
- `ChatListState`: loading, empty, unavailable, and retry foundation.
- Non-blocking chat haptic helpers and a reduced-motion policy helper.

The primitives are not imported by current screens yet. Wave 2 performs the
first guarded integration.

### Pure view-model builders

`buildInboxSections`:

- removes archived projections;
- separates incoming requests from All and Unread;
- keeps outgoing pending requests visible as conversations;
- combines normalized search with the active filter;
- supports draft-first previews, media kinds, unread state, and tombstoned
  deleted identities;
- never accepts or mixes a friends list into the inbox.

`buildMessageGroups`:

- groups adjacent same-sender messages within five minutes;
- breaks groups at sender, system-event, and local-date boundaries;
- inserts one unread boundary before the first unread peer message;
- preserves each original message for accessibility and later rendering.

### Disposable fixture adapter

`mapChatDesignFixtureCatalog` validates Wave 0 fixture metadata fail-closed. The
adapter is presentation-only and cannot authorize commands or provide realtime
state.

## Files

Existing files extended:

- `src/social/types.ts`
- `src/social/featureFlags.ts`
- `src/social/__tests__/featureFlags.test.ts`

New foundation:

- `src/personalChat/ui/chatTheme.ts`
- `src/personalChat/ui/chatMotion.ts`
- `src/personalChat/ui/chatFeedback.ts`
- `src/personalChat/ui/ChatIcon.tsx`
- `src/personalChat/ui/ChatRoyalBackdrop.tsx`
- `src/personalChat/ui/ChatTopBar.tsx`
- `src/personalChat/ui/ChatSearchField.tsx`
- `src/personalChat/ui/ChatFilterBar.tsx`
- `src/personalChat/ui/ChatAvatar.tsx`
- `src/personalChat/ui/ChatConversationRow.tsx`
- `src/personalChat/ui/ChatListState.tsx`
- `src/personalChat/ui/buildInboxSections.ts`
- `src/personalChat/ui/buildMessageGroups.ts`
- `src/personalChat/ui/wave0FixtureAdapter.ts`
- `src/personalChat/ui/usePersonalChatPresentation.ts`
- `src/personalChat/ui/index.ts`
- `src/personalChat/__tests__/chatUiFoundation.test.ts`

## Verification

Passed:

- `npx vitest run src/personalChat/__tests__`
  - 8 files, 35 tests passed.
- Focused Wave 1 plus social-feature flags
  - 2 files, 13 tests passed.
- Full `npm test`
  - 272 files and 1,487 tests passed;
  - 2 unrelated existing expectation failures remain in
    `socialNotificationsService.test.mjs` (`follows`) and
    `socialProfileCore.test.mjs` (`followerCount`/`followingCount`).
- Wave 0 JSON catalog parses with nine states.
- TypeScript reports no diagnostics in the new Wave 1 files.

Repository-wide `tsc --noEmit` remains red on unrelated pre-existing worktree
errors in Battleship, Me profile, room rocket artwork, Drawing Guess, the legacy
chat screens, Home, social profile mapping, and room watch video. None of the
reported diagnostics points to the Wave 1 foundation or its flag changes.

## Exit gate record

- [x] Modern Royal tokens and primitives are isolated from unrelated screens.
- [x] Inbox and timeline builders cover requests, archive filtering, unread,
      drafts, media preview kinds, deleted users, date/system boundaries, and
      unread boundaries.
- [x] Presentation selection fails closed and cannot enable messaging.
- [x] Cross-platform icons provide explicit mappings and fallbacks.
- [x] Reduced-motion and haptic helpers are non-authoritative enhancements.
- [x] Current chat screens and data subscriptions remain untouched.

## Wave 2 handoff

Wave 2 may replace the Chats inbox behind `personalChatsFrontendV2`. It should
consume these primitives and `buildInboxSections`, rebuild the new-chat sheet,
and leave `DirectChatScreen` on the legacy presentation until Wave 3.
