const crypto = require('node:crypto');

const WEEKLY_INCENTIVE_SCHEMA_VERSION = 1;
const DEFAULT_INCENTIVE_TIME_ZONE = 'Asia/Baghdad';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REWARD_ITEMS = 10;
const MAX_REWARD_AMOUNT = 1_000_000_000;
const INCENTIVE_FEATURES = Object.freeze([
  'rocket-rewards',
  'payroll',
  'owner-targets',
]);
const SETTLEMENT_STATES = Object.freeze([
  'preview',
  'eligible',
  'held',
  'paying',
  'paid',
  'ineligible',
  'reversed',
  'failed',
]);
const CYCLE_STATES = Object.freeze([
  'scheduled',
  'active',
  'closed',
  'settling',
  'settled',
  'failed',
]);

function createWeeklyCycle({ nowMillis = Date.now(), templateVersion = 1, timeZone = DEFAULT_INCENTIVE_TIME_ZONE } = {}) {
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0 || !isValidTimeZone(timeZone)) {
    return { ok: false, code: 'INVALID_CYCLE' };
  }
  const local = getZonedParts(nowMillis, timeZone);
  const localDate = Date.UTC(local.year, local.month - 1, local.day);
  const mondayOffset = (new Date(localDate).getUTCDay() + 6) % 7;
  const startDate = new Date(localDate - mondayOffset * 24 * 60 * 60 * 1000);
  const startAtMillis = zonedDateTimeToUtc({
    day: startDate.getUTCDate(),
    hour: 0,
    minute: 0,
    month: startDate.getUTCMonth() + 1,
    second: 0,
    year: startDate.getUTCFullYear(),
  }, timeZone);
  const endDate = new Date(localDate - mondayOffset * 24 * 60 * 60 * 1000 + WEEK_MS);
  const endAtMillis = zonedDateTimeToUtc({
    day: endDate.getUTCDate(),
    hour: 0,
    minute: 0,
    month: endDate.getUTCMonth() + 1,
    second: 0,
    year: endDate.getUTCFullYear(),
  }, timeZone);
  const dateId = [
    startDate.getUTCFullYear(),
    String(startDate.getUTCMonth() + 1).padStart(2, '0'),
    String(startDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return {
    ok: true,
    value: {
      cycleId: `weekly_${dateId}_${timeZone.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      endAtMillis,
      schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
      startAtMillis,
      state: 'active',
      templateVersion,
      timeZone,
    },
  };
}

function createDailyBucket({ nowMillis = Date.now(), timeZone = DEFAULT_INCENTIVE_TIME_ZONE } = {}) {
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0 || !isValidTimeZone(timeZone)) {
    return { ok: false, code: 'INVALID_DAY' };
  }
  const local = getZonedParts(nowMillis, timeZone);
  const startAtMillis = zonedDateTimeToUtc({
    day: local.day,
    hour: 0,
    minute: 0,
    month: local.month,
    second: 0,
    year: local.year,
  }, timeZone);
  const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day) + 24 * 60 * 60 * 1000);
  const endAtMillis = zonedDateTimeToUtc({
    day: nextDate.getUTCDate(),
    hour: 0,
    minute: 0,
    month: nextDate.getUTCMonth() + 1,
    second: 0,
    year: nextDate.getUTCFullYear(),
  }, timeZone);
  const dateId = [
    local.year,
    String(local.month).padStart(2, '0'),
    String(local.day).padStart(2, '0'),
  ].join('-');
  return {
    ok: true,
    value: {
      dayId: `day_${dateId}_${timeZone.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      endAtMillis,
      schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
      startAtMillis,
      timeZone,
    },
  };
}

function normalizeWeeklyCycle(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'cycleId', 'endAtMillis', 'schemaVersion', 'startAtMillis', 'state', 'templateVersion', 'timeZone',
  ])) return { ok: false, code: 'INVALID_CYCLE' };
  const cycleId = normalizeIdentifier(input.cycleId, 120);
  if (
    !cycleId
    || input.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION
    || !Number.isSafeInteger(input.startAtMillis)
    || !Number.isSafeInteger(input.endAtMillis)
    || input.endAtMillis <= input.startAtMillis
    || input.endAtMillis - input.startAtMillis < WEEK_MS - 60 * 60 * 1000
    || input.endAtMillis - input.startAtMillis > WEEK_MS + 60 * 60 * 1000
    || !Number.isSafeInteger(input.templateVersion)
    || input.templateVersion < 1
    || !CYCLE_STATES.includes(input.state)
    || !isValidTimeZone(input.timeZone)
  ) return { ok: false, code: 'INVALID_CYCLE' };
  return { ok: true, value: { ...input, cycleId } };
}

