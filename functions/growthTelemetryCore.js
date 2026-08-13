'use strict';

/**
 * Growth telemetry stubs for Wave 0.
 * Counters live at `appRuntime/growthTelemetry` and are safe to read when dark.
 */

const GROWTH_TELEMETRY_COUNTER_KEYS = Object.freeze([
  'emptyRoomJoins',
  'giftGmvCoins',
  'giftGmvDiamonds',
  'matchAttempts',
  'matchRoomLandings',
  'nonemptyRoomJoins',
  'softMatchAttempts',
  'softMatchPaired',
  'vipConversions',
]);

function createEmptyGrowthTelemetry() {
  return Object.fromEntries(GROWTH_TELEMETRY_COUNTER_KEYS.map((key) => [key, 0]));
}

function mapGrowthTelemetry(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const counters = createEmptyGrowthTelemetry();
  for (const key of GROWTH_TELEMETRY_COUNTER_KEYS) {
    const value = source[key];
    counters[key] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  return {
    ...counters,
    emptyRoomJoinRate: computeRate(counters.emptyRoomJoins, counters.emptyRoomJoins + counters.nonemptyRoomJoins),
    matchToRoomRate: computeRate(counters.matchRoomLandings, counters.matchAttempts),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  };
}

function computeRate(numerator, denominator) {
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return 0;
  if (!Number.isSafeInteger(numerator) || numerator < 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function normalizeGrowthTelemetryIncrement(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!GROWTH_TELEMETRY_COUNTER_KEYS.includes(key)) {
    return { ok: false, code: 'INVALID_COUNTER' };
  }
  const amount = input.amount === undefined ? 1 : Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
    return { ok: false, code: 'INVALID_AMOUNT' };
  }
  return { ok: true, value: { amount, key } };
}

async function readGrowthTelemetry({ db }) {
  const snapshot = await db.doc('appRuntime/growthTelemetry').get();
  return mapGrowthTelemetry(snapshot.exists ? snapshot.data() : {});
}

async function incrementGrowthTelemetry({ db, fieldValue, input }) {
  const normalized = normalizeGrowthTelemetryIncrement(input);
  if (!normalized.ok) return normalized;
  const ref = db.doc('appRuntime/growthTelemetry');
  await ref.set({
    [normalized.value.key]: fieldValue.increment(normalized.value.amount),
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, value: normalized.value };
}

function buildGrowthHealthSummary({ rollout, telemetry }) {
  return {
    emptyRoomJoinRate: telemetry.emptyRoomJoinRate,
    emptyRoomJoins: telemetry.emptyRoomJoins,
    giftGmvCoins: telemetry.giftGmvCoins,
    giftGmvDiamonds: telemetry.giftGmvDiamonds,
    matchAttempts: telemetry.matchAttempts,
    matchRoomLandings: telemetry.matchRoomLandings,
    matchToRoomRate: telemetry.matchToRoomRate,
    nonemptyRoomJoins: telemetry.nonemptyRoomJoins,
    softMatchAttempts: telemetry.softMatchAttempts,
    softMatchPaired: telemetry.softMatchPaired,
    softMatchPairRate: computeRate(telemetry.softMatchPaired, telemetry.softMatchAttempts),
    stageId: rollout?.stageId ?? 0,
    stageName: rollout?.stageName || 'dark',
    vipConversions: telemetry.vipConversions,
  };
}

module.exports = {
  GROWTH_TELEMETRY_COUNTER_KEYS,
  buildGrowthHealthSummary,
  createEmptyGrowthTelemetry,
  incrementGrowthTelemetry,
  mapGrowthTelemetry,
  normalizeGrowthTelemetryIncrement,
  readGrowthTelemetry,
};
