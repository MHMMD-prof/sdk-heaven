# Battleship Local Release Gate

Use this gate before treating local pass-and-play Battleship as production-ready. Release is allowed only when every automated check passes, every Android blocker scenario is passed, and any iOS blocker is either passed or explicitly out of the release target.

Automated evidence is tracked in `src/battleship/__tests__/BattleshipAutomatedEvidence.ts`. Manual results are tracked in `src/battleship/__tests__/BattleshipQaResults.template.ts`. Copy or update the manual template when running device QA: Android scenarios stay `targeted: true`; iOS scenarios become `targeted: true` only when iOS is part of the release target.

Execute Android manual QA with `docs/BATTLESHIP_ANDROID_QA_RUNBOOK.md`. `src/battleship/__tests__/BattleshipQaResults.example.ts` shows how to fill evidence fields without claiming a real pass.

## Automated Checks

Automated checks are validated by the QA runner and must all be passed before release approval.

| Check | Required Result | Recorded Result |
| --- | --- | --- |
| `npx vitest run src/battleship/__tests__` | Pass | Passed on 2026-07-06: 6 test files, 66 tests |
| `npx tsc --noEmit` | Pass | Passed on 2026-07-06 |
| `npm test` | Pass | Passed on 2026-07-06: 29 test files, 245 tests |

The QA runner tests validate the checked-in result shape with:

- `summarizeBattleshipQaResults(results)`
- `canApproveBattleshipRelease(summary)`
- `validateBattleshipQaResults(results)`
- `summarizeBattleshipAutomatedChecks(checks)`
- `validateBattleshipAutomatedChecks(checks)`
- `summarizeBattleshipReleaseEvidence({ automatedChecks, manualResults })`
- `getBattleshipManualQaPacket(results)`

## Required Manual Device Checks

Status values: `not-run`, `passed`, `failed`, `blocked`.

Approval rules:

- Android blocker scenarios must be `passed`.
- Targeted iOS blocker scenarios must be `passed`.
- Non-targeted iOS scenarios do not block release.
- Failed or blocked scenarios must include notes.
- Passed targeted scenarios must include tester, date, and evidence text before approval.

| ID | Platform | Blocker | Status | Scenario | Notes |
| --- | --- | --- | --- | --- | --- |
| android-full-local-match | Android | Yes | not-run | Complete a full local match from setup through victory or draw. |  |
| android-drag-scroll | Android | Yes | not-run | Drag every ship type, rotate at least one ship, and confirm page scroll does not steal the drag. |  |
| android-resume-background | Android | Yes | not-run | Background and resume during setup, battle, and pending handoff. |  |
| android-privacy-handoff | Android | Yes | not-run | Confirm setup and turn handoff screens hide board state until the correct player confirms readiness. |  |
| android-small-screen-rtl | Android | Yes | not-run | Confirm narrow-screen Arabic labels, buttons, stats, fleet rows, and prompts do not clip. |  |
| android-accessibility-smoke | Android | Yes | not-run | Run a screen reader smoke pass over setup rows, board cells, sound toggle, resume, and destructive prompts. |  |
| android-corrupt-save | Android | Yes | not-run | Seed a corrupt local save, relaunch, and confirm Resume is hidden and the game does not crash. |  |
| android-audio-haptics-muted | Android | No | not-run | Toggle sound off and verify the game remains playable without audio or haptics assumptions. |  |
| android-audio-unavailable | Android | Yes | not-run | Disable or interrupt audio output in development and confirm taps, hits, misses, and victory continue without crashes. |  |
| android-haptics-unavailable | Android | Yes | not-run | Run on a device or emulator where haptics are unavailable and confirm all gameplay remains usable. |  |
| android-interrupted-gesture | Android | Yes | not-run | Interrupt a ship drag with navigation/backgrounding and confirm preview/ghost state clears. |  |
| android-animation-reset | Android | Yes | not-run | Fire a shot, immediately reset or hand off, and confirm the board does not stay locked by the shot animation. |  |
| ios-full-local-match | iOS | Target-dependent | not-run | Complete a full local match on iOS if iOS is in the release target. |  |
| ios-resume-background | iOS | Target-dependent | not-run | Background and resume setup and battle on iOS if iOS is in the release target. |  |

## Known Blockers

Add a row for every failed or blocked required scenario. Release cannot proceed while an Android blocker remains open.

| ID | Scenario | Owner | Status | Fix or Decision |
| --- | --- | --- | --- | --- |
| none | No blocker recorded yet. |  |  |  |

## Release Decision Log

| Date | Decision | Reviewer | Evidence |
| --- | --- | --- | --- |
| 2026-07-06 | Blocked by manual QA | Codex | Automated checks passed; Android manual blocker scenarios remain `not-run`. |

## Manual QA Packet

- Android runbook: `docs/BATTLESHIP_ANDROID_QA_RUNBOOK.md`
- Result template: `src/battleship/__tests__/BattleshipQaResults.template.ts`
- Example-only result file: `src/battleship/__tests__/BattleshipQaResults.example.ts`
- Generated packet helper: `getBattleshipManualQaPacket(results)`

## Production Copy Gate

- No visible local Battleship release path should use prototype, debug, wave, or remote-play wording.
- No mojibake or broken Arabic text should appear in Battleship UI.
- Help, resume, privacy handoff, destructive prompts, and result screens must remain understandable without developer context.

## Regression Coverage Gate

The automated suite must cover:

- Resume vs new match decision.
- Destructive confirmation paths.
- Handoff privacy transitions.
- Corrupt save recovery.
- Invalid placement and canceled drag cleanup.
- Attempt-limit win, draw, and unlimited-attempt behavior.
- Best-effort audio and haptic failures.
- Persistence hydration gating for resume/new match.
- Locked battle-cell behavior during shot animation, pending pass, and game-over.
