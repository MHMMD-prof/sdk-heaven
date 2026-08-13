# Voice Room Reference Parity — Wave 6 Activity and Command Center

## Status

Implemented locally. Wave 6 finishes the shared lower presentation layer of the
voice room without changing room behavior or theme-specific seat geometry.

## Room activity preview

- Replaced the three stacked developer-style chat pills with one bounded room
  activity card.
- The card displays the latest non-deleted chat, gift, entry, game or room
  notice and opens the full existing room chat when pressed.
- Normal user activity preserves the sender's user-owned avatar frame. System
  and moderation activity uses a neutral event icon.
- Empty rooms show a useful chat invitation instead of a blank strip.
- The presentation uses the active manifest's approved panel, ruby, gold, text
  and muted-text tokens while keeping one stable layout across all themes.

## Command Center dock

- Rebuilt the five-action dock as a layered ruby/gold Command Center using
  Expo LinearGradient and Expo Symbols.
- Preserved the exact existing callbacks and order: Gift, Chat, primary voice,
  Games and Tools.
- The primary control remains visually dominant and now communicates whether
  the user must take a seat or can speak/mute.
- Added explicit disabled accessibility state and larger hit slop.
- A published theme may provide decorative `assets.dock` artwork. That artwork
  is a passive background only; it cannot replace, reorder or alter actions.
- The code-rendered dock remains the guaranteed fallback when no dock artwork
  exists or a theme falls back to Majlis.

## Preserved contracts

- No audio connection, publishing, seat, permission, gift, game, chat or tools
  logic was changed.
- User-owned avatar frames remain authoritative everywhere they appear.
- Header, stage, overlay rail and fixed bottom positions remain shared across
  all themes.
- The full room chat history and moderation controls remain in the existing
  chat sheet.

## Verification

- Added deterministic activity selection tests for normal, deleted, gift,
  system, moderation and empty states.
- Added source-contract checks preventing a return to the three-pill preview
  and requiring declarative theme-aware dock rendering.
- Focused room visual suite: 5 files, 24 tests passing.
- TypeScript reports no errors in the Wave 6 files; unrelated pre-existing
  repository errors remain outside this wave.
- Android production export passed (2,357 modules). Expo emitted the existing
  non-blocking iOS `GoogleService-Info.plist` config warning during the Android
  export.
