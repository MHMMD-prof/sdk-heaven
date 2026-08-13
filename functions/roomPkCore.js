'use strict';

const { createHash } = require('node:crypto');
const {
  CROSS_ROOM_PK_ACTIONS,
  CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION,
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_SCORE_SHARD_COUNT,
  CROSS_ROOM_PK_SCORE_SHARD_SCHEMA_VERSION,
  CROSS_ROOM_PK_SESSION_SCHEMA_VERSION,
  CROSS_ROOM_PK_TIMING_MS,
  mapCrossRoomPkChallenge,
  mapCrossRoomPkSession,
} = require('./crossRoomPkContract');

const ROOM_PK_ACTIONS = Object.freeze([
  'get-room-pk-status',
  'start-room-pk',
  'join-room-pk-team',
  'end-room-pk',
  ...CROSS_ROOM_PK_ACTIONS,
]);

const ROOM_PK_TEAMS = Object.freeze(['red', 'blue']);
const ROOM_PK_MODES = Object.freeze(['in-room-teams', 'cross-room']);

const DEFAULT_DURATION_MS = 3 * 60 * 1000;
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 1000;
const MAX_CONCURRENT_PER_ROOM = 1;
const MIN_DISTINCT_GIFTERS_FOR_VALID = 2;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const PK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const CLIENT_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,24})?$/;

const PK_COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const PK_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const TEAM_LABELS_AR = Object.freeze({
  blue: 'الأزرق',
  red: 'الأحمر',
});

const ROOM_PK_RATE_LIMIT = 20;
const ROOM_PK_RATE_WINDOW_MS = 60_000;

function normalizeRoomPkBody(body = {}) {
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const durationRaw = Number(body.durationMs);
  return {
    action,
    challengeId: typeof body.challengeId === 'string' ? body.challengeId.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    cursor: typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 128) : '',
    durationMs: Number.isFinite(durationRaw) ? durationRaw : DEFAULT_DURATION_MS,
    mode: typeof body.mode === 'string'
      ? body.mode.trim()
      : (CROSS_ROOM_PK_ACTIONS.includes(action) ? 'cross-room' : 'in-room-teams'),
    opponentRoomId: typeof body.opponentRoomId === 'string' ? body.opponentRoomId.trim() : '',
    pkId: typeof body.pkId === 'string' ? body.pkId.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    team: typeof body.team === 'string' ? body.team.trim().toLowerCase() : '',
  };
}

function clampPkDurationMs(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MS;
  if (value < MIN_DURATION_MS) return MIN_DURATION_MS;
  if (value > MAX_DURATION_MS) return MAX_DURATION_MS;
  return Math.floor(value);
}

function validateRoomPkRequest(command) {
  if (
    !ROOM_PK_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
  ) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid room PK command is required.');
  }
  if (!REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (command.mode && !ROOM_PK_MODES.includes(command.mode)) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid PK mode is required.');
  }
  if (command.action === 'join-room-pk-team' && !ROOM_PK_TEAMS.includes(command.team)) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid PK team (red or blue) is required.');
  }
  if (command.pkId && !PK_ID_PATTERN.test(command.pkId)) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid PK session ID is required.');
  }
  if (isCrossRoomRequest(command)) {
    if (!CLIENT_VERSION_PATTERN.test(command.clientVersion)) {
      return roomPkError('INVALID_REQUEST', 400, 'A supported client version is required.');
    }
    if (command.mode !== 'cross-room') {
      return roomPkError('INVALID_REQUEST', 400, 'A cross-room PK command requires cross-room mode.');
    }
    if (
      command.opponentRoomId
      && (!FIRESTORE_ID_PATTERN.test(command.opponentRoomId) || command.opponentRoomId === command.roomId)
    ) {
      return roomPkError(
        command.opponentRoomId === command.roomId ? 'SAME_ROOM_FORBIDDEN' : 'INVALID_REQUEST',
        400,
        'A valid distinct opponent room is required.',
      );
    }
    if (command.action === 'challenge-cross-room-pk' && !command.opponentRoomId) {
      return roomPkError('INVALID_REQUEST', 400, 'An opponent room is required.');
    }
    if (
      ['accept-cross-room-pk', 'decline-cross-room-pk', 'cancel-cross-room-pk'].includes(command.action)
      && !PK_ID_PATTERN.test(command.challengeId)
    ) {
      return roomPkError('INVALID_REQUEST', 400, 'A valid challenge ID is required.');
    }
    if (command.action === 'get-room-pk-challenge-status'
      && command.challengeId && !PK_ID_PATTERN.test(command.challengeId)) {
      return roomPkError('INVALID_REQUEST', 400, 'A valid challenge ID is required.');
    }
    if (command.action === 'surrender-cross-room-pk' && !PK_ID_PATTERN.test(command.pkId)) {
      return roomPkError('INVALID_REQUEST', 400, 'A valid cross-room session ID is required.');
    }
  }
  return { ok: true, value: { ...command, durationMs: clampPkDurationMs(command.durationMs) } };
}

