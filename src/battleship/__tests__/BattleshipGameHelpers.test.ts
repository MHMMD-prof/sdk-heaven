import { describe, expect, it } from 'vitest';

import { miniGameModes } from '../../data/miniGameModes';
import { createEmptyTargets, placeTargetAtCell } from '../../utils/miniGameEngine';
import {
  createModeTargets,
  getInitialSelectedTargetId,
  getPlacementPreview,
  getResetPhase,
  isBattleCellDisabled,
} from '../BattleshipGameHelpers';

const navalMode = miniGameModes.find((mode) => mode.id === 'naval')!;
const farmMode = miniGameModes.find((mode) => mode.id === 'farm')!;

describe('BattleshipGameHelpers', () => {
  it('resolves reset phases for naval and farm modes', () => {
    expect(getResetPhase(navalMode, true)).toBe('pre-match');
    expect(getResetPhase(navalMode, false)).toBe('setup-player-1');
    expect(getResetPhase(farmMode, true)).toBe('battle');
    expect(getResetPhase(farmMode, false)).toBe('battle');
  });

  it('creates empty naval targets and hidden farm targets', () => {
    const navalTargets = createModeTargets(navalMode);
    const farmTargets = createModeTargets(farmMode);

    expect(navalTargets.every((target) => !target.isPlaced && target.cells.length === 0)).toBe(true);
    expect(farmTargets.every((target) => target.isPlaced && target.cells.length > 0)).toBe(true);
  });

  it('selects the first naval target only for setup modes', () => {
    expect(getInitialSelectedTargetId(navalMode)).toBe(navalMode.targets[0].id);
    expect(getInitialSelectedTargetId(farmMode)).toBeUndefined();
  });

  it('derives valid and invalid placement previews', () => {
    const setupTargets = createEmptyTargets(navalMode);
    const selectedTarget = setupTargets.find((target) => target.id === 'ship-three')!;

    expect(
      getPlacementPreview({
        previewCellId: '1-1',
        selectedTarget,
        setupTargets,
      }),
    ).toEqual({
      previewCells: ['1-1', '1-2'],
      previewIsValid: true,
    });

    const occupiedTargets = placeTargetAtCell(setupTargets, 'ship-four', '1-1');

    expect(
      getPlacementPreview({
        previewCellId: '1-1',
        selectedTarget,
        setupTargets: occupiedTargets,
      }).previewIsValid,
    ).toBe(false);
  });

  it('locks battle cells only for active battle lock conditions', () => {
    const baseOptions = {
      activeGuesses: new Set<string>(),
      cellId: '0-0',
      isGameOver: false,
      pendingTurnPass: false,
      phase: 'battle' as const,
      shotAnimation: undefined,
    };

    expect(isBattleCellDisabled(baseOptions)).toBe(false);
    expect(isBattleCellDisabled({ ...baseOptions, phase: 'setup-player-1' })).toBe(false);
    expect(isBattleCellDisabled({ ...baseOptions, pendingTurnPass: true })).toBe(true);
    expect(isBattleCellDisabled({ ...baseOptions, isGameOver: true })).toBe(true);
    expect(
      isBattleCellDisabled({
        ...baseOptions,
        shotAnimation: { cellId: '2-2', result: 'miss' },
      }),
    ).toBe(true);
    expect(
      isBattleCellDisabled({
        ...baseOptions,
        activeGuesses: new Set(['0-0']),
      }),
    ).toBe(true);
  });
});
