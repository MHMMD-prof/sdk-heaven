import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createSettlementId } = require('./weeklyIncentiveCore');
const {
  enqueueWeeklyIncentiveSettlement,
  getOrCreateWeeklyIncentiveCycle,
  processWeeklyIncentiveSettlementBatch,
  reconcileWeeklyIncentiveSettlement,
  settleWeeklyIncentiveReward,
} = require('./weeklyIncentiveService');

const nowMs = Date.parse('2026-07-29T12:00:00.000Z');
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = {
  delete: () => ({ __delete: true }),
  serverTimestamp: () => timestamp(nowMs),
};

describe('weeklyIncentiveService', () => {
  it('atomically credits both currencies and grants an unequipped timed item', async () => {
    const db = seededDb();
    const input = settlementInput({
      rewardBundle: {
        coins: 300,
        diamonds: 4,
        items: [{ itemId: 'weekly-avatar' }],
      },
    });
    const first = await settleWeeklyIncentiveReward({ clock, db, fieldValue, input });
    const replay = await settleWeeklyIncentiveReward({ clock, db, fieldValue, input });

    expect(first).toMatchObject({
      replayed: false,
      result: {
        items: [{ itemId: 'weekly-avatar', outcome: 'granted' }],
        walletCredits: [
          { amount: 300, balanceAfter: 400, currency: 'coins' },
          { amount: 4, balanceAfter: 6, currency: 'diamonds' },
        ],
      },
    });
    expect(replay).toMatchObject({ replayed: true, result: first.result });
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 400, diamonds: 6 });
    expect(db.read('walletSummaries/user-1').economyBalances).toEqual({ giftEarnings: 9 });
    expect(db.read('storeOwnerships/user-1/items/weekly-avatar')).toMatchObject({
      equipped: false,
      itemId: 'weekly-avatar',
      source: 'weekly-incentive:rocket-rewards',
      state: 'active',
      uid: 'user-1',
    });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(2);
    await expect(reconcileWeeklyIncentiveSettlement({ db, settlementId: input.settlementId }))
      .resolves.toEqual({
        balanced: true,
        discrepancies: [],
        settlementId: input.settlementId,
      });
  });

  it('creates weekly cycles lazily and reuses their immutable template snapshot', async () => {
    const db = seededDb();
    const args = {
      clock,
      db,
      feature: 'rocket-rewards',
      fieldValue,
      scopeId: 'room-1',
      templateVersion: 4,
    };
    const first = await getOrCreateWeeklyIncentiveCycle(args);
    const replay = await getOrCreateWeeklyIncentiveCycle({ ...args, templateVersion: 99 });
    expect(first).toMatchObject({
      cycle: {
        cycleId: 'weekly_2026-07-27_asia-baghdad',
        templateVersion: 4,
      },
      replayed: false,
    });
    expect(replay).toMatchObject({
      cycle: { templateVersion: 4 },
      cycleDocumentId: first.cycleDocumentId,
      replayed: true,
    });
  });

  it('uses the configured fallback for a duplicate permanent item', async () => {
    const db = seededDb();
    db.documents.set('storeCatalog/permanent-car', catalog('permanent-car', 'cars', { kind: 'permanent' }));
    db.documents.set('storeOwnerships/user-1/items/permanent-car', ownership('permanent-car', 'cars', { kind: 'permanent' }));
    const input = settlementInput({
      rank: 2,
      rewardBundle: {
        items: [{
          duplicateFallback: { amount: 25, currency: 'diamonds' },
          itemId: 'permanent-car',
        }],
      },
    });

    await expect(settleWeeklyIncentiveReward({ clock, db, fieldValue, input }))
      .resolves.toMatchObject({
        result: {
          items: [{
            fallback: { amount: 25, currency: 'diamonds' },
            itemId: 'permanent-car',
            outcome: 'duplicate-fallback',
          }],
        },
      });
    expect(db.read('walletSummaries/user-1').balances.diamonds).toBe(27);
  });

  it('serializes concurrent retries into one payment', async () => {
    const db = seededDb();
    const input = settlementInput({ rewardBundle: { coins: 10 } });
    const [first, second] = await Promise.all([
      settleWeeklyIncentiveReward({ clock, db, fieldValue, input }),
      settleWeeklyIncentiveReward({ clock, db, fieldValue, input }),
    ]);
    expect([first, second].filter((result) => result.replayed === false)).toHaveLength(1);
    expect([first, second].filter((result) => result.replayed === true)).toHaveLength(1);
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(110);
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(1);
  });

  it('previews the exact payout without writing a wallet, ledger, or settlement', async () => {
    const db = seededDb();
    const input = settlementInput({ rewardBundle: { coins: 20 } });
    await expect(settleWeeklyIncentiveReward({
      clock,
      db,
      fieldValue,
      input,
      mode: 'preview',
    })).resolves.toMatchObject({
      preview: true,
      result: {
        walletCredits: [{ amount: 20, balanceAfter: 120, currency: 'coins' }],
      },
    });
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(100);
    expect(db.read(`rewardSettlements/${input.settlementId}`)).toBeUndefined();
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(0);
  });

  it('holds a permanent duplicate without a fallback and makes no economic writes', async () => {
    const db = seededDb();
    db.documents.set('storeCatalog/permanent-car', catalog('permanent-car', 'cars', { kind: 'permanent' }));
    db.documents.set('storeOwnerships/user-1/items/permanent-car', ownership('permanent-car', 'cars', { kind: 'permanent' }));
    const input = settlementInput({
      rank: 3,
      rewardBundle: { items: [{ itemId: 'permanent-car' }] },
    });
    await expect(settleWeeklyIncentiveReward({ clock, db, fieldValue, input }))
      .resolves.toMatchObject({ errorCode: 'DUPLICATE_FALLBACK_REQUIRED', held: true });
    expect(db.read(`rewardSettlements/${input.settlementId}`)).toMatchObject({
      holdReason: 'DUPLICATE_FALLBACK_REQUIRED',
      state: 'held',
    });
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 100, diamonds: 2 });
  });

  it('queues idempotently and keeps payout work disabled behind its own flag', async () => {
    const db = seededDb();
    const input = settlementInput({ rewardBundle: { coins: 10 } });
    expect(await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input }))
      .toMatchObject({ replayed: false, settlementId: input.settlementId });
    expect(await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input }))
      .toMatchObject({ replayed: true, settlementId: input.settlementId });

    const batch = await processWeeklyIncentiveSettlementBatch({
      clock,
      db,
      fieldValue,
      options: { workerId: 'worker-1' },
    });
    expect(batch).toMatchObject({
      processed: 1,
      results: [{ settlementId: input.settlementId, state: 'disabled' }],
    });
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(100);
  });

  it('processes a bounded enabled job and closes its lease as paid', async () => {
    const db = seededDb();
    db.documents.set('appConfig/voiceRoomFeatures', { voice_room_rocket_rewards: true });
    const input = settlementInput({ rewardBundle: { diamonds: 7 } });
    await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input });
    const batch = await processWeeklyIncentiveSettlementBatch({
      clock,
      db,
      fieldValue,
      options: { leaseMillis: 30_000, limit: 1, workerId: 'worker-1' },
    });
    expect(batch).toMatchObject({
      processed: 1,
      results: [{ settlementId: input.settlementId, state: 'paid' }],
      scanned: 1,
    });
    expect(db.read(`rewardSettlementJobs/${input.settlementId}`)).toMatchObject({ state: 'paid' });
    expect(db.read('walletSummaries/user-1').balances.diamonds).toBe(9);
  });

  it('recovers an expired worker lease before retrying the idempotent payout', async () => {
    const db = seededDb();
    db.documents.set('appConfig/voiceRoomFeatures', { voice_room_rocket_rewards: true });
    const input = settlementInput({ rewardBundle: { coins: 5 } });
    await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input });
    db.documents.set(`rewardSettlementJobs/${input.settlementId}`, {
      ...db.read(`rewardSettlementJobs/${input.settlementId}`),
      leaseExpiresAt: timestamp(nowMs - 1),
      leasedBy: 'dead-worker',
      state: 'paying',
    });
    const batch = await processWeeklyIncentiveSettlementBatch({
      clock,
      db,
      fieldValue,
      options: { workerId: 'replacement-worker' },
    });
    expect(batch.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementId: input.settlementId, state: 'paid' }),
    ]));
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(105);
  });

  it('reports a missing economic ledger without trying to repair it', async () => {
    const db = seededDb();
    const input = settlementInput({ rewardBundle: { coins: 10 } });
    await settleWeeklyIncentiveReward({ clock, db, fieldValue, input });
    db.documents.delete(`walletTransactions/${input.settlementId}_coins`);
    await expect(reconcileWeeklyIncentiveSettlement({ db, settlementId: input.settlementId }))
      .resolves.toEqual({
        balanced: false,
        discrepancies: ['WALLET_LEDGER_COINS'],
        settlementId: input.settlementId,
      });
  });
});

