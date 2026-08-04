const crypto = require('node:crypto');
const { mapAvatarFrameProjectionSnapshot } = require('./avatarFrameProjectionCore');
const {
  DEFAULT_INCENTIVE_TIME_ZONE,
  createDailyBucket,
  createWeeklyCycle,
  normalizeCanonicalGiftFact,
  timestampToMillis,
} = require('./weeklyIncentiveCore');

const ROOM_SUPPORT_PROJECTION_VERSION = 1;
const ROOM_SUPPORT_SHARD_COUNT = 32;
const ROOM_SUPPORT_LEADERBOARD_LIMIT = 20;

function createRoomSupportProjectionFact(event, {
  roomFallback,
  timeZone = DEFAULT_INCENTIVE_TIME_ZONE,
} = {}) {
  const occurredAtMillis = timestampToMillis(event?.createdAt);
  const day = createDailyBucket({ nowMillis: occurredAtMillis, timeZone });
  const week = createWeeklyCycle({ nowMillis: occurredAtMillis, timeZone });
  const roomStatus = typeof event?.roomStatus === 'string' ? event.roomStatus : roomFallback?.status;
  const roomVisibility = typeof event?.roomVisibility === 'string' ? event.roomVisibility : roomFallback?.visibility;
  const roomAvailability = typeof event?.roomAvailability === 'string'
    ? event.roomAvailability
    : roomFallback?.availability;
  if (
    !day.ok
    || !week.ok
    || roomStatus !== 'active'
    || roomVisibility !== 'public'
    || (roomAvailability !== undefined && roomAvailability !== 'active')
    || event?.senderUid === event?.recipientUid
    || event?.reconciliation?.balanced !== true
    || event?.reconciliation?.senderDebit !== event?.price
    || event?.reconciliation?.recipientCredit + event?.reconciliation?.platformCredit !== event?.price
  ) return { ok: false, code: 'INELIGIBLE_GIFT' };
  const canonical = normalizeCanonicalGiftFact(event, { cycleId: week.value.cycleId });
  if (!canonical.ok) return canonical;
  return {
    ok: true,
    value: {
      ...canonical.value,
      dayId: day.value.dayId,
      dayStartAtMillis: day.value.startAtMillis,
      dayEndAtMillis: day.value.endAtMillis,
      displayNameSnapshot: normalizeDisplayName(event.senderDisplayName),
      projectionVersion: ROOM_SUPPORT_PROJECTION_VERSION,
      roomAvailability: roomAvailability || 'active',
      roomStatus,
      roomVisibility,
      weekEndAtMillis: week.value.endAtMillis,
      weekId: week.value.cycleId,
      weekStartAtMillis: week.value.startAtMillis,
    },
  };
}

function createRoomGiftSourceFingerprint(event) {
  if (!event || !isFirestoreId(event.eventId) || !isFirestoreId(event.roomId)) return '';
  const source = {
    createdAtMillis: timestampToMillis(event.createdAt),
    currency: event.currency,
    eventId: event.eventId,
    price: event.price,
    recipientUid: event.recipientUid,
    reconciliation: event.reconciliation,
    roomAvailability: event.roomAvailability,
    roomId: event.roomId,
    roomStatus: event.roomStatus,
    roomVisibility: event.roomVisibility,
    scoreValue: event.scoreValue,
    senderUid: event.senderUid,
    status: event.status,
  };
  return crypto.createHash('sha256').update(stableStringify(source)).digest('hex');
}

function createRoomSupportPeriod({ fact, periodType }) {
  if (!fact || !['day', 'week'].includes(periodType)) return undefined;
  const periodId = periodType === 'day' ? fact.dayId : fact.weekId;
  const startAtMillis = periodType === 'day' ? fact.dayStartAtMillis : fact.weekStartAtMillis;
  const endAtMillis = periodType === 'day' ? fact.dayEndAtMillis : fact.weekEndAtMillis;
  if (!periodId || !Number.isSafeInteger(startAtMillis) || !Number.isSafeInteger(endAtMillis)) return undefined;
  return {
    endAtMillis,
    periodId,
    periodKey: createRoomSupportPeriodKey(fact.roomId, periodId),
    periodType,
    roomId: fact.roomId,
    startAtMillis,
    timeZone: fact.timeZone || DEFAULT_INCENTIVE_TIME_ZONE,
  };
}

