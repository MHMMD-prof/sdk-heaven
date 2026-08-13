const crypto = require('node:crypto');
const {
  DEFAULT_INCENTIVE_TIME_ZONE,
  WEEKLY_INCENTIVE_SCHEMA_VERSION,
  createSettlementId,
  normalizeRewardBundle,
  timestampToMillis,
} = require('./weeklyIncentiveCore');

const ROOM_ROCKET_TEMPLATE_ID = 'global-room-rocket';
const ROOM_ROCKET_TEMPLATE_VERSION = 1;
const ROOM_ROCKET_RANKS = Object.freeze([1, 2, 3]);
const ROOM_ROCKET_ASSET_LIMITS = Object.freeze({
  animation: { bytes: 12 * 1024 * 1024, durationMs: 12_000, height: 2560, width: 1440 },
  sound: { bytes: 2 * 1024 * 1024, durationMs: 12_000 },
  static: { bytes: 4 * 1024 * 1024, height: 2048, width: 2048 },
});
const ROOM_ROCKET_CYCLE_STATES = Object.freeze([
  'active',
  'unlocked',
  'missed',
  'ready',
  'settling',
  'settled',
  'held',
]);

function validateRoomRocketTemplateV1(input, { publicationStatus } = {}) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'animationApproval',
    'appearance',
    'enabledRankCount',
    'minimumClientVersion',
    'publicationStatus',
    'rewards',
    'schemaVersion',
    'targetSupportPoints',
    'templateId',
    'templateVersion',
    'timeZone',
  ])) return undefined;
  const status = publicationStatus || input.publicationStatus;
  if (
    input.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION
    || input.templateVersion !== ROOM_ROCKET_TEMPLATE_VERSION
    || input.templateId !== ROOM_ROCKET_TEMPLATE_ID
    || !['draft', 'published', 'disabled'].includes(status)
    || !Number.isSafeInteger(input.targetSupportPoints)
    || input.targetSupportPoints < 1
    || input.targetSupportPoints > 1_000_000_000
    || !ROOM_ROCKET_RANKS.includes(input.enabledRankCount)
    || !isSemver(input.minimumClientVersion)
    || !isValidTimeZone(input.timeZone || DEFAULT_INCENTIVE_TIME_ZONE)
  ) return undefined;

  const appearance = normalizeAppearance(input.appearance, status === 'published');
  const rewards = normalizeRankRewards(input.rewards, input.enabledRankCount);
  if (!appearance || !rewards) return undefined;
  const animationApproval = normalizeAnimationApproval(input.animationApproval);
  if (status === 'published' && !animationApproval) return undefined;
  return {
    ...(animationApproval ? { animationApproval } : {}),
    appearance,
    enabledRankCount: input.enabledRankCount,
    minimumClientVersion: input.minimumClientVersion.trim(),
    publicationStatus: status,
    rewards,
    schemaVersion: WEEKLY_INCENTIVE_SCHEMA_VERSION,
    targetSupportPoints: input.targetSupportPoints,
    templateId: ROOM_ROCKET_TEMPLATE_ID,
    templateVersion: ROOM_ROCKET_TEMPLATE_VERSION,
    timeZone: input.timeZone || DEFAULT_INCENTIVE_TIME_ZONE,
  };
}

function normalizeAppearance(input, requireAssets) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'animationAsset', 'name', 'soundAsset', 'staticAsset',
  ])) return undefined;
  const name = normalizeLocalizedName(input.name);
  const staticAsset = normalizeRocketAsset(input.staticAsset, 'static');
  const animationAsset = normalizeRocketAsset(input.animationAsset, 'animation');
  const soundAsset = input.soundAsset === undefined ? undefined : normalizeRocketAsset(input.soundAsset, 'sound');
  if (!name || (requireAssets && (!staticAsset || !animationAsset)) || (input.soundAsset !== undefined && !soundAsset)) {
    return undefined;
  }
  return {
    ...(animationAsset ? { animationAsset } : {}),
    name,
    ...(soundAsset ? { soundAsset } : {}),
    ...(staticAsset ? { staticAsset } : {}),
  };
}

