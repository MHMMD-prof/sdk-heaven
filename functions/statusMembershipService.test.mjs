import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  activeCatalogVersion,
  getStatusCenter,
  getStatusOverview,
  processStatusProjectionJobs,
  projectStatusForUser,
  updateStatusVisibility,
} = require('./statusMembershipService');

describe('statusMembershipService Wave 1 dark boundary', () => {
  it('returns only disabled flags and no authority while the feature is dark', async () => {
    const db = statusDb({ enabled: false });
    const response = await getStatusOverview({ clock: { nowMillis: () => 1_500 }, db, uid: 'user-1' });
    expect(response).toMatchObject({
      result: {
        flags: { vipProgression: false, aristocracyShop: false },
        vip: null,
        aristocracy: null,
        catalogs: { vip: null, aristocracy: null },
      },
    });
  });

  it('returns only sanitized published catalogs when independent flags are enabled', async () => {
    const db = statusDb({ enabled: true });
    const response = await getStatusOverview({ clock: { nowMillis: () => 1_500 }, db, uid: 'user-1' });
    expect(response.result.catalogs.vip).toMatchObject({ catalogVersion: 'vip-2026-01', kind: 'vip-svip' });
    expect(response.result.catalogs.aristocracy).toMatchObject({ catalogVersion: 'noble-2026-01', durationDays: 30 });
    expect(response.result.catalogs.vip).not.toHaveProperty('authoredBy');
    expect(response.result.catalogs.aristocracy).not.toHaveProperty('approvedBy');
  });

  it('fails closed on malformed private authority', async () => {
    const db = statusDb({ enabled: true });
    db.documents.set('vipAccounts/user-1', { uid: 'user-1', lifetimeCredit: 20_000 });
    await expect(getStatusOverview({ db, uid: 'user-1' })).resolves.toEqual({ errorCode: 'VIP_AUTHORITY_INVALID' });
  });

  it('returns bounded sanitized owner history and visibility for the Status Center', async () => {
    const db = statusDb({ enabled: true });
    db.documents.set('statusVisibility/user-1', { schemaVersion: 1, uid: 'user-1', publicDisplay: false });
    db.documents.set('vipContributions/recharge-1', {
      schemaVersion: 1, eventId: 'recharge-1', uid: 'user-1', sourceId: 'transfer-1', policyVersion: 'vip-2026-01',
      kind: 'representative-recharge', pointDelta: 1_000, settlementState: 'settled', occurredAt: timestamp(1_200),
    });
    db.documents.set('aristocracyTransactions/tx-1', {
      schemaVersion: 1, transactionId: 'tx-1', uid: 'user-1', kind: 'purchase', rankId: 'knight', rankOrder: 1,
      amountCoins: 1_000, createdAt: timestamp(1_300), expiresAt: timestamp(2_000),
    });
    const response = await getStatusCenter({ clock: { nowMillis: () => 1_500 }, db, uid: 'user-1' });
    expect(response.result).toMatchObject({
      visibility: 'hidden',
      history: {
        vip: [{ eventId: 'recharge-1', pointDelta: 1_000, occurredAtMillis: 1_200 }],
        aristocracy: [{ transactionId: 'tx-1', amountCoins: 1_000, createdAtMillis: 1_300 }],
      },
    });
    expect(response.result.history.aristocracy[0]).not.toHaveProperty('actorUid');
  });

  it('keeps owner expiry and history visible while purchase and presentation flags are off', async () => {
    const db = statusDb({ enabled: false });
    const response = await getStatusCenter({ clock: { nowMillis: () => 1_500 }, db, uid: 'user-1' });
    expect(response.result).toMatchObject({
      aristocracy: { rankId: 'knight' },
      vip: { levelId: 'svip-1' },
      flags: { aristocracyShop: false, statusPresentation: false, vipProgression: false },
    });
    expect(response.result.catalogs.vip).not.toBeNull();
    expect(response.result.catalogs.aristocracy).not.toBeNull();
  });

  it('updates visibility idempotently and queues projection without client profile writes', async () => {
    const db = statusDb({ enabled: true });
    const fieldValue = { serverTimestamp: () => timestamp(1_600) };
    const input = { publicDisplay: false };
    const first = await updateStatusVisibility({ db, fieldValue, input, requestId: 'status_visible_001', uid: 'user-1' });
    const second = await updateStatusVisibility({ db, fieldValue, input, requestId: 'status_visible_001', uid: 'user-1' });
    expect(first).toEqual({ result: { visibility: 'hidden', syncState: 'pending' } });
    expect(second).toEqual(first);
    expect(db.documents.get('statusVisibility/user-1')).toMatchObject({ publicDisplay: false });
    expect(db.documents.get('statusPresentationJobs/visibility_status_visible_001')).toMatchObject({ state: 'queued', uid: 'user-1' });
  });

  it('keeps the scheduled projection worker inert until both dark flags are enabled', async () => {
    const db = statusDb({ enabled: true });
    db.documents.set('appConfig/statusFeatures', {
      schemaVersion: 1,
      statusPresentation: true,
      statusProjectionRepair: false,
    });
    await expect(processStatusProjectionJobs({ db, fieldValue: {}, limit: 10 })).resolves.toEqual({
      processed: 0,
      reason: 'feature-disabled',
      repaired: 0,
      scanned: 0,
    });
    expect(db.collectionReads).toBe(0);
  });

  it('projects only sanitized presentation and completes its idempotent job', async () => {
    const db = statusDb({ enabled: true });
    db.documents.set('publicProfiles/user-1', { uid: 'user-1', updatedAt: timestamp(1_000) });
    db.documents.set('statusPresentationJobs/job-1', {
      schemaVersion: 1, jobId: 'job-1', uid: 'user-1', state: 'queued', attempts: 0,
    });
    const fieldValue = { delete: () => '__delete__', serverTimestamp: () => timestamp(1_500) };
    const job = { schemaVersion: 1, jobId: 'job-1', uid: 'user-1', state: 'queued', attempts: 0 };
    const first = await projectStatusForUser({
      clock: { nowMillis: () => 1_500, timestampFromMillis: timestamp },
      db,
      fieldValue,
      job,
      jobRef: db.doc('statusPresentationJobs/job-1'),
    });
    expect(first.changed).toBe(true);
    expect(db.documents.get('publicProfiles/user-1').statusPresentation).toMatchObject({
      schemaVersion: 1,
      visibility: 'public',
      vip: { id: 'svip-1' },
      aristocracy: { id: 'knight' },
    });
    expect(db.documents.get('publicProfiles/user-1').statusPresentation.aristocracy).not.toHaveProperty('priceCoins');
    expect(db.documents.get('statusPresentationJobs/job-1').state).toBe('completed');

    db.documents.set('statusPresentationJobs/job-2', {
      schemaVersion: 1, jobId: 'job-2', uid: 'user-1', state: 'queued', attempts: 0,
    });
    const second = await projectStatusForUser({
      clock: { nowMillis: () => 1_500, timestampFromMillis: timestamp },
      db,
      fieldValue,
      job: { ...job, jobId: 'job-2' },
      jobRef: db.doc('statusPresentationJobs/job-2'),
    });
    expect(second.changed).toBe(false);
  });

  it('accepts only typed active catalog pointers', () => {
    expect(activeCatalogVersion({ schemaVersion: 1, kind: 'vip-svip', activeCatalogVersion: 'VIP-2026-01' }, 'vip-svip'))
      .toBe('vip-2026-01');
    expect(activeCatalogVersion({ schemaVersion: 1, kind: 'aristocracy', activeCatalogVersion: '../../secret' }, 'aristocracy'))
      .toBe('');
    expect(activeCatalogVersion({ schemaVersion: 2, kind: 'vip-svip', activeCatalogVersion: 'vip-2026-01' }, 'vip-svip'))
      .toBe('');
  });
});

