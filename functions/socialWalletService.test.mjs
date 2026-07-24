import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getWalletStore, purchaseSpecialId } = require('./socialWalletService');

const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };

describe('socialWalletService', () => {
  it('keeps the store behind the remotely controlled wallet flag', async () => {
    const db = walletDb({ wallet: false });

    expect(await getWalletStore({ db, uid: 'self' })).toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('returns only valid available catalog items and the server balance', async () => {
    const db = walletDb({ wallet: true });
    db.documents.set('specialIdCatalog/0000777', catalogItem('0000777', 50));
    db.documents.set('specialIdCatalog/0000888', catalogItem('0000888', 80, 'disabled'));
    db.documents.set('specialIdCatalog/bad', { price: 1, specialId: '@bad', status: 'available' });
    db.documents.set('walletRechargeReceipts/self/items/recharge-1', { amount: 3, createdAt: { toMillis: () => 2000 }, currency: 'diamonds', representativePublicId: '2222222', representativeUid: 'agent', status: 'completed' });

    const response = await getWalletStore({ db, uid: 'self' });

    expect(response.result.items).toEqual([{ price: 50, specialId: '0000777', status: 'available' }]);
    expect(response.result.wallet).toMatchObject({ balances: { coins: 100, diamonds: 0 }, uid: 'self' });
    expect(response.result.recentRecharges).toEqual([{ amount: 3, createdAt: '1970-01-01T00:00:02.000Z', currency: 'diamonds', representativePublicId: '2222222', representativeUid: 'agent', status: 'completed', transferId: 'recharge-1' }]);
  });

  it('purchases a special ID atomically and is idempotent by request ID', async () => {
    const db = walletDb({ wallet: true });
    db.documents.set('specialIdCatalog/0000777', catalogItem('0000777', 40));
    const command = {
      db,
      fieldValue,
      input: { specialId: '0000777' },
      requestId: 'purchase_12345678',
      uid: 'self',
    };

    expect(await purchaseSpecialId(command)).toEqual({ result: { balances: { coins: 60, diamonds: 0 }, specialId: '0000777' } });
    expect(await purchaseSpecialId(command)).toEqual({ result: { balances: { coins: 60, diamonds: 0 }, specialId: '0000777' } });
    expect(db.documents.get('publicProfiles/self').specialId).toBe('0000777');
    expect(db.documents.get('walletSummaries/self')).toMatchObject({
      balances: { coins: 60, diamonds: 0 },
      lifetimeDebit: { coins: 40, diamonds: 0 },
    });
    expect(db.documents.get('specialIds/0000777')).toMatchObject({ uid: 'self' });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(1);
    expect(db.documents.get('walletTransactions/self_purchase_12345678')).toMatchObject({ currency: 'coins' });
  });

  it('does not write anything when the wallet balance is insufficient', async () => {
    const db = walletDb({ wallet: true });
    db.documents.set('specialIdCatalog/0000777', catalogItem('0000777', 101));

    expect(await purchaseSpecialId({
      db,
      fieldValue,
      input: { specialId: '0000777' },
      requestId: 'purchase_12345678',
      uid: 'self',
    })).toEqual({ errorCode: 'INSUFFICIENT_FUNDS' });
    expect(db.documents.has('specialIds/0000777')).toBe(false);
    expect(db.documents.get('walletSummaries/self').balance).toBe(100);
  });

  it('refuses a custom ID that collides with a normal account ID', async () => {
    const db = walletDb({ wallet: true });
    db.documents.set('specialIdCatalog/7654321', catalogItem('7654321', 40));
    db.documents.set('publicIds/7654321', { createdAt: timestamp(), uid: 'other-user' });

    expect(await purchaseSpecialId({
      db,
      fieldValue,
      input: { specialId: '7654321' },
      requestId: 'purchase_collision_01',
      uid: 'self',
    })).toEqual({ errorCode: 'NOT_FOUND' });
    expect(db.documents.get('walletSummaries/self').balance).toBe(100);
  });

  it('preserves diamonds when a legacy special-ID purchase debits coins', async () => {
    const db = walletDb({ wallet: true });
    db.documents.set('walletSummaries/self', {
      balances: { coins: 100, diamonds: 9 },
      createdAt: timestamp(),
      lifetimeCredit: { coins: 100, diamonds: 9 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'self',
      updatedAt: timestamp(),
    });
    db.documents.set('specialIdCatalog/0000999', catalogItem('0000999', 25));
    await purchaseSpecialId({
      db,
      fieldValue,
      input: { specialId: '0000999' },
      requestId: 'purchase_preserve_01',
      uid: 'self',
    });
    expect(db.documents.get('walletSummaries/self').balances).toEqual({ coins: 75, diamonds: 9 });
  });
});

function walletDb(flags) {
  return new FakeFirestore({
    'appConfig/socialFeatures': flags,
    'publicProfiles/self': publicProfile(),
    'publicIds/1234567': { createdAt: timestamp(), uid: 'self' },
    'walletSummaries/self': {
      balance: 100,
      createdAt: timestamp(),
      lifetimeCredit: 100,
      lifetimeDebit: 0,
      uid: 'self',
      updatedAt: timestamp(),
    },
  });
}

function publicProfile() {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 0,
    createdAt: timestamp(),
    displayName: 'Self',
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: 'self',
    publicId: '1234567',
    uid: 'self',
    updatedAt: timestamp(),
  };
}

function catalogItem(specialId, price, status = 'available') {
  return { createdAt: timestamp(), price, specialId, status, updatedAt: timestamp() };
}

function timestamp() {
  return { toMillis: () => 1 };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  doc(path) {
    return { get: async () => createSnapshot(path, this.documents.get(path)), path };
  }

  async getAll(...refs) {
    return refs.map((ref) => createSnapshot(ref.path, this.documents.get(ref.path)));
  }

  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(ref) {
    return createSnapshot(ref.path, this.db.documents.get(ref.path));
  }

  create(ref, data) {
    this.operations.push({ kind: 'create', data, path: ref.path });
  }

  set(ref, data) {
    this.operations.push({ kind: 'set', data, path: ref.path });
  }

  update(ref, data) {
    this.operations.push({ kind: 'update', data, path: ref.path });
  }

  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'update') {
        this.db.documents.set(operation.path, { ...this.db.documents.get(operation.path), ...operation.data });
      } else if (operation.kind === 'set') {
        this.db.documents.set(operation.path, operation.data);
      } else {
        if (this.db.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
      }
    }
  }
}

class FakeQuery {
  constructor(db, path, state = {}) {
    this.db = db;
    this.path = path;
    this.state = state;
  }

  where(field, operator, value) {
    return this.next({ filters: [...(this.state.filters || []), { field, operator, value }] });
  }

  orderBy(field, direction = 'asc') {
    return this.next({ order: { direction, field } });
  }

  limit(value) {
    return this.next({ limit: value });
  }

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ data, path }));
    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => filter.operator === '==' && data[filter.field] === filter.value);
    }
    if (this.state.order) {
      const { direction, field } = this.state.order;
      rows.sort((left, right) => (left.data[field] - right.data[field]) * (direction === 'desc' ? -1 : 1));
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ data, path }) => createSnapshot(path, data)) };
  }

  next(update) {
    return new FakeQuery(this.db, this.path, { ...this.state, ...update });
  }
}

function createSnapshot(path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: { path },
  };
}