function settlementInput({ rank = 1, rewardBundle }) {
  const base = {
    cycleId: 'weekly_2026-07-27_asia-baghdad',
    feature: 'rocket-rewards',
    source: { planId: '', rank, roomId: 'room-1' },
    uid: 'user-1',
  };
  return {
    ...base,
    rewardBundle,
    settlementId: createSettlementId({ ...base, ...base.source }),
  };
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': {
      voice_room_owner_target_payouts: false,
      voice_room_payroll_payouts: false,
      voice_room_rocket_rewards: false,
    },
    'publicProfiles/user-1': {
      moderationStatus: 'active',
      uid: 'user-1',
    },
    'storeCatalog/weekly-avatar': catalog('weekly-avatar', 'avatar-frames', {
      kind: 'timed',
      unit: 'weeks',
      value: 1,
    }),
    'walletSummaries/user-1': {
      balances: { coins: 100, diamonds: 2 },
      createdAt: timestamp(nowMs - 1000),
      economyBalances: { giftEarnings: 9 },
      lifetimeCredit: { coins: 100, diamonds: 2 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'user-1',
      updatedAt: timestamp(nowMs - 1000),
    },
  });
}

function catalog(itemId, category, duration) {
  return {
    availability: 'available',
    category,
    description: { ar: 'وصف', en: 'Description' },
    duration,
    itemId,
    name: { ar: 'مكافأة', en: 'Reward' },
    order: 1,
    previewAssetUrl: 'https://example.com/preview.png',
    prices: { coins: 10 },
    purchasingEnabled: true,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'https://example.com/thumb.png',
  };
}

