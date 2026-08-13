import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertCatalogMutationAllowed,
  buildStatusPresentation,
  createDisabledStatusFeatureFlags,
  mapAristocracyEntitlement,
  mapStatusFeatureFlags,
  mapStatusPresentation,
  mapVipAccount,
  mapVipContribution,
  normalizeAristocracyCatalogVersion,
  normalizeStatusCommandRequest,
  normalizeStatusSourceOutbox,
  normalizeVipCatalogVersion,
  resolveVipTierForPoints,
  sanitizeAristocracyCatalogForClient,
  sanitizeVipCatalogForClient,
} = require('./statusMembershipCore');

describe('statusMembershipCore Wave 1 authority contracts', () => {
  it('defaults every independent status flag off and ignores malformed config', () => {
    expect(createDisabledStatusFeatureFlags()).toEqual({
      schemaVersion: 1,
      vipProgression: false,
      aristocracyShop: false,
      statusPresentation: false,
      svipCard: false,
      aristocracyCard: false,
      statusProjectionRepair: false,
      statusAnnouncements: false,
      statusAnimations: false,
    });
    expect(mapStatusFeatureFlags({ schemaVersion: 1, vipProgression: true, unknown: true }))
      .toMatchObject({ vipProgression: true, aristocracyShop: false });
    expect(mapStatusFeatureFlags({ vipProgression: true }).vipProgression).toBe(false);
  });

  it('accepts only the dedicated authenticated read command', () => {
    const valid = normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: { action: 'get-status-overview', requestId: 'status_request_0001', version: 1 },
    });
    expect(valid).toMatchObject({ ok: true, value: { uid: 'user-1' } });
    expect(normalizeStatusCommandRequest({ auth: null, data: {} }).code).toBe('AUTH_REQUIRED');
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: { action: 'buy-rank', requestId: 'status_request_0001', version: 1 },
    }).code).toBe('INVALID_REQUEST');
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: { action: 'get-status-center', requestId: 'status_center_0001', version: 1 },
    })).toMatchObject({ ok: true, value: { action: 'get-status-center' } });
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: {
        action: 'update-status-visibility', requestId: 'status_visible_001', version: 1,
        payload: { publicDisplay: false },
      },
    })).toMatchObject({ ok: true, value: { action: 'update-status-visibility' } });
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: {
        action: 'update-status-visibility', requestId: 'status_visible_002', version: 1,
        payload: { publicDisplay: 'false' },
      },
    }).code).toBe('INVALID_REQUEST');
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: {
        action: 'quote-aristocracy', requestId: 'status_request_0002', version: 1,
        payload: { catalogVersion: 'noble-2026-01', targetRankId: 'knight' },
      },
    })).toMatchObject({ ok: true, value: { action: 'quote-aristocracy' } });
    expect(normalizeStatusCommandRequest({
      auth: { uid: 'user-1' },
      data: {
        action: 'quote-aristocracy', requestId: 'status_request_0002', version: 1,
        payload: { catalogVersion: 'noble-2026-01', targetRankId: 'knight', amount: 1 },
      },
    }).code).toBe('INVALID_REQUEST');
  });

  it('validates a strictly ordered VIP-to-SVIP catalog and resolves boundaries', () => {
    const catalog = vipCatalog();
    expect(normalizeVipCatalogVersion(catalog).ok).toBe(true);
    expect(resolveVipTierForPoints(999, catalog).value.tier).toBeNull();
    expect(resolveVipTierForPoints(1_000, catalog).value.tier.id).toBe('vip-1');
    expect(resolveVipTierForPoints(5_000, catalog).value.tier.id).toBe('vip-2');
    expect(resolveVipTierForPoints(20_000, catalog).value.tier.id).toBe('svip-1');
    expect(resolveVipTierForPoints(100_000, catalog).value.nextTier).toBeNull();
    expect(sanitizeVipCatalogForClient(catalog)).not.toHaveProperty('authoredBy');
  });

  it('rejects duplicate, decreasing, reordered, unknown-benefit, and unsafe source tiers', () => {
    const duplicate = vipCatalog();
    duplicate.tiers[1].id = 'vip-1';
    expect(normalizeVipCatalogVersion(duplicate).code).toBe('INVALID_VIP_TIER');
    const decreasing = vipCatalog();
    decreasing.tiers[1].minPoints = 500;
    expect(normalizeVipCatalogVersion(decreasing).code).toBe('INVALID_VIP_TIER_SEQUENCE');
    const reordered = vipCatalog();
    [reordered.tiers[0], reordered.tiers[1]] = [reordered.tiers[1], reordered.tiers[0]];
    expect(normalizeVipCatalogVersion(reordered).code).toBe('INVALID_VIP_TIER_SEQUENCE');
    const benefit = vipCatalog();
    benefit.tiers[0].benefits = ['moderation-immunity'];
    expect(normalizeVipCatalogVersion(benefit).code).toBe('INVALID_VIP_TIER');
    const source = vipCatalog();
    source.pointPolicy.eligibleSources = ['admin-credit'];
    expect(normalizeVipCatalogVersion(source).code).toBe('INVALID_VIP_POINT_POLICY');
  });

  it('validates Aristocracy prices, fixed duration, and non-renewing upgrade policy', () => {
    const catalog = aristocracyCatalog();
    expect(normalizeAristocracyCatalogVersion(catalog).ok).toBe(true);
    expect(sanitizeAristocracyCatalogForClient(catalog)).not.toHaveProperty('approvedBy');
    const autoRenew = aristocracyCatalog();
    autoRenew.upgradePolicy.autoRenew = true;
    expect(normalizeAristocracyCatalogVersion(autoRenew).code).toBe('INVALID_ARISTOCRACY_UPGRADE_POLICY');
    const wrongDuration = aristocracyCatalog();
    wrongDuration.ranks[1].durationDays = 60;
    expect(normalizeAristocracyCatalogVersion(wrongDuration).code).toBe('INVALID_ARISTOCRACY_RANK_SEQUENCE');
    const decreasing = aristocracyCatalog();
    decreasing.ranks[1].priceCoins = 500;
    expect(normalizeAristocracyCatalogVersion(decreasing).code).toBe('INVALID_ARISTOCRACY_RANK_SEQUENCE');
  });

  it('makes published and retired catalog versions immutable and forbids self-approval', () => {
    const published = vipCatalog();
    const edited = vipCatalog();
    edited.tiers[0].minPoints = 2_000;
    expect(assertCatalogMutationAllowed(published, edited, normalizeVipCatalogVersion).code).toBe('IMMUTABLE_CATALOG');
    const draft = vipCatalog({ state: 'draft', approvedBy: undefined });
    const selfApproved = vipCatalog({ authoredBy: 'admin-1', approvedBy: 'admin-1' });
    expect(assertCatalogMutationAllowed(draft, selfApproved, normalizeVipCatalogVersion).code)
      .toBe('PUBLISH_APPROVAL_REQUIRED');
    const selfRetired = vipCatalog({ state: 'retired', authoredBy: 'admin-1', approvedBy: 'admin-1' });
    expect(normalizeVipCatalogVersion(selfRetired).code).toBe('RETIRE_APPROVAL_REQUIRED');
  });

  it('maps private authority documents without using wallet lifetime credit', () => {
    expect(mapVipAccount({
      schemaVersion: 1,
      uid: 'user-1',
      catalogVersion: 'vip-2026-01',
      points: 20_000,
      levelId: 'svip-1',
      band: 'svip',
      level: 1,
      order: 3,
      highestLevelOrder: 3,
      state: 'active',
    }, 'user-1')).toMatchObject({ levelId: 'svip-1', points: 20_000 });
    expect(mapVipAccount({ uid: 'user-1', lifetimeCredit: 99_999 }, 'user-1')).toBeNull();
    expect(mapVipContribution({
      schemaVersion: 1,
      eventId: 'representative:transfer-1',
      uid: 'user-1',
      sourceId: 'representativeTransfers/sender_request',
      policyVersion: 'vip-2026-01',
      kind: 'representative-recharge',
      pointDelta: 5_000,
      settlementState: 'settled',
    }, 'representative:transfer-1')).toMatchObject({ pointDelta: 5_000 });
    expect(mapVipContribution({
      schemaVersion: 1,
      eventId: 'bad-reversal',
      uid: 'user-1',
      sourceId: 'reversal-1',
      policyVersion: 'vip-2026-01',
      kind: 'representative-reversal',
      pointDelta: 5_000,
      settlementState: 'reversed',
    }, 'bad-reversal')).toBeNull();
  });

  it('accepts only coin recharge and linked-reversal outbox evidence', () => {
    expect(normalizeStatusSourceOutbox({
      schemaVersion: 1,
      eventId: 'representative:transfer-1',
      uid: 'user-1',
      sourceKind: 'representative-recharge',
      sourceId: 'representativeTransfers/sender_request',
      currency: 'coins',
      amount: 5_000,
      state: 'queued',
      attempts: 0,
    }, 'representative:transfer-1')).toMatchObject({ sourceKind: 'representative-recharge', amount: 5_000 });
    expect(normalizeStatusSourceOutbox({
      schemaVersion: 1,
      eventId: 'representative-reversal:transfer-1',
      uid: 'user-1',
      sourceKind: 'representative-reversal',
      sourceId: 'representativeTransferReversals/transfer-1',
      reversalOf: 'representative:transfer-1',
      currency: 'coins',
      amount: 5_000,
      state: 'queued',
      attempts: 0,
    }, 'representative-reversal:transfer-1')).toMatchObject({ reversalOf: 'representative:transfer-1' });
    expect(normalizeStatusSourceOutbox({
      schemaVersion: 1,
      eventId: 'diamond-transfer',
      uid: 'user-1',
      sourceKind: 'representative-recharge',
      sourceId: 'transfer-1',
      currency: 'diamonds',
      amount: 1,
      state: 'queued',
      attempts: 0,
    }, 'diamond-transfer')).toBeNull();
  });

  it('derives expiration and builds a sanitized, hideable public projection', () => {
    const entitlement = entitlementDocument();
    expect(mapAristocracyEntitlement(entitlement, 'user-1', 1_500).state).toBe('active');
    expect(mapAristocracyEntitlement(entitlement, 'user-1', 2_500).state).toBe('expired');
    const projection = buildStatusPresentation({
      account: accountDocument(),
      aristocracy: entitlement,
      aristocracyCatalog: aristocracyCatalog(),
      nowMillis: 1_500,
      vipCatalog: vipCatalog(),
      visibility: 'public',
    });
    expect(projection).toMatchObject({
      ok: true,
      value: {
        visibility: 'public',
        vip: { id: 'svip-1', band: 'svip', level: 1 },
        aristocracy: { id: 'knight', order: 1 },
      },
    });
    expect(projection.value.aristocracy).not.toHaveProperty('priceCoins');
    expect(projection.value.aristocracy).not.toHaveProperty('expiresAt');
    expect(projection.value.vip.assets).toEqual({});
    expect(buildStatusPresentation({ visibility: 'hidden' }).value).toEqual({ schemaVersion: 1, visibility: 'hidden' });
    expect(mapStatusPresentation({ ...projection.value, injected: true })).toBeNull();
  });

  it('publishes only canonical benefit-slot references and rejects arbitrary URLs', () => {
    const catalog = vipCatalog();
    catalog.tiers[2].assets = {
      badge: { assetId: 'svip-badge', assetVersionId: 'v1-123456789abc' },
      entryEffect: { assetId: 'svip-entry', assetVersionId: 'v2-abcdef123456' },
    };
    const projection = buildStatusPresentation({
      account: accountDocument(),
      vipCatalog: catalog,
      visibility: 'public',
    });
    expect(projection.value.vip.assets.entryEffect).toEqual({ assetId: 'svip-entry', assetVersionId: 'v2-abcdef123456' });
    expect(mapStatusPresentation({ ...projection.value, vip: { ...projection.value.vip, assets: { badge: { url: 'https://evil.test' } } } })).toBeNull();
  });
});

