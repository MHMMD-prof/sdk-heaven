import { describe, expect, it } from 'vitest';

import { CarromDisc, CarromGameState } from '../../types/carrom';
import { createInitialCarromState } from '../carromEngine';
import {
  createShotHistoryItem,
  createPocketSparkles,
  getEventTone,
  getPocketSummary,
  getRemainingCoinCounts,
  prependShotHistoryItem,
} from '../carromPresentation';

const withMessage = (
  message: string,
  status: CarromGameState['status'] = 'placing',
) => ({
  ...createInitialCarromState(),
  message,
  status,
});

const getDisc = (game: CarromGameState, id: string): CarromDisc => {
  const disc = game.discs.find((item) => item.id === id);

  if (!disc) {
    throw new Error(`Missing carrom disc ${id}`);
  }

  return { ...disc, pocketed: true };
};

const historyItem = (id: string) => ({
  id,
  message: `shot-${id}`,
  player: 1 as const,
  tone: 'neutral' as const,
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

  it('uses a pocket override for own coin history after settlement clears the turn list', () => {
    const game = {
      ...createInitialCarromState(),
      pocketedThisTurn: [],
    };
    const item = createShotHistoryItem(game, 1, [getDisc(game, 'white-1')]);

    expect(item.message).toContain('1 من قطع اللاعب');
  });

  it('uses a pocket override for opponent coin history', () => {
    const game = {
      ...createInitialCarromState(),
      pocketedThisTurn: [],
    };
    const item = createShotHistoryItem(game, 1, [getDisc(game, 'black-1')]);

    expect(item.message).toContain('1 من قطع الخصم');
  });

  it('uses a pocket override for queen and striker history', () => {
    const game = {
      ...createInitialCarromState(),
      pocketedThisTurn: [],
    };
    const item = createShotHistoryItem(game, 1, [
      getDisc(game, 'queen'),
      getDisc(game, 'striker'),
    ]);

    expect(item.message).toContain('الملكة');
    expect(item.message).toContain('حجر الضربة');
  });

  it('counts remaining player coins in one presentation helper', () => {
    const game = createInitialCarromState();
    const counts = getRemainingCoinCounts({
      ...game,
      discs: game.discs.map((disc) =>
        disc.id === 'white-1' || disc.id === 'black-1'
          ? { ...disc, pocketed: true }
          : disc,
      ),
    });

    expect(counts).toEqual({
      1: 8,
      2: 8,
    });
  });

  it('uses a mixed pocket override list without relying on the cleared turn list', () => {
    const game = {
      ...createInitialCarromState(),
      pocketedThisTurn: [],
    };
    const pocketed = [
      getDisc(game, 'white-1'),
      getDisc(game, 'black-1'),
      getDisc(game, 'queen'),
      getDisc(game, 'striker'),
    ];
    const item = createShotHistoryItem(game, 1, pocketed);
    const summary = getPocketSummary(game, 1, pocketed);

    expect(item.message).toContain(summary);
    expect(summary).toContain(getPocketSummary(game, 1, [pocketed[0]!]));
    expect(summary).toContain(getPocketSummary(game, 1, [pocketed[1]!]));
    expect(summary).toContain(getPocketSummary(game, 1, [pocketed[2]!]));
    expect(summary).toContain(getPocketSummary(game, 1, [pocketed[3]!]));
  });

  it('prepends a shot history item to an empty list', () => {
    const item = historyItem('new');

    expect(prependShotHistoryItem([], item)).toEqual([item]);
  });

  it('prepends the newest shot history item first and keeps existing order', () => {
    const current = [historyItem('old-1'), historyItem('old-2')];
    const newest = historyItem('new');

    expect(prependShotHistoryItem(current, newest)).toEqual([
      newest,
      current[0],
      current[1],
    ]);
  });

  it('caps shot history at 8 items', () => {
    const current = Array.from({ length: 8 }, (_, index) => historyItem(`old-${index}`));
    const newest = historyItem('new');
    const next = prependShotHistoryItem(current, newest);

    expect(next).toHaveLength(8);
    expect(next[0]).toBe(newest);
    expect(next[7]).toBe(current[6]);
  });

  it('creates no pocket sparkle payloads for empty input', () => {
    expect(createPocketSparkles([])).toEqual([]);
  });

  it('creates coin pocket sparkle payloads with preserved position and id', () => {
    const game = createInitialCarromState();
    const coin = {
      ...getDisc(game, 'white-1'),
      x: 123,
      y: 456,
    };

    expect(createPocketSparkles([coin])).toEqual([
      {
        id: coin.id,
        tone: 'coin',
        x: 123,
        y: 456,
      },
    ]);
  });

  it('creates queen and striker pocket sparkle tones', () => {
    const game = createInitialCarromState();
    const sparkles = createPocketSparkles([
      getDisc(game, 'queen'),
      getDisc(game, 'striker'),
    ]);

    expect(sparkles[0]?.tone).toBe('queen');
    expect(sparkles[1]?.tone).toBe('striker');
  });
});
