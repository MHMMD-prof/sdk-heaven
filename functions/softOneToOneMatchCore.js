'use strict';

const SOFT_MATCH_QUEUE_TTL_MS = 3 * 60 * 1000;
const SOFT_MATCH_SESSION_TTL_MS = 30 * 60 * 1000;
const SOFT_MATCH_RATE_LIMIT = 15;
const SOFT_MATCH_RATE_WINDOW_MS = 10 * 60 * 1000;
const SOFT_MATCH_CANDIDATE_LIMIT = 24;
const SOFT_MATCH_ROOM_TITLE_AR = 'محادثة صوتية سريعة';
const SOFT_MATCH_GENDERS = Object.freeze(['male', 'female']);
const SOFT_MATCH_ACTIONS = Object.freeze([
  'soft-match-enqueue',
  'soft-match-cancel',
  'soft-match-status',
]);

function normalizeGender(value) {
  if (value === 'male' || value === 'female') return value;
  return '';
}

function normalizeSoftMatchEnqueueInput(input = {}) {
  if (input == null) return { ok: true, value: { preferGender: '' } };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'preferGender')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const preferGender = normalizeGender(input.preferGender);
  if (input.preferGender != null && input.preferGender !== '' && !preferGender) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { preferGender } };
}

function normalizeSoftMatchCancelInput(input) {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (Object.keys(input).length > 0) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: {} };
}

function normalizeSoftMatchStatusInput(input) {
  return normalizeSoftMatchCancelInput(input);
}

function isActiveModeration(profile) {
  return profile && typeof profile === 'object' && profile.moderationStatus === 'active';
}

function genderPreferenceAllows({ actorGender, actorPreferGender, peerGender, peerPreferGender }) {
  const actorPref = normalizeGender(actorPreferGender);
  const peerPref = normalizeGender(peerPreferGender);
  const actor = normalizeGender(actorGender);
  const peer = normalizeGender(peerGender);

  if (actorPref) {
    if (!peer || peer !== actorPref) return false;
  }
  if (peerPref) {
    if (!actor || actor !== peerPref) return false;
  }
  return true;
}

function isSoftMatchQueueWaiting(ticket, nowMs = Date.now()) {
  if (!ticket || typeof ticket !== 'object') return false;
  if (ticket.status !== 'waiting') return false;
  const expiresAtMs = Number(ticket.expiresAtMs);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return false;
  return true;
}

function isSoftMatchQueueMatchedLive(ticket, nowMs = Date.now()) {
  if (!ticket || typeof ticket !== 'object') return false;
  if (ticket.status !== 'matched') return false;
  const sessionExpiresAtMs = Number(ticket.sessionExpiresAtMs);
  if (!Number.isSafeInteger(sessionExpiresAtMs) || sessionExpiresAtMs <= nowMs) return false;
  const roomId = typeof ticket.roomId === 'string' ? ticket.roomId.trim() : '';
  const sessionId = typeof ticket.sessionId === 'string' ? ticket.sessionId.trim() : '';
  return Boolean(roomId && sessionId);
}

function mapLiveSoftMatchTicket(ticket, nowMs = Date.now()) {
  if (isSoftMatchQueueMatchedLive(ticket, nowMs)) {
    return mapSoftMatchResult({
      inviteCode: ticket.inviteCode,
      peerLabelAr: ticket.peerLabelAr,
      roomId: ticket.roomId,
      sessionExpiresAtMs: ticket.sessionExpiresAtMs,
      sessionId: ticket.sessionId,
      status: 'matched',
    });
  }
  if (isSoftMatchQueueWaiting(ticket, nowMs)) {
    return mapSoftMatchResult({
      expiresAtMs: ticket.expiresAtMs,
      preferGender: ticket.preferGender,
      status: 'waiting',
    });
  }
  return null;
}

function pickSoftMatchPeer(candidates, {
  actorGender = '',
  actorPreferGender = '',
  actorUid,
  blockedPeerUids = new Set(),
  nowMs = Date.now(),
} = {}) {
  const safeActorUid = typeof actorUid === 'string' ? actorUid.trim() : '';
  if (!safeActorUid) return null;

  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => {
      if (!isSoftMatchQueueWaiting(candidate, nowMs)) return false;
      const peerUid = typeof candidate.uid === 'string' ? candidate.uid.trim() : '';
      if (!peerUid || peerUid === safeActorUid) return false;
      if (blockedPeerUids.has(peerUid)) return false;
      return genderPreferenceAllows({
        actorGender,
        actorPreferGender,
        peerGender: candidate.gender,
        peerPreferGender: candidate.preferGender,
      });
    })
    .sort((left, right) => {
      const leftMs = Number(left.enqueuedAtMs) || 0;
      const rightMs = Number(right.enqueuedAtMs) || 0;
      return leftMs - rightMs || String(left.uid).localeCompare(String(right.uid));
    });

  return ranked[0] || null;
}

function createSoftMatchSessionId(requestId, uid) {
  const safeRequest = typeof requestId === 'string' ? requestId.replace(/[^A-Za-z0-9_-]/g, '') : '';
  const safeUid = typeof uid === 'string' ? uid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) : '';
  return `sm_${safeUid}_${safeRequest}`.slice(0, 120);
}

