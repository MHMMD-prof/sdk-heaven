const crypto = require('node:crypto');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');

const DIRECT_CHAT_HTTP_RATE_LIMIT = 60;
const DIRECT_CHAT_HTTP_RATE_WINDOW_MS = 10_000;
const DIRECT_CHAT_HTTP_RATE_RECORD_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_HTTP_RATE_COLLECTION = 'directChatHttpRateLimits';

async function consumeDirectChatCommandHttpRateLimits({
  clock,
  db,
  fieldValue,
  headers = {},
  requestId,
  uid,
}) {
  if (!uid) {
    return rateError('INVALID_RATE_LIMIT_SCOPE', 400, 'A valid rate-limit scope is required.');
  }
  const uidLimit = await consumeDirectChatHttpRateLimit({
    clock,
    db,
    fieldValue,
    requestId,
    scope: `command_${uid}`,
    uid,
  });
  if (!uidLimit.ok) return uidLimit;

  const clientIp = readClientIp(headers);
  if (!clientIp) return uidLimit;

  const ipLimit = await consumeDirectChatHttpRateLimit({
    clock,
    db,
    fieldValue,
    requestId,
    scope: `command_ip_${hashClientIp(clientIp)}`,
    uid,
  });
  if (!ipLimit.ok) return ipLimit;
  return {
    ok: true,
    replayed: uidLimit.replayed === true || ipLimit.replayed === true,
  };
}

async function consumeDirectChatHttpRateLimit({
  clock,
  db,
  fieldValue,
  requestId,
  scope,
  uid,
}) {
  if (!scope || !uid) {
    return rateError('INVALID_RATE_LIMIT_SCOPE', 400, 'A valid rate-limit scope is required.');
  }
  const nowMs = clock.nowMillis();
  const rateRef = db.doc(`${DIRECT_CHAT_HTTP_RATE_COLLECTION}/${scope}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateRef);
    const existing = snapshot.exists ? snapshot.data() : undefined;
    const recentRequestIds = Array.isArray(existing?.recentRequestIds)
      ? existing.recentRequestIds.filter((value) => typeof value === 'string').slice(-20)
      : [];
    if (requestId && recentRequestIds.includes(requestId)) {
      return { ok: true, replayed: true };
    }
    const resolution = resolveSlidingWindowRateLimit({
      limit: DIRECT_CHAT_HTTP_RATE_LIMIT,
      nowMs,
      rate: existing,
      windowMs: DIRECT_CHAT_HTTP_RATE_WINDOW_MS,
    });
    if (!resolution.ok) return resolution;
    transaction.set(rateRef, {
      attemptsMs: resolution.value.attemptsMs,
      count: resolution.value.count,
      purgeAfter: clock.timestampFromMillis(nowMs + DIRECT_CHAT_HTTP_RATE_RECORD_RETENTION_MS),
      recentRequestIds: requestId ? [...recentRequestIds, requestId].slice(-20) : recentRequestIds,
      scope,
      uid,
      updatedAt: fieldValue.serverTimestamp(),
      windowStartedAt: clock.timestampFromMillis(resolution.value.windowStartedAtMs),
    }, { merge: true });
    return { ok: true, replayed: false };
  });
}

function readClientIp(headers = {}) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 128);
  }
  const realIp = headers['x-real-ip'] || headers['X-Real-Ip'];
  return typeof realIp === 'string' ? realIp.trim().slice(0, 128) : '';
}

function hashClientIp(ip) {
  return crypto.createHash('sha256').update(`direct-chat-ip-v1\u0000${ip}`).digest('hex').slice(0, 16);
}

function rateError(code, status, error) {
  return { code, error, ok: false, status };
}

module.exports = {
  DIRECT_CHAT_HTTP_RATE_COLLECTION,
  DIRECT_CHAT_HTTP_RATE_LIMIT,
  DIRECT_CHAT_HTTP_RATE_RECORD_RETENTION_MS,
  DIRECT_CHAT_HTTP_RATE_WINDOW_MS,
  consumeDirectChatCommandHttpRateLimits,
  consumeDirectChatHttpRateLimit,
  hashClientIp,
  readClientIp,
};
