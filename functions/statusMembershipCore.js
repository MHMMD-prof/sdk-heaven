'use strict';

const STATUS_SCHEMA_VERSION = 1;
const STATUS_COMMAND_VERSION = 1;
const MAX_STATUS_POINTS = Number.MAX_SAFE_INTEGER;
const STATUS_BENEFIT_IDS = Object.freeze([
  'profile-badge',
  'avatar-frame',
  'nameplate',
  'chat-bubble',
  'room-entry-effect',
  'gated-cosmetics',
]);
const STATUS_FEATURE_FLAGS = Object.freeze([
  'vipProgression',
  'aristocracyShop',
  'statusPresentation',
  'svipCard',
  'aristocracyCard',
  'statusProjectionRepair',
  'statusAnnouncements',
  'statusAnimations',
]);
const ASSET_SLOTS = Object.freeze(['badge', 'frame', 'nameplate', 'chatBubble', 'entryEffect']);

function createDisabledStatusFeatureFlags() {
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    ...Object.fromEntries(STATUS_FEATURE_FLAGS.map((flag) => [flag, false])),
  };
}

function mapStatusFeatureFlags(data = {}) {
  const flags = createDisabledStatusFeatureFlags();
  if (!isRecord(data) || data.schemaVersion !== STATUS_SCHEMA_VERSION) return flags;
  for (const flag of STATUS_FEATURE_FLAGS) flags[flag] = data[flag] === true;
  return flags;
}

function normalizeStatusCommandRequest({ auth, data }) {
  if (!auth?.uid) return { ok: false, code: 'AUTH_REQUIRED' };
  if (!isRecord(data) || !hasOnly(data, ['action', 'payload', 'requestId', 'version'])
    || data.version !== STATUS_COMMAND_VERSION) return { ok: false, code: 'INVALID_REQUEST' };
  const action = cleanString(data.action, 40);
  const requestId = cleanString(data.requestId, 80);
  if (!['get-status-overview', 'get-status-center', 'quote-aristocracy', 'purchase-aristocracy', 'update-status-visibility'].includes(action)
    || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const payload = data.payload === undefined ? {} : data.payload;
  if (!isRecord(payload)) return { ok: false, code: 'INVALID_REQUEST' };
  if (['get-status-overview', 'get-status-center'].includes(action) && Object.keys(payload).length > 0) return { ok: false, code: 'INVALID_REQUEST' };
  if (action === 'quote-aristocracy' && (!hasOnly(payload, ['catalogVersion', 'targetRankId'])
    || Object.keys(payload).length !== 2)) return { ok: false, code: 'INVALID_REQUEST' };
  if (action === 'purchase-aristocracy' && (!hasOnly(payload, ['quoteId']) || Object.keys(payload).length !== 1)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'update-status-visibility' && (!hasOnly(payload, ['publicDisplay'])
    || Object.keys(payload).length !== 1 || typeof payload.publicDisplay !== 'boolean')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { action, payload, requestId, uid: auth.uid, version: STATUS_COMMAND_VERSION } };
}

function normalizeVipCatalogVersion(data = {}) {
  if (!isRecord(data) || !hasOnly(data, [
    'schemaVersion', 'catalogVersion', 'kind', 'state', 'tiers', 'pointPolicy',
    'authoredBy', 'approvedBy', 'reason', 'createdAt', 'publishedAt', 'retiredAt',
  ])) return invalid('INVALID_VIP_CATALOG');
  const catalogVersion = normalizeId(data.catalogVersion, 80);
  if (
    data.schemaVersion !== STATUS_SCHEMA_VERSION
    || data.kind !== 'vip-svip'
    || !catalogVersion
    || !['draft', 'published', 'retired'].includes(data.state)
    || !Array.isArray(data.tiers)
    || data.tiers.length < 2
    || data.tiers.length > 40
  ) return invalid('INVALID_VIP_CATALOG');

  const pointPolicy = normalizeVipPointPolicy(data.pointPolicy);
  if (!pointPolicy) return invalid('INVALID_VIP_POINT_POLICY');
  const tiers = data.tiers.map(normalizeVipTier);
  if (tiers.some((tier) => !tier)) return invalid('INVALID_VIP_TIER');
  if (!validateVipTierSequence(tiers)) return invalid('INVALID_VIP_TIER_SEQUENCE');
  const publication = normalizePublicationFields(data);
  if (!publication.ok) return publication;
  return {
    ok: true,
    value: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      catalogVersion,
      kind: 'vip-svip',
      state: data.state,
      tiers,
      pointPolicy,
      ...publication.value,
    },
  };
}

