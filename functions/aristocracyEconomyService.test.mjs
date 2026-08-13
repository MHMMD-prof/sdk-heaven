import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  approveAristocracyAdminOperation,
  expireAristocracyEntitlements,
  proposeAristocracyAdminOperation,
  purchaseAristocracy,
  quoteAristocracy,
  reconcileAristocracyEconomy,
  setAristocracyShopAvailability,
} = require('./aristocracyEconomyService');

const now = Date.parse('2026-08-13T00:00:00.000Z');
const fieldValue = { delete: () => '__delete__', serverTimestamp: () => timestamp(now) };

describe('aristocracyEconomyService Wave 3', () => {
  it('quotes, atomically debits, grants, and replays exactly once under concurrency', async () => {
    const db = economyDb();
    const quote = await createQuote(db, { quoteId: 'q'.repeat(32) });
    expect(quote).toMatchObject({
      result: { amountCoins: 1_000, balanceBefore: 10_000, balanceAfter: 9_000, operation: 'purchase', autoRenew: false },
    });
    const args = purchaseArgs(db, quote.result.quoteId, 'purchase_request_0001');
    const [left, right] = await Promise.all([purchaseAristocracy(args), purchaseAristocracy(args)]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({ result: { balanceAfter: 9_000, rankId: 'knight', operation: 'purchase' } });
    expect(db.read('walletSummaries/user-1')).toMatchObject({ balances: { coins: 9_000, diamonds: 5 }, lifetimeDebit: { coins: 1_000, diamonds: 0 } });
    expect(db.read('aristocracyEntitlements/user-1')).toMatchObject({ rankId: 'knight', origin: 'paid', revision: 1, state: 'active' });
    expect(db.read('walletTransactions/aristocracy_user-1_purchase_request_0001')).toMatchObject({ amount: 1_000, source: 'aristocracy', type: 'purchase' });
    expect(db.read('aristocracyTransactions/user-1_purchase_request_0001')).toMatchObject({ amountCoins: 1_000, kind: 'purchase' });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/aristocracy_'))).toHaveLength(1);
  });

  it('prevents quote reuse, wrong-user use, and request mutation', async () => {
    const db = economyDb();
    const quote = await createQuote(db, { quoteId: 'a'.repeat(32) });
    await purchaseAristocracy(purchaseArgs(db, quote.result.quoteId, 'purchase_request_0001'));
    await expect(purchaseAristocracy(purchaseArgs(db, quote.result.quoteId, 'purchase_request_0002')))
      .resolves.toEqual({ errorCode: 'QUOTE_USED' });
    await expect(purchaseAristocracy(purchaseArgs(db, 'b'.repeat(32), 'purchase_request_0001')))
      .resolves.toEqual({ errorCode: 'REQUEST_CONFLICT' });
    await expect(purchaseAristocracy({ ...purchaseArgs(db, quote.result.quoteId, 'other_purchase_0001'), uid: 'other-user' }))
      .resolves.toEqual({ errorCode: 'PROFILE_INCOMPLETE' });
  });

  it('rejects expiry, stale entitlement, catalog changes, wallet changes, and a frozen shop without partial writes', async () => {
    for (const [mutate, expected] of [
      [(db, quoteId) => db.documents.set(`aristocracyQuotes/user-1/items/${quoteId}`, { ...db.read(`aristocracyQuotes/user-1/items/${quoteId}`), issuedAt: timestamp(now - 60_000), expiresAt: timestamp(now - 1) }), 'QUOTE_EXPIRED'],
      [(db) => db.documents.set('aristocracyEntitlements/user-1', entitlement()), 'QUOTE_STALE'],
      [(db) => db.documents.set('statusCatalogPointers/aristocracy', { schemaVersion: 1, kind: 'aristocracy', activeCatalogVersion: 'noble-new' }), 'CATALOG_CHANGED'],
      [(db) => db.documents.set('walletSummaries/user-1', wallet(500)), 'INSUFFICIENT_FUNDS'],
      [(db) => db.documents.set('appConfig/statusFeatures', statusFlags(false)), 'FEATURE_DISABLED'],
    ]) {
      const db = economyDb();
      const quote = await createQuote(db, { quoteId: 'c'.repeat(32) });
      mutate(db, quote.result.quoteId);
      await expect(purchaseAristocracy(purchaseArgs(db, quote.result.quoteId, 'purchase_request_0001')))
        .resolves.toEqual({ errorCode: expected });
      expect([...db.documents.keys()].filter((path) => path.startsWith('aristocracyTransactions/'))).toHaveLength(0);
    }
  });

  it('idempotently replays quotes and rate-limits probing without creating extra quote records', async () => {
    const db = economyDb();
    const first = await createQuote(db, { quoteId: 'j'.repeat(32) });
    const replay = await createQuote(db, { quoteId: 'k'.repeat(32) });
    expect(replay).toEqual(first);
    expect([...db.documents.keys()].filter((path) => path.startsWith('aristocracyQuotes/'))).toHaveLength(1);

    db.documents.set('statusRateLimits/user-1/hours/2026-08-13T00', {
      uid: 'user-1', hourBucket: '2026-08-13T00', aristocracyQuotes: 30,
    });
    await expect(createQuote(db, { quoteId: 'l'.repeat(32), requestId: 'quote_request_0031' }))
      .resolves.toEqual({ errorCode: 'RATE_LIMITED' });
  });

  it('upgrades with unchanged expiry and renews only by a new explicit full-price confirmation', async () => {
    const db = economyDb();
    const first = await createQuote(db, { quoteId: 'd'.repeat(32) });
    await purchaseAristocracy(purchaseArgs(db, first.result.quoteId, 'purchase_request_0001'));
    const originalExpiry = db.read('aristocracyEntitlements/user-1').expiresAt.toMillis();

    const halfway = now + 15 * 86_400_000;
    const upgrade = await createQuote(db, { nowMillis: halfway, quoteId: 'e'.repeat(32), requestId: 'quote_request_0002', targetRankId: 'baron' });
    expect(upgrade).toMatchObject({ result: { operation: 'upgrade', amountCoins: 2_000, resultingExpiryMillis: originalExpiry } });
    await purchaseAristocracy(purchaseArgs(db, upgrade.result.quoteId, 'purchase_request_0002', halfway));
    expect(db.read('aristocracyEntitlements/user-1')).toMatchObject({ rankId: 'baron', revision: 2 });
    expect(db.read('aristocracyEntitlements/user-1').expiresAt.toMillis()).toBe(originalExpiry);

    const renewal = await createQuote(db, { nowMillis: halfway, quoteId: 'f'.repeat(32), requestId: 'quote_request_0003', targetRankId: 'baron' });
    expect(renewal).toMatchObject({ result: { operation: 'renewal', amountCoins: 5_000 } });
    await purchaseAristocracy(purchaseArgs(db, renewal.result.quoteId, 'purchase_request_0003', halfway));
    expect(db.read('aristocracyEntitlements/user-1').expiresAt.toMillis()).toBe(originalExpiry + 30 * 86_400_000);
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(2_000);
  });

  it('expires overdue paid status without touching wallet history', async () => {
    const db = economyDb();
    const quote = await createQuote(db, { quoteId: 'g'.repeat(32) });
    await purchaseAristocracy(purchaseArgs(db, quote.result.quoteId, 'purchase_request_0001'));
    const walletBefore = db.read('walletSummaries/user-1');
    const expiryMillis = db.read('aristocracyEntitlements/user-1').expiresAt.toMillis();
    const result = await expireAristocracyEntitlements({ clock: testClock(expiryMillis + 1), db, fieldValue });
    expect(result).toEqual({ scanned: 1, expired: 1 });
    expect(db.read('aristocracyEntitlements/user-1').state).toBe('expired');
    expect(db.read('walletSummaries/user-1')).toEqual(walletBefore);
    expect([...db.documents.values()].some((row) => row?.kind === 'expiry')).toBe(true);
  });

  it('requires independent owner approval for bounded complimentary grants and freezes', async () => {
    const db = economyDb();
    const input = {
      action: 'complimentary-grant', targetUid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight', durationDays: 30,
      reason: 'Approved customer recovery', evidenceRef: 'ticket-123', requestId: 'admin_request_0001',
    };
    const initiator = { admin: true, adminRole: 'owner', uid: 'owner-1' };
    await expect(proposeAristocracyAdminOperation({ db, decodedToken: initiator, fieldValue, input }))
      .resolves.toMatchObject({ result: { state: 'pending-approval' } });
    await expect(approveAristocracyAdminOperation({ clock: testClock(), db, decodedToken: { admin: true, adminRole: 'owner', uid: 'owner-1' }, fieldValue, requestId: input.requestId }))
      .resolves.toEqual({ errorCode: 'SELF_APPROVAL_FORBIDDEN' });
    await expect(approveAristocracyAdminOperation({ clock: testClock(), db, decodedToken: { admin: true, adminRole: 'owner', uid: 'owner-2' }, fieldValue, requestId: input.requestId }))
      .resolves.toMatchObject({ result: { action: 'complimentary-grant', state: 'active' } });
    expect(db.read('aristocracyEntitlements/user-1')).toMatchObject({ origin: 'complimentary', rankId: 'knight', state: 'active' });
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(10_000);

    const freeze = { action: 'freeze', targetUid: 'user-1', reason: 'Security review required', evidenceRef: 'case-456', requestId: 'admin_request_0002' };
    await proposeAristocracyAdminOperation({ db, decodedToken: initiator, fieldValue, input: freeze });
    await approveAristocracyAdminOperation({ clock: testClock(), db, decodedToken: { admin: true, adminRole: 'owner', uid: 'owner-2' }, fieldValue, requestId: freeze.requestId });
    expect(db.read('aristocracyEntitlements/user-1').state).toBe('frozen');
    await expect(createQuote(db, { quoteId: 'h'.repeat(32), requestId: 'quote_request_0009' }))
      .resolves.toEqual({ errorCode: 'ENTITLEMENT_RESTRICTED' });
  });

  it('gives only an owner an audited idempotent global shop freeze', async () => {
    const db = economyDb();
    const args = {
      db, decodedToken: { admin: true, adminRole: 'owner', uid: 'owner-1' }, enabled: false,
      fieldValue, reason: 'Emergency economy freeze', requestId: 'shop_freeze_000001',
    };
    const first = await setAristocracyShopAvailability(args);
    await expect(setAristocracyShopAvailability(args)).resolves.toEqual(first);
    expect(first).toEqual({ result: { enabled: false, previousEnabled: true } });
    expect(db.read('appConfig/statusFeatures').aristocracyShop).toBe(false);
    expect(db.read('adminAuditEvents/aristocracy_shop_shop_freeze_000001')).toMatchObject({
      action: 'aristocracy-shop-availability', enabled: false,
    });
    await expect(setAristocracyShopAvailability({ ...args, decodedToken: { admin: true, adminRole: 'catalog-manager', uid: 'admin-2' } }))
      .resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });
  });

  it('reconciles paid history to wallet ledger and detects drift or orphans', async () => {
    const db = economyDb();
    const quote = await createQuote(db, { quoteId: 'i'.repeat(32) });
    await purchaseAristocracy(purchaseArgs(db, quote.result.quoteId, 'purchase_request_0001'));
    const clean = await reconcileAristocracyEconomy({ db, documentIdField: '__name__' });
    expect(clean).toMatchObject({ ok: true, value: { clean: true, paidAmountCoins: 1_000, errors: [] } });
    db.documents.set('walletTransactions/aristocracy_user-1_purchase_request_0001', {
      ...db.read('walletTransactions/aristocracy_user-1_purchase_request_0001'), amount: 999,
    });
    const drift = await reconcileAristocracyEconomy({ db, documentIdField: '__name__' });
    expect(drift.value.clean).toBe(false);
    expect(drift.value.errors).toContainEqual({ kind: 'ledger-mismatch', id: 'user-1_purchase_request_0001' });
  });
});