function createRoomPkSessionId(requestId, roomId) {
  return `rpk_${createHash('sha256').update(`${roomId}|${requestId}`).digest('hex').slice(0, 24)}`;
}

function createCrossRoomPkChallengeId(requestId, challengerRoomId, opponentRoomId) {
  return `crpkc_${createHash('sha256')
    .update(`${challengerRoomId}|${opponentRoomId}|${requestId}`)
    .digest('hex').slice(0, 24)}`;
}

function createCrossRoomPkSessionId(challengeId) {
  return `crpks_${createHash('sha256').update(`session|${challengeId}`).digest('hex').slice(0, 24)}`;
}

function buildRoomPkFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.roomId,
      command.challengeId || '',
      command.clientVersion || '',
      command.cursor || '',
      command.team || '',
      command.pkId || '',
      command.mode || '',
      command.opponentRoomId || '',
      String(command.durationMs || 0),
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function buildEmptyTeam(labelAr) {
  return {
    labelAr,
    memberUids: [],
    score: 0,
  };
}

function mapRoomPkSession(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.schemaVersion === CROSS_ROOM_PK_SESSION_SCHEMA_VERSION || data.mode === 'cross-room') {
    return mapCrossRoomPkSession(data);
  }
  const teams = data.teams && typeof data.teams === 'object' ? data.teams : {};
  const mapTeam = (side) => {
    const team = teams[side] && typeof teams[side] === 'object' ? teams[side] : {};
    return {
      labelAr: typeof team.labelAr === 'string' ? team.labelAr : TEAM_LABELS_AR[side],
      memberUids: Array.isArray(team.memberUids)
        ? team.memberUids.filter((uid) => typeof uid === 'string')
        : [],
      score: Number.isFinite(Number(team.score)) ? Number(team.score) : 0,
    };
  };
  return {
    createdAt: data.createdAt || null,
    distinctGifters: Array.isArray(data.distinctGifters)
      ? data.distinctGifters.filter((uid) => typeof uid === 'string')
      : [],
    durationMs: Number(data.durationMs) || DEFAULT_DURATION_MS,
    endsAtMs: timestampToMillis(data.endsAt) || Number(data.endsAtMs) || 0,
    giftEventIds: Array.isArray(data.giftEventIds)
      ? data.giftEventIds.filter((id) => typeof id === 'string')
      : [],
    hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
    mode: data.mode === 'cross-room' ? 'cross-room' : 'in-room-teams',
    pkId: typeof data.pkId === 'string' ? data.pkId : '',
    purgeAfter: data.purgeAfter || null,
    roomId: typeof data.roomId === 'string' ? data.roomId : '',
    schemaVersion: Number(data.schemaVersion) || 1,
    startedAtMs: timestampToMillis(data.startedAt) || Number(data.startedAtMs) || 0,
    status: typeof data.status === 'string' ? data.status : 'void',
    teams: {
      blue: mapTeam('blue'),
      red: mapTeam('red'),
    },
    updatedAt: data.updatedAt || null,
    winner: data.winner == null ? null : data.winner,
    winnerReason: typeof data.winnerReason === 'string' ? data.winnerReason : '',
  };
}