function statusDb({ enabled }) {
  const db = new FakeFirestore({
    'appConfig/statusFeatures': {
      schemaVersion: 1,
      vipProgression: enabled,
      aristocracyShop: enabled,
      statusPresentation: false,
      statusProjectionRepair: false,
      statusAnnouncements: false,
      statusAnimations: false,
    },
    'statusCatalogPointers/vip-svip': { schemaVersion: 1, kind: 'vip-svip', activeCatalogVersion: 'vip-2026-01' },
    'statusCatalogPointers/aristocracy': { schemaVersion: 1, kind: 'aristocracy', activeCatalogVersion: 'noble-2026-01' },
    'vipAccounts/user-1': accountDocument(),
    'aristocracyEntitlements/user-1': entitlementDocument(),
    'vipTierCatalogVersions/vip-2026-01': vipCatalog(),
    'aristocracyCatalogVersions/noble-2026-01': aristocracyCatalog(),
  });
  return db;
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.collectionReads = 0;
  }
  doc(path) {
    return {
      path,
      get: async () => snapshot(path, this.documents.get(path)),
      update: async (data) => this.applyUpdate(path, data),
    };
  }
  async getAll(...refs) {
    return Promise.all(refs.map((ref) => ref.get()));
  }
  collection(collectionName) {
    this.collectionReads += 1;
    const db = this;
    return {
      where(field, operator, value) {
        if (operator !== '==') throw new Error('Unsupported operator');
        return {
          orderBy(orderField, direction) {
            return {
              limit(limit) {
                return {
                  async get() {
                    const rows = [...db.documents.entries()]
                      .filter(([, data]) => data?.[field] === value)
                      .filter(([path]) => path.startsWith(`${collectionName}/`));
                    void orderField; void direction; void limit;
                    return { docs: rows.map(([path, data]) => snapshot(path, data)) };
                  },
                };
              },
            };
          },
        };
      },
    };
  }
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({
      get: async (ref) => ref.get(),
      create: (ref, data) => writes.push({ path: ref.path, data, create: true }),
      set: (ref, data, options) => writes.push({ path: ref.path, data, set: true, options }),
      update: (ref, data) => writes.push({ path: ref.path, data }),
    });
    for (const write of writes) {
      if (write.create) {
        if (this.documents.has(write.path)) throw new Error(`Existing document: ${write.path}`);
        this.documents.set(write.path, write.data);
      } else if (write.set) {
        this.documents.set(write.path, write.options?.merge ? { ...(this.documents.get(write.path) || {}), ...write.data } : write.data);
      } else this.applyUpdate(write.path, write.data);
    }
    return result;
  }
  applyUpdate(path, data) {
    const previous = this.documents.get(path);
    if (!previous) throw new Error(`Missing document: ${path}`);
    const next = { ...previous };
    for (const [key, value] of Object.entries(data)) {
      if (value === '__delete__') delete next[key];
      else next[key] = value;
    }
    this.documents.set(path, next);
  }
}

