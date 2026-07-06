import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../constants', () => ({
  labels: {
    clear: 'clear',
    confirmBattleResetMessage: 'battle reset message',
    confirmBattleResetTitle: 'battle reset title',
    confirmClearSetupMessage: 'clear setup message',
    confirmClearSetupTitle: 'clear setup title',
    confirmContinue: 'continue',
    confirmModeChangeMessage: 'mode change message',
    confirmModeChangeTitle: 'mode change title',
    confirmNewMatchMessage: 'new match message',
    confirmNewMatchTitle: 'new match title',
    confirmVictoryResetMessage: 'victory reset message',
    confirmVictoryResetTitle: 'victory reset title',
    enemyWaters: 'enemy waters',
    newRound: 'new round',
    passTitle: 'handoff',
    passTurnStatus: 'pass turn',
    player: 'player',
    preparePlayer: 'prepare',
    roundOver: 'round over',
    savedDaysAgo: 'days ago',
    savedHoursAgo: 'hours ago',
    savedJustNow: 'just now',
    savedMinutesAgo: 'minutes ago',
    setupFleet: 'setup fleet',
    shotFlying: 'shot flying',
    startMatch: 'start',
    turn: 'turn',
    winner: 'winner',
  },
}));

import { createBoardCells, createHiddenTargets } from '../../utils/miniGameEngine';
import { miniGameModes } from '../../data/miniGameModes';
import {
  createBattleshipConfirmDialogState,
  type BattleshipConfirmAction,
} from '../BattleshipReleasePolish';
import { useBattleshipMatchState } from '../useBattleshipMatchState';
import { battleshipQaResultsTemplate } from './BattleshipQaResults.template';
import {
  canApproveBattleshipRelease,
  summarizeBattleshipAutomatedChecks,
  summarizeBattleshipReleaseEvidence,
  summarizeBattleshipQaResults,
  getBattleshipManualQaPacket,
  validateBattleshipAutomatedChecks,
  validateBattleshipQaResults,
  type BattleshipAutomatedCheckResult,
  type BattleshipQaResult,
} from './BattleshipQaRunner';
import { battleshipAutomatedEvidence } from './BattleshipAutomatedEvidence';
import { battleshipQaResultsExample } from './BattleshipQaResults.example';

const navalMode = miniGameModes.find((mode) => mode.id === 'naval')!;
const playerOneTargets = createHiddenTargets(navalMode);
const playerTwoTargets = createHiddenTargets(navalMode);
const playerOneCells = playerTwoTargets.flatMap((target) => target.cells);
const playerTwoCells = playerOneTargets.flatMap((target) => target.cells);
const playerOneMisses = createBoardCells()
  .filter((cell) => !playerTwoCells.includes(cell))
  .slice(0, 18);
const playerTwoMisses = createBoardCells()
  .filter((cell) => !playerOneCells.includes(cell))
  .slice(0, 18);