function normalizeRocketAsset(input, slot) {
  const allowed = slot === 'sound'
    ? ['bytes', 'durationMs', 'format', 'storagePath', 'uri', 'version']
    : ['bytes', 'durationMs', 'format', 'height', 'storagePath', 'uri', 'version', 'width'];
  if (!isPlainObject(input) || hasUnknownKeys(input, allowed)) return undefined;
  const version = Number.isSafeInteger(input.version) && input.version >= 1 ? input.version : 0;
  const storagePath = typeof input.storagePath === 'string' ? input.storagePath.trim() : '';
  const uri = normalizeHttpsUrl(input.uri);
  const formats = slot === 'static'
    ? ['png', 'webp']
    : slot === 'animation'
      ? ['mp4', 'lottie-json', 'animated-webp']
      : ['mp3', 'm4a'];
  const limit = ROOM_ROCKET_ASSET_LIMITS[slot];
  if (
    !version
    || !uri
    || !formats.includes(input.format)
    || !isPositiveBoundedInteger(input.bytes, limit.bytes)
    || !new RegExp(`^room-rockets/${ROOM_ROCKET_TEMPLATE_ID}/v${version}/[A-Za-z0-9._-]+$`).test(storagePath)
  ) return undefined;
  if (slot === 'sound') {
    if (!isPositiveBoundedInteger(input.durationMs, limit.durationMs)) return undefined;
    return {
      bytes: input.bytes,
      durationMs: input.durationMs,
      format: input.format,
      storagePath,
      uri,
      version,
    };
  }
  if (
    !isPositiveBoundedInteger(input.width, limit.width)
    || !isPositiveBoundedInteger(input.height, limit.height)
    || (slot === 'animation' && !isPositiveBoundedInteger(input.durationMs, limit.durationMs))
  ) return undefined;
  return {
    bytes: input.bytes,
    ...(slot === 'animation' ? { durationMs: input.durationMs } : {}),
    format: input.format,
    height: input.height,
    storagePath,
    uri,
    version,
    width: input.width,
  };
}

function normalizeAnimationApproval(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, [
    'approvalId',
    'fallbackVerified',
    'memoryVerified',
    'physicalAndroidDevice',
    'reducedMotionVerified',
    'testedClientVersion',
  ])) return undefined;
  const approvalId = normalizeId(input.approvalId, 80);
  const physicalAndroidDevice = typeof input.physicalAndroidDevice === 'string'
    ? input.physicalAndroidDevice.trim().slice(0, 120)
    : '';
  if (
    !approvalId
    || !physicalAndroidDevice
    || !isSemver(input.testedClientVersion)
    || input.fallbackVerified !== true
    || input.memoryVerified !== true
    || input.reducedMotionVerified !== true
  ) return undefined;
  return {
    approvalId,
    fallbackVerified: true,
    memoryVerified: true,
    physicalAndroidDevice,
    reducedMotionVerified: true,
    testedClientVersion: input.testedClientVersion.trim(),
  };
}

function normalizeRankRewards(input, enabledRankCount) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !['1', '2', '3'].includes(key))) return undefined;
  const rewards = {};
  for (const rank of ROOM_ROCKET_RANKS) {
    const raw = input[String(rank)];
    if (rank > enabledRankCount) {
      if (raw !== undefined) return undefined;
      continue;
    }
    const reward = normalizeRewardBundle(raw);
    if (!reward.ok) return undefined;
    rewards[String(rank)] = reward.value;
  }
  return rewards;
}

function applyRocketGiftProgress(cycle, fact) {
  if (
    !isPlainObject(cycle)
    || !['active', 'unlocked'].includes(cycle.state)
    || !Number.isSafeInteger(cycle.targetSupportPoints)
    || cycle.targetSupportPoints < 1
    || !Number.isSafeInteger(cycle.supportPoints)
    || cycle.supportPoints < 0
    || !isPlainObject(fact)
    || !Number.isSafeInteger(fact.supportPoints)
    || fact.supportPoints < 1
  ) return { ok: false, code: 'INVALID_ROCKET_PROGRESS' };
  const supportPoints = Math.min(Number.MAX_SAFE_INTEGER, cycle.supportPoints + fact.supportPoints);
  if (!Number.isSafeInteger(supportPoints)) return { ok: false, code: 'ROCKET_PROGRESS_OVERFLOW' };
  const crossedGoal = cycle.state === 'active' && cycle.supportPoints < cycle.targetSupportPoints
    && supportPoints >= cycle.targetSupportPoints;
  return {
    ok: true,
    value: {
      crossedGoal,
      giftCount: (Number.isSafeInteger(cycle.giftCount) ? cycle.giftCount : 0) + 1,
      state: crossedGoal ? 'unlocked' : cycle.state,
      supportPoints,
    },
  };
}

function selectRocketPodium(candidates, { enabledRankCount, isEligible }) {
  if (!Array.isArray(candidates) || !ROOM_ROCKET_RANKS.includes(enabledRankCount) || typeof isEligible !== 'function') {
    return { ok: false, code: 'INVALID_ROCKET_CANDIDATES' };
  }
  const sorted = candidates
    .filter(isSupporterCandidate)
    .sort(compareSupporters);
  const winners = [];
  const disqualified = [];
  for (const candidate of sorted) {
    const eligibility = isEligible(candidate);
    if (!eligibility?.eligible) {
      disqualified.push({ reason: eligibility?.reason || 'INELIGIBLE', uid: candidate.uid });
      continue;
    }
    winners.push({
      eligibleSpendCoins: candidate.eligibleSpendCoins,
      firstContributionAtMillis: readContributionMillis(candidate),
      rank: winners.length + 1,
      supportPoints: candidate.supportPoints,
      uid: candidate.uid,
    });
    if (winners.length === enabledRankCount) break;
  }
  return { ok: true, value: { disqualified, winners } };
}

