# Personal Chats Frontend Rebuild — Wave 0 Experience Contract

Status: COMPLETE  
Started: 2026-08-09  
Design revision: 2026-08-09 — Modern Royal red-and-gold direction requested  
Production code changed: no

## Purpose

Freeze the replacement frontend's visual and interaction contract before any
production screen is rebuilt. This document is the implementation authority for
Waves 1–6 and supersedes the current chat pages as a visual reference.

The old pages remain operational during Wave 0. Nothing in this wave is imported
by the application.

## Design thesis

Personal chat is a high-frequency utility surface inside a royal red-and-gold
product. Identity and warmth come from people, words, avatars, selected
cosmetics, and restrained royal details—not from placing the entire experience
inside one scenic card.

The replacement uses deep oxblood and garnet canvases, layered red surfaces,
warm gold primary controls, fine gold dividers, and sparse crest/crown motifs.
It should feel unmistakably royal while hierarchy, spacing, motion, and
typography keep it useful for long conversations.

## Explicit removals

The new chat frontend must not reproduce any of the following:

- the current full-screen velvet stage, leather card, salon, or invitation-card
  composition;
- thick or stacked gold borders around the screen, header, composer, every row,
  and every bubble at the same time;
- a card containing the entire inbox;
- friends without conversations mixed into the conversation list;
- a permanent tool row above the composer;
- one giant screen component owning data, rendering, actions, and styles;
- entrance animation whose only purpose is decoration.

Gold is a core brand color for primary actions, selected controls, icons, avatar
rings, fine dividers, verified status, and premium cosmetics. It must establish
hierarchy rather than become uniform decoration. One crest/crown motif is
allowed in a page header or empty state; repeated crests are not.

## Semantic color contract

These are chat-local tokens. Names express meaning and must survive later palette
tuning. Values are the Wave 0 prototype baseline, not global theme changes.

| Token | Baseline | Use |
| --- | --- | --- |
| `chat.canvas` | `#090203` | Main inbox/thread foundation |
| `chat.canvasRaised` | `#180609` | Sticky header and composer |
| `chat.surface` | `#240A10` | Search, trays, sheets, received bubbles |
| `chat.surfacePressed` | `#341018` | Pressed/selected tonal state |
| `chat.surfaceOutgoing` | `#7A1730` | Sent message bubbles |
| `chat.textPrimary` | `#FFF8EC` | Names and message text |
| `chat.textSecondary` | `#D5C3B0` | Preview, timestamps, presence copy |
| `chat.textTertiary` | `#9B8778` | Disabled/retention/supporting copy |
| `chat.divider` | `rgba(224,185,103,0.22)` | Fine gold structural separation |
| `chat.royalRed` | `#A61935` | Selected depth and outgoing surfaces |
| `chat.royalRedBright` | `#D43B58` | Unread and urgent emphasis |
| `chat.royalRedSoft` | `#3D0C17` | Request/unread tonal emphasis |
| `chat.gold` | `#E0B967` | Primary actions and structural accent |
| `chat.goldBright` | `#F5D993` | Selected/focused gold highlight |
| `chat.goldForeground` | `#2B080D` | Content on gold controls |
| `chat.success` | `#56C596` | Online/accepted confirmation |
| `chat.danger` | `#F26772` | Failed send/destructive action |
| `chat.focus` | `#F4C2D0` | Keyboard/screen-reader focus ring |
| `chat.scrim` | `rgba(0,0,0,0.62)` | Modal sheet backdrop |

Contrast rule: essential text and icons must meet WCAG AA against their actual
surface. Color never communicates unread, failure, request, presence, or
selection without copy, shape, or icon reinforcement.

## Density and geometry contract

| Element | Contract |
| --- | --- |
| Phone content width | Fluid from 320dp upward |
| Wide thread reading column | Maximum 760dp, centered |
| Top bar | 56dp content plus safe-area inset |
| Sticky inbox controls | Search 44dp; filters 36dp |
| Conversation row | Minimum 76dp, full width |
| Inbox avatar | 52dp |
| Thread avatar | 38dp |
| Icon-only touch target | Minimum 44×44dp |
| Bubble width | Maximum 82% phone / 620dp wide layout |
| Bubble radius | 18dp; grouped corner 6dp |
| Composer | 52dp minimum, 132dp maximum input height |
| Sheet top radius | 24dp |
| Primary horizontal gutter | 16dp |
| Dense internal gap | 4–8dp |
| Normal component gap | 12dp |
| Section gap | 20–24dp |