function normalizeVipPointPolicy(value) {
  if (!isRecord(value) || !hasOnly(value, [
    'currency', 'eligibleSources', 'pointsPerCoinNumerator', 'pointsPerCoinDenominator',
    'reversalMode', 'spendingMode',
  ])) return null;
  const sources = Array.isArray(value.eligibleSources) ? value.eligibleSources : [];
  if (
    value.currency !== 'coins'
    || sources.length !== 1
    || sources[0] !== 'representative-transfer'
    || !positiveInteger(value.pointsPerCoinNumerator, 1_000_000)
    || !positiveInteger(value.pointsPerCoinDenominator, 1_000_000)
    || value.reversalMode !== 'linked-net'
    || value.spendingMode !== 'no-effect'
  ) return null;
  return {
    currency: 'coins',
    eligibleSources: ['representative-transfer'],
    pointsPerCoinNumerator: value.pointsPerCoinNumerator,
    pointsPerCoinDenominator: value.pointsPerCoinDenominator,
    reversalMode: 'linked-net',
    spendingMode: 'no-effect',
  };
}

function normalizeVipTier(value) {
  if (!isRecord(value) || !hasOnly(value, [
    'id', 'band', 'level', 'order', 'minPoints', 'name', 'accentColor', 'benefits', 'assets',
  ])) return null;
  const id = normalizeId(value.id, 40);
  const name = normalizeLocalizedName(value.name);
  const assets = normalizeStatusAssets(value.assets);
  const benefits = normalizeBenefits(value.benefits);
  if (
    !id
    || !['vip', 'svip'].includes(value.band)
    || !positiveInteger(value.level, 20)
    || !positiveInteger(value.order, 40)
    || !nonNegativeInteger(value.minPoints, MAX_STATUS_POINTS)
    || !name
    || !validColor(value.accentColor)
    || !benefits
    || !assets
  ) return null;
  if (id !== `${value.band}-${value.level}`) return null;
  return {
    id,
    band: value.band,
    level: value.level,
    order: value.order,
    minPoints: value.minPoints,
    name,
    accentColor: value.accentColor,
    benefits,
    assets,
  };
}

function validateVipTierSequence(tiers) {
  const ids = new Set();
  let previousPoints = -1;
  let seenSvip = false;
  const nextLevel = { vip: 1, svip: 1 };
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    if (ids.has(tier.id) || tier.order !== index + 1 || tier.level !== nextLevel[tier.band]) return false;
    if (tier.minPoints <= previousPoints) return false;
    if (tier.band === 'svip') seenSvip = true;
    if (tier.band === 'vip' && seenSvip) return false;
    ids.add(tier.id);
    nextLevel[tier.band] += 1;
    previousPoints = tier.minPoints;
  }
  return tiers.some((tier) => tier.band === 'vip') && tiers.some((tier) => tier.band === 'svip');
}

