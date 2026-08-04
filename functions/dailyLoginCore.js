const crypto = require('node:crypto');

const {
  createDailyBucket,
  normalizeRewardBundle,
  stableStringify,
  timestampToMillis,
} = require('./weeklyIncentiveCore');

const DAILY_LOGIN_SCHEMA_VERSION = 1;
const DAILY_LOGIN_TIME_ZONE = 'Asia/Baghdad';
const DAILY_LOGIN_REWARD_DAYS = 7;
const DAILY_LOGIN_RATE_LIMIT_MAX = 8;
const DAILY_LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const DAILY_LOGIN_CAMPAIGN_STATUSES = Object.freeze(['draft', 'published', 'retired']);

function normalizeDailyLoginCommandBody(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'action',
    'clientVersion',
    'deviceId',
    'requestId',
  ])) return { ok: false, code: 'INVALID_REQUEST' };
  if (!['claim-daily-login-reward', 'get-daily-login-status'].includes(input.action)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const requestId = input.requestId === undefined ? '' : normalizeRequestId(input.requestId);
  const clientVersion = input.clientVersion === undefined ? '' : normalizeClientVersion(input.clientVersion);
  const deviceId = input.deviceId === undefined ? '' : normalizeDeviceId(input.deviceId);
  if (
    (input.action === 'claim-daily-login-reward' && !requestId)
    || (input.requestId !== undefined && !requestId)
    || (input.clientVersion !== undefined && !clientVersion)
    || (input.deviceId !== undefined && !deviceId)
  ) return { ok: false, code: 'INVALID_REQUEST' };
  return {
    ok: true,
    value: {
      action: input.action,
      clientVersion,
      deviceHash: deviceId ? hashValue(deviceId) : '',
      requestId,
    },
  };
}

function normalizeDailyLoginCampaignPointer(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'activeRevision',
    'claimsPaused',
    'createdAt',
    'createdBy',
    'emergencyDisabled',
    'lastPublishedRevision',
    'presentationVisible',
    'publicationStatus',
    'revision',
    'scheduledAtMillis',
    'scheduledRevision',
    'schemaVersion',
    'updatedAt',
    'updatedBy',
  ])) return { ok: false, code: 'CAMPAIGN_INVALID' };
  if (
    input.schemaVersion !== DAILY_LOGIN_SCHEMA_VERSION
    || !Number.isSafeInteger(input.activeRevision)
    || input.activeRevision < 1
    || !DAILY_LOGIN_CAMPAIGN_STATUSES.includes(input.publicationStatus)
    || typeof input.emergencyDisabled !== 'boolean'
    || typeof input.presentationVisible !== 'boolean'
    || (input.claimsPaused !== undefined && typeof input.claimsPaused !== 'boolean')
    || (input.lastPublishedRevision !== undefined && (!Number.isSafeInteger(input.lastPublishedRevision) || input.lastPublishedRevision < input.activeRevision))
    || (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 1))
    || (input.scheduledRevision !== undefined && (!Number.isSafeInteger(input.scheduledRevision) || input.scheduledRevision < 1))
    || (input.scheduledAtMillis !== undefined && (!Number.isSafeInteger(input.scheduledAtMillis) || input.scheduledAtMillis < 0))
    || ((input.scheduledRevision === undefined) !== (input.scheduledAtMillis === undefined))
  ) return { ok: false, code: 'CAMPAIGN_INVALID' };
  return {
    ok: true,
    value: {
      activeRevision: input.activeRevision,
      claimsPaused: input.claimsPaused === true,
      emergencyDisabled: input.emergencyDisabled,
      lastPublishedRevision: input.lastPublishedRevision ?? input.activeRevision,
      presentationVisible: input.presentationVisible,
      publicationStatus: input.publicationStatus,
      revision: input.revision ?? input.activeRevision,
      ...(input.scheduledAtMillis !== undefined ? { scheduledAtMillis: input.scheduledAtMillis } : {}),
      ...(input.scheduledRevision !== undefined ? { scheduledRevision: input.scheduledRevision } : {}),
      schemaVersion: DAILY_LOGIN_SCHEMA_VERSION,
    },
  };
}