function applyRoomSupportAggregate(current, fact, period) {
  if (!fact || !period) return { ok: false, code: 'INVALID_PROJECTION' };
  const previous = current && typeof current === 'object' ? current : {};
  if (
    previous.uid !== undefined && previous.uid !== fact.senderUid
    || previous.roomId !== undefined && previous.roomId !== fact.roomId
    || previous.periodId !== undefined && previous.periodId !== period.periodId
  ) return { ok: false, code: 'PROJECTION_CONFLICT' };
  const eligibleSpendCoins = readSafeAmount(previous.eligibleSpendCoins) + fact.debitedCoins;
  const supportPoints = readSafeAmount(previous.supportPoints) + fact.supportPoints;
  const giftCount = readSafeAmount(previous.giftCount) + 1;
  if (![eligibleSpendCoins, supportPoints, giftCount].every(Number.isSafeInteger)) {
    return { ok: false, code: 'PROJECTION_OVERFLOW' };
  }
  const previousFirst = timestampToMillis(previous.firstContributionAt);
  const previousLast = timestampToMillis(previous.lastContributionAt);
  return {
    ok: true,
    value: {
      displayNameSnapshot: fact.displayNameSnapshot,
      eligibleSpendCoins,
      firstContributionAtMillis: previousFirst
        ? Math.min(previousFirst, fact.occurredAtMillis)
        : fact.occurredAtMillis,
      giftCount,
      lastContributionAtMillis: previousLast
        ? Math.max(previousLast, fact.occurredAtMillis)
        : fact.occurredAtMillis,
      periodId: period.periodId,
      periodType: period.periodType,
      projectionVersion: ROOM_SUPPORT_PROJECTION_VERSION,
      roomId: fact.roomId,
      supportPoints,
      uid: fact.senderUid,
    },
  };
}

function applyRoomSupportShard(current, fact, period, shardId) {
  const previous = current && typeof current === 'object' ? current : {};
  const eligibleSpendCoins = readSafeAmount(previous.eligibleSpendCoins) + fact.debitedCoins;
  const supportPoints = readSafeAmount(previous.supportPoints) + fact.supportPoints;
  const giftCount = readSafeAmount(previous.giftCount) + 1;
  if (![eligibleSpendCoins, supportPoints, giftCount].every(Number.isSafeInteger)) {
    return { ok: false, code: 'PROJECTION_OVERFLOW' };
  }
  return {
    ok: true,
    value: {
      eligibleSpendCoins,
      giftCount,
      periodId: period.periodId,
      projectionVersion: ROOM_SUPPORT_PROJECTION_VERSION,
      roomId: fact.roomId,
      shardId,
      supportPoints,
    },
  };
}

function createRoomSupportLeaderboard(candidates, {
  generatedAtMillis,
  period,
  totals,
} = {}) {
  if (!Array.isArray(candidates) || !period || !totals || !Number.isSafeInteger(generatedAtMillis)) {
    return { ok: false, code: 'INVALID_LEADERBOARD' };
  }
  const entries = candidates
    .filter(isLeaderboardCandidate)
    .sort(compareSupporters)
    .slice(0, ROOM_SUPPORT_LEADERBOARD_LIMIT)
    .map((candidate, index) => ({
      avatarLabel: normalizeAvatarLabel(candidate.avatarLabel),
      ...(mapAvatarFrameProjectionSnapshot(candidate.avatarFrame) ? { avatarFrame: mapAvatarFrameProjectionSnapshot(candidate.avatarFrame) } : {}),
      avatarUrl: normalizeHttpsUrl(candidate.avatarUrl),
      displayName: normalizeDisplayName(candidate.displayName || candidate.displayNameSnapshot),
      eligibleSpendCoins: candidate.eligibleSpendCoins,
      firstContributionAtMillis: timestampToMillis(candidate.firstContributionAt) || candidate.firstContributionAtMillis,
      rank: index + 1,
      supportPoints: candidate.supportPoints,
      uid: candidate.uid,
    }));
  return {
    ok: true,
    value: {
      entries,
      generatedAtMillis,
      periodId: period.periodId,
      periodType: period.periodType,
      projectionVersion: ROOM_SUPPORT_PROJECTION_VERSION,
      roomId: period.roomId,
      totals: {
        eligibleSpendCoins: readSafeAmount(totals.eligibleSpendCoins),
        giftCount: readSafeAmount(totals.giftCount),
        supportPoints: readSafeAmount(totals.supportPoints),
      },
    },
  };
}

