const crypto = require('node:crypto');
const {
  DEFAULT_INCENTIVE_TIME_ZONE,
  WEEKLY_INCENTIVE_SCHEMA_VERSION,
  createSettlementId,
} = require('./weeklyIncentiveCore');

const ROOM_TARGET_TEMPLATE_ID = 'global-room-target';
const ROOM_TARGET_TEMPLATE_VERSION = 1;
const ROOM_TARGET_MAX_SELECTED_USERS = 20;
const ROOM_TARGET_MAX_AMOUNT = 1_000_000_000;
const ROOM_TARGET_CYCLE_STATES = Object.freeze([
  'active',
  'unlocked',
  'missed',
  'ready',
  'settling',
  'settled',
  'held',
]);

function validateRoomTargetTemplateV1(input, { publicationStatus } = {}) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'conversion',
    'eligibleGiftRules',
    'enabled',
    'maxSelectedUsers',
    'perRoomReturnCap',
    'perUserReturnCap',
    'publicationStatus',
    'returnBps',
    'riskValuation',
    'schemaVersion',
    'targetSupportPoints',
    'templateId',
    'templateVersion',
    'timeZone',
  ])) return undefined;
  const status = publicationStatus || input.publicationStatus;
  if (
    input.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION
    || input.templateVersion !== ROOM_TARGET_TEMPLATE_VERSION
    || input.templateId !== ROOM_TARGET_TEMPLATE_ID
    || !['draft', 'published', 'disabled'].includes(status)
    || typeof input.enabled !== 'boolean'
    || !isPositiveBoundedInteger(input.targetSupportPoints, ROOM_TARGET_MAX_AMOUNT)
    || !Number.isSafeInteger(input.returnBps)
    || input.returnBps < 1
    || input.returnBps > 10_000
    || !Number.isSafeInteger(input.maxSelectedUsers)
    || input.maxSelectedUsers < 0
    || input.maxSelectedUsers > ROOM_TARGET_MAX_SELECTED_USERS
    || !isPositiveBoundedInteger(input.perUserReturnCap, ROOM_TARGET_MAX_AMOUNT)
    || !isPositiveBoundedInteger(input.perRoomReturnCap, ROOM_TARGET_MAX_AMOUNT)
    || input.perRoomReturnCap < input.perUserReturnCap
    || !isValidTimeZone(input.timeZone || DEFAULT_INCENTIVE_TIME_ZONE)
  ) return undefined;
  const conversion = normalizeConversion(input.conversion);
  const eligibleGiftRules = normalizeEligibleGiftRules(input.eligibleGiftRules);
  const riskValuation = normalizeRiskValuation(input.riskValuation);
  if (!conversion || !eligibleGiftRules || !riskValuation) return undefined;
  return {
    conversion,
    eligibleGiftRules,
    enabled: input.enabled,
    maxSelectedUsers: input.maxSelectedUsers,
    perRoomReturnCap: input.perRoomReturnCap,
    perUserReturnCap: input.perUserReturnCap,
    publicationStatus: status,
    returnBps: input.returnBps,
    riskValuation,
    schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
    targetSupportPoints: input.targetSupportPoints,
    templateId: ROOM_TARGET_TEMPLATE_ID,
    templateVersion: ROOM_TARGET_TEMPLATE_VERSION,
    timeZone: input.timeZone || DEFAULT_INCENTIVE_TIME_ZONE,
  };
}

function normalizeConversion(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'denominator',
    'numerator',
    'payoutCurrency',
    'rounding',
    'sourceCurrency',
  ])) return undefined;
  if (
    input.sourceCurrency !== 'coins'
    || !['coins', 'diamonds'].includes(input.payoutCurrency)
    || input.rounding !== 'floor'
    || !isPositiveBoundedInteger(input.numerator, 1_000_000)
    || !isPositiveBoundedInteger(input.denominator, 1_000_000)
    || greatestCommonDivisor(input.numerator, input.denominator) !== 1
    || (input.payoutCurrency === 'coins' && (input.numerator !== 1 || input.denominator !== 1))
  ) return undefined;
  return {
    denominator: input.denominator,
    numerator: input.numerator,
    payoutCurrency: input.payoutCurrency,
    rounding: 'floor',
    sourceCurrency: 'coins',
  };
}