function mapDailyLoginCampaignPointer(data) {
  return normalizeDailyLoginCampaignPointer({
    activeRevision: data?.activeRevision,
    claimsPaused: data?.claimsPaused,
    emergencyDisabled: data?.emergencyDisabled,
    lastPublishedRevision: data?.lastPublishedRevision,
    presentationVisible: data?.presentationVisible,
    publicationStatus: data?.publicationStatus,
    revision: data?.revision,
    scheduledAtMillis: data?.scheduledAt === undefined ? undefined : timestampToMillis(data.scheduledAt),
    scheduledRevision: data?.scheduledRevision,
    schemaVersion: data?.schemaVersion,
  });
}

function resolveDailyLoginCampaignRevision(pointer, nowMillis) {
  if (
    !pointer
    || !Number.isSafeInteger(nowMillis)
    || nowMillis < 0
    || !Number.isSafeInteger(pointer.activeRevision)
  ) return 0;
  return pointer.scheduledRevision
    && Number.isSafeInteger(pointer.scheduledAtMillis)
    && nowMillis >= pointer.scheduledAtMillis
    ? pointer.scheduledRevision
    : pointer.activeRevision;
}

function normalizeDailyLoginCampaignVersion(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'createdAt',
    'createdBy',
    'endsAtMillis',
    'minimumClientVersion',
    'publishedAt',
    'publishedBy',
    'publicationStatus',
    'revision',
    'rewards',
    'schemaVersion',
    'startsAtMillis',
    'timeZone',
  ])) return { ok: false, code: 'CAMPAIGN_INVALID' };
  const minimumClientVersion = input.minimumClientVersion === undefined
    ? ''
    : normalizeClientVersion(input.minimumClientVersion);
  const startsAtMillis = input.startsAtMillis === undefined ? undefined : input.startsAtMillis;
  const endsAtMillis = input.endsAtMillis === undefined ? undefined : input.endsAtMillis;
  if (
    input.schemaVersion !== DAILY_LOGIN_SCHEMA_VERSION
    || !Number.isSafeInteger(input.revision)
    || input.revision < 1
    || input.publicationStatus !== 'published'
    || input.timeZone !== DAILY_LOGIN_TIME_ZONE
    || (input.minimumClientVersion !== undefined && !minimumClientVersion)
    || (startsAtMillis !== undefined && (!Number.isSafeInteger(startsAtMillis) || startsAtMillis < 0))
    || (endsAtMillis !== undefined && (!Number.isSafeInteger(endsAtMillis) || endsAtMillis < 0))
    || (startsAtMillis !== undefined && endsAtMillis !== undefined && endsAtMillis <= startsAtMillis)
    || !Array.isArray(input.rewards)
    || input.rewards.length !== DAILY_LOGIN_REWARD_DAYS
  ) return { ok: false, code: 'CAMPAIGN_INVALID' };
  const rewards = [];
  for (let index = 0; index < DAILY_LOGIN_REWARD_DAYS; index += 1) {
    const raw = input.rewards[index];
    if (!isPlainObject(raw) || hasUnknownKeys(raw, ['day', 'reward']) || raw.day !== index + 1) {
      return { ok: false, code: 'CAMPAIGN_INVALID' };
    }
    const reward = normalizeRewardBundle(raw.reward);
    if (!reward.ok) return { ok: false, code: 'CAMPAIGN_INVALID' };
    rewards.push({ day: index + 1, reward: reward.value });
  }
  return {
    ok: true,
    value: {
      ...(endsAtMillis !== undefined ? { endsAtMillis } : {}),
      minimumClientVersion,
      publicationStatus: 'published',
      revision: input.revision,
      rewards,
      schemaVersion: DAILY_LOGIN_SCHEMA_VERSION,
      ...(startsAtMillis !== undefined ? { startsAtMillis } : {}),
      timeZone: DAILY_LOGIN_TIME_ZONE,
    },
  };
}

