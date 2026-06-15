import { describe, expect, it } from 'vitest';

import { createInitialCarromState } from '../carromEngine';
import {
  CarromMatchCommandError,
  CARROM_MATCH_TABLES,
  localCarromMatchController,
} from '../localCarromMatchController';

describe('localCarromMatchController', () => {
  it('creates a ready match with structured token stake data', () => {
    const match = localCarromMatchController.createMatch('gold', 3);

    expect(match.status).toBe('ready');
    expect(match.table).toEqual(CARROM_MATCH_TABLES[1]);
    expect(match.table.stake).toMatchObject({
      currency: 'token',
      entryFee: 500,
      prizePool: 900,
      rake: 100,
      isRealMoney: false,
    });
    expect(match.players).toHaveLength(2);
    expect(match.events[0]?.kind).toBe('match_created');
  });

  it('records ready, countdown, and live transitions as match events', () => {
    const match = localCarromMatchController.createMatch('bronze', 3);
    const ready = readyBothPlayers(match);
    const countdown = localCarromMatchController.startCountdown(ready);
    const live = localCarromMatchController.startMatch(countdown);

    expect(ready.players[0]?.ready).toBe(true);
    expect(ready.players[1]?.ready).toBe(true);
    expect(countdown.status).toBe('countdown');
    expect(live.status).toBe('live');
    expect(live.events.map((event) => event.kind)).toEqual([
      'match_created',
      'player_ready',
      'player_ready',
      'countdown_started',
      'match_started',
    ]);
  });

  it('creates replay-friendly shot input and result records', () => {
    const match = createLiveMatch('royal');
    const beforeState = createInitialCarromState();
    const input = localCarromMatchController.createShotInput({
      match,
      player: 1,
      striker: { x: 500, y: 678 },
      velocity: { vx: 12, vy: -8 },
    });
    const afterState = {
      ...beforeState,
      currentPlayer: 2 as const,
      message: 'انتهت الضربة',
      status: 'placing' as const,
    };
    const result = localCarromMatchController.createShotResult({
      input,
      beforeState,
      afterState,
    });
    const submitted = localCarromMatchController.recordShotSubmitted(match, input);
    const resolved = localCarromMatchController.recordShotResolved(submitted, result);

    expect(input.matchId).toBe(match.id);
    expect(input.roundId).toBe(match.roundId);
    expect(input.playerId).toBe('local-player-1');
    expect(submitted.pendingShot).toMatchObject({ inputId: input.id });
    expect(resolved.pendingShot).toBeUndefined();
    expect(result.beforeStateHash).toMatch(/^fnv1a-/);
    expect(result.afterStateHash).toMatch(/^fnv1a-/);
    expect(resolved.events.map((event) => event.kind)).toContain('shot_submitted');
    expect(resolved.events.map((event) => event.kind)).toContain('shot_resolved');
  });

  it('settles a match with a structured settlement preview', () => {
    const live = createLiveMatch('bronze');
    const beforeState = createInitialCarromState();
    const input = localCarromMatchController.createShotInput({
      match: live,
      player: 1,
      striker: { x: 500, y: 678 },
      velocity: { vx: 12, vy: -8 },
    });
    const result = localCarromMatchController.createShotResult({
      input,
      beforeState,
      afterState: {
        ...beforeState,
        message: 'فاز اللاعب 2',
        status: 'gameOver',
        winner: 2,
      },
    });
    const submitted = localCarromMatchController.recordShotSubmitted(live, input);
    const resolved = localCarromMatchController.recordShotResolved(submitted, result);
    const settled = localCarromMatchController.settleMatch(resolved, 2);

    expect(settled.status).toBe('settled');
    expect(settled.settlement).toMatchObject({
      winnerId: 'local-player-2',
      winner: 2,
      prizePool: 180,
      rake: 20,
      currency: 'token',
      isRealMoney: false,
    });
    expect(settled.events.at(-1)?.kind).toBe('match_settled');
  });

  it('rejects countdown until every player is ready', () => {
    const match = localCarromMatchController.createMatch('bronze', 3);
    const oneReady = localCarromMatchController.setReady(match, 'local-player-1', true);

    expect(() => localCarromMatchController.startCountdown(oneReady)).toThrow(
      CarromMatchCommandError,
    );
  });

  it('rejects illegal transition shortcuts', () => {
    const match = localCarromMatchController.createMatch('bronze', 3);

    expect(() => localCarromMatchController.startMatch(match)).toThrow(CarromMatchCommandError);
    expect(() => localCarromMatchController.settleMatch(match, 1)).toThrow(
      CarromMatchCommandError,
    );
  });

  it('rejects duplicate shots while one is pending', () => {
    const match = createLiveMatch('gold');
    const input = localCarromMatchController.createShotInput({
      match,
      player: 1,
      striker: { x: 500, y: 678 },
      velocity: { vx: 10, vy: -10 },
    });
    const submitted = localCarromMatchController.recordShotSubmitted(match, input);

    expect(() =>
      localCarromMatchController.createShotInput({
        match: submitted,
        player: 1,
        striker: { x: 500, y: 678 },
        velocity: { vx: 5, vy: -5 },
      }),
    ).toThrow(CarromMatchCommandError);
  });

  it('rejects shot results that do not match the pending shot', () => {
    const match = createLiveMatch('gold');
    const beforeState = createInitialCarromState();
    const input = localCarromMatchController.createShotInput({
      match,
      player: 1,
      striker: { x: 500, y: 678 },
      velocity: { vx: 10, vy: -10 },
    });
    const submitted = localCarromMatchController.recordShotSubmitted(match, input);
    const result = localCarromMatchController.createShotResult({
      input: { ...input, id: 'shot-tampered' },
      beforeState,
      afterState: { ...beforeState, currentPlayer: 2, status: 'placing' },
    });

    expect(() => localCarromMatchController.recordShotResolved(submitted, result)).toThrow(
      CarromMatchCommandError,
    );
  });

  it('requires a resolved winning shot before settlement', () => {
    const match = createLiveMatch('royal');

    expect(() => localCarromMatchController.settleMatch(match, 1)).toThrow(
      CarromMatchCommandError,
    );
  });

  it('returns event history copies instead of mutable session events', () => {
    const match = localCarromMatchController.createMatch('bronze', 3);
    const events = localCarromMatchController.getEvents(match);

    events.push({ ...events[0]!, id: 'mutated-event' });

    expect(match.events).toHaveLength(1);
  });
});

const readyBothPlayers = (match: ReturnType<typeof localCarromMatchController.createMatch>) => {
  const withLocalReady = localCarromMatchController.setReady(match, 'local-player-1', true);

  return localCarromMatchController.setReady(withLocalReady, 'local-player-2', true);
};

const createLiveMatch = (tableId: 'bronze' | 'gold' | 'royal') => {
  const ready = readyBothPlayers(localCarromMatchController.createMatch(tableId, 3));
  const countdown = localCarromMatchController.startCountdown(ready);

  return localCarromMatchController.startMatch(countdown);
};
