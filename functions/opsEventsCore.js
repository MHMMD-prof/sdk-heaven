'use strict';

const { createDailyBucket } = require('./weeklyIncentiveCore');

const OPS_MISSION_KINDS = Object.freeze(['send_gifts']);
const OPS_EVENT_STATUSES = Object.freeze(['draft', 'published', 'retired']);
const OPS_MISSIONS_TIME_ZONE = 'Asia/Baghdad';
const OPS_MISSION_TITLE_MAX = 80;
const OPS_EVENT_TITLE_MAX = 80;
const OPS_EVENT_THEME_MAX = 160;

const DEFAULT_DAILY_MISSIONS = Object.freeze([
  Object.freeze({
    kind: 'send_gifts',
    missionId: 'daily_send_gifts_3',
    rewardCoins: 50,
    target: 3,
    titleAr: 'أرسل 3 هدايا اليوم',
  }),
]);

function listDefaultDailyMissions() {
  return DEFAULT_DAILY_MISSIONS.map((mission) => ({ ...mission }));
}

function mapMissionDefinition(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const missionId = typeof data.missionId === 'string' ? data.missionId.trim().slice(0, 64) : '';
  const kind = typeof data.kind === 'string' ? data.kind.trim() : '';
  const titleAr = typeof data.titleAr === 'string' ? data.titleAr.trim().slice(0, OPS_MISSION_TITLE_MAX) : '';
  const target = Number(data.target);
  const rewardCoins = Number(data.rewardCoins);
  if (!missionId || !OPS_MISSION_KINDS.includes(kind) || !titleAr) return null;
  if (!Number.isSafeInteger(target) || target < 1 || target > 1000) return null;
  if (!Number.isSafeInteger(rewardCoins) || rewardCoins < 1 || rewardCoins > 100_000) return null;
  return {
    kind,
    missionId,
    rewardCoins,
    target,
    titleAr,
  };
}

function mapOpsEvent(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const eventId = typeof data.eventId === 'string' ? data.eventId.trim().slice(0, 64) : '';
  const titleAr = typeof data.titleAr === 'string' ? data.titleAr.trim().slice(0, OPS_EVENT_TITLE_MAX) : '';
  const themeAr = typeof data.themeAr === 'string' ? data.themeAr.trim().slice(0, OPS_EVENT_THEME_MAX) : '';
  const status = typeof data.status === 'string' ? data.status.trim() : '';
  const startsAtMs = Number(data.startsAtMs);
  const endsAtMs = Number(data.endsAtMs);
  if (!eventId || !titleAr || !OPS_EVENT_STATUSES.includes(status)) return null;
  if (!Number.isSafeInteger(startsAtMs) || !Number.isSafeInteger(endsAtMs) || endsAtMs <= startsAtMs) {
    return null;
  }
  return {
    audience: data.audience === 'all' || !data.audience ? 'all' : String(data.audience).slice(0, 40),
    endsAtMs,
    eventId,
    startsAtMs,
    status,
    themeAr,
    titleAr,
  };
}

function isEventActive(event, nowMs = Date.now()) {
  if (!event || event.status !== 'published') return false;
  return nowMs >= event.startsAtMs && nowMs < event.endsAtMs;
}

function resolveMissionDay(nowMs = Date.now()) {
  return createDailyBucket({ nowMillis: nowMs, timeZone: OPS_MISSIONS_TIME_ZONE });
}

function buildMissionClaimKey({ dayId, missionId, uid }) {
  return `${uid}_${dayId}_${missionId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160);
}

function mapMissionProgressRow(definition, progressData = {}) {
  if (!definition) return null;
  const progress = Number(progressData.progress);
  const claimed = progressData.claimed === true;
  const safeProgress = Number.isSafeInteger(progress) && progress >= 0
    ? Math.min(progress, definition.target)
    : 0;
  const complete = safeProgress >= definition.target;
  return {
    claimed,
    claimable: complete && !claimed,
    complete,
    kind: definition.kind,
    missionId: definition.missionId,
    progress: safeProgress,
    rewardCoins: definition.rewardCoins,
    target: definition.target,
    titleAr: definition.titleAr,
  };
}

function normalizeClaimMissionInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (Object.keys(input).some((key) => key !== 'missionId')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const missionId = typeof input.missionId === 'string' ? input.missionId.trim() : '';
  if (!missionId || missionId.length > 64) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { missionId } };
}

function normalizeAdminOpsEventMutation(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const action = typeof body.operation === 'string'
    ? body.operation.trim()
    : typeof body.action === 'string'
      ? body.action.trim()
      : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!reason || reason.length < 3) return { ok: false, code: 'INVALID_REQUEST' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, code: 'INVALID_REQUEST' };

  if (action === 'publish') {
    const eventId = typeof body.eventId === 'string' && body.eventId.trim()
      ? body.eventId.trim().slice(0, 64)
      : `evt_${Date.now().toString(36)}`;
    const titleAr = typeof body.titleAr === 'string' ? body.titleAr.trim().slice(0, OPS_EVENT_TITLE_MAX) : '';
    const themeAr = typeof body.themeAr === 'string' ? body.themeAr.trim().slice(0, OPS_EVENT_THEME_MAX) : '';
    const startsAtMs = Number(body.startsAtMs);
    const endsAtMs = Number(body.endsAtMs);
    if (!titleAr || titleAr.length < 2) return { ok: false, code: 'INVALID_REQUEST' };
    if (!Number.isSafeInteger(startsAtMs) || !Number.isSafeInteger(endsAtMs) || endsAtMs <= startsAtMs) {
      return { ok: false, code: 'INVALID_REQUEST' };
    }
    return {
      ok: true,
      value: {
        action: 'publish',
        event: {
          audience: 'all',
          endsAtMs,
          eventId,
          startsAtMs,
          status: 'published',
          themeAr,
          titleAr,
        },
        reason,
        requestId,
      },
    };
  }

  if (action === 'retire') {
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim().slice(0, 64) : '';
    if (!eventId) return { ok: false, code: 'INVALID_REQUEST' };
    return {
      ok: true,
      value: {
        action: 'retire',
        eventId,
        reason,
        requestId,
      },
    };
  }

  return { ok: false, code: 'INVALID_REQUEST' };
}

module.exports = {
  DEFAULT_DAILY_MISSIONS,
  OPS_EVENT_STATUSES,
  OPS_MISSIONS_TIME_ZONE,
  OPS_MISSION_KINDS,
  buildMissionClaimKey,
  isEventActive,
  listDefaultDailyMissions,
  mapMissionDefinition,
  mapMissionProgressRow,
  mapOpsEvent,
  normalizeAdminOpsEventMutation,
  normalizeClaimMissionInput,
  resolveMissionDay,
};