async function createQuote(db, { nowMillis = now, quoteId, requestId = 'quote_request_0001', targetRankId = 'knight' }) {
  return quoteAristocracy({
    clock: testClock(nowMillis), createQuoteId: () => quoteId, db, fieldValue,
    input: { catalogVersion: 'noble-2026-01', targetRankId }, requestId, uid: 'user-1',
  });
}
function purchaseArgs(db, quoteId, requestId, nowMillis = now) {
  return { clock: testClock(nowMillis), db, fieldValue, input: { quoteId }, requestId, uid: 'user-1' };
}
function economyDb() {
  return new FakeFirestore({
    'appConfig/statusFeatures': statusFlags(true),
    'statusCatalogPointers/aristocracy': { schemaVersion: 1, kind: 'aristocracy', activeCatalogVersion: 'noble-2026-01' },
    'aristocracyCatalogVersions/noble-2026-01': catalog(),
    'adminProfiles/admin-1': { uid: 'admin-1', role: 'catalog-manager', status: 'active' },
    'adminProfiles/owner-1': { uid: 'owner-1', role: 'owner', status: 'active' },
    'adminProfiles/owner-2': { uid: 'owner-2', role: 'owner', status: 'active' },
    'adminProfiles/admin-2': { uid: 'admin-2', role: 'catalog-manager', status: 'active' },
    'publicIds/1111111': { createdAt: timestamp(1), uid: 'user-1' },
    'publicProfiles/user-1': profile(),
    'walletSummaries/user-1': wallet(10_000),
  });
}
function statusFlags(aristocracyShop) {
  return { schemaVersion: 1, vipProgression: false, aristocracyShop, statusPresentation: false, statusProjectionRepair: false, statusAnnouncements: false, statusAnimations: false };
}
function catalog() {
  return {
    schemaVersion: 1, catalogVersion: 'noble-2026-01', kind: 'aristocracy', state: 'published', authoredBy: 'admin-1', approvedBy: 'admin-2', reason: 'Wave 3 test catalog', durationDays: 30,
    upgradePolicy: { mode: 'prorated-difference', rounding: 'ceil', expiryMode: 'unchanged-on-upgrade', renewalMode: 'manual-full-price', downgradeMode: 'after-expiry', autoRenew: false, gifting: false },
    ranks: [rank('knight', 1, 1_000), rank('baron', 2, 5_000)],
  };
}
function rank(id, order, priceCoins) { return { id, order, priceCoins, durationDays: 30, name: { ar: id, en: id }, accentColor: '#D4AF37', benefits: [], assets: {} }; }
function entitlement(overrides = {}) { return { schemaVersion: 1, uid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight', rankOrder: 1, state: 'active', origin: 'paid', revision: 1, highestEverRankOrder: 1, acquiredAt: timestamp(now), expiresAt: timestamp(now + 30 * 86_400_000), latestTransactionId: 'external-change', createdAt: timestamp(now), updatedAt: timestamp(now), ...overrides }; }
function profile() { return { avatarLabel: 'U', avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', coupleId: '', coupleLevel: 0, createdAt: timestamp(1), displayName: 'user', friendCount: 0, giftScore: 0, moderationStatus: 'active', normalizedName: 'user', publicId: '1111111', searchPrefixes: ['user'], uid: 'user-1', updatedAt: timestamp(1) }; }
function wallet(coins) { return { balances: { coins, diamonds: 5 }, createdAt: timestamp(1), lifetimeCredit: { coins: 10_000, diamonds: 5 }, lifetimeDebit: { coins: 0, diamonds: 0 }, uid: 'user-1', updatedAt: timestamp(1) }; }
function timestamp(value) { return { toDate: () => new Date(value), toMillis: () => value }; }
function testClock(value = now) { return { nowMillis: () => value, timestampFromMillis: timestamp }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); this.transactionTail = Promise.resolve(); }
  doc(path) {
    return { id: path.split('/').at(-1), path, get: async () => snapshot(this, path), update: async (data) => this.applyUpdate(path, data) };
  }
  collection(path) { return new FakeQuery(this, path); }
  read(path) { return this.documents.get(path); }
  async runTransaction(callback) {
    const run = async () => { const tx = new FakeTransaction(this); const result = await callback(tx); tx.commit(); return result; };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
  applyUpdate(path, data) {
    if (!this.documents.has(path)) throw new Error(`Missing: ${path}`);
    const next = { ...this.documents.get(path) };
    for (const [key, value] of Object.entries(data)) { if (value === '__delete__') delete next[key]; else next[key] = value; }
    this.documents.set(path, next);
  }
}
class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(this.db, ref.path); }
  create(ref, data) { this.operations.push({ kind: 'create', path: ref.path, data }); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', path: ref.path, data }); }
  commit() {
    for (const op of this.operations) {
      if (op.kind === 'create' && this.db.documents.has(op.path)) throw new Error(`Exists: ${op.path}`);
      if (op.kind === 'update') this.db.applyUpdate(op.path, op.data);
      else this.db.documents.set(op.path, op.data);
    }
  }
}
class FakeQuery {
  constructor(db, path, filters = [], limitCount = 1_000, order = null) { this.db = db; this.path = path; this.filters = filters; this.limitCount = limitCount; this.order = order; }
  where(field, operator, value) { return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.limitCount, this.order); }
  orderBy(field, direction = 'asc') { return new FakeQuery(this.db, this.path, this.filters, this.limitCount, { direction, field }); }
  startAfter() { return this; }
  limit(count) { return new FakeQuery(this.db, this.path, this.filters, count, this.order); }
  async get() {
    let rows = [...this.db.documents.entries()].filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    rows = rows.filter(([, data]) => this.filters.every(({ field, operator, value }) => {
      const actual = field.split('.').reduce((current, key) => current?.[key], data);
      if (operator === '==') return actual === value;
      const left = actual?.toMillis?.() ?? actual; const right = value?.toMillis?.() ?? value;
      return operator === '<=' && left <= right;
    }));
    if (this.order) rows.sort((left, right) => {
      const a = left[1][this.order.field]?.toMillis?.() ?? left[1][this.order.field] ?? 0;
      const b = right[1][this.order.field]?.toMillis?.() ?? right[1][this.order.field] ?? 0;
      return this.order.direction === 'desc' ? b - a : a - b;
    });
    const docs = rows.slice(0, this.limitCount).map(([path]) => snapshot(this.db, path));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}
function snapshot(db, path) { const data = db.documents.get(path); return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: db.doc(path) }; }