function createSoftMatchRoomId(sessionId) {
  const safe = typeof sessionId === 'string' ? sessionId.replace(/[^A-Za-z0-9_-]/g, '') : '';
  return `soft_${safe}`.slice(0, 120);
}

function createSoftMatchInviteCode(sessionId) {
  const raw = typeof sessionId === 'string' ? sessionId.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const padded = `${raw}SOFTMATCH`.slice(0, 10);
  return padded.length >= 6 ? padded.slice(0, 10) : `SOFT${padded}01`.slice(0, 10);
}

function buildSoftMatchRoomDocument({
  countryCode = 'IQ',
  hostDisplayName = '',
  hostUid,
  nowMs,
  peerUid,
  roomId,
  sessionId,
}) {
  const safeHost = typeof hostUid === 'string' ? hostUid.trim() : '';
  const safePeer = typeof peerUid === 'string' ? peerUid.trim() : '';
  const safeRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  const safeSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!safeHost || !safePeer || !safeRoomId || !safeSessionId) return null;

  return {
    announcement: '',
    audioLockdown: false,
    availability: 'active',
    chatMode: 'everyone',
    countryCode: typeof countryCode === 'string' && countryCode.trim()
      ? countryCode.trim().toUpperCase().slice(0, 2)
      : 'IQ',
    effectsPolicy: 'full',
    historyVisibility: 'after-join',
    hostAvatarLabel: '',
    hostDisplayName: typeof hostDisplayName === 'string' ? hostDisplayName.trim().slice(0, 48) : '',
    hostId: safeHost,
    id: safeRoomId,
    inviteCode: createSoftMatchInviteCode(safeSessionId),
    keywordFilterMode: 'strict',
    moderatorCount: 0,
    ownerAvatarLabel: '',
    ownerDisplayName: typeof hostDisplayName === 'string' ? hostDisplayName.trim().slice(0, 48) : '',
    ownerUid: safeHost,
    participantCount: 2,
    revision: 1,
    roomCustomizationSuspended: false,
    roomImageReviewStatus: 'none',
    schemaVersion: 2,
    seatMode: 'locked',
    seatTargetCount: 5,
    softMatch: true,
    softMatchPeerUids: [safeHost, safePeer],
    softMatchSessionId: safeSessionId,
    speakerCount: 0,
    status: 'active',
    themeId: 'majlis-default',
    title: SOFT_MATCH_ROOM_TITLE_AR,
    type: 'voice',
    visibility: 'private',
    welcomeMessage: 'محادثة صوتية قصيرة — احترم الآخرين وأبلغ عن أي إساءة.',
  };
}

function buildSoftMatchMemberDocument({ displayName = '', role, uid }) {
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid) return null;
  const isHost = role === 'host';
  return {
    authorityRole: isHost ? 'owner' : 'member',
    avatarLabel: '',
    canPublishAudio: true,
    displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 48) : '',
    privileges: { canManageMusic: false },
    role: isHost ? 'host' : 'speaker',
    schemaVersion: 2,
    seatId: null,
    status: 'active',
    uid: safeUid,
  };
}

function mapSoftMatchResult(data = {}) {
  if (!data || typeof data !== 'object') return null;
  const status = data.status === 'matched' || data.status === 'waiting' || data.status === 'idle'
    ? data.status
    : null;
  if (!status) return null;
  const result = {
    status,
  };
  if (status === 'waiting') {
    result.expiresAtMs = Number.isSafeInteger(Number(data.expiresAtMs)) ? Number(data.expiresAtMs) : 0;
    result.preferGender = normalizeGender(data.preferGender);
  }
  if (status === 'matched') {
    const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : '';
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
    const inviteCode = typeof data.inviteCode === 'string' ? data.inviteCode.trim() : '';
    if (!roomId || !sessionId) return null;
    result.inviteCode = inviteCode;
    result.peerLabelAr = typeof data.peerLabelAr === 'string' && data.peerLabelAr.trim()
      ? data.peerLabelAr.trim().slice(0, 48)
      : 'ضيف صوتي';
    result.roomId = roomId;
    result.sessionId = sessionId;
    result.sessionExpiresAtMs = Number.isSafeInteger(Number(data.sessionExpiresAtMs))
      ? Number(data.sessionExpiresAtMs)
      : 0;
  }
  return result;
}

module.exports = {
  SOFT_MATCH_ACTIONS,
  SOFT_MATCH_CANDIDATE_LIMIT,
  SOFT_MATCH_GENDERS,
  SOFT_MATCH_QUEUE_TTL_MS,
  SOFT_MATCH_RATE_LIMIT,
  SOFT_MATCH_RATE_WINDOW_MS,
  SOFT_MATCH_ROOM_TITLE_AR,
  SOFT_MATCH_SESSION_TTL_MS,
  buildSoftMatchMemberDocument,
  buildSoftMatchRoomDocument,
  createSoftMatchInviteCode,
  createSoftMatchRoomId,
  createSoftMatchSessionId,
  genderPreferenceAllows,
  isActiveModeration,
  isSoftMatchQueueMatchedLive,
  isSoftMatchQueueWaiting,
  mapLiveSoftMatchTicket,
  mapSoftMatchResult,
  normalizeGender,
  normalizeSoftMatchCancelInput,
  normalizeSoftMatchEnqueueInput,
  normalizeSoftMatchStatusInput,
  pickSoftMatchPeer,
};
