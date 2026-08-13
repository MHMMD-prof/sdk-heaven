# Personal Chats Frontend Rebuild — Wave 5 Hardening

Status: COMPLETE LOCALLY; PHYSICAL DEVICE SIGN-OFF PENDING  
Completed locally: 2026-08-09  
User-visible cutover: guarded  
Production presentation flag: off by default

## Delivered

- Added a development-only, environment-gated visual fixture covering populated
  inbox, accepted thread, and incoming-request states without Firebase or auth.
- Added deterministic Arabic and English content, mixed-script messages, unread,
  muted, deleted-user, reply, failed-send, and request-decision examples.
- Hardened narrow layouts: attachment actions can wrap, composer input can
  shrink, image attachments use viewport-bounded dimensions, and voice notes no
  longer impose an unsafe phone-width minimum.
- Raised report-sheet text scaling to 200%, increased its usable height, hid the
  duplicate unread badge announcement, and localized attachment accessibility
  labels.
- Added a localized online-state label and preserved 44-point minimum controls,
  the 760px reading column, and the 82% bubble-width cap.
- Made cosmetics and protected-chat filesystem caches initialize lazily on
  native. Expo FileSystem's web shim no longer crashes the chat frontend at
  module load; native cache behavior is unchanged.
- Added the missing `@lottiefiles/dotlottie-react` web peer required by the
  installed `lottie-react-native` version.

## Browser visual QA

The deterministic fixture was exercised in the in-app browser with live Expo
SDK 56 web bundles:

- English/LTR populated inbox at desktop width and 320×568.
- English/LTR accepted thread and incoming request at 320×568.
- Arabic content populated inbox at desktop width and 320×568.
- Keyboard-focusable state switcher, search field, filter tabs, conversation
  rows, header actions, request decisions, composer, and send/attachment actions
  were present in the accessibility tree.

The narrow inbox, thread composer, and request decision card remain within the
viewport. Primary content stays centered and bounded at wide widths.

## Verification

Passed:

- Personal-chat suite: 12 files, 59 tests.
- Wave 5 hardening suite: 6 tests.
- Full suite: 281 files and 1,537 tests passed.
- Mojibake scan across the rebuilt chat source and wave records: no matches.
- Expo SDK 56 web export: 2,160 modules bundled successfully.
- Expo SDK 56 Android export: 2,346 modules bundled successfully.
- TypeScript produced no diagnostics in Wave 1–5 chat files.

Recorded unrelated repository failures:

- `socialNotificationsService.test.mjs` expects preferences without `follows`.
- `socialProfileCore.test.mjs` expects profiles without `followerCount` and
  `followingCount`.
- Repository-wide TypeScript still reports unrelated existing errors in
  Battleship, Me profile, room rocket artwork, Drawing Guess, legacy chat
  screens, Home, social profile mapping, and room watch video.

## Remaining physical-device gate

Wave 6 must not begin until the following checks pass on real Android and iOS
devices with populated accounts:

- Arabic RTL layout flow and VoiceOver/TalkBack reading order.
- 200% system text size, reduced motion, contrast, focus, swipe/long-press, and
  safe-area behavior.
- Keyboard open/close, multiline composer growth, realtime arrivals while the
  keyboard is open, and pagination anchor retention.
- Camera/library permission, image upload/cancel/retry, microphone permission,
  voice-note record/cancel/upload/playback, and attachment memory behavior.
- Small Android, standard and large iPhone, plus populated 150-row/200-message
  stress checks on target hardware.
- Arabic product approval of real populated inbox and thread data.

Until these checks are recorded, `personalChatsFrontendV2` remains fail-closed
and Wave 6 cutover/deletion is blocked.
