import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  LIVEKIT_SYNC_MAX_ATTEMPTS,
  ROOM_COMMAND_RATE_LIMIT,
  resolveSlidingWindowRateLimit,
} = require('./voiceRoomRateLimitCore');

describe('voiceRoomRateLimitCore', () => {
  it('allows traffic under the limit and blocks at the limit', () => {
    const nowMs = 1_000_000;
    let rate;
    for (let index = 0; index < ROOM_COMMAND_RATE_LIMIT; index += 1) {
      const result = resolveSlidingWindowRateLimit({
        limit: ROOM_COMMAND_RATE_LIMIT,
        nowMs,
        rate,
        windowMs: 60_000,
      });
      expect(result.ok).toBe(true);
      rate = {
        count: result.value.count,
        windowStartedAt: result.value.windowStartedAtMs,
      };
    }
    expect(resolveSlidingWindowRateLimit({
      limit: ROOM_COMMAND_RATE_LIMIT,
      nowMs: nowMs + 1_000,
      rate,
      windowMs: 60_000,
    })).toMatchObject({ ok: false, code: 'RATE_LIMITED', status: 429 });
  });

  it('resets after the window elapses', () => {
    const result = resolveSlidingWindowRateLimit({
      limit: 2,
      nowMs: 200_000,
      rate: { count: 2, windowStartedAt: 100_000 },
      windowMs: 60_000,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { count: 1, windowStartedAtMs: 200_000 },
    });
    expect(LIVEKIT_SYNC_MAX_ATTEMPTS).toBe(8);
  });

  it('uses a true rolling window instead of resetting every attempt at one boundary', () => {
    const first = resolveSlidingWindowRateLimit({
      limit: 3,
      nowMs: 60_000,
      rate: { attemptsMs: [1_000, 59_000] },
      windowMs: 60_000,
    });
    expect(first).toMatchObject({
      ok: true,
      value: { attemptsMs: [1_000, 59_000, 60_000], count: 3 },
    });

    const rolled = resolveSlidingWindowRateLimit({
      limit: 3,
      nowMs: 62_000,
      rate: first.value,
      windowMs: 60_000,
    });
    expect(rolled).toMatchObject({
      ok: true,
      value: { attemptsMs: [59_000, 60_000, 62_000], count: 3 },
    });
  });
});
