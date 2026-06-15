import { describe, expect, it } from 'vitest';

import {
  CARROM_POCKETS,
  applyShot,
  createInitialCarromState,
  lockStrikerPlacement,
  stepCarrom,
} from '../carromEngine';
import { CarromGameState } from '../../types/carrom';

const settleShot = (state: CarromGameState, maxFrames = 500) => {
  let current = state;

  for (let frame = 0; frame < maxFrames && current.status === 'moving'; frame += 1) {
    current = stepCarrom(current);
  }

  return current;
};

describe('carromEngine', () => {
  it('settles a normal shot after the optimized physics loop', () => {
    const aiming = lockStrikerPlacement(createInitialCarromState());
    const moving = applyShot(aiming, { vx: 12, vy: -20 });
    const settled = settleShot(moving);

    expect(settled.status).not.toBe('moving');
    expect(settled.discs.find((disc) => disc.kind === 'striker')?.vx).toBe(0);
    expect(settled.discs.find((disc) => disc.kind === 'striker')?.vy).toBe(0);
  });

  it('resolves a pocketed striker as a foul after the optimized physics loop', () => {
    const pocket = CARROM_POCKETS[0];
    const aiming = lockStrikerPlacement({
      ...createInitialCarromState(),
      discs: createInitialCarromState().discs.map((disc) =>
        disc.kind === 'striker'
          ? {
              ...disc,
              x: pocket.x,
              y: pocket.y,
            }
          : disc,
      ),
    });
    const moving = applyShot(aiming, { vx: 0, vy: 0 });
    const settled = settleShot(moving);

    expect(settled.status).toBe('placing');
    expect(settled.message).toContain('خطأ');
    expect(settled.discs.find((disc) => disc.kind === 'striker')?.pocketed).toBe(false);
  });
});
