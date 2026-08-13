'use strict';

const { SUPPORTED_COUNTRY_CODES } = require('./socialProfileCore');

const QUICK_MATCH_CANDIDATE_LIMIT = 100;
const QUICK_MATCH_MAX_PARTICIPANTS = 40;
const QUICK_MATCH_TOP_POOL = 8;
const QUICK_MATCH_RATE_LIMIT = 20;
const QUICK_MATCH_RATE_WINDOW_MS = 10 * 60 * 1000;
const LUCKY_BAG_COIN_AMOUNT = 25;
const LUCKY_BAG_TIME_ZONE = 'Asia/Baghdad';
const MASK_TTL_MS = 15 * 60 * 1000;

function isStaffLockdownActive(room) {
  return Boolean(room?.staffLockdown && typeof room.staffLockdown === 'object' && room.staffLockdown.byUid);
}

function isQuickMatchEligibleRoom(room, { uid } = {}) {
  if (!room || typeof room !== 'object') return false;
  if (room.status !== 'active') return false;
  if (room.visibility !== 'public') return false;
  if (room.availability && room.availability !== 'active') return false;
  if (isStaffLockdownActive(room)) return false;
  if (room.audioLockdown === true) return false;
  const participantCount = Number(room.participantCount);
  if (!Number.isSafeInteger(participantCount) || participantCount < 0) return false;
  if (participantCount >= QUICK_MATCH_MAX_PARTICIPANTS) return false;
  const hostId = typeof room.hostId === 'string' ? room.hostId.trim() : '';
  const ownerUid = typeof room.ownerUid === 'string' ? room.ownerUid.trim() : '';
  if (!hostId) return false;
  if (uid && (hostId === uid || ownerUid === uid)) return false;
  return true;
}

function scoreQuickMatchRoom(room, { preferredCountryCode = '' } = {}) {
  if (!isQuickMatchEligibleRoom(room)) return Number.NEGATIVE_INFINITY;
  const participantCount = Number(room.participantCount) || 0;
  let score = 0;
  // Room fill assist: empty/quiet rooms with a live host rank highest.
  if (participantCount === 0) score += 45;
  else if (participantCount <= 4) score += 35;
  else if (participantCount <= 12) score += 18;
  else score += 6;

  const country = typeof room.countryCode === 'string' ? room.countryCode.trim().toUpperCase() : '';
  if (preferredCountryCode && country === preferredCountryCode) score += 28;
  else if (SUPPORTED_COUNTRY_CODES.includes(country)) score += 8;

  if (typeof room.hostDisplayName === 'string' && room.hostDisplayName.trim()) score += 4;
  return score;
}

function pickQuickMatchRoom(rooms, { preferredCountryCode = '', random = Math.random, uid = '' } = {}) {
  const ranked = (Array.isArray(rooms) ? rooms : [])
    .filter((room) => isQuickMatchEligibleRoom(room, { uid }))
    .map((room) => ({
      room,
      score: scoreQuickMatchRoom(room, { preferredCountryCode }),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || String(left.room.id).localeCompare(String(right.room.id)));

  if (ranked.length === 0) return null;
  const pool = ranked.slice(0, QUICK_MATCH_TOP_POOL);
  const totalWeight = pool.reduce((sum, entry) => sum + Math.max(1, entry.score), 0);
  let ticket = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * totalWeight;
  for (const entry of pool) {
    ticket -= Math.max(1, entry.score);
    if (ticket <= 0) return entry.room;
  }
  return pool[0].room;
}

function normalizeQuickMatchInput(input = {}) {
  if (input == null) return { ok: true, value: { preferredCountryCode: '' } };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'preferredCountryCode')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const raw = typeof input.preferredCountryCode === 'string'
    ? input.preferredCountryCode.trim().toUpperCase()
    : '';
  if (raw && !SUPPORTED_COUNTRY_CODES.includes(raw)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { preferredCountryCode: raw } };
}

function buildMaskedMatchProjection({ enabled, nowMs = Date.now(), roomId, uid }) {
  if (!enabled) return null;
  const safeRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeRoomId || !safeUid) return null;
  return {
    expiresAtMs: nowMs + MASK_TTL_MS,
    labelAr: 'ضيف مقنع',
    roomId: safeRoomId,
    uid: safeUid,
  };
}

module.exports = {
  LUCKY_BAG_COIN_AMOUNT,
  LUCKY_BAG_TIME_ZONE,
  MASK_TTL_MS,
  QUICK_MATCH_CANDIDATE_LIMIT,
  QUICK_MATCH_MAX_PARTICIPANTS,
  QUICK_MATCH_RATE_LIMIT,
  QUICK_MATCH_RATE_WINDOW_MS,
  buildMaskedMatchProjection,
  isQuickMatchEligibleRoom,
  isStaffLockdownActive,
  normalizeQuickMatchInput,
  pickQuickMatchRoom,
  scoreQuickMatchRoom,
};