function mapDailyLoginCampaignVersion(data) {
  return normalizeDailyLoginCampaignVersion({
    endsAtMillis: data?.endsAt === undefined ? undefined : timestampToMillis(data.endsAt),
    minimumClientVersion: data?.minimumClientVersion,
    publicationStatus: data?.publicationStatus,
    revision: data?.revision,
    rewards: data?.rewards,
    schemaVersion: data?.schemaVersion,
    startsAtMillis: data?.startsAt === undefined ? undefined : timestampToMillis(data.startsAt),
    timeZone: data?.timeZone,
  });
}

function createDailyLoginDay(nowMillis = Date.now()) {
  const bucket = createDailyBucket({ nowMillis, timeZone: DAILY_LOGIN_TIME_ZONE });
  if (!bucket.ok) return { ok: false, code: 'INVALID_DAY' };
  const match = /^day_(\d{4}-\d{2}-\d{2})_asia-baghdad$/.exec(bucket.value.dayId);
  if (!match) return { ok: false, code: 'INVALID_DAY' };
  const previousDate = shiftDateId(match[1], -1);
  return {
    ok: true,
    value: {
      dateId: match[1],
      dayId: bucket.value.dayId,
      nextResetAtMillis: bucket.value.endAtMillis,
      previousDateId: previousDate,
      startAtMillis: bucket.value.startAtMillis,
      timeZone: DAILY_LOGIN_TIME_ZONE,
    },
  };
}

function resolveDailyLoginPosition({ lastClaimDateId = '', lastStreakPosition = 0, today }) {
  if (!today || typeof today.dateId !== 'string' || typeof today.previousDateId !== 'string') {
    return { ok: false, code: 'INVALID_DAY' };
  }
  if (lastClaimDateId === today.dateId) {
    return {
      ok: true,
      value: {
        alreadyClaimed: true,
        position: normalizeStreakPosition(lastStreakPosition) || 1,
      },
    };
  }
  const consecutive = lastClaimDateId === today.previousDateId;
  const previousPosition = normalizeStreakPosition(lastStreakPosition);
  return {
    ok: true,
    value: {
      alreadyClaimed: false,
      position: consecutive && previousPosition
        ? (previousPosition % DAILY_LOGIN_REWARD_DAYS) + 1
        : 1,
    },
  };
}

function createDailyLoginReceiptId({ dayId, uid }) {
  if (!normalizeUid(uid) || !/^day_\d{4}-\d{2}-\d{2}_asia-baghdad$/.test(dayId || '')) return '';
  return `dlc_${hashValue(stableStringify({ dayId, uid })).slice(0, 40)}`;
}

function createDailyLoginSettlementId({ dayId, uid }) {
  const receiptId = createDailyLoginReceiptId({ dayId, uid });
  return receiptId ? `dls_${hashValue(receiptId).slice(0, 40)}` : '';
}

function createDailyLoginFingerprint({ campaignRevision, dayId, rewardBundle, streakPosition, uid }) {
  const reward = normalizeRewardBundle(rewardBundle);
  if (
    !reward.ok
    || !Number.isSafeInteger(campaignRevision)
    || campaignRevision < 1
    || !Number.isSafeInteger(streakPosition)
    || streakPosition < 1
    || streakPosition > DAILY_LOGIN_REWARD_DAYS
    || !createDailyLoginReceiptId({ dayId, uid })
  ) return '';
  return hashValue(stableStringify({
    campaignRevision,
    dayId,
    rewardBundle: reward.value,
    streakPosition,
    uid,
  }));
}

function resolveEffectiveReward(rewardBundle, itemRewardsEnabled) {
  const reward = normalizeRewardBundle(rewardBundle);
  if (!reward.ok) return reward;
  const value = {
    ...reward.value,
    items: itemRewardsEnabled ? reward.value.items : [],
  };
  if (value.coins === 0 && value.diamonds === 0 && value.items.length === 0) {
    return { ok: false, code: 'ITEM_REWARDS_DISABLED' };
  }
  return { ok: true, value };
}

