'use strict';

const { createDailyBucket, createWeeklyCycle } = require('./weeklyIncentiveCore');
const { SUPPORTED_COUNTRY_CODES } = require('./socialProfileCore');

const LEADERBOARD_KINDS = Object.freeze(['wealth', 'charm']);
const FAMILY_LEADERBOARD_KINDS = Object.freeze(['family_wealth', 'family_charm']);
const ALL_LEADERBOARD_KINDS = Object.freeze([...LEADERBOARD_KINDS, ...FAMILY_LEADERBOARD_KINDS]);
const LEADERBOARD_WINDOWS = Object.freeze(['daily', 'weekly', 'all']);
const LEADERBOARD_TIME_ZONE = 'Asia/Baghdad';
const LEADERBOARD_LIMIT = 50;
const LEADERBOARD_STALE_MS = 5 * 60 * 1000;
const LEADERBOARD_FALLBACK_SCAN_LIMIT = 200;

function isFamilyLeaderboardKind(kind) {
  return FAMILY_LEADERBOARD_KINDS.includes(kind);
}

function buildPeriodId({ window, nowMs = Date.now() } = {}) {
  if (!LEADERBOARD_WINDOWS.includes(window)) {
    return { ok: false, code: 'INVALID_WINDOW' };
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { ok: false, code: 'INVALID_PERIOD' };
  }
  if (window === 'all') {
    return { ok: true, value: 'all' };
  }

  const day = createDailyBucket({ nowMillis: nowMs, timeZone: LEADERBOARD_TIME_ZONE });
  if (!day.ok) return { ok: false, code: 'INVALID_PERIOD' };
  if (window === 'daily') {
    return { ok: true, value: day.value.dayId };
  }

  // Weekly board period: Monday-start week covering the daily dayId date.
  const week = createWeeklyCycle({ nowMillis: nowMs, timeZone: LEADERBOARD_TIME_ZONE });
  if (!week.ok) return { ok: false, code: 'INVALID_PERIOD' };
  return { ok: true, value: week.value.cycleId };
}

function buildBoardId({ kind, window, scope }) {
  if (!ALL_LEADERBOARD_KINDS.includes(kind) || !LEADERBOARD_WINDOWS.includes(window)) return '';
  const normalizedScope = normalizeLeaderboardScope(scope);
  if (!normalizedScope) return '';
  return `${kind}_${window}_${normalizedScope}`;
}

function normalizeLeaderboardScope(scope) {
  if (scope == null || scope === '') return 'global';
  if (typeof scope !== 'string') return '';
  const trimmed = scope.trim();
  if (!trimmed || trimmed.toLowerCase() === 'global') return 'global';
  const code = trimmed.toUpperCase();
  return SUPPORTED_COUNTRY_CODES.includes(code) ? code : '';
}

function normalizeGetLeaderboardInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const kind = typeof input.kind === 'string' ? input.kind.trim().toLowerCase() : '';
  const window = typeof input.window === 'string' ? input.window.trim().toLowerCase() : '';
  if (!ALL_LEADERBOARD_KINDS.includes(kind) || !LEADERBOARD_WINDOWS.includes(window)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (isFamilyLeaderboardKind(kind) && window !== 'weekly') {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const scope = normalizeLeaderboardScope(input.scope);
  if (!scope) return { ok: false, code: 'INVALID_REQUEST' };
  const boardId = buildBoardId({ kind, window, scope });
  if (!boardId) return { ok: false, code: 'INVALID_REQUEST' };
  return {
    ok: true,
    value: {
      boardId,
      kind,
      scope,
      window,
    },
  };
}

function compareLeaderboardEntries(left, right) {
  const leftScore = Number(left?.score) || 0;
  const rightScore = Number(right?.score) || 0;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const leftFirst = Number.isSafeInteger(left?.firstContributionAtMs) ? left.firstContributionAtMs : Number.MAX_SAFE_INTEGER;
  const rightFirst = Number.isSafeInteger(right?.firstContributionAtMs) ? right.firstContributionAtMs : Number.MAX_SAFE_INTEGER;
  if (leftFirst !== rightFirst) return leftFirst - rightFirst;
  return String(left?.uid || '').localeCompare(String(right?.uid || ''));
}

function rankEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .slice()
    .sort(compareLeaderboardEntries)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function mapLeaderboardUserScore(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  if (!uid) return null;
  const wealthCoins = Number(data.wealthCoins);
  const charmScore = Number(data.charmScore);
  return {
    charmScore: Number.isSafeInteger(charmScore) && charmScore >= 0 ? charmScore : 0,
    countryCode: typeof data.countryCode === 'string' ? data.countryCode.trim().toUpperCase() : '',
    displayName: typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '',
    firstContributionAtMs: Number.isSafeInteger(data.firstContributionAtMs) ? data.firstContributionAtMs : 0,
    lastContributionAtMs: Number.isSafeInteger(data.lastContributionAtMs) ? data.lastContributionAtMs : 0,
    publicId: typeof data.publicId === 'string'
      ? data.publicId.trim()
      : (Number.isSafeInteger(data.publicId) ? String(data.publicId) : ''),
    uid,
    wealthCoins: Number.isSafeInteger(wealthCoins) && wealthCoins >= 0 ? wealthCoins : 0,
  };
}

function mapLeaderboardFamilyScore(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const familyId = typeof data.familyId === 'string' ? data.familyId.trim() : '';
  if (!familyId) return null;
  const wealthCoins = Number(data.wealthCoins);
  const charmScore = Number(data.charmScore);
  return {
    charmScore: Number.isSafeInteger(charmScore) && charmScore >= 0 ? charmScore : 0,
    displayName: typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '',
    familyId,
    firstContributionAtMs: Number.isSafeInteger(data.firstContributionAtMs) ? data.firstContributionAtMs : 0,
    lastContributionAtMs: Number.isSafeInteger(data.lastContributionAtMs) ? data.lastContributionAtMs : 0,
    // Board entries reuse `uid` as the stable entity id (familyId for family boards).
    uid: familyId,
    wealthCoins: Number.isSafeInteger(wealthCoins) && wealthCoins >= 0 ? wealthCoins : 0,
  };
}

function mapLeaderboardEntry(data = {}, { kind } = {}) {
  if (isFamilyLeaderboardKind(kind)) {
    const scoreDoc = mapLeaderboardFamilyScore(data);
    if (!scoreDoc) return null;
    const score = kind === 'family_charm' ? scoreDoc.charmScore : scoreDoc.wealthCoins;
    if (!Number.isSafeInteger(score) || score < 1) return null;
    return {
      countryCode: '',
      displayName: scoreDoc.displayName,
      firstContributionAtMs: scoreDoc.firstContributionAtMs,
      publicId: '',
      score,
      uid: scoreDoc.uid,
    };
  }
  const scoreDoc = mapLeaderboardUserScore(data);
  if (!scoreDoc) return null;
  const score = kind === 'charm' ? scoreDoc.charmScore : scoreDoc.wealthCoins;
  if (!Number.isSafeInteger(score) || score < 1) return null;
  return {
    countryCode: scoreDoc.countryCode,
    displayName: scoreDoc.displayName,
    firstContributionAtMs: scoreDoc.firstContributionAtMs,
    publicId: scoreDoc.publicId,
    score,
    uid: scoreDoc.uid,
  };
}

function mapLeaderboardDocument(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : '';
  const window = typeof data.window === 'string' ? data.window.trim().toLowerCase() : '';
  const scope = normalizeLeaderboardScope(data.scope);
  if (!ALL_LEADERBOARD_KINDS.includes(kind) || !LEADERBOARD_WINDOWS.includes(window) || !scope) {
    return null;
  }
  const boardId = typeof data.boardId === 'string' && data.boardId.trim()
    ? data.boardId.trim()
    : buildBoardId({ kind, window, scope });
  const periodId = typeof data.periodId === 'string' ? data.periodId.trim() : '';
  if (!boardId || !periodId) return null;
  const entries = Array.isArray(data.entries)
    ? data.entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const uid = typeof entry.uid === 'string' ? entry.uid.trim() : '';
        const score = Number(entry.score);
        const rank = Number(entry.rank);
        if (!uid || !Number.isSafeInteger(score) || score < 0 || !Number.isSafeInteger(rank) || rank < 1) {
          return null;
        }
        return {
          countryCode: typeof entry.countryCode === 'string' ? entry.countryCode.trim().toUpperCase() : '',
          displayName: typeof entry.displayName === 'string' ? entry.displayName.trim().slice(0, 80) : '',
          firstContributionAtMs: Number.isSafeInteger(entry.firstContributionAtMs) ? entry.firstContributionAtMs : 0,
          publicId: typeof entry.publicId === 'string'
            ? entry.publicId.trim()
            : (Number.isSafeInteger(entry.publicId) ? String(entry.publicId) : ''),
          rank,
          score,
          uid,
        };
      })
      .filter(Boolean)
    : [];
  return {
    boardId,
    entries,
    frozen: data.frozen === true,
    kind,
    periodId,
    scope,
    updatedAtMs: readTimestampMs(data.updatedAtMs ?? data.updatedAt),
    window,
  };
}

function scoreFieldForKind(kind) {
  if (kind === 'charm' || kind === 'family_charm') return 'charmScore';
  return 'wealthCoins';
}

function isLeaderboardIndexError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return code === 'failed-precondition'
    || code === 'FAILED_PRECONDITION'
    || /requires an index|FAILED_PRECONDITION|The query requires an index/i.test(message);
}

function readTimestampMs(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isSafeInteger(millis) && millis >= 0 ? millis : 0;
  }
  if (value && Number.isSafeInteger(value._seconds)) {
    return value._seconds * 1000;
  }
  if (value && Number.isSafeInteger(value.seconds)) {
    return value.seconds * 1000;
  }
  return 0;
}

function isBoardFresh(board, nowMs = Date.now()) {
  if (!board || board.frozen === true) return false;
  const updatedAtMs = Number.isSafeInteger(board.updatedAtMs) ? board.updatedAtMs : 0;
  return updatedAtMs > 0 && (nowMs - updatedAtMs) < LEADERBOARD_STALE_MS;
}

module.exports = {
  ALL_LEADERBOARD_KINDS,
  FAMILY_LEADERBOARD_KINDS,
  LEADERBOARD_FALLBACK_SCAN_LIMIT,
  LEADERBOARD_KINDS,
  LEADERBOARD_LIMIT,
  LEADERBOARD_STALE_MS,
  LEADERBOARD_TIME_ZONE,
  // Aliases matching the Wave 2 contract naming.
  KINDS: LEADERBOARD_KINDS,
  STALE_MS: LEADERBOARD_STALE_MS,
  TIME_ZONE: LEADERBOARD_TIME_ZONE,
  WINDOWS: LEADERBOARD_WINDOWS,
  buildBoardId,
  buildPeriodId,
  compareLeaderboardEntries,
  isBoardFresh,
  isFamilyLeaderboardKind,
  isLeaderboardIndexError,
  mapLeaderboardDocument,
  mapLeaderboardEntry,
  mapLeaderboardFamilyScore,
  mapLeaderboardUserScore,
  normalizeGetLeaderboardInput,
  normalizeLeaderboardScope,
  rankEntries,
  readTimestampMs,
  scoreFieldForKind,
};