function mapCrossRoomPkRolloutPolicy(data = {}) {
  const allowedStages = ['dark', 'internal', 'closed-beta', 'country-cohort', 'public'];
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || data.schemaVersion !== 1 || !allowedStages.includes(data.stage)) {
    return {
      allowedAuthorityUids: [],
      allowedRoomIds: [],
      countryCodes: [],
      percentageBasisPoints: 0,
      schemaVersion: 1,
      stage: 'dark',
    };
  }
  const boundedIds = (value) => Array.isArray(value)
    ? [...new Set(value.filter((entry) => FIRESTORE_ID_PATTERN.test(String(entry))))].slice(0, 200)
    : [];
  const countryCodes = Array.isArray(data.countryCodes)
    ? [...new Set(data.countryCodes
      .map((entry) => typeof entry === 'string' ? entry.trim().toUpperCase() : '')
      .filter((entry) => /^[A-Z]{2}$/.test(entry)))].slice(0, 64)
    : [];
  const percentageBasisPoints = Number.isInteger(data.percentageBasisPoints)
    ? Math.max(0, Math.min(10_000, data.percentageBasisPoints))
    : 0;
  return {
    allowedAuthorityUids: boundedIds(data.allowedAuthorityUids),
    allowedRoomIds: boundedIds(data.allowedRoomIds),
    countryCodes,
    percentageBasisPoints,
    schemaVersion: 1,
    stage: data.stage,
  };
}

function isCrossRoomPkPairInRollout({ challengerAuthorityUid, challengerRoom, opponentAuthorityUid, opponentRoom, policy }) {
  const mapped = mapCrossRoomPkRolloutPolicy(policy);
  if (mapped.stage === 'dark') return false;
  const roomOverride = mapped.allowedRoomIds.includes(challengerRoom?.id)
    && mapped.allowedRoomIds.includes(opponentRoom?.id);
  const authorityOverride = mapped.allowedAuthorityUids.includes(challengerAuthorityUid)
    && mapped.allowedAuthorityUids.includes(opponentAuthorityUid);
  if (roomOverride || authorityOverride) return true;
  if (mapped.stage === 'internal' || mapped.stage === 'closed-beta') return false;
  const countriesAllowed = mapped.stage === 'public'
    || (
      mapped.countryCodes.includes(challengerRoom?.countryCode)
      && mapped.countryCodes.includes(opponentRoom?.countryCode)
    );
  if (!countriesAllowed || mapped.percentageBasisPoints <= 0) return false;
  const pair = [challengerRoom?.id || '', opponentRoom?.id || ''].sort().join('|');
  const bucket = Number.parseInt(createHash('sha256').update(pair).digest('hex').slice(0, 8), 16) % 10_000;
  return bucket < mapped.percentageBasisPoints;
}

function resolveRoomPkAuthorityUid(room) {
  if (!room || typeof room !== 'object') return '';
  return [room.hostUid, room.ownerUid, room.hostId]
    .find((uid) => typeof uid === 'string' && uid.trim())?.trim() || '';
}

function isCrossRoomPkEligibleRoom(room) {
  return Boolean(
    isActiveRoom(room)
    && room.visibility === 'public'
    && room.type === 'voice'
    && room.schemaVersion === 2
    && room.giftsPaused !== true
    && !(room.staffLockdown && typeof room.staffLockdown === 'object')
    && !room.activeGameSessionId
    && !room.activeWatchLeaseId,
  );
}

function buildRoomPkPresentationSnapshot(room) {
  const authorityDisplayName = typeof room?.hostDisplayName === 'string'
    ? room.hostDisplayName.trim().slice(0, 80)
    : (typeof room?.ownerDisplayName === 'string' ? room.ownerDisplayName.trim().slice(0, 80) : '');
  return {
    authorityDisplayName,
    roomId: typeof room?.id === 'string' ? room.id : '',
    roomImageUrl: room?.roomImageReviewStatus === 'approved' && typeof room.roomImageUrl === 'string'
      ? room.roomImageUrl.trim().slice(0, 2_048)
      : '',
    roomTitle: typeof room?.title === 'string' ? room.title.trim().slice(0, 120) : '',
  };
}

