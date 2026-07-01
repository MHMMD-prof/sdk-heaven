import { describe, expect, it } from 'vitest';

import { CarromGameState } from '../../types/carrom';
import { createInitialCarromState } from '../carromEngine';
import {
  createShotHistoryItem,
  getEventTone,
  getPocketSummary,
} from '../carromPresentation';

const withMessage = (
  message: string,
  status: CarromGameState['status'] = 'placing',
) => ({
  ...createInitialCarromState(),
  message,
  status,
});

describe('carromPresentation', () => {
  it('classifies foul messages', () => {
    expect(getEventTone('خطأ: دخل حجر الضربة', 'placing')).toBe('foul');
  });

  it('classifies queen messages', () => {
    expect(getEventTone('الملكة تنتظر التغطية', 'placing')).toBe('queen');
  });

  it('classifies success messages', () => {
    expect(getEventTone('قطعة ناجحة، العب مجدداً', 'placing')).toBe('success');
  });

  it('summarizes an empty pocket result', () => {
    expect(getPocketSummary(createInitialCarromState(), 1)).toBe('لا توجد قطع داخلة');
  });

  it('summarizes a pocketed striker', () => {
    const game = createInitialCarromState();
    const striker = game.discs.find((disc) => disc.kind === 'striker');

    expect(striker).toBeDefined();
    expect(
      getPocketSummary(
        {
          ...game,
          pocketedThisTurn: [{ ...striker!, pocketed: true }],
        },
        1,
      ),
    ).toContain('حجر الضربة');
  });

  it('creates a win history message', () => {
    const item = createShotHistoryItem(
      {
        ...withMessage('فاز اللاعب 2', 'gameOver'),
        winner: 2,
      },
      1,
    );

    expect(item.tone).toBe('win');
    expect(item.message).toContain('اللاعب 2 فاز');
  });
});