function normalizeRewardBundle(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, ['coins', 'diamonds', 'items', 'schemaVersion'])) {
    return { ok: false, code: 'INVALID_REWARD' };
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION) {
    return { ok: false, code: 'INVALID_REWARD' };
  }
  const coins = input.coins === undefined ? 0 : input.coins;
  const diamonds = input.diamonds === undefined ? 0 : input.diamonds;
  if (!isRewardAmount(coins) || !isRewardAmount(diamonds)) return { ok: false, code: 'INVALID_REWARD' };
  const rawItems = input.items === undefined ? [] : input.items;
  if (!Array.isArray(rawItems) || rawItems.length > MAX_REWARD_ITEMS) return { ok: false, code: 'INVALID_REWARD' };
  const items = [];
  const seen = new Set();
  for (const rawItem of rawItems) {
    const item = normalizeRewardItem(rawItem);
    if (!item || seen.has(item.itemId)) return { ok: false, code: 'INVALID_REWARD' };
    seen.add(item.itemId);
    items.push(item);
  }
  if (coins === 0 && diamonds === 0 && items.length === 0) return { ok: false, code: 'EMPTY_REWARD' };
  return {
    ok: true,
    value: {
      coins,
      diamonds,
      items,
      schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
    },
  };
}

function normalizeRewardItem(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, ['duplicateFallback', 'itemId'])) return undefined;
  const itemId = normalizeIdentifier(input.itemId, 80);
  if (!itemId) return undefined;
  let duplicateFallback;
  if (input.duplicateFallback !== undefined) {
    if (!isPlainObject(input.duplicateFallback) || hasUnknownKeys(input.duplicateFallback, ['amount', 'currency'])) return undefined;
    if (!['coins', 'diamonds'].includes(input.duplicateFallback.currency) || !isPositiveRewardAmount(input.duplicateFallback.amount)) return undefined;
    duplicateFallback = {
      amount: input.duplicateFallback.amount,
      currency: input.duplicateFallback.currency,
    };
  }
  return { ...(duplicateFallback ? { duplicateFallback } : {}), itemId };
}

function createSettlementId({ cycleId, feature, planId = '', rank = 0, roomId = '', uid }) {
  const featureScopeIsValid = feature === 'rocket-rewards'
    ? Boolean(roomId) && rank >= 1 && rank <= 3
    : feature === 'payroll'
      ? Boolean(planId) && rank === 0
      : feature === 'owner-targets'
        ? Boolean(roomId) && rank === 0
        : false;
  if (
    !INCENTIVE_FEATURES.includes(feature)
    || !featureScopeIsValid
    || !normalizeIdentifier(cycleId, 120)
    || !normalizeUid(uid)
    || (planId && !normalizeIdentifier(planId, 120))
    || (roomId && !normalizeIdentifier(roomId, 128))
    || !Number.isSafeInteger(rank)
    || rank < 0
  ) return '';
  const scope = stableStringify({ cycleId, feature, planId, rank, roomId, uid });
  return `ris_${crypto.createHash('sha256').update(scope).digest('hex').slice(0, 40)}`;
}

function createWeeklyCycleDocumentId({ cycleId, feature, scopeId }) {
  if (!normalizeIdentifier(cycleId, 120) || !INCENTIVE_FEATURES.includes(feature) || !normalizeIdentifier(scopeId, 128)) return '';
  const digest = crypto.createHash('sha256')
    .update(stableStringify({ cycleId, feature, scopeId }))
    .digest('hex')
    .slice(0, 40);
  return `wic_${digest}`;
}