function normalizeAristocracyCatalogVersion(data = {}) {
  if (!isRecord(data) || !hasOnly(data, [
    'schemaVersion', 'catalogVersion', 'kind', 'state', 'durationDays', 'ranks', 'upgradePolicy',
    'authoredBy', 'approvedBy', 'reason', 'createdAt', 'publishedAt', 'retiredAt',
  ])) return invalid('INVALID_ARISTOCRACY_CATALOG');
  const catalogVersion = normalizeId(data.catalogVersion, 80);
  if (
    data.schemaVersion !== STATUS_SCHEMA_VERSION
    || data.kind !== 'aristocracy'
    || !catalogVersion
    || !['draft', 'published', 'retired'].includes(data.state)
    || !positiveInteger(data.durationDays, 365)
    || !Array.isArray(data.ranks)
    || data.ranks.length < 1
    || data.ranks.length > 20
  ) return invalid('INVALID_ARISTOCRACY_CATALOG');
  const ranks = data.ranks.map((rank) => normalizeAristocracyRank(rank, data.durationDays));
  if (ranks.some((rank) => !rank) || !validateRankSequence(ranks)) return invalid('INVALID_ARISTOCRACY_RANK_SEQUENCE');
  const upgradePolicy = normalizeUpgradePolicy(data.upgradePolicy);
  if (!upgradePolicy) return invalid('INVALID_ARISTOCRACY_UPGRADE_POLICY');
  const publication = normalizePublicationFields(data);
  if (!publication.ok) return publication;
  return {
    ok: true,
    value: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      catalogVersion,
      kind: 'aristocracy',
      state: data.state,
      durationDays: data.durationDays,
      ranks,
      upgradePolicy,
      ...publication.value,
    },
  };
}

function normalizeAristocracyRank(value, durationDays) {
  if (!isRecord(value) || !hasOnly(value, [
    'id', 'order', 'priceCoins', 'durationDays', 'name', 'accentColor', 'benefits', 'assets',
  ])) return null;
  const id = normalizeId(value.id, 40);
  const name = normalizeLocalizedName(value.name);
  const benefits = normalizeBenefits(value.benefits);
  const assets = normalizeStatusAssets(value.assets);
  if (
    !id
    || !positiveInteger(value.order, 20)
    || !positiveInteger(value.priceCoins, 1_000_000_000)
    || value.durationDays !== durationDays
    || !name
    || !validColor(value.accentColor)
    || !benefits
    || !assets
  ) return null;
  return {
    id,
    order: value.order,
    priceCoins: value.priceCoins,
    durationDays,
    name,
    accentColor: value.accentColor,
    benefits,
    assets,
  };
}

function validateRankSequence(ranks) {
  const ids = new Set();
  let previousPrice = 0;
  for (let index = 0; index < ranks.length; index += 1) {
    const rank = ranks[index];
    if (ids.has(rank.id) || rank.order !== index + 1 || rank.priceCoins <= previousPrice) return false;
    ids.add(rank.id);
    previousPrice = rank.priceCoins;
  }
  return true;
}

function normalizeUpgradePolicy(value) {
  if (!isRecord(value) || !hasOnly(value, [
    'mode', 'rounding', 'expiryMode', 'renewalMode', 'downgradeMode', 'autoRenew', 'gifting',
  ])) return null;
  if (
    value.mode !== 'prorated-difference'
    || value.rounding !== 'ceil'
    || value.expiryMode !== 'unchanged-on-upgrade'
    || value.renewalMode !== 'manual-full-price'
    || value.downgradeMode !== 'after-expiry'
    || value.autoRenew !== false
    || value.gifting !== false
  ) return null;
  return { ...value };
}

function assertCatalogMutationAllowed(existing, next, normalizer) {
  const normalized = normalizer(next);
  if (!normalized.ok) return normalized;
  if (existing !== undefined && existing !== null) {
    const previous = normalizer(existing);
    if (!previous.ok) return invalid('INVALID_EXISTING_CATALOG');
    if (['published', 'retired'].includes(previous.value.state)) return invalid('IMMUTABLE_CATALOG');
    if (previous.value.catalogVersion !== normalized.value.catalogVersion) return invalid('CATALOG_VERSION_CONFLICT');
  }
  if (normalized.value.state === 'published' && normalized.value.authoredBy === normalized.value.approvedBy) {
    return invalid('SELF_APPROVAL_FORBIDDEN');
  }
  return normalized;
}