function normalizeEligibleGiftRules(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'committedOnly',
    'excludeSelfGifts',
    'minimumDebitedCoins',
  ])) return undefined;
  if (
    input.committedOnly !== true
    || input.excludeSelfGifts !== true
    || !isPositiveBoundedInteger(input.minimumDebitedCoins, ROOM_TARGET_MAX_AMOUNT)
  ) return undefined;
  return {
    committedOnly: true,
    excludeSelfGifts: true,
    minimumDebitedCoins: input.minimumDebitedCoins,
  };
}

function normalizeRiskValuation(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'diamondValueCoins',
    'itemValuesCoins',
  ])) return undefined;
  if (!isPositiveBoundedInteger(input.diamondValueCoins, 1_000_000)) return undefined;
  if (!isPlainObject(input.itemValuesCoins) || Object.keys(input.itemValuesCoins).length > 100) return undefined;
  const itemValuesCoins = {};
  for (const [itemId, value] of Object.entries(input.itemValuesCoins)) {
    const normalizedId = normalizeId(itemId, 128);
    if (!normalizedId || !isPositiveBoundedInteger(value, ROOM_TARGET_MAX_AMOUNT)) return undefined;
    itemValuesCoins[normalizedId] = value;
  }
  return { diamondValueCoins: input.diamondValueCoins, itemValuesCoins };
}

function normalizeRoomTargetRosterInput(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, ['requestId', 'roomId', 'selectedUids'])) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const requestId = normalizeId(input.requestId, 80);
  const roomId = normalizeId(input.roomId, 128);
  if (!requestId || requestId.length < 16 || !roomId || !Array.isArray(input.selectedUids)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const selectedUids = [];
  const seen = new Set();
  for (const candidate of input.selectedUids) {
    const uid = normalizeId(candidate, 128);
    if (!uid || seen.has(uid)) return { ok: false, code: seen.has(uid) ? 'DUPLICATE_ROSTER_USER' : 'INVALID_REQUEST' };
    seen.add(uid);
    selectedUids.push(uid);
  }
  if (selectedUids.length > ROOM_TARGET_MAX_SELECTED_USERS) return { ok: false, code: 'ROSTER_LIMIT_EXCEEDED' };
  return { ok: true, value: { requestId, roomId, selectedUids } };
}

function applyRoomTargetGiftProgress(cycle, member, fact) {
  if (
    !isPlainObject(cycle)
    || !['active', 'unlocked'].includes(cycle.state)
    || !isPositiveBoundedInteger(cycle.targetSupportPoints, ROOM_TARGET_MAX_AMOUNT)
    || !isNonNegativeSafeInteger(cycle.supportPoints)
    || !isNonNegativeSafeInteger(cycle.eligibleSpendCoins)
    || !isPlainObject(member)
    || !normalizeId(member.uid, 128)
    || !isNonNegativeSafeInteger(member.supportPoints)
    || !isNonNegativeSafeInteger(member.eligibleSpendCoins)
    || !isEligibleTargetFact(fact, cycle)
  ) return { ok: false, code: 'INVALID_TARGET_PROGRESS' };
  const supportPoints = safeAdd(cycle.supportPoints, fact.supportPoints);
  const eligibleSpendCoins = safeAdd(cycle.eligibleSpendCoins, fact.debitedCoins);
  const memberSupportPoints = safeAdd(member.supportPoints, fact.supportPoints);
  const memberEligibleSpendCoins = safeAdd(member.eligibleSpendCoins, fact.debitedCoins);
  if ([supportPoints, eligibleSpendCoins, memberSupportPoints, memberEligibleSpendCoins].some((value) => value === undefined)) {
    return { ok: false, code: 'TARGET_PROGRESS_OVERFLOW' };
  }
  const crossedGoal = cycle.state === 'active'
    && cycle.supportPoints < cycle.targetSupportPoints
    && supportPoints >= cycle.targetSupportPoints;
  return {
    ok: true,
    value: {
      crossedGoal,
      cycle: {
        eligibleSpendCoins,
        giftCount: safeAdd(cycle.giftCount || 0, 1),
        state: crossedGoal ? 'unlocked' : cycle.state,
        supportPoints,
      },
      member: {
        eligibleSpendCoins: memberEligibleSpendCoins,
        giftCount: safeAdd(member.giftCount || 0, 1),
        supportPoints: memberSupportPoints,
      },
    },
  };
}