function ownership(itemId, category, duration) {
  return {
    acquiredAt: timestamp(nowMs - 1000),
    category,
    duration,
    equipped: false,
    itemId,
    kind: 'store-ownership',
    ownershipId: itemId,
    state: 'active',
    uid: 'user-1',
    updatedAt: timestamp(nowMs - 1000),
  };
}

function timestamp(value) {
  return { toMillis: () => value };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) {
    return makeRef(this, path);
  }
  collection(path) {
    return new FakeQuery(this, path);
  }
  read(path) {
    return this.documents.get(path);
  }
  async runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }
  async get(ref) {
    return snapshot(this.db, ref.path, this.db.documents.get(ref.path));
  }
  create(ref, data) {
    this.operations.push({ data, kind: 'create', path: ref.path });
  }
  set(ref, data, options) {
    this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path });
  }
  update(ref, data) {
    this.operations.push({ data, kind: 'update', path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
      const current = this.db.documents.get(operation.path) || {};
      const data = Object.fromEntries(Object.entries(operation.data).filter(([, value]) => value?.__delete !== true));
      const next = operation.kind === 'update' || operation.merge ? { ...current, ...data } : data;
      for (const [key, value] of Object.entries(operation.data)) if (value?.__delete === true) delete next[key];
      this.db.documents.set(operation.path, next);
    }
  }
}

class FakeQuery {
  constructor(db, path, filters = [], max = 50, cursor = '') {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.max = max;
    this.cursor = cursor;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.max, this.cursor);
  }
  orderBy() {
    return this;
  }
  startAfter(cursor) {
    return new FakeQuery(this.db, this.path, this.filters, this.max, cursor);
  }
  limit(max) {
    return new FakeQuery(this.db, this.path, this.filters, max, this.cursor);
  }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => operator === '==' && data[field] === value))
      .sort((left, right) => String(left[1].settlementId || left[0]).localeCompare(String(right[1].settlementId || right[0])))
      .filter(([, data]) => !this.cursor || String(data.settlementId) > this.cursor)
      .slice(0, this.max)
      .map(([path, data]) => snapshot(this.db, path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(db, path) {
  return {
    get: async () => snapshot(db, path, db.documents.get(path)),
    id: path.split('/').at(-1),
    path,
    set: async (data, options) => {
      const current = db.documents.get(path) || {};
      const filtered = Object.fromEntries(Object.entries(data).filter(([, value]) => value?.__delete !== true));
      const next = options?.merge ? { ...current, ...filtered } : filtered;
      for (const [key, value] of Object.entries(data)) if (value?.__delete === true) delete next[key];
      db.documents.set(path, next);
    },
  };
}

function snapshot(db, path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeRef(db, path),
  };
}