function mapVipAccount(data, uid) {
  if (!isRecord(data) || data.uid !== uid || data.schemaVersion !== STATUS_SCHEMA_VERSION) return null;
  if (
    !normalizeId(data.catalogVersion, 80)
    || !nonNegativeInteger(data.points, MAX_STATUS_POINTS)
    || !['active', 'frozen', 'review'].includes(data.state)
    || !nonNegativeInteger(data.highestLevelOrder, 40)
  ) return null;
  const levelId = data.levelId === null ? null : normalizeId(data.levelId, 40);
  const band = data.band === null ? null : data.band;
  const level = data.level === null ? null : data.level;
  const order = data.order === null ? null : data.order;
  if (
    (levelId === null) !== (band === null)
    || (levelId === null) !== (level === null)
    || (levelId === null) !== (order === null)
    || (band !== null && !['vip', 'svip'].includes(band))
    || (level !== null && !positiveInteger(level, 20))
    || (order !== null && !positiveInteger(order, 40))
    || (levelId !== null && levelId !== `${band}-${level}`)
  ) return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    uid,
    catalogVersion: data.catalogVersion,
    points: data.points,
    levelId,
    band,
    level,
    order,
    highestLevelOrder: data.highestLevelOrder,
    state: data.state,
  };
}

function mapVipContribution(data, eventId) {
  if (!isRecord(data) || data.schemaVersion !== STATUS_SCHEMA_VERSION || data.eventId !== eventId) return null;
  const uid = cleanString(data.uid, 128);
  const sourceId = cleanString(data.sourceId, 256);
  const policyVersion = normalizeId(data.policyVersion, 80);
  if (
    !uid
    || !sourceId
    || !policyVersion
    || !['representative-recharge', 'representative-reversal', 'admin-correction'].includes(data.kind)
    || !Number.isSafeInteger(data.pointDelta)
    || data.pointDelta === 0
    || Math.abs(data.pointDelta) > MAX_STATUS_POINTS
    || !['settled', 'reversed', 'review'].includes(data.settlementState)
  ) return null;
  if (data.kind === 'representative-recharge' && data.pointDelta < 1) return null;
  if (data.kind === 'representative-reversal' && (data.pointDelta > -1 || !cleanString(data.reversalOf, 256))) return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    eventId,
    uid,
    sourceId,
    policyVersion,
    kind: data.kind,
    pointDelta: data.pointDelta,
    settlementState: data.settlementState,
    ...(data.reversalOf ? { reversalOf: data.reversalOf } : {}),
  };
}

function mapAristocracyEntitlement(data, uid, nowMillis = Date.now()) {
  if (!isRecord(data) || data.uid !== uid || data.schemaVersion !== STATUS_SCHEMA_VERSION) return null;
  const catalogVersion = normalizeId(data.catalogVersion, 80);
  const rankId = normalizeId(data.rankId, 40);
  const expiresAtMillis = timestampMillis(data.expiresAt);
  if (
    !catalogVersion
    || !rankId
    || !positiveInteger(data.rankOrder, 20)
    || !['active', 'expired', 'frozen', 'review'].includes(data.state)
    || !Number.isFinite(expiresAtMillis)
  ) return null;
  if (data.origin !== undefined && !['paid', 'complimentary'].includes(data.origin)) return null;
  if (data.revision !== undefined && !nonNegativeInteger(data.revision, MAX_STATUS_POINTS)) return null;
  if (data.highestEverRankOrder !== undefined && !nonNegativeInteger(data.highestEverRankOrder, 20)) return null;
  const effectiveState = data.state === 'active' && expiresAtMillis <= nowMillis ? 'expired' : data.state;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    uid,
    catalogVersion,
    rankId,
    rankOrder: data.rankOrder,
    state: effectiveState,
    expiresAt: data.expiresAt,
    expiresAtMillis,
    origin: data.origin || 'paid',
    revision: data.revision || 0,
    highestEverRankOrder: data.highestEverRankOrder || data.rankOrder,
  };
}