function isEligibleTargetFact(fact, cycle) {
  return Boolean(
    isPlainObject(fact)
    && normalizeId(fact.eventId, 160)
    && fact.roomId === cycle.roomId
    && fact.weekId === cycle.cycleId
    && normalizeId(fact.senderUid, 128)
    && normalizeId(fact.recipientUid, 128)
    && fact.senderUid !== fact.recipientUid
    && isPositiveBoundedInteger(fact.debitedCoins, ROOM_TARGET_MAX_AMOUNT)
    && isPositiveBoundedInteger(fact.supportPoints, ROOM_TARGET_MAX_AMOUNT)
    && fact.debitedCoins >= cycle.eligibleGiftRules?.minimumDebitedCoins
  );
}

function calculateRoomTargetReturn(eligibleSpendCoins, template) {
  if (!isNonNegativeSafeInteger(eligibleSpendCoins)) return undefined;
  const normalized = validateRoomTargetTemplateV1(template, {
    publicationStatus: template?.publicationStatus || 'published',
  });
  if (!normalized) return undefined;
  const coinReturn = floorMultiplyDivide(eligibleSpendCoins, normalized.returnBps, 10_000);
  if (coinReturn === undefined) return undefined;
  const converted = floorMultiplyDivide(
    coinReturn,
    normalized.conversion.numerator,
    normalized.conversion.denominator,
  );
  if (converted === undefined) return undefined;
  return Math.min(converted, normalized.perUserReturnCap);
}

function allocateRoomTargetReturns(members, template) {
  if (!Array.isArray(members)) return { ok: false, code: 'INVALID_TARGET_MEMBERS' };
  const normalized = validateRoomTargetTemplateV1(template, {
    publicationStatus: template?.publicationStatus || 'published',
  });
  if (!normalized) return { ok: false, code: 'INVALID_TARGET_TEMPLATE' };
  const candidates = [];
  for (const member of members) {
    const uid = normalizeId(member?.uid, 128);
    if (!uid || !isNonNegativeSafeInteger(member.eligibleSpendCoins)) {
      return { ok: false, code: 'INVALID_TARGET_MEMBERS' };
    }
    const requestedReturn = member.eligible === false
      ? 0
      : calculateRoomTargetReturn(member.eligibleSpendCoins, normalized);
    if (requestedReturn === undefined) return { ok: false, code: 'INVALID_TARGET_RETURN' };
    candidates.push({ ...member, requestedReturn, uid });
  }
  const requestedTotal = candidates.reduce((total, member) => safeAdd(total, member.requestedReturn), 0);
  if (requestedTotal === undefined) return { ok: false, code: 'TARGET_RETURN_OVERFLOW' };
  if (requestedTotal <= normalized.perRoomReturnCap) {
    return {
      ok: true,
      value: {
        allocations: candidates.map((member) => ({
          amount: member.requestedReturn,
          cappedByRoom: false,
          eligibleSpendCoins: member.eligibleSpendCoins,
          uid: member.uid,
        })),
        requestedTotal,
        total: requestedTotal,
      },
    };
  }
  const base = candidates.map((member) => {
    const scaled = BigInt(member.requestedReturn) * BigInt(normalized.perRoomReturnCap);
    const amount = Number(scaled / BigInt(requestedTotal));
    return {
      amount,
      eligibleSpendCoins: member.eligibleSpendCoins,
      remainder: scaled % BigInt(requestedTotal),
      requestedReturn: member.requestedReturn,
      uid: member.uid,
    };
  });
  let remaining = normalized.perRoomReturnCap - base.reduce((sum, member) => sum + member.amount, 0);
  const order = [...base].sort((left, right) => (
    left.remainder === right.remainder
      ? left.uid.localeCompare(right.uid)
      : left.remainder > right.remainder ? -1 : 1
  ));
  for (const member of order) {
    if (remaining <= 0) break;
    if (member.amount < member.requestedReturn) {
      member.amount += 1;
      remaining -= 1;
    }
  }
  return {
    ok: true,
    value: {
      allocations: base.map((member) => ({
        amount: member.amount,
        cappedByRoom: member.amount < member.requestedReturn,
        eligibleSpendCoins: member.eligibleSpendCoins,
        uid: member.uid,
      })),
      requestedTotal,
      total: normalized.perRoomReturnCap - remaining,
    },
  };
}