function snapshot(path, data) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: { path } };
}

function timestamp(value) { return { toMillis: () => value }; }

function accountDocument() {
  return {
    schemaVersion: 1, uid: 'user-1', catalogVersion: 'vip-2026-01', points: 20_000,
    levelId: 'svip-1', band: 'svip', level: 1, order: 3, highestLevelOrder: 3, state: 'active',
  };
}

function entitlementDocument() {
  return {
    schemaVersion: 1, uid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight',
    rankOrder: 1, state: 'active', expiresAt: { toMillis: () => 2_000 },
  };
}

function vipCatalog() {
  return {
    schemaVersion: 1, catalogVersion: 'vip-2026-01', kind: 'vip-svip', state: 'published',
    authoredBy: 'admin-1', approvedBy: 'admin-2', reason: 'test',
    pointPolicy: {
      currency: 'coins', eligibleSources: ['representative-transfer'], pointsPerCoinNumerator: 1,
      pointsPerCoinDenominator: 1, reversalMode: 'linked-net', spendingMode: 'no-effect',
    },
    tiers: [
      { id: 'vip-1', band: 'vip', level: 1, order: 1, minPoints: 1_000, name: { ar: 'VIP 1', en: 'VIP 1' }, accentColor: '#D4AF37', benefits: [], assets: {} },
      { id: 'vip-2', band: 'vip', level: 2, order: 2, minPoints: 5_000, name: { ar: 'VIP 2', en: 'VIP 2' }, accentColor: '#D4AF37', benefits: [], assets: {} },
      { id: 'svip-1', band: 'svip', level: 1, order: 3, minPoints: 20_000, name: { ar: 'SVIP 1', en: 'SVIP 1' }, accentColor: '#22A978', benefits: [], assets: {} },
    ],
  };
}

function aristocracyCatalog() {
  return {
    schemaVersion: 1, catalogVersion: 'noble-2026-01', kind: 'aristocracy', state: 'published',
    authoredBy: 'admin-1', approvedBy: 'admin-2', reason: 'test', durationDays: 30,
    upgradePolicy: {
      mode: 'prorated-difference', rounding: 'ceil', expiryMode: 'unchanged-on-upgrade',
      renewalMode: 'manual-full-price', downgradeMode: 'after-expiry', autoRenew: false, gifting: false,
    },
    ranks: [
      { id: 'knight', order: 1, priceCoins: 1_000, durationDays: 30, name: { ar: 'فارس', en: 'Knight' }, accentColor: '#D4AF37', benefits: [], assets: {} },
    ],
  };
}