function resolveVipTierForPoints(points, catalog) {
  const normalized = normalizeVipCatalogVersion(catalog);
  if (!normalized.ok || normalized.value.state !== 'published') return { ok: false, code: 'CATALOG_UNAVAILABLE' };
  const safePoints = nonNegativeInteger(points, MAX_STATUS_POINTS) ? points : 0;
  let tier = null;
  let nextTier = null;
  for (const candidate of normalized.value.tiers) {
    if (safePoints >= candidate.minPoints) tier = candidate;
    else { nextTier = candidate; break; }
  }
  return { ok: true, value: { points: safePoints, tier, nextTier } };
}

function buildStatusPresentation({ account, aristocracy, aristocracyCatalog, nowMillis = Date.now(), visibility = 'public', vipCatalog }) {
  if (!['public', 'hidden'].includes(visibility)) return invalid('INVALID_VISIBILITY');
  if (visibility === 'hidden') return { ok: true, value: { schemaVersion: STATUS_SCHEMA_VERSION, visibility: 'hidden' } };
  const value = { schemaVersion: STATUS_SCHEMA_VERSION, visibility: 'public' };
  if (account) {
    const mappedAccount = mapVipAccount(account, account.uid);
    const normalizedCatalog = normalizeVipCatalogVersion(vipCatalog);
    if (!mappedAccount || !normalizedCatalog.ok || normalizedCatalog.value.catalogVersion !== mappedAccount.catalogVersion) {
      return invalid('VIP_AUTHORITY_INVALID');
    }
    const tier = normalizedCatalog.value.tiers.find((candidate) => candidate.id === mappedAccount.levelId);
    if (tier && mappedAccount.state === 'active') value.vip = publicVipTier(tier, normalizedCatalog.value.catalogVersion);
  }
  if (aristocracy) {
    const entitlement = mapAristocracyEntitlement(aristocracy, aristocracy.uid, nowMillis);
    const normalizedCatalog = normalizeAristocracyCatalogVersion(aristocracyCatalog);
    if (!entitlement || !normalizedCatalog.ok || normalizedCatalog.value.catalogVersion !== entitlement.catalogVersion) {
      return invalid('ARISTOCRACY_AUTHORITY_INVALID');
    }
    const rank = normalizedCatalog.value.ranks.find((candidate) => candidate.id === entitlement.rankId);
    if (rank && entitlement.state === 'active') value.aristocracy = publicAristocracyRank(rank, normalizedCatalog.value.catalogVersion);
  }
  return { ok: true, value };
}

function mapStatusPresentation(data) {
  if (!isRecord(data) || data.schemaVersion !== STATUS_SCHEMA_VERSION || !['public', 'hidden'].includes(data.visibility)) return null;
  if (!hasOnly(data, ['schemaVersion', 'visibility', 'vip', 'aristocracy'])) return null;
  if (data.visibility === 'hidden' && (data.vip !== undefined || data.aristocracy !== undefined)) return null;
  const value = { schemaVersion: STATUS_SCHEMA_VERSION, visibility: data.visibility };
  if (data.vip !== undefined) {
    const vip = mapPublicVipTier(data.vip);
    if (!vip) return null;
    value.vip = vip;
  }
  if (data.aristocracy !== undefined) {
    const aristocracy = mapPublicAristocracyRank(data.aristocracy);
    if (!aristocracy) return null;
    value.aristocracy = aristocracy;
  }
  return value;
}

function publicVipTier(tier, catalogVersion) {
  return {
    catalogVersion,
    id: tier.id,
    band: tier.band,
    level: tier.level,
    order: tier.order,
    nameAr: tier.name.ar,
    nameEn: tier.name.en,
    accentColor: tier.accentColor,
    assets: tier.assets,
  };
}