function buildRoomTargetSettlementInputs({ allocations, cycle, roomId }) {
  if (!Array.isArray(allocations) || !isPlainObject(cycle) || !normalizeId(cycle.cycleId, 120) || !normalizeId(roomId, 128)) {
    return { ok: false, code: 'INVALID_TARGET_SETTLEMENT' };
  }
  const currency = cycle.conversion?.payoutCurrency;
  if (!['coins', 'diamonds'].includes(currency)) return { ok: false, code: 'INVALID_TARGET_SETTLEMENT' };
  const inputs = [];
  for (const allocation of allocations) {
    if (!normalizeId(allocation.uid, 128) || !isNonNegativeSafeInteger(allocation.amount)) {
      return { ok: false, code: 'INVALID_TARGET_SETTLEMENT' };
    }
    if (allocation.amount === 0) continue;
    const settlementId = createSettlementId({
      cycleId: cycle.cycleId,
      feature: 'owner-targets',
      rank: 0,
      roomId,
      uid: allocation.uid,
    });
    if (!settlementId) return { ok: false, code: 'INVALID_TARGET_SETTLEMENT' };
    inputs.push({
      cycleId: cycle.cycleId,
      feature: 'owner-targets',
      rewardBundle: {
        coins: currency === 'coins' ? allocation.amount : 0,
        diamonds: currency === 'diamonds' ? allocation.amount : 0,
        items: [],
        schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
      },
      settlementId,
      source: { rank: 0, roomId },
      uid: allocation.uid,
    });
  }
  return { ok: true, value: inputs };
}

function calculateRoomTargetRisk({
  commissionBps,
  rocketRewardLiability,
  template,
}) {
  const normalized = validateRoomTargetTemplateV1(template, {
    publicationStatus: template?.publicationStatus || 'published',
  });
  if (!normalized || !Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    return { ok: false, code: 'INVALID_RISK_INPUT' };
  }
  const targetCommissionCoins = floorMultiplyDivide(
    normalized.targetSupportPoints,
    commissionBps,
    10_000,
  );
  const roomTargetLiabilityCoins = ceilingMultiplyDivide(
    normalized.perRoomReturnCap,
    normalized.conversion.denominator,
    normalized.conversion.numerator,
  );
  if (targetCommissionCoins === undefined || roomTargetLiabilityCoins === undefined) {
    return { ok: false, code: 'RISK_OVERFLOW' };
  }
  const rocket = normalizeRocketLiability(rocketRewardLiability, normalized.riskValuation);
  if (!rocket.ok) return rocket;
  const stackedLiabilityCoins = safeAdd(roomTargetLiabilityCoins, rocket.value);
  if (stackedLiabilityCoins === undefined) return { ok: false, code: 'RISK_OVERFLOW' };
  return {
    ok: true,
    value: {
      commissionBps,
      marginCoins: targetCommissionCoins - stackedLiabilityCoins,
      roomTargetLiabilityCoins,
      rocketLiabilityCoins: rocket.value,
      stackedLiabilityCoins,
      targetCommissionCoins,
      viable: stackedLiabilityCoins <= targetCommissionCoins,
    },
  };
}

