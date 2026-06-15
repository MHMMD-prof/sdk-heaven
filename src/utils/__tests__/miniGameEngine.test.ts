import { describe, expect, it } from 'vitest';

import { MiniGameMode } from '../../types/miniGame';
import {
  BOARD_SIZE,
  canPlaceTarget,
  createEmptyTargets,
  getPlacementCells,
  isFleetPlaced,
  placeTargetAtCell,
  randomizeTargets,
  removeTargetPlacement,
  rotatePlacedTarget,
} from '../miniGameEngine';

const mode: MiniGameMode = {
  id: 'naval',
  title: 'Naval',
  subtitle: 'Test mode',
  boardLabel: 'Board',
  accentColor: '#4BA3FF',
  targets: [
    {
      id: 'big',
      name: 'Big',
      shortLabel: 'B',
      imageKey: 'big',
      footprint: { columns: 4, rows: 2 },
    },
    {
      id: 'long',
      name: 'Long',
      shortLabel: 'L',
      imageKey: 'long',
      footprint: { columns: 3, rows: 1 },
    },
    {
      id: 'medium',
      name: 'Medium',
      shortLabel: 'M',
      imageKey: 'medium',
      footprint: { columns: 2, rows: 1 },
    },
    {
      id: 'small',
      name: 'Small',
      shortLabel: 'S',
      imageKey: 'small',
      footprint: { columns: 1, rows: 1 },
    },
  ],
};

describe('mini-game placement engine', () => {
  it('computes footprint cells from an anchor', () => {
    expect(getPlacementCells('1-2', { columns: 3, rows: 2 })).toEqual([
      '1-2',
      '1-3',
      '1-4',
      '2-2',
      '2-3',
      '2-4',
    ]);
  });

  it('places a target inside the board', () => {
    const targets = createEmptyTargets(mode);
    const placed = placeTargetAtCell(targets, 'medium', '2-2');
    const medium = placed.find((target) => target.id === 'medium');

    expect(medium?.isPlaced).toBe(true);
    expect(medium?.cells).toEqual(['2-2', '2-3']);
  });

  it('rejects out-of-bounds placement', () => {
    const targets = createEmptyTargets(mode);

    expect(canPlaceTarget('long', '5-4', { columns: 3, rows: 1 }, targets)).toBe(false);
    expect(placeTargetAtCell(targets, 'long', '5-4')[1].isPlaced).toBe(false);
  });

  it('rejects overlapping ships but allows touching ships', () => {
    const targets = placeTargetAtCell(createEmptyTargets(mode), 'medium', '0-0');

    expect(canPlaceTarget('small', '0-1', { columns: 1, rows: 1 }, targets)).toBe(false);
    expect(canPlaceTarget('small', '0-2', { columns: 1, rows: 1 }, targets)).toBe(true);
  });

  it('rotates a placed target and recomputes cells', () => {
    const targets = placeTargetAtCell(createEmptyTargets(mode), 'medium', '2-2');
    const rotated = rotatePlacedTarget(targets, 'medium');
    const medium = rotated.find((target) => target.id === 'medium');

    expect(medium?.footprint).toEqual({ columns: 1, rows: 2 });
    expect(medium?.cells).toEqual(['2-2', '3-2']);
  });

  it('removes and moves a ship while freeing old cells', () => {
    const placed = placeTargetAtCell(createEmptyTargets(mode), 'medium', '2-2');
    const removed = removeTargetPlacement(placed, 'medium');

    expect(canPlaceTarget('small', '2-2', { columns: 1, rows: 1 }, removed)).toBe(true);

    const moved = placeTargetAtCell(removed, 'medium', '4-0');
    const medium = moved.find((target) => target.id === 'medium');

    expect(medium?.cells).toEqual(['4-0', '4-1']);
  });

  it('randomizes every ship without overlap', () => {
    const randomized = randomizeTargets(createEmptyTargets(mode));
    const occupiedCells = randomized.flatMap((target) => target.cells);
    const uniqueCells = new Set(occupiedCells);

    expect(isFleetPlaced(randomized)).toBe(true);
    expect(uniqueCells.size).toBe(occupiedCells.length);
    expect(
      occupiedCells.every((cell) => {
        const [row, column] = cell.split('-').map(Number);

        return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE;
      }),
    ).toBe(true);
  });
});