function publicAristocracyRank(rank, catalogVersion) {
  return {
    catalogVersion,
    id: rank.id,
    order: rank.order,
    nameAr: rank.name.ar,
    nameEn: rank.name.en,
    accentColor: rank.accentColor,
    assets: rank.assets,
  };
}

function mapPublicVipTier(value) {
  if (!isRecord(value) || !hasOnly(value, ['catalogVersion', 'id', 'band', 'level', 'order', 'nameAr', 'nameEn', 'accentColor', 'assets'])) return null;
  const assets = normalizeStatusAssets(value.assets);
  if (
    !normalizeId(value.catalogVersion, 80)
    || !normalizeId(value.id, 40)
    || !['vip', 'svip'].includes(value.band)
    || !positiveInteger(value.level, 20)
    || !positiveInteger(value.order, 40)
    || value.id !== `${value.band}-${value.level}`
    || !cleanString(value.nameAr, 40)
    || !cleanString(value.nameEn, 40)
    || !validColor(value.accentColor)
    || !assets
  ) return null;
  return { ...value, assets };
}

function mapPublicAristocracyRank(value) {
  if (!isRecord(value) || !hasOnly(value, ['catalogVersion', 'id', 'order', 'nameAr', 'nameEn', 'accentColor', 'assets'])) return null;
  const assets = normalizeStatusAssets(value.assets);
  if (
    !normalizeId(value.catalogVersion, 80)
    || !normalizeId(value.id, 40)
    || !positiveInteger(value.order, 20)
    || !cleanString(value.nameAr, 40)
    || !cleanString(value.nameEn, 40)
    || !validColor(value.accentColor)
    || !assets
  ) return null;
  return { ...value, assets };
}

function sanitizeVipCatalogForClient(catalog) {
  const normalized = normalizeVipCatalogVersion(catalog);
  if (!normalized.ok || normalized.value.state !== 'published') return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    catalogVersion: normalized.value.catalogVersion,
    kind: normalized.value.kind,
    tiers: normalized.value.tiers,
    pointPolicy: normalized.value.pointPolicy,
  };
}

function sanitizeAristocracyCatalogForClient(catalog) {
  const normalized = normalizeAristocracyCatalogVersion(catalog);
  if (!normalized.ok || normalized.value.state !== 'published') return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    catalogVersion: normalized.value.catalogVersion,
    kind: normalized.value.kind,
    durationDays: normalized.value.durationDays,
    ranks: normalized.value.ranks,
    upgradePolicy: normalized.value.upgradePolicy,
  };
}

function normalizeProjectionJob(data, jobId) {
  if (!isRecord(data) || data.schemaVersion !== STATUS_SCHEMA_VERSION || data.jobId !== jobId) return null;
  const uid = cleanString(data.uid, 128);
  if (!uid || !['queued', 'processing', 'completed', 'dead-letter'].includes(data.state)) return null;
  if (!nonNegativeInteger(data.attempts, 100)) return null;
  return { schemaVersion: STATUS_SCHEMA_VERSION, jobId, uid, state: data.state, attempts: data.attempts };
}

function normalizeStatusSourceOutbox(data, eventId) {
  if (!isRecord(data) || !hasOnly(data, [
    'schemaVersion', 'eventId', 'uid', 'sourceKind', 'sourceId', 'currency', 'amount',
    'reversalOf', 'state', 'attempts', 'createdAt', 'nextAttemptAt', 'processedAt', 'lastError', 'updatedAt',
  ])) return null;
  const uid = cleanString(data.uid, 128);
  const sourceId = cleanString(data.sourceId, 256);
  const reversalOf = cleanString(data.reversalOf, 256);
  if (
    data.schemaVersion !== STATUS_SCHEMA_VERSION
    || data.eventId !== eventId
    || !uid
    || !sourceId
    || !['representative-recharge', 'representative-reversal'].includes(data.sourceKind)
    || data.currency !== 'coins'
    || !positiveInteger(data.amount, 1_000_000_000)
    || !['queued', 'processing', 'completed', 'dead-letter'].includes(data.state)
    || !nonNegativeInteger(data.attempts, 100)
    || (data.sourceKind === 'representative-reversal' && !reversalOf)
    || (data.sourceKind === 'representative-recharge' && reversalOf)
  ) return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    eventId,
    uid,
    sourceKind: data.sourceKind,
    sourceId,
    currency: 'coins',
    amount: data.amount,
    state: data.state,
    attempts: data.attempts,
    ...(reversalOf ? { reversalOf } : {}),
  };
}