function buildCrossRoomPkChallenge({ challengerAuthorityUid, challengerRoom, durationMs, nowMs, opponentRoom, requestId }) {
  const challengeId = createCrossRoomPkChallengeId(requestId, challengerRoom.id, opponentRoom.id);
  const expiresAtMs = nowMs + CROSS_ROOM_PK_TIMING_MS.challengeTtl;
  return {
    challengeId,
    challengerAuthorityUid,
    challengerRoomId: challengerRoom.id,
    challengerRoomSnapshot: buildRoomPkPresentationSnapshot(challengerRoom),
    createdAtMs: nowMs,
    durationMs: clampPkDurationMs(durationMs),
    expiresAtMs,
    mode: 'cross-room',
    opponentRoomId: opponentRoom.id,
    opponentRoomSnapshot: buildRoomPkPresentationSnapshot(opponentRoom),
    purgeAfterMs: expiresAtMs + CROSS_ROOM_PK_RETENTION_MS.challenge,
    requestId,
    schemaVersion: CROSS_ROOM_PK_CHALLENGE_SCHEMA_VERSION,
    status: 'pending',
  };
}

function buildCrossRoomPkSession({ acceptedByUid, challenge, nowMs, redAuthorityUid, blueAuthorityUid }) {
  const pkId = createCrossRoomPkSessionId(challenge.challengeId);
  const endsAtMs = nowMs + challenge.durationMs;
  return {
    acceptedByUid,
    blueRoomId: challenge.opponentRoomId,
    challengeId: challenge.challengeId,
    createdByUid: challenge.challengerAuthorityUid,
    distinctGifterCount: 0,
    durationMs: challenge.durationMs,
    endsAtMs,
    mode: 'cross-room',
    pkId,
    purgeAfterMs: endsAtMs + CROSS_ROOM_PK_RETENTION_MS.session,
    redRoomId: challenge.challengerRoomId,
    roomId: challenge.challengerRoomId,
    roomIds: [challenge.challengerRoomId, challenge.opponentRoomId],
    schemaVersion: CROSS_ROOM_PK_SESSION_SCHEMA_VERSION,
    scoreShardCount: CROSS_ROOM_PK_SCORE_SHARD_COUNT,
    settleAfterMs: endsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace,
    startedAtMs: nowMs,
    status: 'active',
    teams: {
      blue: {
        authorityUid: blueAuthorityUid,
        distinctGifterCount: 0,
        roomId: challenge.opponentRoomId,
        roomImageUrl: challenge.opponentRoomSnapshot.roomImageUrl,
        roomTitle: challenge.opponentRoomSnapshot.roomTitle,
        score: 0,
      },
      red: {
        authorityUid: redAuthorityUid,
        distinctGifterCount: 0,
        roomId: challenge.challengerRoomId,
        roomImageUrl: challenge.challengerRoomSnapshot.roomImageUrl,
        roomTitle: challenge.challengerRoomSnapshot.roomTitle,
        score: 0,
      },
    },
    winner: null,
    winnerReason: '',
  };
}

function buildCrossRoomPkScoreShards({ pkId, purgeAfterMs }) {
  return ROOM_PK_TEAMS.flatMap((side) => Array.from(
    { length: CROSS_ROOM_PK_SCORE_SHARD_COUNT },
    (_, shard) => ({
      distinctGifterCount: 0,
      giftCount: 0,
      pkId,
      purgeAfterMs,
      schemaVersion: CROSS_ROOM_PK_SCORE_SHARD_SCHEMA_VERSION,
      score: 0,
      shard,
      shardId: `${side}_${String(shard).padStart(2, '0')}`,
      side,
    }),
  ));
}

