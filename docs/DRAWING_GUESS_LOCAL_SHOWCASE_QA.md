# Drawing Guess Local Showcase QA

Use this checklist for the Games-tab local showcase path. The goal is a complete local party drawing game on a real phone layout, with no online setup or debug-feeling copy visible.

## Setup

- Run the native app on a small Android-sized screen or emulator.
- Open Games, then open Drawing Guess.
- Use the default Games-tab launch: local showcase mode.

## Manual Pass

1. Lobby
   - The lobby reads like a local party game.
   - Player lineup, ready count, Start match, and New local match are reachable.
   - How to play opens, explains the flow, and closes cleanly.
   - No local showcase copy mentions online, LiveKit, token, simulation, debug, future, or wave.

2. Prompt Choice
   - Start a match.
   - Prompt cards show category labels and readable prompt text.
   - Long prompt text wraps inside the card without clipping.
   - Non-drawer waiting copy does not reveal the prompt.

3. Drawing Round
   - Canvas remains the visual focus and does not clip.
   - Brush, eraser, colors, sizes, undo, clear, and reveal results are reachable.
   - Color swatches and brush sizes have meaningful screen reader labels.
   - Undo flashes Stroke undone.
   - Clear flashes Canvas cleared.
   - Timer badge and progress remain readable.

4. Guessing And Keyboard
   - On a guesser turn, tap the guess input and open the keyboard.
   - The active input and Send guess action remain usable.
   - Send guess is visibly disabled for empty or whitespace guesses.
   - The keyboard send key submits a non-empty guess.
   - A correct local guess announces a clear solved state.
   - Multiple guess rows remain readable and scrollable.

5. Results
   - Reveal results shows the prompt, correct/missed status, point deltas, and totals.
   - Next round appears before the final drawer.
   - Final scores appears after the final drawer.

6. Final Scores
   - Winner, ranking rows, local player marker, and points are readable.
   - New local match resets the showcase cleanly.

7. Small Screen Layout
   - Header text, player names, prompt cards, leaderboard rows, guess rows, and result rows wrap safely.
   - No required control is clipped off-screen.
   - The page scrolls naturally when content is taller than the viewport.

8. Accessibility And Haptics
   - Main controls have useful screen reader names and hints.
   - Tool, color, and size selection feedback is subtle.
   - Clear canvas gives warning-style feedback.
   - Correct guesses and result reveals give success-style feedback.
   - Haptic feedback never blocks gameplay on devices that ignore it.

## Verification Commands

```sh
npx tsc --noEmit
npm test
```

If unrelated repo failures block the full test command, run:

```sh
npx vitest run src/drawingGuess
```

## Wave 7 Verification Results

- Drawing Guess automated checks passed on July 2, 2026:
  - `npx vitest run src/drawingGuess`
  - 7 test files passed, 72 tests passed.
- Repo-wide automated checks are currently blocked by unrelated Carrom worktree failures:
  - `npm test` fails in `src/utils/__tests__/carromEngine.test.ts` because `createEmptySubstepMotionRecords` is missing.
  - `npx tsc --noEmit` fails in `src/utils/carromEngine.ts` because `createEmptySubstepMotionRecords` and `getSpeedSquared` are missing.
  - No Drawing Guess TypeScript errors were reported before the Carrom blockers stopped the check.
- Static local showcase copy audit passed for the Drawing Guess UI path:
  - Online-specific strings remain behind online-only controls or tests.
  - Games-tab local showcase view-model tests continue to reject online/debug copy leaks.
- Manual native-device QA still needs a device/emulator pass:
  - Drawing smoothness, keyboard behavior, haptics, and screen reader labels must be confirmed on the target showcase device.
  - No additional Drawing Guess code blocker was found during the repo-level verification pass.
