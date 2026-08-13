import { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../constants', () => ({
  labels: {
    hit: 'hit',
    miss: 'miss',
  },
}));

import { miniGameModes } from '../../data/miniGameModes';
import { MiniGameTarget } from '../../types/miniGame';
import { createEmptyTargets, placeTargetAtCell } from '../../utils/miniGameEngine';
import { GamePhase, LastShot, ShotAnimation } from '../BattleshipGameTypes';
import { useBattleshipBattleActions } from '../useBattleshipBattleActions';
import { useBattleshipSetupActions } from '../useBattleshipSetupActions';

const navalMode = miniGameModes.find((mode) => mode.id === 'naval')!;

const createSetter = <T,>(initialValue: T) => {
  let value = initialValue;
  const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
    value =
      typeof nextValue === 'function'
        ? (nextValue as (currentValue: T) => T)(value)
        : nextValue;
  };

  return {
    get: () => value,
    set: setValue,
  };
};

const noop = () => {};

describe('Battleship setup actions', () => {
  it('confirms Player 1 setup into the Player 2 privacy handoff', () => {
    const phase = createSetter<GamePhase>('setup-player-1');
    const selectedTargetId = createSetter<string | undefined>('ship-one');
    const previewCellId = createSetter<string | undefined>('0-0');
    const notifySuccess = vi.fn();

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => undefined,
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess,
      phase: phase.get(),
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: previewCellId.get(),
      selectedTarget: undefined,
      selectedTargetId: selectedTargetId.get(),
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: phase.set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: previewCellId.set,
      setSelectedTargetId: selectedTargetId.set,
      setupFleetReady: true,
      setupPlayer: 1,
      setupTargets: createEmptyTargets(navalMode),
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.confirmSetupFleet();

    expect(phase.get()).toBe('handoff-to-player-2');
    expect(selectedTargetId.get()).toBeUndefined();
    expect(previewCellId.get()).toBeUndefined();
    expect(notifySuccess).toHaveBeenCalledOnce();
  });

  it('confirms an online fleet without entering hot-seat handoff', () => {
    const phase = createSetter<GamePhase>('setup-player-1');
    const onlineConfirmed: MiniGameTarget[][] = [];
    const setupTargets = [
      {
        id: 'ship-1',
        name: 'Ship',
        shortLabel: 'S',
        footprint: { columns: 2, rows: 1 },
        cells: ['0-0', '0-1'],
        isPlaced: true,
      },
    ];

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => undefined,
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess: noop,
      onOnlineFleetConfirmed: (targets) => onlineConfirmed.push(targets),
      phase: phase.get(),
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: undefined,
      selectedTarget: undefined,
      selectedTargetId: undefined,
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: phase.set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: createSetter<MiniGameTarget[]>(setupTargets).set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: createSetter<string | undefined>(undefined).set,
      setSelectedTargetId: createSetter<string | undefined>(undefined).set,
      setupFleetReady: true,
      setupPlayer: 1,
      setupTargets,
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.confirmSetupFleet();

    expect(phase.get()).toBe('setup-player-1');
    expect(onlineConfirmed).toEqual([setupTargets]);
  });

  it('confirms Player 2 setup into battle with cleared battle state', () => {
    const phase = createSetter<GamePhase>('setup-player-2');
    const currentPlayer = createSetter<1 | 2>(2);
    const pendingTurnPass = createSetter(true);
    const lastShot = createSetter<LastShot | undefined>({ result: 'hit', text: 'hit' });
    const playerOneGuesses = createSetter(new Set(['0-0']));
    const playerTwoGuesses = createSetter(new Set(['1-1']));
    const clearSunkEffects = vi.fn();

    const actions = useBattleshipSetupActions({
      clearSunkEffects,
      getCellIdFromBoardEvent: () => undefined,
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess: noop,
      phase: phase.get(),
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: undefined,
      selectedTarget: undefined,
      selectedTargetId: undefined,
      setCurrentPlayer: currentPlayer.set,
      setLastShot: lastShot.set,
      setPendingTurnPass: pendingTurnPass.set,
      setPhase: phase.set,
      setPlayerOneGuesses: playerOneGuesses.set,
      setPlayerOneTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPlayerTwoGuesses: playerTwoGuesses.set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: createSetter<string | undefined>(undefined).set,
      setSelectedTargetId: createSetter<string | undefined>(undefined).set,
      setupFleetReady: true,
      setupPlayer: 2,
      setupTargets: createEmptyTargets(navalMode),
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.confirmSetupFleet();

    expect(phase.get()).toBe('battle');
    expect(currentPlayer.get()).toBe(1);
    expect(pendingTurnPass.get()).toBe(false);
    expect(lastShot.get()).toBeUndefined();
    expect(playerOneGuesses.get().size).toBe(0);
    expect(playerTwoGuesses.get().size).toBe(0);
    expect(clearSunkEffects).toHaveBeenCalledOnce();
  });

  it('keeps tap invalid and drag invalid placement state behavior distinct', () => {
    const setupTargets = createEmptyTargets(navalMode);
    const selectedTarget = setupTargets.find((target) => target.id === 'ship-three')!;
    const previewCellId = createSetter<string | undefined>(undefined);
    const invalidFeedback = vi.fn();

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => '9-9',
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: invalidFeedback,
      notifySuccess: noop,
      phase: 'setup-player-1',
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: undefined,
      selectedTarget,
      selectedTargetId: selectedTarget.id,
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: createSetter<GamePhase>('setup-player-1').set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: createSetter<MiniGameTarget[]>(setupTargets).set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: previewCellId.set,
      setSelectedTargetId: createSetter<string | undefined>(selectedTarget.id).set,
      setupFleetReady: false,
      setupPlayer: 1,
      setupTargets,
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.handleSetupCellPress('9-9');

    expect(previewCellId.get()).toBe('9-9');

    actions.handleDragReleaseCell('9-9');

    expect(previewCellId.get()).toBe('9-9');
    expect(invalidFeedback).toHaveBeenCalledTimes(2);
  });

  it('routes board-owned tap releases through normal setup cell press behavior', () => {
    const setupTargets = createEmptyTargets(navalMode);
    const selectedTarget = setupTargets.find((target) => target.id === 'ship-four')!;
    const playerOneTargets = createSetter<MiniGameTarget[]>(setupTargets);
    const previewCellId = createSetter<string | undefined>(undefined);
    const selectedTargetId = createSetter<string | undefined>(selectedTarget.id);

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => '2-2',
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess: noop,
      phase: 'setup-player-1',
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: undefined,
      selectedTarget,
      selectedTargetId: selectedTarget.id,
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: createSetter<GamePhase>('setup-player-1').set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: playerOneTargets.set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: previewCellId.set,
      setSelectedTargetId: selectedTargetId.set,
      setupFleetReady: false,
      setupPlayer: 1,
      setupTargets,
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.handleSetupBoardPress({ nativeEvent: {} } as never);

    expect(playerOneTargets.get().find((target) => target.id === selectedTarget.id)?.cells).toEqual([
      '2-2',
    ]);
    expect(previewCellId.get()).toBeUndefined();
  });

  it('commits optimized drag release from the hovered cell', () => {
    const setupTargets = createEmptyTargets(navalMode);
    const selectedTarget = setupTargets.find((target) => target.id === 'ship-four')!;
    const playerOneTargets = createSetter<MiniGameTarget[]>(setupTargets);
    const previewCellId = createSetter<string | undefined>(undefined);
    const selectedTargetId = createSetter<string | undefined>(selectedTarget.id);

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => undefined,
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess: noop,
      phase: 'setup-player-1',
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: undefined,
      selectedTarget,
      selectedTargetId: selectedTarget.id,
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: createSetter<GamePhase>('setup-player-1').set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: playerOneTargets.set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: previewCellId.set,
      setSelectedTargetId: selectedTargetId.set,
      setupFleetReady: false,
      setupPlayer: 1,
      setupTargets,
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.handleDragHoverCell('3-3');
    actions.handleDragReleaseCell('3-3');

    expect(playerOneTargets.get().find((target) => target.id === selectedTarget.id)?.cells).toEqual([
      '3-3',
    ]);
    expect(previewCellId.get()).toBeUndefined();
  });

  it('clears setup preview when drag is canceled', () => {
    const setupTargets = createEmptyTargets(navalMode);
    const selectedTarget = setupTargets.find((target) => target.id === 'ship-four')!;
    const previewCellId = createSetter<string | undefined>('3-3');

    const actions = useBattleshipSetupActions({
      clearSunkEffects: noop,
      getCellIdFromBoardEvent: () => undefined,
      impactLight: noop,
      impactMedium: noop,
      mode: navalMode,
      notifyError: noop,
      notifySuccess: noop,
      phase: 'setup-player-1',
      playInvalidSound: noop,
      playTapSound: noop,
      previewCellId: previewCellId.get(),
      selectedTarget,
      selectedTargetId: selectedTarget.id,
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: createSetter<GamePhase>('setup-player-1').set,
      setPlayerOneGuesses: createSetter(new Set<string>()).set,
      setPlayerOneTargets: createSetter<MiniGameTarget[]>(setupTargets).set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setPlayerTwoTargets: createSetter<MiniGameTarget[]>(createEmptyTargets(navalMode)).set,
      setPreviewCellId: previewCellId.set,
      setSelectedTargetId: createSetter<string | undefined>(selectedTarget.id).set,
      setupFleetReady: false,
      setupPlayer: 1,
      setupTargets,
      playerTwoTargets: createEmptyTargets(navalMode),
    });

    actions.handleDragCancel();

    expect(previewCellId.get()).toBeUndefined();
  });
});

describe('Battleship battle actions', () => {
  it('keeps the current player active after a hit', () => {
    const target = {
      ...createEmptyTargets(navalMode).find((item) => item.id === 'ship-three')!,
      cells: ['0-0', '0-1'],
      isPlaced: true,
    };
    const guesses = createSetter(new Set<string>());
    const pendingTurnPass = createSetter(false);
    const currentPlayer = createSetter<1 | 2>(1);
    const shotAnimation = createSetter<ShotAnimation | undefined>(undefined);
    const hitSound = vi.fn();

    const actions = useBattleshipBattleActions({
      activeGuesses: guesses.get(),
      activeTargets: [target],
      attemptsEnabled: true,
      currentPlayer: currentPlayer.get(),
      defendingPlayer: 2,
      handleSetupCellPress: noop,
      impactHeavy: noop,
      impactLight: noop,
      isCellDisabled: () => false,
      isSetupPhase: false,
      playHitSound: hitSound,
      playMissSound: noop,
      playTapSound: noop,
      scheduleShotResolution: (onResolve) => onResolve(),
      setCurrentPlayer: currentPlayer.set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: pendingTurnPass.set,
      setPhase: createSetter<GamePhase>('battle').set,
      setPlayerOneGuesses: guesses.set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setShotAnimation: shotAnimation.set,
      totalTargetCells: 2,
      triggerSunkEffect: noop,
    });

    actions.handleCellPress('0-0');

    expect(guesses.get()).toEqual(new Set(['0-0']));
    expect(shotAnimation.get()).toEqual({ cellId: '0-0', result: 'hit' });
    expect(pendingTurnPass.get()).toBe(false);
    expect(currentPlayer.get()).toBe(1);
    expect(hitSound).toHaveBeenCalledOnce();
  });

  it('requires pass turn after a miss and then hands off to the next player', () => {
    const target = {
      ...createEmptyTargets(navalMode).find((item) => item.id === 'ship-four')!,
      cells: ['0-0'],
      isPlaced: true,
    };
    const guesses = createSetter(new Set<string>());
    const phase = createSetter<GamePhase>('battle');
    const pendingTurnPass = createSetter(false);
    const currentPlayer = createSetter<1 | 2>(1);
    const lastShot = createSetter<LastShot | undefined>(undefined);

    const actions = useBattleshipBattleActions({
      activeGuesses: guesses.get(),
      activeTargets: [target],
      attemptsEnabled: true,
      currentPlayer: currentPlayer.get(),
      defendingPlayer: 2,
      handleSetupCellPress: noop,
      impactHeavy: noop,
      impactLight: noop,
      isCellDisabled: () => false,
      isSetupPhase: false,
      playHitSound: noop,
      playMissSound: noop,
      playTapSound: noop,
      scheduleShotResolution: (onResolve) => onResolve(),
      setCurrentPlayer: currentPlayer.set,
      setLastShot: lastShot.set,
      setPendingTurnPass: pendingTurnPass.set,
      setPhase: phase.set,
      setPlayerOneGuesses: guesses.set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setShotAnimation: createSetter<ShotAnimation | undefined>(undefined).set,
      totalTargetCells: 1,
      triggerSunkEffect: noop,
    });

    actions.handleCellPress('4-4');
    expect(guesses.get()).toEqual(new Set(['4-4']));
    expect(pendingTurnPass.get()).toBe(true);

    actions.passTurn();
    expect(phase.get()).toBe('turn-handoff');

    actions.continueTurnHandoff();
    expect(currentPlayer.get()).toBe(2);
    expect(pendingTurnPass.get()).toBe(false);
    expect(lastShot.get()).toBeUndefined();
    expect(phase.get()).toBe('battle');
  });

  it.each([
    'shot animation',
    'pending pass',
    'game over',
  ])('ignores battle cell press while locked by %s', () => {
    const target = {
      ...createEmptyTargets(navalMode).find((item) => item.id === 'ship-four')!,
      cells: ['0-0'],
      isPlaced: true,
    };
    const guesses = createSetter(new Set<string>());
    const tapSound = vi.fn();

    const actions = useBattleshipBattleActions({
      activeGuesses: guesses.get(),
      activeTargets: [target],
      attemptsEnabled: true,
      currentPlayer: 1,
      defendingPlayer: 2,
      handleSetupCellPress: noop,
      impactHeavy: noop,
      impactLight: noop,
      isCellDisabled: () => true,
      isSetupPhase: false,
      playHitSound: noop,
      playMissSound: noop,
      playTapSound: tapSound,
      scheduleShotResolution: (onResolve) => onResolve(),
      setCurrentPlayer: createSetter<1 | 2>(1).set,
      setLastShot: createSetter<LastShot | undefined>(undefined).set,
      setPendingTurnPass: createSetter(false).set,
      setPhase: createSetter<GamePhase>('battle').set,
      setPlayerOneGuesses: guesses.set,
      setPlayerTwoGuesses: createSetter(new Set<string>()).set,
      setShotAnimation: createSetter<ShotAnimation | undefined>(undefined).set,
      totalTargetCells: 1,
      triggerSunkEffect: noop,
    });

    actions.handleCellPress('0-0');

    expect(guesses.get().size).toBe(0);
    expect(tapSound).not.toHaveBeenCalled();
  });
});

