import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DISTINCT_GIFTERS_FOR_VALID,
  MIN_DURATION_MS,
  applyPkGiftScore,
  clampPkDurationMs,
  createRoomPkSessionId,
  isPkSessionActive,
  mapRoomPkSession,
  normalizeRoomPkBody,
  resolvePkWinner,
  validateRoomPkRequest,
} = require('./roomPkCore');

const requestId = 'roompk_request_000001';
const roomId = 'room-pk-1';
const nowMs = 2_000_000_000_000;

describe('roomPkCore', () => {
  it('validates commands and requires a team for join', () => {
    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'get-room-pk-status',
      requestId,
      roomId,
    })).ok).toBe(true);

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'join-room-pk-team',
      requestId,
      roomId,
      team: 'green',
    })).error.code).toBe('INVALID_REQUEST');

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'join-room-pk-team',
      requestId,
      roomId,
      team: 'blue',
    })).ok).toBe(true);

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'start-room-pk',
      requestId: 'short',
      roomId,
    })).error.code).toBe('INVALID_REQUEST');
  });

  it('clamps duration between min and max with a default midpoint', () => {
    expect(clampPkDurationMs(undefined)).toBe(DEFAULT_DURATION_MS);
    expect(clampPkDurationMs(1_000)).toBe(MIN_DURATION_MS);
    expect(clampPkDurationMs(999_999_999)).toBe(MAX_DURATION_MS);
    expect(clampPkDurationMs(180_000)).toBe(180_000);

    const normalized = validateRoomPkRequest(normalizeRoomPkBody({
      action: 'start-room-pk',
      durationMs: 5_000,
      requestId,
      roomId,
    }));
    expect(normalized.ok).toBe(true);
    expect(normalized.value.durationMs).toBe(MIN_DURATION_MS);
  });

  it('resolves winners including anti-farm void when distinct gifters are unmet', () => {
    expect(resolvePkWinner({
      blueScore: 10,
      distinctGifters: ['u1'],
      minDistinct: MIN_DISTINCT_GIFTERS_FOR_VALID,
      redScore: 100,
    })).toEqual({
      reason: 'insufficient_distinct_gifters',
      winner: 'void',
    });

    expect(resolvePkWinner({
      blueScore: 40,
      distinctGifters: ['u1', 'u2'],
      redScore: 100,
    })).toEqual({
      reason: 'higher_score',
      winner: 'red',
    });

    expect(resolvePkWinner({
      blueScore: 50,
      distinctGifters: ['u1', 'u2'],
      redScore: 50,
    })).toEqual({
      reason: 'tied_score',
      winner: 'draw',
    });
  });

  it('applies gift scores idempotently and rejects duplicate event ids', () => {
    const session = mapRoomPkSession({
      distinctGifters: [],
      durationMs: DEFAULT_DURATION_MS,
      endsAtMs: nowMs + DEFAULT_DURATION_MS,
      giftEventIds: [],
      hostUid: 'host-1',
      mode: 'in-room-teams',
      pkId: createRoomPkSessionId(requestId, roomId),
      roomId,
      schemaVersion: 1,
      startedAtMs: nowMs,
      status: 'active',
      teams: {
        blue: { labelAr: 'الأزرق', memberUids: ['blue-1'], score: 0 },
        red: { labelAr: 'الأحمر', memberUids: ['red-1'], score: 0 },
      },
      winner: null,
      winnerReason: '',
    });

    expect(isPkSessionActive(session, nowMs)).toBe(true);

    const first = applyPkGiftScore({
      eventId: 'gift-event-1',
      nowMs,
      priceCoins: 25,
      session,
      team: 'red',
      uid: 'gifter-1',
    });
    expect(first).toMatchObject({
      duplicate: false,
      ok: true,
      session: {
        distinctGifters: ['gifter-1'],
        giftEventIds: ['gift-event-1'],
        teams: {
          red: { score: 25 },
        },
      },
    });

    const duplicate = applyPkGiftScore({
      eventId: 'gift-event-1',
      nowMs,
      priceCoins: 25,
      session: { ...session, ...first.session },
      team: 'red',
      uid: 'gifter-1',
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      ok: true,
      session: null,
    });
  });

  it('builds stable short session ids from request and room', () => {
    const first = createRoomPkSessionId(requestId, roomId);
    const second = createRoomPkSessionId(requestId, roomId);
    expect(first).toBe(second);
    expect(first.startsWith('rpk_')).toBe(true);
    expect(first.length).toBeLessThanOrEqual(28);
  });
});