function resolvePkWinner({
  blueScore = 0,
  distinctGifters = [],
  minDistinct = MIN_DISTINCT_GIFTERS_FOR_VALID,
  redScore = 0,
} = {}) {
  const gifters = Array.isArray(distinctGifters)
    ? distinctGifters.filter((uid) => typeof uid === 'string' && uid.length > 0)
    : [];
  const uniqueCount = new Set(gifters).size;
  if (uniqueCount < minDistinct) {
    return {
      reason: 'insufficient_distinct_gifters',
      winner: 'void',
    };
  }
  const red = Number(redScore) || 0;
  const blue = Number(blueScore) || 0;
  if (red === blue) {
    return { reason: 'tied_score', winner: 'draw' };
  }
  if (red > blue) {
    return { reason: 'higher_score', winner: 'red' };
  }
  return { reason: 'higher_score', winner: 'blue' };
}

function applyPkGiftScore({
  eventId,
  nowMs,
  priceCoins,
  session,
  team,
  uid,
}) {
  if (!session || !isPkSessionActive(session, nowMs)) {
    return roomPkError('SESSION_NOT_ACTIVE', 409, 'There is no active PK session for scoring.');
  }
  if (!ROOM_PK_TEAMS.includes(team)) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid PK team is required for scoring.');
  }
  if (typeof uid !== 'string' || !uid || typeof eventId !== 'string' || !eventId) {
    return roomPkError('INVALID_REQUEST', 400, 'A valid gifter and gift event are required.');
  }
  const coins = Number(priceCoins);
  if (!Number.isFinite(coins) || coins <= 0) {
    return roomPkError('INVALID_REQUEST', 400, 'A positive gift coin amount is required.');
  }

  const mapped = mapRoomPkSession(session);
  const giftEventIds = mapped.giftEventIds;
  if (giftEventIds.includes(eventId)) {
    return {
      duplicate: true,
      ok: true,
      session: null,
    };
  }

  const distinctGifters = mapped.distinctGifters.includes(uid)
    ? mapped.distinctGifters
    : [...mapped.distinctGifters, uid];
  const nextTeams = {
    blue: { ...mapped.teams.blue },
    red: { ...mapped.teams.red },
  };
  nextTeams[team] = {
    ...nextTeams[team],
    score: nextTeams[team].score + Math.floor(coins),
  };

  return {
    duplicate: false,
    ok: true,
    session: {
      distinctGifters,
      giftEventIds: [...giftEventIds, eventId],
      teams: nextTeams,
      updatedAtMs: nowMs,
    },
  };
}

function isPkSessionActive(session, nowMs) {
  if (!session || session.status !== 'active') return false;
  const endsAtMs = timestampToMillis(session.endsAt) || Number(session.endsAtMs) || 0;
  if (endsAtMs > 0 && endsAtMs <= nowMs) return false;
  return true;
}

function canManageRoomPk({ membership, room, uid }) {
  if (!uid) return { ok: false };
  const ownerUid = room?.ownerUid || '';
  if (uid === ownerUid) return { ok: true, authority: 'owner' };
  if (room?.hostUid === uid || room?.hostId === uid) {
    return { ok: true, authority: 'host' };
  }
  if (membership?.uid === uid && membership?.status === 'active') {
    if (membership.authorityRole === 'host' || membership.role === 'host') {
      return { ok: true, authority: 'host' };
    }
    if (membership.authorityRole === 'moderator' || membership.role === 'moderator') {
      return { ok: true, authority: 'moderator' };
    }
  }
  return { ok: false };
}

function canStartRoomPk({ membership, room, uid }) {
  if (!uid) return { ok: false };
  const ownerUid = room?.ownerUid || room?.hostId || '';
  if (uid === ownerUid) return { ok: true, authority: 'owner' };
  if (
    membership
    && membership.uid === uid
    && membership.status === 'active'
    && (membership.authorityRole === 'host' || membership.role === 'host')
  ) {
    return { ok: true, authority: 'host' };
  }
  if (room?.hostUid === uid || room?.hostId === uid) {
    return { ok: true, authority: 'host' };
  }
  return { ok: false };
}

function resolveTeamForUid(session, uid) {
  const mapped = mapRoomPkSession(session);
  if (!mapped || !uid) return null;
  if (mapped.teams.red.memberUids.includes(uid)) return 'red';
  if (mapped.teams.blue.memberUids.includes(uid)) return 'blue';
  return null;
}

