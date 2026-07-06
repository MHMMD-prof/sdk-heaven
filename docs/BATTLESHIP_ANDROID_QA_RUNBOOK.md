# Battleship Android Manual QA Runbook

Use this runbook to execute the remaining Android manual release gate for local pass-and-play Battleship. This document prepares QA only; it does not mark any scenario as passed.

## Prerequisites

- Use a native Android dev-client or release-like build, not web.
- Use at least one narrow Android screen and one standard Android phone/emulator when available.
- Start from the Games flow and select local Battleship.
- Record results in `src/battleship/__tests__/BattleshipQaResults.template.ts` or a copied result file.
- For every passed targeted scenario, record `tester`, `date`, `evidence`, and `status: 'passed'`.
- For every failed or blocked scenario, record `notes` with the device/build and reproduction detail.

## Result Rules

- `passed`: every expected result was observed on Android and evidence is recorded.
- `failed`: the scenario was run and a product or runtime defect was observed.
- `blocked`: the scenario could not be run because device, build, or setup was unavailable.
- `not-run`: the scenario has not been executed.

## Scenarios

### android-full-local-match

Evidence kind: text.

Steps:
1. Launch the app into the Games flow and open local Battleship.
2. Start a match with shot limit enabled.
3. Place Player 1 fleet, confirm, complete privacy handoff, place Player 2 fleet, and confirm.
4. Play until victory or draw.
5. Start a new round from the result screen.

Expected result: A complete local match can be finished and reset without crashes, privacy leaks, or stuck state.

### android-drag-scroll

Evidence kind: video.

Steps:
1. Start Player 1 setup on a narrow Android screen.
2. Drag every ship type across multiple cells.
3. Rotate at least one ship and drag it again.
4. Try a drag near the top, middle, and bottom of the scroll view.

Expected result: Ship ghost follows the finger, placement preview clears on interruption, and page scroll does not steal active drags.

### android-resume-background

Evidence kind: text.

Steps:
1. Background and reopen during Player 1 setup.
2. Background and reopen during battle after at least one shot.
3. Background and reopen on a pending turn handoff screen.
4. Use Resume match when offered.

Expected result: Resume restores setup, battle, and pending handoff state without stale previews or wrong-player exposure.

### android-privacy-handoff

Evidence kind: screenshot.

Steps:
1. Complete Player 1 setup and reach setup handoff.
2. Confirm no board state is visible before readiness confirmation.
3. Continue to battle and trigger a turn handoff after a miss.
4. Confirm no board state is visible before the next player confirms readiness.

Expected result: No board state is visible until the correct player explicitly confirms readiness.

### android-small-screen-rtl

Evidence kind: screenshot.

Steps:
1. Use the narrowest Android device/emulator in the release matrix.
2. Inspect pre-match, setup, handoff, battle, confirmation dialog, and result screens.
3. Check Arabic labels, buttons, stat tiles, fleet rows, and prompts.

Expected result: Arabic labels, buttons, stat tiles, fleet rows, and prompts remain readable without clipping.

### android-accessibility-smoke

Evidence kind: text.

Steps:
1. Enable Android screen reader.
2. Traverse setup ship rows, rotate/randomize/clear, board cells, sound toggle, resume, handoff confirmation, destructive prompts, and result reset.
3. Activate core controls with the screen reader.

Expected result: Screen reader announces core controls clearly and gameplay remains navigable.

### android-corrupt-save

Evidence kind: device-log.

Steps:
1. In development, seed an invalid value for the Battleship AsyncStorage save key.
2. Relaunch the app and open local Battleship.
3. Observe the pre-match screen.

Expected result: Invalid local save is discarded, Resume is hidden, and the app does not crash.

### android-audio-haptics-muted

Evidence kind: text.

Steps:
1. Toggle sound off.
2. Complete setup actions, fire hit/miss shots, hand off, and reset.
3. Observe gameplay with muted or ignored feedback.

Expected result: Muted or ignored feedback never blocks setup, firing, handoff, victory, or reset.

### android-audio-unavailable

Evidence kind: text.

Steps:
1. Use a device/emulator configuration where sound may be unavailable or interrupted.
2. Trigger tap, invalid placement, miss, hit, sunk, and victory feedback.

Expected result: Audio playback failures do not crash the app or block gameplay.

### android-haptics-unavailable

Evidence kind: text.

Steps:
1. Use an emulator or device/settings combination where haptic feedback is unavailable.
2. Trigger setup, invalid placement, shot, handoff, and victory paths.

Expected result: Missing haptics do not crash the app or block gameplay.

### android-interrupted-gesture

Evidence kind: video.

Steps:
1. Begin dragging a selected setup ship.
2. Interrupt with app switcher, navigation, or gesture cancellation.
3. Return to setup and continue placing ships.

Expected result: Interrupted drags clear preview and ghost state, then setup remains usable.

### android-animation-reset

Evidence kind: video.

Steps:
1. Enter battle and fire a shot.
2. Immediately reset or trigger handoff while shot feedback is active.
3. Continue interacting with the board after the transition.

Expected result: Shot feedback interruption does not leave cells locked or stale animations visible.