function createSettlementFingerprint({ cycleId, feature, rewardBundle, source, uid }) {
  const normalized = normalizeRewardBundle(rewardBundle);
  if (!normalized.ok || !normalizeIdentifier(cycleId, 120) || !INCENTIVE_FEATURES.includes(feature) || !normalizeUid(uid) || !isPlainObject(source)) return '';
  return crypto.createHash('sha256')
    .update(stableStringify({ cycleId, feature, rewardBundle: normalized.value, source, uid }))
    .digest('hex');
}

function normalizeCanonicalGiftFact(event, { cycleId } = {}) {
  if (!isPlainObject(event)) return { ok: false, code: 'INVALID_GIFT_FACT' };
  const eventId = normalizeIdentifier(event.eventId, 160);
  const roomId = normalizeIdentifier(event.roomId, 128);
  const senderUid = normalizeUid(event.senderUid);
  const recipientUid = normalizeUid(event.recipientUid);
  const normalizedCycleId = normalizeIdentifier(cycleId, 120);
  const occurredAtMillis = timestampToMillis(event.createdAt);
  if (
    !normalizedCycleId
    || !eventId
    || !roomId
    || !senderUid
    || !recipientUid
    || event.status !== 'committed'
    || event.currency !== 'coins'
    || !isPositiveRewardAmount(event.price)
    || !Number.isSafeInteger(event.scoreValue)
    || event.scoreValue < 0
    || !Number.isSafeInteger(occurredAtMillis)
    || occurredAtMillis < 0
  ) return { ok: false, code: 'INVALID_GIFT_FACT' };
  return {
    ok: true,
    value: {
      catalogScoreValue: event.scoreValue,
      cycleId: normalizedCycleId,
      debitedCoins: event.price,
      eventId,
      occurredAtMillis,
      recipientUid,
      roomId,
      schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
      senderUid,
      supportPoints: event.price,
    },
  };
}

function normalizeSettlementWorkerOptions(input = {}) {
  if (!isPlainObject(input) || hasUnknownKeys(input, ['cursor', 'dryRun', 'leaseMillis', 'limit', 'workerId'])) {
    return { ok: false, code: 'INVALID_WORKER_OPTIONS' };
  }
  const limit = input.limit === undefined ? 50 : input.limit;
  const leaseMillis = input.leaseMillis === undefined ? 60_000 : input.leaseMillis;
  const workerId = typeof input.workerId === 'string' ? input.workerId.trim() : '';
  const cursor = input.cursor === undefined ? '' : normalizeIdentifier(input.cursor, 80);
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 200
    || !Number.isSafeInteger(leaseMillis)
    || leaseMillis < 10_000
    || leaseMillis > 10 * 60_000
    || !/^[A-Za-z0-9_-]{3,80}$/.test(workerId)
    || (input.cursor !== undefined && !cursor)
  ) {
    return { ok: false, code: 'INVALID_WORKER_OPTIONS' };
  }
  return { ok: true, value: { cursor, dryRun: input.dryRun === true, leaseMillis, limit, workerId } };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(milliseconds, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(milliseconds));
  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function zonedDateTimeToUtc(parts, timeZone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(guess, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const difference = desired - actualAsUtc;
    guess += difference;
    if (difference === 0) break;
  }
  return guess;
}

function timestampToMillis(value) {
  if (Number.isSafeInteger(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return NaN;
}

function normalizeIdentifier(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length <= maxLength && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized) ? normalized : '';
}

function normalizeUid(value) {
  const uid = typeof value === 'string' ? value.trim() : '';
  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

function isRewardAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REWARD_AMOUNT;
}

function isPositiveRewardAmount(value) {
  return isRewardAmount(value) && value > 0;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnknownKeys(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

module.exports = {
  CYCLE_STATES,
  DEFAULT_INCENTIVE_TIME_ZONE,
  INCENTIVE_FEATURES,
  MAX_REWARD_AMOUNT,
  MAX_REWARD_ITEMS,
  SETTLEMENT_STATES,
  WEEKLY_INCENTIVE_SCHEMA_VERSION,
  WEEK_MS,
  createSettlementFingerprint,
  createSettlementId,
  createDailyBucket,
  createWeeklyCycleDocumentId,
  createWeeklyCycle,
  normalizeCanonicalGiftFact,
  normalizeRewardBundle,
  normalizeSettlementWorkerOptions,
  normalizeWeeklyCycle,
  stableStringify,
  timestampToMillis,
};