No component may reduce a touch target to make a crowded layout fit. It must
reflow, truncate secondary text, or move actions into a sheet.

## Typography contract

- Page title: strong, compact, one line.
- Conversation name: primary emphasis; unread adds weight, not a gold color.
- Message preview: one line; prefix semantic state such as `Draft:` or an
  attachment icon/label.
- Message text: default readable body size with platform line-height behavior.
- Metadata: one quieter level and never placed over message text or media.
- Arabic uses the configured Arabic-capable app font and native shaping. Never
  manually reverse strings.
- User-generated content gets its natural writing direction; surrounding UI
  follows the active locale.
- At 200% dynamic type, names and primary actions remain reachable. Secondary
  preview/time may wrap, truncate, or move below.

## Motion and feedback contract

- Press: native press state plus optional light selection haptic.
- Filter change: 140–180ms red/gold tonal-indicator transition.
- Sheet: platform slide/presentation motion.
- New-message affordance: short translate/opacity transition; never pulses.
- Send: no artificial delay and no celebratory animation.
- Reduced motion: state changes are immediate; opacity may remain when it does
  not obscure content.
- Haptics are enhancement only. Success, failure, and selection always have a
  visible and accessible state.

## Inbox layouts

### A. Populated inbox

Order:

1. Safe area.
2. Top bar with `Chats`, compact total unread count, and labeled new-chat icon.
3. Search field.
4. Filters: All, Unread, Requests.
5. Optional single request summary in All.
6. Flat conversation rows.
7. Existing global bottom navigation.

Conversation row anatomy in RTL:

```text
┌──────────────────────────────────────┐
│  ١٢:٤٥     سارة                  ◉  │
│     ٢      وصلت الصورة، شكراً       │
└──────────────────────────────────────┘
```

The real row includes a 52dp avatar at the reading edge. Unread uses heavier
name/preview text plus a numeric ruby badge. Time remains readable and does not
turn gold.

### B. Requests

All shows one summary row: sender avatars, count, and `Review requests`. The
Requests filter shows request-specific rows with sender name, one safe request
preview, time, and `Review`. Accept/reject/block/report decisions happen in the
thread so context and safety actions stay together.

### C. Search results

Search filters conversations within the active filter. It does not search all
users and does not introduce friends into the inbox. `New chat` owns people
search.

### D. Empty inbox

Use a small message icon, `No conversations yet`, one supporting sentence, and
one `Start a chat` action. No crest, illustration theater, privacy essay, or
large decorative card.

### E. Offline/error

Keep cached rows visible. A compact status strip provides `Offline` or the
specific retry state. Initial fatal failure may use a centered state; background
refresh failure may not replace usable content.

## New-chat layout

Use a bottom sheet on phone and a bounded modal on wide layouts.

1. Handle/platform chrome and title.
2. Auto-focused people search.
3. Recent contacts when available.
4. Friends list.
5. `Discover people` escape hatch when that feature is enabled.

Selecting a person closes the sheet, restores focus deterministically, and opens
the existing `DirectChat` route. It does not create a second navigation model.

## Direct-thread layouts

### A. Accepted conversation

```text
┌──────────────────────────────────────┐
│  ‹    (avatar) سارة       متصلة   ⋯ │
├──────────────────────────────────────┤
│              اليوم                   │
│                                      │
│  مرحباً، هل أنتِ في الغرفة؟          │
│                    نعم، سأدخل الآن   │
│                         ١٢:٤٦  ✓✓    │
│                                      │
├──────────────────────────────────────┤
│  ＋   اكتب رسالة…              إرسال │
└──────────────────────────────────────┘
```

The header is sticky. The canvas is quiet. Sender groups suppress duplicate
metadata. Time and delivery appear once at the end of the outgoing group.

### B. Incoming request

History remains readable. A decision card above the composer explains the
one-message request and presents Accept as primary. Reject, Report, and Block
remain visible secondary/destructive actions. The composer is replaced by or
disabled beneath the decision state, never made to look sendable.

### C. Media conversation

Images use bounded rounded media with explicit loading/failure states. Voice
notes show play, elapsed/duration, and download/error status. Stickers do not
inherit an opaque bubble unless reply/meta content requires one.

### D. Failed send

The failed message stays in context with `Not sent` and a retry affordance.
Long-press actions also offer Retry and Remove. Failure is not represented by
red border alone.

### E. Keyboard-open composer

The newest message remains visible above the composer. Multiline input grows to
the maximum, then scrolls internally. Reply context sits inside the composer
surface. Attachment tools open from one `+` action and do not permanently reduce
timeline height.