function vipCatalog(overrides = {}) {
  return {
    schemaVersion: 1,
    catalogVersion: 'vip-2026-01',
    kind: 'vip-svip',
    state: 'published',
    authoredBy: 'admin-1',
    approvedBy: 'admin-2',
    reason: 'Wave 1 test catalog',
    pointPolicy: {
      currency: 'coins',
      eligibleSources: ['representative-transfer'],
      pointsPerCoinNumerator: 1,
      pointsPerCoinDenominator: 1,
      reversalMode: 'linked-net',
      spendingMode: 'no-effect',
    },
    tiers: [
      tier('vip', 1, 1, 1_000),
      tier('vip', 2, 2, 5_000),
      tier('svip', 1, 3, 20_000),
    ],
    ...overrides,
  };
}

function tier(band, level, order, minPoints) {
  return {
    id: `${band}-${level}`,
    band,
    level,
    order,
    minPoints,
    name: { ar: `${band.toUpperCase()} ${level}`, en: `${band.toUpperCase()} ${level}` },
    accentColor: band === 'vip' ? '#D4AF37' : '#22A978',
    benefits: ['profile-badge'],
    assets: {},
  };
}

function aristocracyCatalog(overrides = {}) {
  return {
    schemaVersion: 1,
    catalogVersion: 'noble-2026-01',
    kind: 'aristocracy',
    state: 'published',
    authoredBy: 'admin-1',
    approvedBy: 'admin-2',
    reason: 'Wave 1 test catalog',
    durationDays: 30,
    upgradePolicy: {
      mode: 'prorated-difference',
      rounding: 'ceil',
      expiryMode: 'unchanged-on-upgrade',
      renewalMode: 'manual-full-price',
      downgradeMode: 'after-expiry',
      autoRenew: false,
      gifting: false,
    },
    ranks: [
      rank('knight', 1, 1_000),
      rank('baron', 2, 5_000),
    ],
    ...overrides,
  };
}

function rank(id, order, priceCoins) {
  return {
    id,
    order,
    priceCoins,
    durationDays: 30,
    name: { ar: id === 'knight' ? 'فارس' : 'بارون', en: id === 'knight' ? 'Knight' : 'Baron' },
    accentColor: '#D4AF37',
    benefits: ['profile-badge'],
    assets: {},
  };
}

function accountDocument() {
  return {
    schemaVersion: 1,
    uid: 'user-1',
    catalogVersion: 'vip-2026-01',
    points: 20_000,
    levelId: 'svip-1',
    band: 'svip',
    level: 1,
    order: 3,
    highestLevelOrder: 3,
    state: 'active',
  };
}

function entitlementDocument() {
  return {
    schemaVersion: 1,
    uid: 'user-1',
    catalogVersion: 'noble-2026-01',
    rankId: 'knight',
    rankOrder: 1,
    state: 'active',
    expiresAt: { toMillis: () => 2_000 },
  };
}
