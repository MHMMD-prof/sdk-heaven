'use strict';

const CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION = 1;
const CROSS_ROOM_PK_SESSION_SCHEMA_VERSION = 2;
const CROSS_ROOM_PK_SCORE_SHARD_SCHEMA_VERSION = 1;
const CROSS_ROOM_PK_RECONCILIATION_SCHEMA_VERSION = 1;
const CROSS_ROOM_PK_SCORE_SHARD_COUNT = 16;

const CROSS_ROOM_PK_ACTIONS = deepFreeze([
  'list-cross-room-pk-opponents',
  'challenge-cross-room-pk',
  'get-room-pk-challenge-status',
  'accept-cross-room-pk',
  'decline-cross-room-pk',
  'cancel-cross-room-pk',
  'surrender-cross-room-pk',
]);


const CROSS_ROOM_PK_CHALLENGE_STATUSES = deepFreeze([
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);

const CROSS_ROOM_PK_SESSION_STATUSES = deepFreeze([
  'active',
  'settling',
  'ended',
  'forfeited',
  'void',
]);

const CROSS_ROOM_PK_WINNERS = deepFreeze(['red', 'blue', 'draw', 'void']);

const CROSS_ROOM_PK_TIMING_MS = deepFreeze({
  challengeTtl: 60_000,
  cleanupCadence: 60_000,
  cooldown: 2 * 60_000,
  defaultDuration: 3 * 60_000,
  ingestionGrace: 15_000,
  maxDuration: 10 * 60_000,
  minDuration: 60_000,
  reconciliationLease: 60_000,
  recentResultPointer: 2 * 60_000,
  repeatOpponentCooldown: 10 * 60_000,
});

const CROSS_ROOM_PK_RETENTION_MS = deepFreeze({
  challenge: 7 * 24 * 60 * 60_000,
  command: 24 * 60 * 60_000,
  giftFact: 7 * 24 * 60 * 60_000,
  gifterMarker: 7 * 24 * 60 * 60_000,
  reconciliation: 7 * 24 * 60 * 60_000,
  scoreShard: 7 * 24 * 60 * 60_000,
  session: 7 * 24 * 60 * 60_000,
});

const CROSS_ROOM_PK_LIMITS = deepFreeze({
  maxOpponentResults: 20,
  maxReconciliationEventsPerRoom: 50_000,
  outgoingChallengesPerRoom: 5,
  outgoingChallengesWindowMs: 10 * 60_000,
  reconciliationPageSize: 100,
});

const CROSS_ROOM_PK_ERROR_CONTRACT = deepFreeze({
  INVALID_REQUEST: errorContract(400, 'Invalid cross-room PK request.', 'بيانات طلب التحدي غير صالحة.'),
  FEATURE_DISABLED: errorContract(503, 'Cross-room PK is unavailable.', 'تحدي الغرف غير متاح حالياً.'),
  ROOM_NOT_ACTIVE: errorContract(409, 'One of the rooms is not active.', 'إحدى الغرف لم تعد نشطة.'),
  ROOM_NOT_ELIGIBLE: errorContract(409, 'One of the rooms is not eligible.', 'لا يمكن بدء التحدي بين هاتين الغرفتين الآن.'),
  SAME_ROOM_FORBIDDEN: errorContract(400, 'A room cannot challenge itself.', 'لا يمكنك تحدي غرفتك نفسها.'),
  MEMBERSHIP_REQUIRED: errorContract(403, 'Active room membership is required.', 'يجب أن تكون عضواً نشطاً في الغرفة.'),
  FORBIDDEN: errorContract(403, 'Current owner or host authority is required.', 'هذا الإجراء متاح لمالك الغرفة أو مضيفها فقط.'),
  BLOCKED_RELATIONSHIP: errorContract(403, 'The current room authorities cannot interact.', 'لا يمكن إنشاء تحدٍ بين هاتين الغرفتين.'),
  CHALLENGE_NOT_FOUND: errorContract(404, 'The challenge was not found.', 'لم يعد هذا التحدي متاحاً.'),
  CHALLENGE_NOT_PENDING: errorContract(409, 'The challenge is no longer pending.', 'تم الرد على هذا التحدي بالفعل.'),
  CHALLENGE_EXPIRED: errorContract(409, 'The challenge has expired.', 'انتهت مهلة قبول التحدي.'),
  ROOM_ALREADY_RESERVED: errorContract(409, 'One of the rooms has another pending challenge.', 'إحدى الغرف مرتبطة بتحدٍ آخر حالياً.'),
  SESSION_ALREADY_ACTIVE: errorContract(409, 'One of the rooms already has an active PK.', 'إحدى الغرف تشارك في تحدٍ مباشر حالياً.'),
  COOLDOWN_ACTIVE: errorContract(409, 'One of the rooms is in PK cooldown.', 'يجب الانتظار قليلاً قبل بدء تحدٍ جديد.'),
  SESSION_NOT_ACTIVE: errorContract(409, 'The PK session is not active.', 'انتهى هذا التحدي أو لم يعد نشطاً.'),
  REQUEST_ID_CONFLICT: errorContract(409, 'The request ID was reused with different input.', 'تعذر إعادة الطلب لأن بياناته تغيّرت.'),
  RATE_LIMITED: errorContract(429, 'The cross-room PK rate limit was exceeded.', 'تم تجاوز حد المحاولات. حاول لاحقاً.'),
});

const CROSS_ROOM_PK_COPY_AR = deepFreeze({
  actionAccept: 'قبول التحدي',
  actionCancel: 'إلغاء التحدي',
  actionChallenge: 'تحدي غرفة أخرى',
  actionDecline: 'رفض',
  actionSurrender: 'انسحاب',
  challengeCancelled: 'تم إلغاء التحدي.',
  challengeDeclined: 'رفضت الغرفة الأخرى التحدي.',
  challengeExpired: 'انتهت مهلة التحدي.',
  incomingChallengeTitle: 'تحدٍ جديد بين الغرف',
  resultDraw: 'انتهى التحدي بالتعادل.',
  resultForfeitLoss: 'خسرت غرفتك بالانسحاب.',
  resultForfeitWin: 'فازت غرفتك بالانسحاب.',
  resultLoss: 'فازت الغرفة المنافسة.',
  resultVoid: 'لم تُحتسب نتيجة التحدي.',
  resultWin: 'فازت غرفتك!',
  scoreLabel: 'النقاط',
  settling: 'جارٍ اعتماد النتيجة…',
  surrenderConfirmation: 'سيُحتسب الانسحاب فوزاً للغرفة المنافسة. هل تريد المتابعة؟',
  waitingForOpponent: 'بانتظار رد الغرفة الأخرى…',
  yourRoom: 'غرفتك',
});

const CROSS_ROOM_PK_TELEMETRY_KEYS = deepFreeze({
  candidateSearch: 'cross_room_pk_candidate_search',
  challengeAccepted: 'cross_room_pk_challenge_accepted',
  challengeCancelled: 'cross_room_pk_challenge_cancelled',
  challengeCreated: 'cross_room_pk_challenge_created',
  challengeDeclined: 'cross_room_pk_challenge_declined',
  challengeExpired: 'cross_room_pk_challenge_expired',
  commandDenied: 'cross_room_pk_command_denied',
  finalizerLatencyMs: 'cross_room_pk_finalizer_latency_ms',
  giftDuplicateIgnored: 'cross_room_pk_gift_duplicate_ignored',
  giftGmvCoins: 'cross_room_pk_gift_gmv_coins',
  giftScored: 'cross_room_pk_gift_scored',
  projectionDelayMs: 'cross_room_pk_projection_delay_ms',
  pushDelivered: 'cross_room_pk_push_delivered',
  pushFailed: 'cross_room_pk_push_failed',
  pushOpened: 'cross_room_pk_push_opened',
  pushQueued: 'cross_room_pk_push_queued',
  reconciliationDriftCoins: 'cross_room_pk_reconciliation_drift_coins',
  reconciliationDriftCount: 'cross_room_pk_reconciliation_drift_count',
  sessionCompleted: 'cross_room_pk_session_completed',
  sessionForfeited: 'cross_room_pk_session_forfeited',
  sessionStarted: 'cross_room_pk_session_started',
  sessionVoided: 'cross_room_pk_session_voided',
  settlingStuck: 'cross_room_pk_settling_stuck',
});

const CROSS_ROOM_PK_TELEMETRY_DIMENSIONS = deepFreeze([
  'appVersion',
  'challengeStatus',
  'countryPair',
  'denialCode',
  'endReason',
  'platform',
  'rolloutStage',
  'sessionStatus',
  'winner',
]);

const CROSS_ROOM_PK_ROLLBACK_CONTRACT = deepFreeze({
  crossRoomPkOff: {
    activeCrossRoom: 'settling',
    activeInRoom: 'preserve',
    pendingCrossRoom: 'cancelled',
    reason: 'feature_flag_off',
  },
  roomPkOff: {
    activeCrossRoom: 'settling',
    activeInRoom: 'terminate',
    pendingCrossRoom: 'cancelled',
    reason: 'room_pk_flag_off',
  },
});

function getCrossRoomPkErrorContract(code) {
  return CROSS_ROOM_PK_ERROR_CONTRACT[code] || CROSS_ROOM_PK_ERROR_CONTRACT.INVALID_REQUEST;
}

function canTransitionCrossRoomPkChallenge(from, to) {
  if (!CROSS_ROOM_PK_CHALLENGE_STATUSES.includes(from)
    || !CROSS_ROOM_PK_CHALLENGE_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return from === 'pending' && ['accepted', 'declined', 'cancelled', 'expired'].includes(to);
}

function canTransitionCrossRoomPkSession(from, to) {
  if (!CROSS_ROOM_PK_SESSION_STATUSES.includes(from)
    || !CROSS_ROOM_PK_SESSION_STATUSES.includes(to)) return false;
  if (from === to) return true;
  if (from === 'active') return ['settling', 'forfeited', 'void'].includes(to);
  if (from === 'settling') return ['ended', 'forfeited', 'void'].includes(to);
  return false;
}

function resolveCrossRoomPkTermination({ blueInvalid = false, reason = '', redInvalid = false } = {}) {
  if (redInvalid && blueInvalid) {
    return { endReason: reason || 'both_rooms_invalid', status: 'void', winner: 'void', winnerReason: 'both_rooms_invalid' };
  }
  if (redInvalid) {
    return { endReason: reason || 'red_forfeit', status: 'forfeited', winner: 'blue', winnerReason: 'red_forfeit' };
  }
  if (blueInvalid) {
    return { endReason: reason || 'blue_forfeit', status: 'forfeited', winner: 'red', winnerReason: 'blue_forfeit' };
  }
  return { endReason: reason || 'feature_flag_off', status: 'settling', winner: null, winnerReason: '' };
}

function mapCrossRoomPkChallenge(data) {
  if (!isRecord(data)
    || data.schemaVersion !== CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION
    || data.mode !== 'cross-room'
    || !CROSS_ROOM_PK_CHALLENGE_STATUSES.includes(data.status)) return null;

  const challengeId = cleanId(data.challengeId);
  const challengerRoomId = cleanId(data.challengerRoomId);
  const opponentRoomId = cleanId(data.opponentRoomId);
  const challengerAuthorityUid = cleanId(data.challengerAuthorityUid);
  const requestId = cleanId(data.requestId);
  const durationMs = Number(data.durationMs);
  const createdAtMs = timestampToMillis(data.createdAt) || Number(data.createdAtMs) || 0;
  const expiresAtMs = timestampToMillis(data.expiresAt) || Number(data.expiresAtMs) || 0;
  const purgeAfterMs = timestampToMillis(data.purgeAfter) || Number(data.purgeAfterMs) || 0;
  const challengerRoomSnapshot = mapRoomSnapshot(data.challengerRoomSnapshot);
  const opponentRoomSnapshot = mapRoomSnapshot(data.opponentRoomSnapshot);

  if (!challengeId || !challengerRoomId || !opponentRoomId || challengerRoomId === opponentRoomId
    || !challengerAuthorityUid || !requestId
    || !Number.isInteger(durationMs)
    || durationMs < CROSS_ROOM_PK_TIMING_MS.minDuration
    || durationMs > CROSS_ROOM_PK_TIMING_MS.maxDuration
    || !createdAtMs
    || expiresAtMs - createdAtMs !== CROSS_ROOM_PK_TIMING_MS.challengeTtl
    || purgeAfterMs <= expiresAtMs
    || !challengerRoomSnapshot
    || !opponentRoomSnapshot
    || challengerRoomSnapshot.roomId !== challengerRoomId
    || opponentRoomSnapshot.roomId !== opponentRoomId) return null;

  const acceptedByUid = cleanId(data.acceptedByUid);
  const sessionId = cleanId(data.sessionId);
  if (data.status === 'accepted' && (!acceptedByUid || !sessionId)) return null;
  if (data.status === 'pending' && (acceptedByUid || sessionId)) return null;

  return {
    acceptedByUid,
    challengeId,
    challengerAuthorityUid,
    challengerRoomId,
    challengerRoomSnapshot,
    createdAt: data.createdAt || null,
    createdAtMs,
    durationMs,
    expiresAt: data.expiresAt || null,
    expiresAtMs,
    mode: 'cross-room',
    opponentRoomId,
    opponentRoomSnapshot,
    purgeAfter: data.purgeAfter || null,
    purgeAfterMs,
    requestId,
    resolutionReason: cleanText(data.resolutionReason, 80),
    resolvedAt: data.resolvedAt || null,
    resolvedAtMs: timestampToMillis(data.resolvedAt) || Number(data.resolvedAtMs) || 0,
    schemaVersion: CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION,
    sessionId,
    status: data.status,
  };
}

function mapCrossRoomPkSession(data) {
  if (!isRecord(data)
    || data.schemaVersion !== CROSS_ROOM_PK_SESSION_SCHEMA_VERSION
    || data.mode !== 'cross-room'
    || !CROSS_ROOM_PK_SESSION_STATUSES.includes(data.status)
    || hasUnboundedV1Arrays(data)) return null;

  const pkId = cleanId(data.pkId);
  const redRoomId = cleanId(data.redRoomId);
  const blueRoomId = cleanId(data.blueRoomId);
  const createdByUid = cleanId(data.createdByUid);
  const acceptedByUid = cleanId(data.acceptedByUid);
  const challengeId = cleanId(data.challengeId);
  const roomIds = Array.isArray(data.roomIds) ? data.roomIds.map(cleanId) : [];
  const durationMs = Number(data.durationMs);
  const startedAtMs = timestampToMillis(data.startedAt) || Number(data.startedAtMs) || 0;
  const endsAtMs = timestampToMillis(data.endsAt) || Number(data.endsAtMs) || 0;
  const scoringEndsAtMs = timestampToMillis(data.scoringEndsAt)
    || Number(data.scoringEndsAtMs) || endsAtMs;
  const settleAfterMs = timestampToMillis(data.settleAfter) || Number(data.settleAfterMs) || 0;
  const scoreShardCount = Number(data.scoreShardCount);
  const red = mapCrossRoomPkSide(data.teams?.red, redRoomId);
  const blue = mapCrossRoomPkSide(data.teams?.blue, blueRoomId);
  const winner = data.winner == null ? null : data.winner;
  const purgeAfterMs = timestampToMillis(data.purgeAfter) || Number(data.purgeAfterMs) || 0;

  if (!pkId || !redRoomId || !blueRoomId || redRoomId === blueRoomId
    || cleanId(data.roomId) !== redRoomId
    || roomIds.length !== 2 || roomIds[0] !== redRoomId || roomIds[1] !== blueRoomId
    || !createdByUid || !acceptedByUid || !challengeId
    || !Number.isInteger(durationMs)
    || durationMs < CROSS_ROOM_PK_TIMING_MS.minDuration
    || durationMs > CROSS_ROOM_PK_TIMING_MS.maxDuration
    || !startedAtMs || endsAtMs - startedAtMs !== durationMs
    || scoringEndsAtMs < startedAtMs || scoringEndsAtMs > endsAtMs
    || (data.status === 'active' && scoringEndsAtMs !== endsAtMs)
    || settleAfterMs - scoringEndsAtMs !== CROSS_ROOM_PK_TIMING_MS.ingestionGrace
    || purgeAfterMs <= settleAfterMs
    || scoreShardCount !== CROSS_ROOM_PK_SCORE_SHARD_COUNT
    || !red || !blue
    || (['active', 'settling'].includes(data.status)
      && (red.score !== 0 || blue.score !== 0
        || red.distinctGifterCount !== 0 || blue.distinctGifterCount !== 0))
    || !validWinnerForStatus(data.status, winner)) return null;

  const distinctGifterCount = Number(data.distinctGifterCount);
  if (!isNonNegativeSafeInteger(distinctGifterCount)
    || distinctGifterCount !== red.distinctGifterCount + blue.distinctGifterCount) return null;

  return {
    acceptedByUid,
    blueRoomId,
    challengeId,
    createdByUid,
    distinctGifterCount,
    durationMs,
    endedAt: data.endedAt || null,
    endedAtMs: timestampToMillis(data.endedAt) || Number(data.endedAtMs) || 0,
    endedBy: cleanId(data.endedBy),
    endReason: cleanText(data.endReason, 80),
    endsAt: data.endsAt || null,
    endsAtMs,
    mode: 'cross-room',
    forfeitSide: ['red', 'blue', 'both'].includes(data.forfeitSide) ? data.forfeitSide : '',
    pkId,
    purgeAfter: data.purgeAfter || null,
    purgeAfterMs,
    redRoomId,
    roomId: redRoomId,
    roomIds: [redRoomId, blueRoomId],
    schemaVersion: CROSS_ROOM_PK_SESSION_SCHEMA_VERSION,
    scoreShardCount,
    scoringEndsAt: data.scoringEndsAt || data.endsAt || null,
    scoringEndsAtMs,
    scoreVerifiedAt: data.scoreVerifiedAt || null,
    scoreVerifiedAtMs: timestampToMillis(data.scoreVerifiedAt) || Number(data.scoreVerifiedAtMs) || 0,
    settleAfter: data.settleAfter || null,
    settleAfterMs,
    startedAt: data.startedAt || null,
    startedAtMs,
    status: data.status,
    teams: { blue, red },
    winner,
    winnerReason: cleanText(data.winnerReason, 80),
  };
}

function classifyRoomPkSession(data) {
  if (!isRecord(data)) return 'invalid';
  if (data.schemaVersion === 1 && data.mode !== 'cross-room') return 'in-room-v1';
  if (data.schemaVersion === CROSS_ROOM_PK_SESSION_SCHEMA_VERSION && data.mode === 'cross-room') {
    return mapCrossRoomPkSession(data) ? 'cross-room-v2' : 'invalid';
  }
  return 'invalid';
}

function mapCrossRoomPkSide(value, expectedRoomId) {
  if (!isRecord(value) || !expectedRoomId || Array.isArray(value.memberUids)) return null;
  const roomId = cleanId(value.roomId);
  const roomTitle = cleanText(value.roomTitle, 120);
  const roomImageUrl = cleanText(value.roomImageUrl, 2_048);
  const authorityUid = cleanId(value.authorityUid);
  const score = Number(value.score);
  const distinctGifterCount = Number(value.distinctGifterCount);
  if (roomId !== expectedRoomId || !roomTitle || !authorityUid
    || !isNonNegativeSafeInteger(score)
    || !isNonNegativeSafeInteger(distinctGifterCount)) return null;
  return {
    authorityUid,
    distinctGifterCount,
    roomId,
    roomImageUrl,
    roomTitle,
    score,
  };
}

function mapRoomSnapshot(value) {
  if (!isRecord(value)) return null;
  const roomId = cleanId(value.roomId);
  const roomTitle = cleanText(value.roomTitle, 120);
  const roomImageUrl = cleanText(value.roomImageUrl, 2_048);
  const authorityDisplayName = cleanText(value.authorityDisplayName, 80);
  if (!roomId || !roomTitle || !authorityDisplayName) return null;
  return { authorityDisplayName, roomId, roomImageUrl, roomTitle };
}

function validWinnerForStatus(status, winner) {
  if (status === 'active' || status === 'settling') return winner === null;
  if (status === 'ended') return ['red', 'blue', 'draw'].includes(winner);
  if (status === 'forfeited') return winner === 'red' || winner === 'blue';
  return status === 'void' && winner === 'void';
}

function hasUnboundedV1Arrays(data) {
  if (Array.isArray(data.distinctGifters) || Array.isArray(data.giftEventIds)) return true;
  return Array.isArray(data.teams?.red?.memberUids) || Array.isArray(data.teams?.blue?.memberUids);
}

function errorContract(status, message, messageAr) {
  return { message, messageAr, status };
}

function cleanId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 128 && !trimmed.includes('/') ? trimmed : '';
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

module.exports = {
  CROSS_ROOM_PK_ACTIONS,
  CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION,
  CROSS_ROOM_PK_CHALLENGE_STATUSES,
  CROSS_ROOM_PK_COPY_AR,
  CROSS_ROOM_PK_ERROR_CONTRACT,
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RECONCILIATION_SCHEMA_VERSION,
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_ROLLBACK_CONTRACT,
  CROSS_ROOM_PK_SCORE_SHARD_COUNT,
  CROSS_ROOM_PK_SCORE_SHARD_SCHEMA_VERSION,
  CROSS_ROOM_PK_SESSION_SCHEMA_VERSION,
  CROSS_ROOM_PK_SESSION_STATUSES,
  CROSS_ROOM_PK_TELEMETRY_DIMENSIONS,
  CROSS_ROOM_PK_TELEMETRY_KEYS,
  CROSS_ROOM_PK_TIMING_MS,
  CROSS_ROOM_PK_WINNERS,
  canTransitionCrossRoomPkChallenge,
  canTransitionCrossRoomPkSession,
  classifyRoomPkSession,
  getCrossRoomPkErrorContract,
  mapCrossRoomPkChallenge,
  mapCrossRoomPkSession,
  resolveCrossRoomPkTermination,
};