function normalizePublicationFields(data) {
  const authoredBy = cleanString(data.authoredBy, 128);
  const approvedBy = cleanString(data.approvedBy, 128);
  const reason = cleanString(data.reason, 300);
  if (!authoredBy || reason.length < 2) return invalid('INVALID_PUBLICATION_METADATA');
  if (data.state === 'published' && (!approvedBy || authoredBy === approvedBy)) return invalid('PUBLISH_APPROVAL_REQUIRED');
  if (data.state === 'retired' && (!approvedBy || authoredBy === approvedBy)) return invalid('RETIRE_APPROVAL_REQUIRED');
  return { ok: true, value: { authoredBy, ...(approvedBy ? { approvedBy } : {}), reason } };
}

function normalizeBenefits(value) {
  if (!Array.isArray(value) || value.length > STATUS_BENEFIT_IDS.length) return null;
  const benefits = value.map((entry) => cleanString(entry, 40));
  if (benefits.some((entry) => !STATUS_BENEFIT_IDS.includes(entry)) || new Set(benefits).size !== benefits.length) return null;
  return benefits;
}

function normalizeStatusAssets(value) {
  if (value === undefined) return {};
  if (!isRecord(value) || !hasOnly(value, ASSET_SLOTS)) return null;
  const assets = {};
  for (const [slot, asset] of Object.entries(value)) {
    if (!isRecord(asset) || !hasOnly(asset, ['assetId', 'assetVersionId'])) return null;
    const assetId = normalizeId(asset.assetId, 80);
    const assetVersionId = cleanString(asset.assetVersionId, 40);
    if (!assetId || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId)) return null;
    assets[slot] = { assetId, assetVersionId };
  }
  return assets;
}

function normalizeLocalizedName(value) {
  if (!isRecord(value) || !hasOnly(value, ['ar', 'en'])) return null;
  const ar = cleanString(value.ar, 40);
  const en = cleanString(value.en, 40);
  return ar && en ? { ar, en } : null;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

function hasOnly(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeId(value, maxLength) {
  const id = cleanString(value, maxLength).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(id) ? id : '';
}

function validColor(value) {
  return typeof value === 'string' && /^#[A-Fa-f0-9]{6}$/.test(value);
}

function positiveInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}

function nonNegativeInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function invalid(code) {
  return { ok: false, code };
}

module.exports = {
  MAX_STATUS_POINTS,
  STATUS_BENEFIT_IDS,
  STATUS_COMMAND_VERSION,
  STATUS_FEATURE_FLAGS,
  STATUS_SCHEMA_VERSION,
  assertCatalogMutationAllowed,
  buildStatusPresentation,
  createDisabledStatusFeatureFlags,
  mapAristocracyEntitlement,
  mapStatusFeatureFlags,
  mapStatusPresentation,
  mapVipAccount,
  mapVipContribution,
  normalizeAristocracyCatalogVersion,
  normalizeProjectionJob,
  normalizeStatusSourceOutbox,
  normalizeStatusCommandRequest,
  normalizeVipCatalogVersion,
  resolveVipTierForPoints,
  sanitizeAristocracyCatalogForClient,
  sanitizeVipCatalogForClient,
};