## Message grouping rules

- Group adjacent visible messages from the same sender when no system/date/unread
  boundary intervenes and the gap is at most five minutes.
- Reply, kind, delivery, or moderation differences do not necessarily break a
  group, but each message retains its own accessible label.
- System messages, retention notices, and date separators are full-width timeline
  events and always break groups.
- Failed optimistic messages may group visually but always show their own failed
  status and action.
- Read state appears only on the newest relevant outgoing message permitted by
  privacy settings.

## Capability destination map

| Existing capability | New destination | Must preserve |
| --- | --- | --- |
| Inbox pagination | Conversation list footer | Existing rows stay visible |
| Search | Sticky inbox search | Locale normalization |
| Total unread | Top bar + bottom-nav badge | Compact counts |
| Per-chat unread | Conversation row | Numeric badge + weight |
| Pending requests | Request summary/filter + decision card | Accept/reject/report/block |
| Start chat with friend | New-chat sheet | Existing route and status resolution |
| Discover users | New-chat empty/footer action | Existing feature gate |
| Mute/archive | Row swipe + action sheet | Accessible named actions |
| Offline/error | Status strip/state | Retry without discarding cache |
| Profile entry | Thread header identity | Existing profile route |
| Presence/typing | Header subtitle | Privacy controls and live region |
| Draft restore | Composer + `Draft:` inbox preview | Per-user/conversation key |
| Text/emoji/sticker | Composer attachment tray | Existing send contracts |
| Images/voice notes | Attachment tray + message renderer | Authorization and failure states |
| Reply | Bubble action + composer context | Missing-source fallback |
| Send/retry/unsend | Bubble delivery/action sheet | Idempotency and unsend policy |
| Load older | Timeline top/infinite trigger | Scroll anchor |
| Retention notice | Timeline system event | Accurate policy wording |
| Reporting | Message/conversation action sheet | Bounded selected evidence |
| Blocking | Conversation action sheet | Confirmation and backend checks |
| Read receipts | Outgoing group footer | Privacy setting |
| Cosmetics | Avatar/name/bubble content layer | Contrast and feature flags |
| Deleted user | Header/row tombstone identity | History remains readable |
| Feature unavailable | Chat list/thread state | Chats tab remains visible |
| Push/deep link | Existing route containers | Payload compatibility |

## Fixture set

`fixtures/personalChatFrontendWave0.json` is the canonical disposable design
fixture set. It contains no real user data and must never be used for production
authorization or command behavior.

Required fixtures:

- Arabic populated inbox;
- English search result;
- empty inbox;
- incoming requests;
- accepted mixed-message thread;
- incoming request thread;
- media thread;
- failed send;
- keyboard-open composer.

## Accessibility review checklist

- [ ] Screen title is a heading and first meaningful focus target.
- [ ] Every icon-only action has a localized accessible name.
- [ ] Conversation row announces name, preview type, time, unread count, mute,
      and request state without duplicate avatar text.
- [ ] Swipe-only actions have accessibility actions and action-sheet access.
- [ ] Message announces sender, semantic content, time, and delivery once.
- [ ] Typing/status updates are polite live-region updates, not repeated alerts.
- [ ] Focus returns to the invoking control when a sheet closes.
- [ ] Focus order follows visual/read order in RTL and LTR.
- [ ] Dynamic type at 200% preserves primary actions.
- [ ] Color contrast and non-color status cues pass.
- [ ] Reduced motion removes spatial state transitions.

## Wave 0 acceptance record

Completed locally:

- [x] Replacement design thesis and explicit-removal list.
- [x] Semantic color, density, typography, motion, and feedback contracts.
- [x] Inbox, new-chat, accepted-thread, request, media, failed-send, and
      keyboard-open layouts.
- [x] Arabic/RTL and English/LTR disposable fixture data.
- [x] Capability-to-destination map.
- [x] Accessibility checklist.
- [x] Exact Expo SDK 56 capability review.
- [x] Interactive approval prototype.
- [x] Reworked the initial dark-neutral proposal into the app-aligned Modern
      Royal red-and-gold direction after product feedback.

Open exit gates:

- [x] Product approved the app-aligned Modern Royal direction and requested the
      next wave.
- [x] Arabic/RTL and English/LTR fixture states are available in the approval
      prototype.
- [x] Red-and-gold palette and density contract locked for Wave 1 primitives.

Wave 0 closed when product requested Wave 1 on 2026-08-09.