function normalizeRocketLiability(liability, valuation) {
  if (liability === undefined || liability === null) return { ok: true, value: 0 };
  if (
    !isPlainObject(liability)
    || !isNonNegativeSafeInteger(liability.coins)
    || !isNonNegativeSafeInteger(liability.diamonds)
    || !Array.isArray(liability.items)
  ) return { ok: false, code: 'INVALID_ROCKET_LIABILITY' };
  let total = liability.coins;
  const diamondCost = safeMultiply(liability.diamonds, valuation.diamondValueCoins);
  if (diamondCost === undefined) return { ok: false, code: 'RISK_OVERFLOW' };
  total = safeAdd(total, diamondCost);
  for (const itemId of liability.items) {
    const id = normalizeId(itemId, 128);
    const cost = id ? valuation.itemValuesCoins[id] : undefined;
    if (!isPositiveBoundedInteger(cost, ROOM_TARGET_MAX_AMOUNT)) {
      return { ok: false, code: 'UNVALUED_ROCKET_ITEM' };
    }
    total = safeAdd(total, cost);
    if (total === undefined) return { ok: false, code: 'RISK_OVERFLOW' };
  }
  return { ok: true, value: total };
}

function createRoomTargetProjectionReceiptId(eventId) {
  const id = normalizeId(eventId, 160);
  return id ? `rtp_${crypto.createHash('sha256').update(id).digest('hex').slice(0, 40)}` : '';
}

function createRoomTargetGoalEventId(roomId, cycleId) {
  if (!normalizeId(roomId, 128) || !normalizeId(cycleId, 120)) return '';
  return `rtg_${crypto.createHash('sha256').update(`${roomId}|${cycleId}`).digest('hex').slice(0, 40)}`;
}

function floorMultiplyDivide(value, numerator, denominator) {
  if (![value, numerator, denominator].every(Number.isSafeInteger) || value < 0 || numerator < 0 || denominator < 1) {
    return undefined;
  }
  const result = (BigInt(value) * BigInt(numerator)) / BigInt(denominator);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

function ceilingMultiplyDivide(value, numerator, denominator) {
  if (![value, numerator, denominator].every(Number.isSafeInteger) || value < 0 || numerator < 0 || denominator < 1) {
    return undefined;
  }
  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const result = (product + divisor - 1n) / divisor;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

function safeAdd(left, right) {
  const value = left + right;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeMultiply(left, right) {
  const value = left * right;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalizeId(value, maxLength) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= maxLength && !id.includes('/') ? id : '';
}

function isPositiveBoundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
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

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnknownKeys(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

module.exports = {
  ROOM_TARGET_CYCLE_STATES,
  ROOM_TARGET_MAX_SELECTED_USERS,
  ROOM_TARGET_TEMPLATE_ID,
  ROOM_TARGET_TEMPLATE_VERSION,
  allocateRoomTargetReturns,
  applyRoomTargetGiftProgress,
  buildRoomTargetSettlementInputs,
  calculateRoomTargetReturn,
  calculateRoomTargetRisk,
  createRoomTargetGoalEventId,
  createRoomTargetProjectionReceiptId,
  normalizeRoomTargetRosterInput,
  validateRoomTargetTemplateV1,
};
