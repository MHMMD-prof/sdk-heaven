const {
  VOICE_ROOM_HTTP_RATE_LIMIT,
  VOICE_ROOM_HTTP_RATE_WINDOW_MS,
  VOICE_ROOM_RATE_RECORD_RETENTION_MS,
  resolveSlidingWindowRateLimit,
} = require('./voiceRoomRateLimitCore');

const HTTP_RATE_SURFACES = new Set(['room-attendance', 'room-command', 'room-gift']);
const HARDENING_COLLECTION_GROUPS = [
  'commandRequests',
  'commandRateLimits',
  'giftCommandRequests',
  'giftRateLimits',
  'giftQuotes',
];
const HARDENING_ROOT_COLLECTIONS = [
  'roomAttendanceEventReceipts',
  'roomAttendanceIntervals',
  'voiceRoomHttpRateLimits',
];

async function consumeVoiceRoomHttpRateLimit({
  clock,
  db,
  fieldValue,
  requestId,
  surface,
  uid,
}) {
  if (!HTTP_RATE_SURFACES.has(surface) || !uid) {
    return rateError('INVALID_RATE_LIMIT_SCOPE', 400, 'A valid rate-limit scope is required.');
  }
  const nowMs = clock.nowMillis();
  const rateRef = db.doc(`voiceRoomHttpRateLimits/${surface}_${uid}`);
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
      limit: VOICE_ROOM_HTTP_RATE_LIMIT,
      nowMs,
      rate: existing,
      windowMs: VOICE_ROOM_HTTP_RATE_WINDOW_MS,
    });
    if (!resolution.ok) return resolution;
    transaction.set(rateRef, {
      attemptsMs: resolution.value.attemptsMs,
      count: resolution.value.count,
      purgeAfter: clock.timestampFromMillis(nowMs + VOICE_ROOM_RATE_RECORD_RETENTION_MS),
      recentRequestIds: requestId ? [...recentRequestIds, requestId].slice(-20) : recentRequestIds,
      surface,
      uid,
      updatedAt: fieldValue.serverTimestamp(),
      windowStartedAt: clock.timestampFromMillis(resolution.value.windowStartedAtMs),
    }, { merge: true });
    return { ok: true, replayed: false };
  });
}

async function cleanupVoiceRoomHardeningArtifacts({
  clock,
  db,
  limit = 100,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  let deleted = 0;
  let scanned = 0;
  for (const collectionGroup of HARDENING_COLLECTION_GROUPS) {
    const snapshot = await db.collectionGroup(collectionGroup)
      .where('purgeAfter', '<=', now)
      .limit(limit)
      .get();
    scanned += snapshot.size;
    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
  }
  for (const collectionName of HARDENING_ROOT_COLLECTIONS) {
    const snapshot = await db.collection(collectionName)
      .where('purgeAfter', '<=', now)
      .limit(limit)
      .get();
    scanned += snapshot.size;
    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
  }
  return { deleted, scanned };
}

function rateError(code, status, error) {
  return { code, error, ok: false, status };
}

module.exports = {
  cleanupVoiceRoomHardeningArtifacts,
  consumeVoiceRoomHttpRateLimit,
};
