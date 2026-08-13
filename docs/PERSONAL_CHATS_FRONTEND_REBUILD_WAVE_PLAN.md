# Personal Chats Frontend Rebuild — Wave Plan

## Outcome

Replace the Chats tab, direct-message screen, and new-chat flow with a new
frontend. This is not a polish pass and does not preserve the current page
composition, decorative art direction, or monolithic screen structure.

The finished experience should feel like a fast, modern royal messenger inside
the existing product: Arabic/RTL-first, easy to scan, comfortable for long
conversations, and unmistakably part of the app's red-and-gold identity.

## Current-state diagnosis

The existing frontend is not a useful base for an incremental restyle:

- `src/screens/ChatsScreen.tsx` is a 700+ line page combining data shaping,
  search, section construction, swipe behavior, empty/error states, and a highly
  decorative visual system.
- `src/screens/DirectChatScreen.tsx` is a 680+ line page combining thread
  orchestration, draft persistence, typing, moderation, message rendering,
  request handling, the composer, and the same decorative visual system.
- Velvet, leather, crest, gold rails, nested borders, and gradients compete with
  names, previews, unread state, messages, and actions.
- Pending requests, active conversations, and friends who have no conversation
  are merged into one long list. The inbox therefore has no single clear job.
- The direct-chat header and composer consume too much visual attention, while
  message grouping, chronology, and delivery state are comparatively weak.
- The same row, avatar, button, surface, state, and typography decisions are
  recreated locally rather than expressed as a small chat UI system.

The data and safety foundation is mature and should remain in place. The rebuild
must reuse `DirectChatProvider`, `useDirectChatThread`, command contracts,
realtime projections, drafts, protected attachments, reports, blocking,
privacy, and cosmetics projections.

## Locked design direction

### Visual language: Modern Royal

- Base: deep oxblood, garnet, and near-black red surfaces with controlled tonal
  gradients. Scenic artwork may appear only as a faint atmosphere layer and
  never as the main container structure.
- Brand color: saturated royal red for unread emphasis, selection, and depth.
- Primary action color: warm gold with dark-red foreground. Gold also provides
  restrained hierarchy through icons, dividers, avatar rings, and key status
  details; it must not frame every object.
- Shape: medium-radius surfaces and message bubbles; circular controls only for
  icon-only actions.
- Depth: spacing, red tonal layering, fine gold accents, and one subtle shadow
  level. Avoid stacked borders, heavy glows, leather-card framing, and salon-like
  containers. A crest/crown motif may appear once in a header or empty state.
- Motion: short opacity/translate transitions for state changes and composer
  actions. No entrance theater. Respect reduced motion.
- Icons: one consistent cross-platform symbol wrapper with explicit iOS,
  Android, and web names and a fallback.

### Inbox information architecture

The Chats tab is an inbox, not a social-discovery page.

1. Compact top bar: page title, total unread count, and new-chat action.
2. Search field fixed below the top bar while the list scrolls.
3. Filter chips: All, Unread, Requests. Do not add tabs that have no distinct
   user job.
4. Pending requests appear only in Requests or as one compact summary card at
   the top of All. They do not visually imitate accepted conversations.
5. Conversation rows are full-width and flat: avatar/presence, name, one-line
   preview, time, mute/draft/delivery marker, and unread badge.
6. Friends without a conversation never appear in the inbox. They belong only
   in the new-chat flow.
7. Archive and mute remain swipe/long-press actions with visible accessible
   alternatives.

### Direct-chat information architecture

1. Compact sticky header: back, avatar, name, live status/typing, options.
2. Quiet message canvas with no large decorative background image.
3. Messages grouped by sender and time proximity. Repeated avatars/tails/meta
   are suppressed inside a group.
4. Date separators and unread boundary make chronology obvious.
5. Replies, attachments, system messages, failed sends, unsent messages, and
   moderation removals have distinct but restrained components.
6. Incoming requests use an anchored decision card above the composer; the
   message history remains readable.
7. Composer is a stable bottom surface with attach, expandable input, and send.
   Emoji, sticker, image, and voice-note tools open from one attachment action
   instead of permanently occupying a row.
8. Reply context appears inside the composer and can be dismissed with a large,
   accessible target.

### Responsive behavior

- Phone is the primary layout.
- Wide web/tablet uses a centered reading column with bounded message width;
  Wave 1 must not introduce a split inbox/thread navigation model.
- RTL changes flow, alignment, back/send direction, swipe semantics, and text
  shaping—not only `textAlign`.
- Dynamic type must remain usable through 200% without truncating primary
  actions or placing unread counts over names.

## Technical boundaries

### Preserve