function buildRoomSupportExpectedState(facts, period) {
  if (!Array.isArray(facts) || !period) return { ok: false, code: 'INVALID_RECONCILIATION' };
  const supporters = new Map();
  const shards = new Map();
  for (const fact of facts) {
    if (
      fact.roomId !== period.roomId
      || (period.periodType === 'day' ? fact.dayId : fact.weekId) !== period.periodId
    ) return { ok: false, code: 'FACT_PERIOD_MISMATCH' };
    const supporter = applyRoomSupportAggregate(supporters.get(fact.senderUid), fact, period);
    const shardId = createRoomSupportShardId(fact.eventId);
    const shard = applyRoomSupportShard(shards.get(shardId), fact, period, shardId);
    if (!supporter.ok || !shard.ok) return { ok: false, code: supporter.code || shard.code };
    supporters.set(fact.senderUid, supporter.value);
    shards.set(shardId, shard.value);
  }
  return {
    ok: true,
    value: {
      shards,
      supporters,
      totals: sumRoomSupportShards([...shards.values()]),
    },
  };
}

function sumRoomSupportShards(shards) {
  return (Array.isArray(shards) ? shards : []).reduce((totals, shard) => ({
    eligibleSpendCoins: totals.eligibleSpendCoins + readSafeAmount(shard?.eligibleSpendCoins),
    giftCount: totals.giftCount + readSafeAmount(shard?.giftCount),
    supportPoints: totals.supportPoints + readSafeAmount(shard?.supportPoints),
  }), { eligibleSpendCoins: 0, giftCount: 0, supportPoints: 0 });
}

function createRoomSupportPeriodKey(roomId, periodId) {
  if (!isFirestoreId(roomId) || !/^(day|weekly)_[A-Za-z0-9_-]{3,120}$/.test(periodId || '')) return '';
  return `rsp_${crypto.createHash('sha256').update(`${roomId}|${periodId}`).digest('hex').slice(0, 40)}`;
}

function createRoomSupportShardId(eventId) {
  if (!isFirestoreId(eventId)) return '';
  const value = Number.parseInt(crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 8), 16);
  return `shard_${String(value % ROOM_SUPPORT_SHARD_COUNT).padStart(2, '0')}`;
}

function createLeaderboardRefreshId(eventId, periodKey) {
  if (!isFirestoreId(eventId) || !/^rsp_[a-f0-9]{40}$/.test(periodKey || '')) return '';
  return `rsr_${crypto.createHash('sha256').update(`${eventId}|${periodKey}`).digest('hex').slice(0, 40)}`;
}

function compareSupporters(left, right) {
  return right.eligibleSpendCoins - left.eligibleSpendCoins
    || (timestampToMillis(left.firstContributionAt) || left.firstContributionAtMillis)
      - (timestampToMillis(right.firstContributionAt) || right.firstContributionAtMillis)
    || String(left.uid).localeCompare(String(right.uid));
}

function isLeaderboardCandidate(value) {
  return Boolean(
    value
    && isFirestoreId(value.uid)
    && Number.isSafeInteger(value.eligibleSpendCoins)
    && value.eligibleSpendCoins >= 0
    && Number.isSafeInteger(value.supportPoints)
    && value.supportPoints >= 0
    && Number.isSafeInteger(timestampToMillis(value.firstContributionAt) || value.firstContributionAtMillis),
  );
}

function normalizeDisplayName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function normalizeAvatarLabel(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2) : '';
}

function normalizeHttpsUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/[^\s]{1,2039}$/.test(url) ? url : '';
}

function isFirestoreId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function readSafeAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  ROOM_SUPPORT_LEADERBOARD_LIMIT,
  ROOM_SUPPORT_PROJECTION_VERSION,
  ROOM_SUPPORT_SHARD_COUNT,
  applyRoomSupportAggregate,
  applyRoomSupportShard,
  buildRoomSupportExpectedState,
  compareSupporters,
  createRoomGiftSourceFingerprint,
  createLeaderboardRefreshId,
  createRoomSupportLeaderboard,
  createRoomSupportPeriod,
  createRoomSupportPeriodKey,
  createRoomSupportProjectionFact,
  createRoomSupportShardId,
  sumRoomSupportShards,
};