describe('Battleship release gate', () => {
  it('defines Android blocker scenarios with explicit manual status', () => {
    const androidBlockers = battleshipQaResultsTemplate.filter((scenario) =>
      scenario.blocker && scenario.platform === 'android'
    );

    expect(androidBlockers.length).toBeGreaterThanOrEqual(5);
    expect(androidBlockers.every((scenario) => scenario.status === 'not-run')).toBe(true);
    expect(androidBlockers.every((scenario) => scenario.targeted)).toBe(true);
    expect(new Set(battleshipQaResultsTemplate.map((scenario) => scenario.id)).size).toBe(
      battleshipQaResultsTemplate.length,
    );
  });

  it('summarizes QA result counts for targeted scenarios', () => {
    const results: BattleshipQaResult[] = [
      createQaResult('passed'),
      createQaResult('failed', { notes: 'layout clipped' }),
      createQaResult('blocked', { notes: 'device unavailable' }),
      createQaResult('not-run'),
      createQaResult('passed', { platform: 'ios', targeted: false }),
    ];

    expect(summarizeBattleshipQaResults(results)).toMatchObject({
      blocked: 1,
      failed: 1,
      notRun: 1,
      passed: 1,
      total: 4,
    });
  });

  it('records current automated evidence for every required check', () => {
    const validation = validateBattleshipAutomatedChecks(battleshipAutomatedEvidence);

    expect(validation.errors).toEqual([]);
    expect(validation.summary).toMatchObject({
      failed: 0,
      notRun: 0,
      passed: 3,
      total: 3,
    });
  });

  it.each([
    createAutomatedCheck('not-run'),
    createAutomatedCheck('failed', { notes: 'command failed in CI' }),
    createAutomatedCheck('passed', { evidence: '' }),
  ])('blocks release when an automated check is %s or missing evidence', (check) => {
    const validation = validateBattleshipAutomatedChecks([check]);

    expect(validation.errors.length).toBeGreaterThan(0);
    expect(summarizeBattleshipAutomatedChecks([check]).openBlockers.length).toBe(
      check.status === 'passed' ? 0 : 1,
    );
  });

  it('blocks approval until Android blockers pass', () => {
    const summary = summarizeBattleshipQaResults(battleshipQaResultsTemplate);

    expect(canApproveBattleshipRelease(summary)).toBe(false);
    expect(summary.openBlockers.some((scenario) => scenario.platform === 'android')).toBe(true);
  });

  it('blocks targeted iOS scenarios until they pass', () => {
    const results: BattleshipQaResult[] = battleshipQaResultsTemplate.map((scenario) => ({
      ...scenario,
      date: '2026-07-04',
      evidence: 'manual pass',
      status: 'passed' as const,
      targeted: scenario.platform === 'ios' ? true : scenario.targeted,
      tester: 'QA',
    }));

    results.find((scenario) => scenario.id === 'ios-full-local-match')!.status = 'not-run';

    const summary = summarizeBattleshipQaResults(results);

    expect(canApproveBattleshipRelease(summary)).toBe(false);
    expect(summary.openBlockers.map((scenario) => scenario.id)).toContain('ios-full-local-match');
  });

  it('does not block release for non-targeted iOS scenarios', () => {
    const results = battleshipQaResultsTemplate.map((scenario) => ({
      ...scenario,
      date: scenario.targeted ? '2026-07-04' : '',
      evidence: scenario.targeted ? 'manual pass' : '',
      status: scenario.targeted ? ('passed' as const) : scenario.status,
      tester: scenario.targeted ? 'QA' : '',
    }));
    const validation = validateBattleshipQaResults(results);

    expect(validation.errors).toEqual([]);
    expect(canApproveBattleshipRelease(validation.summary)).toBe(true);
  });

  it('requires notes for failed or blocked scenarios', () => {
    const validation = validateBattleshipQaResults([
      createQaResult('failed'),
      createQaResult('blocked'),
    ]);

    expect(validation.errors).toContain('android-test: failed or blocked scenarios require notes');
  });

  it('prevents approved releases without tester, date, and evidence', () => {
    const results = battleshipQaResultsTemplate.map((scenario) => ({
      ...scenario,
      status: scenario.targeted ? ('passed' as const) : scenario.status,
    }));
    const validation = validateBattleshipQaResults(results);

    expect(canApproveBattleshipRelease(validation.summary)).toBe(false);
    expect(validation.errors.some((error) => error.includes('tester and date'))).toBe(true);
  });

  it('keeps release blocked by manual QA even after automation passes', () => {
    const status = summarizeBattleshipReleaseEvidence({
      automatedChecks: battleshipAutomatedEvidence,
      manualResults: battleshipQaResultsTemplate,
    });

    expect(status.approved).toBe(false);
    expect(status.blockedByAutomation).toBe(false);
    expect(status.blockedByManualQa).toBe(true);
    expect(status.blockerReasons.some((reason) => reason.includes('android-full-local-match'))).toBe(
      true,
    );
  });

  it('generates a targeted Android manual QA packet with metadata for every blocker', () => {
    const packet = getBattleshipManualQaPacket(battleshipQaResultsTemplate);

    expect(packet.androidBlockers.length).toBeGreaterThanOrEqual(10);
    expect(packet.androidBlockers.every((item) => item.platform === 'android')).toBe(true);
    expect(packet.androidBlockers.every((item) => item.targeted)).toBe(true);
    expect(packet.androidBlockers.every((item) => item.evidenceKind)).toBe(true);
    expect(packet.androidBlockers.every((item) => item.setupNotes.trim().length > 0)).toBe(true);
    expect(packet.androidBlockers.every((item) => item.expectedPassCriteria.trim().length > 0)).toBe(
      true,
    );
    expect(packet.totalEstimatedMinutes).toBeGreaterThan(0);
  });

  it('excludes non-targeted iOS scenarios from the Android manual QA packet', () => {
    const packet = getBattleshipManualQaPacket(battleshipQaResultsTemplate);
    const packetIds = [
      ...packet.androidBlockers.map((item) => item.id),
      ...packet.androidNonBlockers.map((item) => item.id),
    ];

    expect(packetIds).not.toContain('ios-full-local-match');
    expect(packetIds).not.toContain('ios-resume-background');
  });

  it('keeps the example manual results non-approving', () => {
    const status = summarizeBattleshipReleaseEvidence({
      automatedChecks: battleshipAutomatedEvidence,
      manualResults: battleshipQaResultsExample,
    });

    expect(status.approved).toBe(false);
    expect(status.blockedByManualQa).toBe(true);
    expect(battleshipQaResultsExample.every((result) => result.status === 'not-run')).toBe(true);
  });

  it('approves release only when automation and targeted manual QA pass', () => {
    const manualResults = battleshipQaResultsTemplate.map((scenario) => ({
      ...scenario,
      date: scenario.targeted ? '2026-07-06' : '',
      evidence: scenario.targeted ? 'manual device pass' : '',
      status: scenario.targeted ? ('passed' as const) : scenario.status,
      tester: scenario.targeted ? 'QA' : '',
    }));
    const status = summarizeBattleshipReleaseEvidence({
      automatedChecks: battleshipAutomatedEvidence,
      manualResults,
    });

    expect(status).toMatchObject({
      approved: true,
      blockedByAutomation: false,
      blockedByManualQa: false,
    });
    expect(status.blockerReasons).toEqual([]);
  });

  it.each([
    'clear-setup',
    'mode-change',
    'new-match',
    'reset-battle',
    'reset-victory',
  ] as BattleshipConfirmAction[])('runs %s confirmation exactly once', (action) => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const dialog = createBattleshipConfirmDialogState({ action, onClose, onConfirm });

    dialog.onConfirm();
    dialog.onConfirm();

    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('ends with a winner when all defender cells are hit', () => {
    const state = useBattleshipMatchState({
      attemptsEnabled: true,
      currentPlayer: 1,
      pendingTurnPass: false,
      phase: 'battle',
      playerOneGuesses: new Set(playerOneCells),
      playerOneTargets,
      playerTwoGuesses: new Set(),
      playerTwoTargets,
      selectedTargetId: undefined,
      shotAnimation: undefined,
    });

    expect(state.isGameOver).toBe(true);
    expect(state.winner).toBe(1);
  });

  it('draws when limited attempts are exhausted by both players', () => {
    const state = useBattleshipMatchState({
      attemptsEnabled: true,
      currentPlayer: 1,
      pendingTurnPass: false,
      phase: 'battle',
      playerOneGuesses: new Set(playerOneMisses),
      playerOneTargets,
      playerTwoGuesses: new Set(playerTwoMisses),
      playerTwoTargets,
      selectedTargetId: undefined,
      shotAnimation: undefined,
    });

    expect(state.isGameOver).toBe(true);
    expect(state.winner).toBeUndefined();
  });

  it('does not end from exhausted guesses when attempts are unlimited', () => {
    const state = useBattleshipMatchState({
      attemptsEnabled: false,
      currentPlayer: 1,
      pendingTurnPass: false,
      phase: 'battle',
      playerOneGuesses: new Set(playerOneMisses),
      playerOneTargets,
      playerTwoGuesses: new Set(playerTwoMisses),
      playerTwoTargets,
      selectedTargetId: undefined,
      shotAnimation: undefined,
    });

    expect(state.isGameOver).toBe(false);
    expect(state.attemptsLeftText).toBe('\u221e');
  });

  it('keeps release copy and required labels present in production source', () => {
    const source = [
      'BattleshipBoardCard.tsx',
      'BattleshipCellGrid.tsx',
      'BattleshipConfirmDialog.tsx',
      'BattleshipFleetPanel.tsx',
      'BattleshipHandoffPanel.tsx',
      'BattleshipHeader.tsx',
      'BattleshipPreMatchPanel.tsx',
      'BattleshipVictoryPanel.tsx',
      'constants.ts',
    ]
      .map((fileName) =>
        readFileSync(join(process.cwd(), 'src', 'battleship', fileName), 'utf8'),
      )
      .join('\n');

    expect(source).not.toMatch(/\b(experimental|prototype|debug|wave|online)\b/i);
    expect(source).not.toMatch(/[Ãâœ]/);
    expect(source).toContain('passConfirmHint');
    expect(source).toContain('resumeMatchHint');
    expect(source).toContain('confirmBattleResetMessage');
    expect(source).toContain('newRoundHint');
  });
});

const createQaResult = (
  status: BattleshipQaResult['status'],
  overrides: Partial<BattleshipQaResult> = {},
): BattleshipQaResult => ({
  blocker: true,
  date: status === 'passed' ? '2026-07-04' : '',
  evidence: status === 'passed' ? 'manual pass' : '',
  id: 'android-test',
  notes: '',
  platform: 'android',
  status,
  targeted: true,
  tester: status === 'passed' ? 'QA' : '',
  title: 'Manual QA test',
  ...overrides,
});

const createAutomatedCheck = (
  status: BattleshipAutomatedCheckResult['status'],
  overrides: Partial<BattleshipAutomatedCheckResult> = {},
): BattleshipAutomatedCheckResult => ({
  command: 'npm test',
  date: status === 'passed' ? '2026-07-06' : '',
  evidence: status === 'passed' ? 'test pass' : '',
  id: `automated-${status}`,
  notes: '',
  required: true,
  requiredResult: 'pass',
  status,
  ...overrides,
});