function buildStartRoomPkSession({
  durationMs,
  hostUid,
  nowMs,
  pkId,
  roomId,
}) {
  const clamped = clampPkDurationMs(durationMs);
  return {
    createdAtMs: nowMs,
    distinctGifters: [],
    durationMs: clamped,
    endsAtMs: nowMs + clamped,
    giftEventIds: [],
    hostUid,
    mode: 'in-room-teams',
    pkId,
    roomId,
    schemaVersion: 1,
    startedAtMs: nowMs,
    status: 'active',
    teams: {
      blue: buildEmptyTeam(TEAM_LABELS_AR.blue),
      red: {
        ...buildEmptyTeam(TEAM_LABELS_AR.red),
        memberUids: [hostUid],
      },
    },
    updatedAtMs: nowMs,
    winner: null,
    winnerReason: '',
  };
}

function buildFinalizePatch({ nowMs, session, status = 'ended' }) {
  const mapped = mapRoomPkSession(session);
  const resolution = resolvePkWinner({
    blueScore: mapped.teams.blue.score,
    distinctGifters: mapped.distinctGifters,
    minDistinct: MIN_DISTINCT_GIFTERS_FOR_VALID,
    redScore: mapped.teams.red.score,
  });
  const nextStatus = resolution.winner === 'void' && status === 'ended'
    ? 'void'
    : status;
  return {
    endedAtMs: nowMs,
    status: nextStatus,
    updatedAtMs: nowMs,
    winner: resolution.winner,
    winnerReason: resolution.reason,
  };
}

function roomPkError(code, status, message, details) {
  return {
    ok: false,
    status,
    error: {
      code,
      message,
    },
    // Top-level mirrors for roomGame-style callers / index wiring.
    code,
    ...(details ? { details } : {}),
  };
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

function isActiveMembership(membership, uid) {
  return Boolean(membership && membership.uid === uid && membership.status === 'active');
}

function isActiveRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && (room.availability === undefined || room.availability === 'active'),
  );
}

function isCrossRoomRequest(command) {
  return CROSS_ROOM_PK_ACTIONS.includes(command?.action)
    || command?.mode === 'cross-room'
    || Boolean(command?.opponentRoomId);
}

module.exports = {
  COOLDOWN_MS,
  DEFAULT_DURATION_MS,
  MAX_CONCURRENT_PER_ROOM,
  MAX_DURATION_MS,
  MIN_DISTINCT_GIFTERS_FOR_VALID,
  MIN_DURATION_MS,
  PK_COMMAND_RETENTION_MS,
  PK_SESSION_RETENTION_MS,
  REQUEST_ID_PATTERN,
  ROOM_PK_ACTIONS,
  ROOM_PK_MODES,
  ROOM_PK_RATE_LIMIT,
  ROOM_PK_RATE_WINDOW_MS,
  ROOM_PK_TEAMS,
  TEAM_LABELS_AR,
  applyPkGiftScore,
  buildFinalizePatch,
  buildCrossRoomPkChallenge,
  buildCrossRoomPkScoreShards,
  buildCrossRoomPkSession,
  buildRoomPkFingerprint,
  buildRoomPkPresentationSnapshot,
  buildStartRoomPkSession,
  canManageRoomPk,
  canStartRoomPk,
  clampPkDurationMs,
  createRoomPkSessionId,
  createCrossRoomPkChallengeId,
  createCrossRoomPkSessionId,
  isActiveMembership,
  isActiveRoom,
  isCrossRoomRequest,
  isCrossRoomPkEligibleRoom,
  isCrossRoomPkPairInRollout,
  isPkSessionActive,
  mapRoomPkSession,
  mapCrossRoomPkChallenge,
  mapCrossRoomPkRolloutPolicy,
  normalizeRoomPkBody,
  resolvePkWinner,
  resolveRoomPkAuthorityUid,
  resolveTeamForUid,
  roomPkError,
  timestampToMillis,
  validateRoomPkRequest,
};