function buildRocketSettlementInputs({ cycle, roomId, winners }) {
  if (!isPlainObject(cycle) || !normalizeId(cycle.cycleId, 120) || !normalizeId(roomId, 128) || !Array.isArray(winners)) {
    return { ok: false, code: 'INVALID_ROCKET_SETTLEMENT' };
  }
  const inputs = [];
  for (const winner of winners) {
    const rewardBundle = cycle.rewards?.[String(winner.rank)];
    const normalizedReward = normalizeRewardBundle(rewardBundle);
    const settlementId = createSettlementId({
      cycleId: cycle.cycleId,
      feature: 'rocket-rewards',
      rank: winner.rank,
      roomId,
      uid: winner.uid,
    });
    if (!normalizedReward.ok || !settlementId) return { ok: false, code: 'INVALID_ROCKET_SETTLEMENT' };
    inputs.push({
      cycleId: cycle.cycleId,
      feature: 'rocket-rewards',
      rewardBundle: normalizedReward.value,
      settlementId,
      source: { rank: winner.rank, roomId },
      uid: winner.uid,
    });
  }
  return { ok: true, value: inputs };
}

function calculateRocketRewardLiability(rewards, enabledRankCount) {
  const normalized = normalizeRankRewards(rewards, enabledRankCount);
  if (!normalized) return undefined;
  return ROOM_ROCKET_RANKS
    .filter((rank) => rank <= enabledRankCount)
    .reduce((total, rank) => {
      const reward = normalized[String(rank)];
      return {
        coins: total.coins + reward.coins,
        diamonds: total.diamonds + reward.diamonds,
        itemGrantCount: total.itemGrantCount + reward.items.length,
        rankCount: total.rankCount + 1,
      };
    }, { coins: 0, diamonds: 0, itemGrantCount: 0, rankCount: 0 });
}

function createRocketProjectionReceiptId(eventId) {
  const id = normalizeId(eventId, 160);
  return id ? `rrp_${crypto.createHash('sha256').update(id).digest('hex').slice(0, 40)}` : '';
}

function createRocketGoalEventId(roomId, cycleId) {
  if (!normalizeId(roomId, 128) || !normalizeId(cycleId, 120)) return '';
  return `rrg_${crypto.createHash('sha256').update(`${roomId}|${cycleId}`).digest('hex').slice(0, 40)}`;
}

function compareSupporters(left, right) {
  return right.eligibleSpendCoins - left.eligibleSpendCoins
    || readContributionMillis(left) - readContributionMillis(right)
    || String(left.uid).localeCompare(String(right.uid));
}

function isSupporterCandidate(value) {
  return Boolean(
    isPlainObject(value)
    && normalizeId(value.uid, 128)
    && Number.isSafeInteger(value.eligibleSpendCoins)
    && value.eligibleSpendCoins >= 0
    && Number.isSafeInteger(value.supportPoints)
    && value.supportPoints >= 0
    && Number.isSafeInteger(readContributionMillis(value)),
  );
}

function readContributionMillis(value) {
  return timestampToMillis(value?.firstContributionAt) || value?.firstContributionAtMillis || 0;
}

function normalizeLocalizedName(input) {
  if (!isPlainObject(input) || hasUnknownKeys(input, ['ar', 'en'])) return undefined;
  const ar = typeof input.ar === 'string' ? input.ar.trim().slice(0, 60) : '';
  const en = typeof input.en === 'string' ? input.en.trim().slice(0, 60) : '';
  return ar && en ? { ar, en } : undefined;
}

function isSemver(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.trim());
}

function normalizeHttpsUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/[^\s]{1,2039}$/.test(url) ? url : '';
}

function normalizeId(value, maxLength) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= maxLength && !id.includes('/') ? id : '';
}

function isPositiveBoundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
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
  ROOM_ROCKET_ASSET_LIMITS,
  ROOM_ROCKET_CYCLE_STATES,
  ROOM_ROCKET_RANKS,
  ROOM_ROCKET_TEMPLATE_ID,
  ROOM_ROCKET_TEMPLATE_VERSION,
  applyRocketGiftProgress,
  buildRocketSettlementInputs,
  calculateRocketRewardLiability,
  compareSupporters,
  createRocketGoalEventId,
  createRocketProjectionReceiptId,
  selectRocketPodium,
  validateRoomRocketTemplateV1,
};