function isClientVersionCompatible(clientVersion, minimumClientVersion) {
  if (!minimumClientVersion) return true;
  const current = parseVersion(clientVersion);
  const minimum = parseVersion(minimumClientVersion);
  if (!current || !minimum) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function isCampaignActive(campaign, nowMillis) {
  return Boolean(
    campaign
    && Number.isSafeInteger(nowMillis)
    && (campaign.startsAtMillis === undefined || nowMillis >= campaign.startsAtMillis)
    && (campaign.endsAtMillis === undefined || nowMillis < campaign.endsAtMillis)
  );
}

function resolveDailyLoginRateLimit({ nowMillis, rate }) {
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0) return { ok: false, code: 'INVALID_REQUEST' };
  const previous = Array.isArray(rate?.attemptsMs)
    ? rate.attemptsMs.filter((value) => Number.isSafeInteger(value) && value > nowMillis - DAILY_LOGIN_RATE_LIMIT_WINDOW_MS && value <= nowMillis)
    : [];
  const attemptsMs = [...previous, nowMillis].slice(-DAILY_LOGIN_RATE_LIMIT_MAX);
  if (previous.length >= DAILY_LOGIN_RATE_LIMIT_MAX) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterMillis: Math.max(1, previous[0] + DAILY_LOGIN_RATE_LIMIT_WINDOW_MS - nowMillis),
      value: { attemptsMs, count: previous.length + 1 },
    };
  }
  return { ok: true, value: { attemptsMs, count: attemptsMs.length } };
}

function publicDailyLoginCalendar(campaign, itemRewardsEnabled) {
  return campaign.rewards.map(({ day, reward }) => ({
    day,
    reward: {
      coins: reward.coins,
      diamonds: reward.diamonds,
      items: itemRewardsEnabled ? reward.items : [],
      schemaVersion: DAILY_LOGIN_SCHEMA_VERSION,
    },
  }));
}

function normalizeRequestId(value) {
  const requestId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{12,80}$/.test(requestId) ? requestId : '';
}

function normalizeClientVersion(value) {
  const version = typeof value === 'string' ? value.trim() : '';
  return parseVersion(version) ? version : '';
}

function normalizeDeviceId(value) {
  const deviceId = typeof value === 'string' ? value.trim() : '';
  return deviceId.length >= 1 && deviceId.length <= 200 ? deviceId : '';
}

function normalizeUid(value) {
  const uid = typeof value === 'string' ? value.trim() : '';
  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

function normalizeStreakPosition(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= DAILY_LOGIN_REWARD_DAYS ? value : 0;
}

function parseVersion(value) {
  const match = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:[-+][0-9A-Za-z.-]+)?$/.exec(
    typeof value === 'string' ? value : '',
  );
  return match ? match.slice(1, 4).map(Number) : undefined;
}

function shiftDateId(dateId, offsetDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateId || '');
  if (!match || !Number.isSafeInteger(offsetDays)) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnknownKeys(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

module.exports = {
  DAILY_LOGIN_CAMPAIGN_STATUSES,
  DAILY_LOGIN_RATE_LIMIT_MAX,
  DAILY_LOGIN_RATE_LIMIT_WINDOW_MS,
  DAILY_LOGIN_REWARD_DAYS,
  DAILY_LOGIN_SCHEMA_VERSION,
  DAILY_LOGIN_TIME_ZONE,
  createDailyLoginDay,
  createDailyLoginFingerprint,
  createDailyLoginReceiptId,
  createDailyLoginSettlementId,
  isCampaignActive,
  isClientVersionCompatible,
  mapDailyLoginCampaignPointer,
  mapDailyLoginCampaignVersion,
  normalizeDailyLoginCampaignPointer,
  normalizeDailyLoginCampaignVersion,
  normalizeDailyLoginCommandBody,
  publicDailyLoginCalendar,
  resolveDailyLoginCampaignRevision,
  resolveDailyLoginPosition,
  resolveDailyLoginRateLimit,
  resolveEffectiveReward,
};