- All backend commands, Firestore/Storage policy, deterministic conversation
  identity, pagination, retention, and safety behavior.
- `DirectChatProvider`, `useDirectChatThread`, direct-chat models, attachment
  authorization, report submission, and draft persistence.
- Existing routes and deep-link/push payload shapes: `Main` Chats tab and
  `DirectChat { targetUid, source }`.
- Avatar frames, nameplates, badges, and chat-bubble cosmetics as optional
  content overlays with strict contrast and performance limits.
- Existing performance caps: 150 inbox items and 200 messages per open thread.

### Replace

- All rendered structure and styles in `ChatsScreen.tsx` and
  `DirectChatScreen.tsx`.
- `DirectChatComposeSheet.tsx` presentation and navigation structure.
- The current full-screen velvet-stage/leather-card composition and repeated
  crest treatment. A single restrained royal motif may be reused or replaced.
- The mixed inbox/friends row model and ornamental empty states.
- Alert-only conversation/message menus where a controlled action sheet can
  provide clearer, testable, cross-platform behavior.

### Do not add

- A new backend, message schema, navigation library, design-system package, or
  state-management library.
- Group chat, calls, reactions, editing, disappearing messages, or encryption
  claims.
- A permanent duplicate V1/V2 component stack after rollout.

The project is Expo SDK 56 / React Native 0.85. Implementation must use the exact
versioned Expo 56 contracts. Existing installed capabilities are sufficient:
[Expo Symbols](https://docs.expo.dev/versions/v56.0.0/sdk/symbols/),
[Expo Haptics](https://docs.expo.dev/versions/v56.0.0/sdk/haptics/),
[Expo Image](https://docs.expo.dev/versions/v56.0.0/sdk/image/), and
[Expo LinearGradient](https://docs.expo.dev/versions/v56.0.0/sdk/linear-gradient/).
`expo-symbols` is beta in SDK 56, so the icon wrapper must always supply
cross-platform names and a fallback. No blur or glass dependency is required.

## Target component structure

```text
src/personalChat/ui/
  chatTheme.ts
  ChatIcon.tsx
  ChatAvatar.tsx
  ChatTopBar.tsx
  ChatSearchField.tsx
  ChatFilterBar.tsx
  ChatConversationRow.tsx
  ChatRequestSummary.tsx
  ChatListState.tsx
  ChatThreadCanvas.tsx
  ChatMessageGroup.tsx
  ChatMessageBubble.tsx
  ChatSystemEvent.tsx
  ChatRequestDecisionCard.tsx
  ChatComposer.tsx
  ChatAttachmentTray.tsx
  ChatActionSheet.tsx
  buildInboxSections.ts
  buildMessageGroups.ts
```

`ChatsScreen.tsx` and `DirectChatScreen.tsx` remain route-level containers, but
each should become a thin composition layer. Data/state operations stay in hooks
or pure builders; presentational components receive explicit props and do not
call Firebase or command endpoints.

## Implementation waves

## Wave 0 — Experience contract and disposable prototypes

Status: COMPLETE (design contract and fixture set created 2026-08-09; product
approved the revised Modern Royal red-and-gold direction by requesting Wave 1).

Wave record: `docs/PERSONAL_CHATS_FRONTEND_REBUILD_WAVE0.md`

Build the design contract before production components.

- Create low-fidelity phone layouts for: populated inbox, requests, search
  results, empty inbox, accepted thread, incoming request, media thread, failed
  send, and keyboard-open composer.
- Create one RTL/Arabic and one LTR/English fixture for every layout.
- Define chat-only semantic tokens for canvas, surface, elevated surface, text,
  muted text, divider, ruby action, danger, unread, and focus. Do not mutate the
  global theme to force unrelated screens into the new language.
- Lock density: top-bar height, row minimum height, avatar sizes, bubble maximum
  width, composer minimum/maximum height, and 44-point minimum touch targets.
- Inventory every current capability and map it to a visible destination so the
  visual rewrite cannot silently drop safety or media behavior.

Exit gate:

- Product approval on the replacement direction at phone width.
- Every current user-visible capability has a destination or an explicit deferral.
- No production screen imports the prototype.

## Wave 1 — New chat UI foundation behind a temporary cutover flag

Status: COMPLETE LOCALLY (2026-08-09). Presentation flag remains fail-closed and
the existing screens do not consume the new primitives until Wave 2.

Wave record: `docs/PERSONAL_CHATS_FRONTEND_REBUILD_WAVE1.md`

- Add chat semantic tokens and shared primitives in `src/personalChat/ui/`.
- Add pure inbox-section and message-group builders with unit tests.
- Add a temporary fail-closed `personalChatsFrontendV2` presentation flag. It
  selects rendering only and must never alter authorization or data behavior.
- Add fixture-driven development states so UI work does not depend on live
  accounts, network timing, or production data.
- Add the cross-platform icon wrapper and reduced-motion/haptic helpers.
- Keep old and new screens connected to the same providers during this wave;
  never duplicate subscriptions.

Exit gate:

- Primitives render in RTL/LTR, light text scaling, 200% text scaling, and phone/
  wide widths.
- Builders cover requests, archived filtering, unread, drafts, media previews,
  deleted users, and empty results.
- Turning the flag off produces the current frontend with no data migration.

## Wave 2 — Replace the Chats inbox

Status: COMPLETE LOCALLY (2026-08-09). The replacement inbox and compose sheet
are integrated behind `personalChatsFrontendV2`; the flag remains off by default.
See `PERSONAL_CHATS_FRONTEND_REBUILD_WAVE2.md` for the implementation and
verification record.

- Rebuild `ChatsScreen.tsx` around the new top bar, sticky search, filters,
  request summary, flat conversation rows, and state components.
- Remove startable friends from inbox data construction.
- Rebuild the new-chat flow as a focused searchable people sheet with recent
  contacts/friends and a discovery escape hatch.
- Preserve pagination, refresh, offline/error retry, unread count, mute, archive,
  compose, and profile/avatar cosmetics.
- Add lightweight skeleton rows for initial loading; pagination loading is inline
  and must not blank the existing list.
- Add deterministic focus return when the new-chat or action sheet closes.

Exit gate:

- A user can distinguish unread, muted, request, draft, failed-preview, and
  archived states without opening a conversation.
- Search and filters compose predictably and return a useful no-results state.
- No legacy velvet/leather salon composition or repeated framed-card treatment
  remains in the Chats tab render tree. Royal motifs and gold structure stay
  deliberate and sparse.
- Inbox scrolling stays within the existing memory cap and meets the provisional
  1.5-second P95 open budget on target hardware.

## Wave 3 — Replace the message timeline and header

Status: COMPLETE LOCALLY (2026-08-09). The Modern Royal thread header, grouped
timeline, stable pagination behavior, new-message affordance, and message action
sheet are integrated behind `personalChatsFrontendV2`. See
`PERSONAL_CHATS_FRONTEND_REBUILD_WAVE3.md` for the verification record.

- Rebuild `DirectChatScreen.tsx` around `ChatTopBar`, `ChatThreadCanvas`, message
  groups, date separators, unread boundary, and explicit system events.
- Preserve load-older scroll position and new-message scroll behavior. Do not
  jump a user to the bottom while they are reading history; show a “new messages”
  affordance instead.
- Make reply targets visually connected to their source and provide a graceful
  “message unavailable” state after retention or moderation.
- Keep attachment rendering and cosmetics projection, but cap cosmetic opacity/
  complexity so message text always wins.
- Replace long-press alerts with a chat action sheet for reply, copy, retry,
  unsend, report, and destructive actions.

Exit gate:

- Text, emoji, sticker, image, voice note, reply, system, sending, sent, read,
  failed, unsent, removed, and retained-history states are visually covered.
- Pagination does not shift the visible anchor.
- New realtime messages do not interrupt history reading.
- Header status changes do not cause layout movement.
- VoiceOver/TalkBack reads sender, content type, time, and delivery state once,
  in a sensible order.

## Wave 4 — Replace requests, composer, and attachment flow

Status: COMPLETE LOCALLY (2026-08-09). The anchored request decision card,
keyboard-safe Modern Royal composer, reply context, and consolidated attachment
tray are integrated behind `personalChatsFrontendV2`. See
`PERSONAL_CHATS_FRONTEND_REBUILD_WAVE4.md` for the verification record and the
physical-device checks deferred to Wave 5.

- Add the anchored incoming-request decision card with Accept as the only primary
  action; Reject, Report, and Block remain clear and reachable.
- Rebuild the composer with one attachment entry, expanding multiline input,
  reply context, character warning, send state, and keyboard-safe bottom inset.
- Move emoji, sticker, image, and voice-note entry into `ChatAttachmentTray` while
  reusing the existing upload/send implementations.
- Add selection/haptic feedback only for deliberate actions; haptics must be
  non-blocking and never encode meaning without a visual state.
- Ensure outgoing pending requests explain the one-message rule without leaving
  an apparently enabled composer.

Exit gate:

- Keyboard open/close, multiline growth, reply cancellation, media selection,
  upload failure, retry, and request acceptance work on Android and iOS.
- Composer never covers the newest message or jumps when safe-area/keyboard
  insets change.
- All destructive actions require confirmation and retain their existing backend
  policy checks.

## Wave 5 — Hardening, accessibility, and visual QA

Status: COMPLETE LOCALLY (2026-08-09). Automated, web, Arabic/LTR fixture, and
export gates pass. Physical Android/iOS accessibility, keyboard, camera, and
microphone sign-off remains required before Wave 6.

Wave record: `docs/PERSONAL_CHATS_FRONTEND_REBUILD_WAVE5.md`

- Run an Arabic-first copy review and remove any mojibake from source, fixtures,
  accessibility labels, alerts, and tests.
- Verify bidirectional content: Arabic UI with English usernames/URLs, English UI
  with Arabic messages, numerals, emoji, and mixed punctuation.
- Verify reduced motion, screen readers, keyboard navigation on web, focus order,
  contrast, minimum targets, and 200% dynamic type.
- Test small Android, standard iPhone, large iPhone, and wide web/tablet widths.
- Profile inbox/thread rerenders, image memory, typing updates, pagination, and
  rapid message arrival against existing caps and budgets.
- Add visual regression fixtures for all Wave 0 states. Prefer stable component
  fixtures over screenshots dependent on live Firebase data.

Exit gate:

- TypeScript and focused chat suites pass.
- Full unit suite passes or every unrelated pre-existing failure is recorded.
- Android and iOS physical-device smoke checks pass for keyboard, media, voice
  notes, gestures, safe areas, and screen readers.
- Product signs off on the complete replacement in Arabic, not only an English
  or empty-data mock.

## Wave 6 — Cutover and deletion of the old frontend

Status: STAGING INFRASTRUCTURE COMPLETE LOCALLY (2026-08-09). No production
rollout was applied. Internal/percentage/global stages and instant rollback are
implemented and verified; physical-device acceptance and an observed rollout
window still block global cutover and legacy deletion.

Wave record: `docs/PERSONAL_CHATS_FRONTEND_REBUILD_WAVE6.md`

- Enable the new presentation for internal users, then a small staged cohort,
  then all users while monitoring inbox open, send acknowledgement, crash-free
  sessions, report access, and attachment failures.
- Roll back by switching presentation only; never roll back chat data or server
  contracts.
- After the acceptance window, remove the temporary flag and delete the old JSX,
  styles, decorative chat imports, dead helpers, and obsolete tests.
- Rename V2-specific identifiers to neutral names. The shipped code must be the
  only chat frontend, not a permanent `NewChatsScreen` fork.
- Record before/after screenshots, device matrix, metrics, and the exact deletion
  commit in this document.

Final acceptance:

- Chats and Direct Chat contain no legacy frontend branch.
- All existing chat entry points, deep links, push opens, requests, media,
  reporting, blocking, privacy, cosmetics, and offline/error states still work.
- Inbox scanability and message readability are approved on real populated data.
- The old velvet/leather salon composition and repeated crest treatment are
  removed from the chat surface; the new royal red-and-gold language replaces
  them.

## Required verification matrix

Automated:

- Pure inbox filtering/section construction and message grouping.
- Route/deep-link compatibility and Chats-tab visibility.
- Accessibility labels/actions for conversation rows, messages, request actions,
  composer actions, and sheets.
- Draft restore, typing timeout, unread/read transitions, pagination anchor,
  optimistic send/retry, and reduced-motion branches.
- Existing direct-chat contract, realtime, links, drafts, and performance-budget
  suites.
- `npx tsc --noEmit` and `npm test`.

Manual, on populated accounts:

- Arabic RTL and English LTR on Android and iOS.
- Empty, loading, offline, error, search-empty, request, blocked, restricted,
  deleted-user, and retention-purged states.
- 150-conversation inbox and 200-message thread stress fixtures.
- Long names, long previews, mixed-script messages, huge emoji, image aspect
  ratios, long voice notes, and multiple unread counts.
- Keyboard open during incoming realtime messages and while loading history.
- Screen reader, reduced motion, large text, swipe actions, hardware keyboard,
  and web focus behavior.

## Rollback rules

- Waves 1–5 may revert to the legacy presentation flag without touching chat
  history, member projections, drafts, uploads, reports, or push payloads.
- Any regression that can send to the wrong target, hide a safety action, lose a
  draft, corrupt pagination position, or misrepresent request/read state blocks
  rollout immediately.
- Cosmetic rendering may be disabled independently if it harms readability or
  frame time; core messaging remains available.
- Wave 6 removes the legacy branch only after the staged acceptance window. After
  deletion, rollback is a normal code revert, never a data rollback.

## Definition of done

This project is done only when the old chat frontend has been replaced and
deleted. Shipping a new background, palette, card style, or bubble radius on top
of the current page structure does not satisfy this plan.
