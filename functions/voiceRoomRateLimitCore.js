/**
 * Shared sliding-window rate limit for voice-room HTTP commands.
 * Window resets when elapsed; count increments within the same window.
 */

function resolveSlidingWindowRateLimit({
  countField = 'count',
  limit,
  nowMs,
  rate,
  windowField = 'windowStartedAt',
  windowMs,
}) {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const recordedAttempts = Array.isArray(rate?.attemptsMs)
    ? rate.attemptsMs
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > safeNow - windowMs && value <= safeNow)
      .sort((left, right) => left - right)
    : [];
  const windowStartedAtMs = timestampToMillis(rate?.[windowField]);
  const sameLegacyWindow = (
    recordedAttempts.length === 0
    && windowStartedAtMs !== undefined
    && safeNow - windowStartedAtMs < windowMs
  );
  const legacyCount = sameLegacyWindow ? Math.max(0, Number(rate?.[countField] || 0)) : 0;
  const attemptsMs = recordedAttempts.length > 0
    ? recordedAttempts
    : Array.from({ length: Math.min(legacyCount, limit) }, () => windowStartedAtMs);
  if (attemptsMs.length >= limit) {
    const oldestAttemptMs = attemptsMs[0] ?? safeNow;
    return {
      ok: false,
      code: 'RATE_LIMITED',
      status: 429,
      error: 'Too many requests were sent for this action.',
      details: {
        retryAfterMs: Math.max(1, (oldestAttemptMs + windowMs) - safeNow),
      },
    };
  }
  const nextAttemptsMs = [...attemptsMs, safeNow];
  return {
    ok: true,
    value: {
      attemptsMs: nextAttemptsMs,
      [countField]: nextAttemptsMs.length,
      [`${windowField}Ms`]: nextAttemptsMs[0],
    },
  };
}

function timestampToMillis(value) {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return undefined;
}

const ROOM_COMMAND_RATE_LIMIT = 40;
const ROOM_COMMAND_RATE_WINDOW_MS = 60_000;
const ROOM_GIFT_RATE_LIMIT = 20;
const ROOM_GIFT_RATE_WINDOW_MS = 60_000;
const ROOM_ENTRY_EFFECT_RATE_LIMIT = 12;
const ROOM_ENTRY_EFFECT_RATE_WINDOW_MS = 60_000;
const ROOM_GAME_RATE_LIMIT = 30;
const ROOM_GAME_RATE_WINDOW_MS = 60_000;
const ROOM_MUSIC_RATE_LIMIT = 30;
const ROOM_MUSIC_RATE_WINDOW_MS = 60_000;
const LIVEKIT_SYNC_MAX_ATTEMPTS = 8;
const VOICE_ROOM_COMMAND_RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const VOICE_ROOM_HTTP_RATE_LIMIT = 60;
const VOICE_ROOM_HTTP_RATE_WINDOW_MS = 60_000;
const VOICE_ROOM_RATE_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;

module.exports = {
  LIVEKIT_SYNC_MAX_ATTEMPTS,
  ROOM_COMMAND_RATE_LIMIT,
  ROOM_COMMAND_RATE_WINDOW_MS,
  ROOM_ENTRY_EFFECT_RATE_LIMIT,
  ROOM_ENTRY_EFFECT_RATE_WINDOW_MS,
  ROOM_GAME_RATE_LIMIT,
  ROOM_GAME_RATE_WINDOW_MS,
  ROOM_MUSIC_RATE_LIMIT,
  ROOM_MUSIC_RATE_WINDOW_MS,
  VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
  VOICE_ROOM_HTTP_RATE_LIMIT,
  VOICE_ROOM_HTTP_RATE_WINDOW_MS,
  VOICE_ROOM_RATE_RECORD_RETENTION_MS,
  ROOM_GIFT_RATE_LIMIT,
  ROOM_GIFT_RATE_WINDOW_MS,
  resolveSlidingWindowRateLimit,
  timestampToMillis,
};
