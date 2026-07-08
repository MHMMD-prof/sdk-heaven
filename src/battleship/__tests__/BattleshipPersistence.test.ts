import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

vi.mock('../constants', () => ({
  labels: {
    cancel: 'cancel',
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
    enemyWaters: 'مياه الخصم',
    newRound: 'new round',
    passTitle: 'handoff',
    player: 'اللاعب',
    savedDaysAgo: 'day ago',
    savedHoursAgo: 'hour ago',
    savedJustNow: 'محفوظة الآن',
    savedMinutesAgo: 'دقيقة مضت',
    setupFleet: 'setup',
    startMatch: 'start',
  },
}));

import { createEmptyTargets, createHiddenTargets } from '../../utils/miniGameEngine';
import { miniGameModes } from '../../data/miniGameModes';
import {
  BATTLESHIP_SAVE_KEY,
  decodeBattleshipSave,
  encodeBattleshipSave,
  loadSavedBattleshipMatch,
  type BattleshipSaveState,
} from '../BattleshipPersistence';
import {
  getBattleshipPersistenceScreenState,
  getConfirmCopy,
  getSavedMatchSummary,
  getSavedTimeLabel,
} from '../BattleshipReleasePolish';

const navalMode = miniGameModes.find((mode) => mode.id === 'naval')!;

const createSaveState = (phase: BattleshipSaveState['phase']): BattleshipSaveState => {
  const playerOneReady = phase !== 'setup-player-1';
  const playerTwoReady = phase === 'battle' || phase === 'turn-handoff';

  return {
    attemptsEnabled: true,
    currentPlayer: 1,
    lastShot: phase === 'battle' ? { result: 'hit', text: 'hit' } : undefined,
    modeId: 'naval',
    pendingTurnPass: phase === 'turn-handoff',
    phase,
    playerOneGuesses: phase === 'battle' ? ['0-0'] : [],
    playerOneTargets: playerOneReady ? createHiddenTargets(navalMode) : createEmptyTargets(navalMode),
    playerTwoGuesses: phase === 'battle' ? ['1-1'] : [],
    playerTwoTargets: playerTwoReady ? createHiddenTargets(navalMode) : createEmptyTargets(navalMode),
    savedAt: 1234,
    selectedTargetId: 'ship-one',
  };
};

describe('Battleship persistence', () => {
  beforeEach(() => {
    storage.clear();
  });

  it.each([
    'setup-player-1',
    'handoff-to-player-2',
    'setup-player-2',
    'battle',
    'turn-handoff',
  ] as const)('round-trips a %s save', (phase) => {
    const save = createSaveState(phase);

    expect(decodeBattleshipSave(encodeBattleshipSave(save))).toEqual(save);
  });

  it('rejects malformed saves', () => {
    expect(decodeBattleshipSave('{bad')).toBeUndefined();
    expect(decodeBattleshipSave(JSON.stringify({ version: 1, game: { phase: 'bad' } }))).toBeUndefined();
  });

  it('clears corrupt local saves while loading', async () => {
    storage.set(BATTLESHIP_SAVE_KEY, '{bad');

    await expect(loadSavedBattleshipMatch()).resolves.toBeUndefined();

    expect(storage.has(BATTLESHIP_SAVE_KEY)).toBe(false);
  });

  it('rejects saves that cannot resume their phase', () => {
    const impossibleBattle = {
      ...createSaveState('battle'),
      playerTwoTargets: createEmptyTargets(navalMode),
    };

    expect(decodeBattleshipSave(encodeBattleshipSave(impossibleBattle))).toBeUndefined();
  });

  it('swallows storage failures during load, save, and clear', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('load failed'));
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('save failed'));
    vi.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('clear failed'));

    await expect(loadSavedBattleshipMatch()).resolves.toBeUndefined();
    await expect(import('../BattleshipPersistence').then(({ saveBattleshipMatch }) =>
      saveBattleshipMatch(createSaveState('setup-player-1')),
    )).resolves.toBe(false);
    await expect(import('../BattleshipPersistence').then(({ clearSavedBattleshipMatch }) =>
      clearSavedBattleshipMatch(),
    )).resolves.toBe(false);
  });

  it('summarizes saved matches with phase, player, and freshness', () => {
    const save = createSaveState('battle');

    expect(getSavedMatchSummary(save, save.savedAt + 2 * 60 * 1000)?.line).toContain('2');
    expect(getSavedMatchSummary(save, save.savedAt + 2 * 60 * 1000)?.line).toContain('اللاعب 1');
    expect(getSavedMatchSummary(save, save.savedAt + 2 * 60 * 1000)?.line).toContain('مياه الخصم');
  });

  it('formats saved match freshness without throwing on clock drift', () => {
    const now = 10_000;

    expect(getSavedTimeLabel(now, now)).toBe('محفوظة الآن');
    expect(getSavedTimeLabel(now + 1_000, now)).toBe('محفوظة الآن');
    expect(getSavedTimeLabel(now - 3_600_000, now)).toContain('1');
  });

  it('prevents resume and new match actions before persistence hydration', () => {
    expect(
      getBattleshipPersistenceScreenState({
        hasSavedMatch: true,
        persistenceReady: false,
      }),
    ).toEqual({
      canResumeSavedMatch: false,
      canStartNewMatch: false,
      isPersistenceLoading: true,
    });

    expect(
      getBattleshipPersistenceScreenState({
        hasSavedMatch: true,
        persistenceReady: true,
      }),
    ).toEqual({
      canResumeSavedMatch: true,
      canStartNewMatch: true,
      isPersistenceLoading: false,
    });
  });

  it.each([
    'clear-setup',
    'mode-change',
    'new-match',
    'reset-battle',
    'reset-victory',
  ] as const)('provides confirmation copy for %s', (action) => {
    expect(getConfirmCopy(action).confirmLabel).toBeTruthy();
    expect(getConfirmCopy(action).message).toBeTruthy();
    expect(getConfirmCopy(action).title).toBeTruthy();
  });

  it('keeps production copy free of prototype language', () => {
    const constantsSource = readFileSync(
      join(process.cwd(), 'src', 'battleship', 'constants.ts'),
      'utf8',
    );

    expect(constantsSource).not.toMatch(/\b(experimental|prototype|debug|wave|online)\b/i);
  });

  it('keeps release-path source free of mojibake', () => {
    const source = [
      'constants.ts',
      'BattleshipHandoffPanel.tsx',
      'BattleshipPreMatchPanel.tsx',
      'BattleshipVictoryPanel.tsx',
      'BattleshipBoardCard.tsx',
    ]
      .map((fileName) =>
        readFileSync(join(process.cwd(), 'src', 'battleship', fileName), 'utf8'),
      )
      .join('\n');

    expect(source).not.toMatch(new RegExp(`[${String.fromCharCode(0x00c3, 0x00e2, 0x0153)}]`));
  });
});
