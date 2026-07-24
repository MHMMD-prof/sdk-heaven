import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getGiftCenter, sendGift } = require('./socialGiftsService');

const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };

describe('socialGiftsService', () => {
  it('keeps gifts behind the remote flag', async () => {
    expect(await getGiftCenter({ db: giftDb(false), uid: 'self' })).toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('returns catalog, history, recipient, and wallet through the server boundary', async () => {
    const db = giftDb(true);
    db.documents.set('giftEvents/old', giftEvent());
    const response = await getGiftCenter({ db, input: { targetUid: 'target' }, uid: 'self' });

    expect(response.result.catalog).toHaveLength(1);
    expect(response.result.recipient).toMatchObject({ uid: 'target' });
    expect(response.result.sent).toHaveLength(1);
    expect(response.result.wallet.balances).toEqual({ coins: 100, diamonds: 0 });
  });

  it('debits once, records history, and increases recipient score atomically', async () => {
    const db = giftDb(true);
    const command = {
      db,
      fieldValue,
      input: { giftId: 'rose', message: 'مبارك', targetUid: 'target' },
      requestId: 'gift_request_123456',
      uid: 'self',
    };

    expect(await sendGift(command)).toEqual({ result: { balances: { coins: 75, diamonds: 0 }, eventId: 'self_gift_request_123456', giftScore: 7 } });
    expect(await sendGift(command)).toEqual({ result: { balances: { coins: 75, diamonds: 0 }, eventId: 'self_gift_request_123456', giftScore: 7 } });
    expect(db.documents.get('walletSummaries/self')).toMatchObject({
      balances: { coins: 75, diamonds: 0 },
      lifetimeDebit: { coins: 25, diamonds: 0 },
    });
    expect(db.documents.get('publicProfiles/target').giftScore).toBe(7);
    expect([...db.documents.keys()].filter((path) => path.startsWith('giftEvents/'))).toHaveLength(1);
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(1);
    expect(db.documents.get('walletTransactions/gift_self_gift_request_123456')).toMatchObject({ currency: 'coins' });
  });

  it('rejects blocked and unaffordable gifts without writes', async () => {
    const blocked = giftDb(true);
    blocked.documents.set('blocks/target/blocked/self', { createdAt: timestamp() });
    expect(await sendGift({
      db: blocked,
      fieldValue,
      input: { giftId: 'rose', targetUid: 'target' },
      requestId: 'gift_request_123456',
      uid: 'self',
    })).toEqual({ errorCode: 'PERMISSION_DENIED' });

    const expensive = giftDb(true);
    expensive.documents.set('giftCatalog/rose', catalogItem(101));
    expect(await sendGift({
      db: expensive,
      fieldValue,
      input: { giftId: 'rose', targetUid: 'target' },
      requestId: 'gift_request_123456',
      uid: 'self',
    })).toEqual({ errorCode: 'INSUFFICIENT_FUNDS' });
    expect(expensive.documents.get('publicProfiles/target').giftScore).toBe(2);
  });
});

function giftDb(gifts) {
  return new FakeFirestore({
    'appConfig/socialFeatures': { gifts },
    'giftCatalog/rose': catalogItem(25),
    'publicIds/1111111': { createdAt: timestamp(), uid: 'self' },
    'publicIds/2222222': { createdAt: timestamp(), uid: 'target' },
    'publicProfiles/self': profile('self', 'المرسل', '1111111', 0),
    'publicProfiles/target': profile('target', 'المستلم', '2222222', 2),
    'walletSummaries/self': {
      balance: 100, createdAt: timestamp(), lifetimeCredit: 100, lifetimeDebit: 0, uid: 'self', updatedAt: timestamp(),
    },
  });
}

function profile(uid, displayName, publicId, giftScore) {
  return {
    avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', coupleLevel: 0,
    createdAt: timestamp(), displayName, friendCount: 0, giftScore, moderationStatus: 'active',
    normalizedName: displayName, publicId, uid, updatedAt: timestamp(),
  };
}

function catalogItem(price) {
  return { giftId: 'rose', iconKey: 'rose', nameAr: 'وردة ملكية', price, scoreValue: 5, status: 'available' };
}

function giftEvent() {
  return {
    createdAt: timestamp(), giftId: 'rose', iconKey: 'rose', message: '', nameAr: 'وردة ملكية', price: 25,
    recipientDisplayName: 'المستلم', recipientUid: 'target', scoreValue: 5,
    senderDisplayName: 'المرسل', senderUid: 'self',
  };
}

function timestamp() { return { toMillis: () => 1 }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  collection(path) { return new FakeQuery(this, path); }
  doc(path) { return { get: async () => snapshot(path, this.documents.get(path)), path }; }
  async getAll(...refs) { return refs.map((ref) => snapshot(ref.path, this.documents.get(ref.path))); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ data, kind: 'create', path: ref.path }); }
  set(ref, data) { this.operations.push({ data, kind: 'set', path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'update') this.db.documents.set(operation.path, { ...this.db.documents.get(operation.path), ...operation.data });
      else if (operation.kind === 'set') this.db.documents.set(operation.path, operation.data);
      else {
        if (this.db.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
      }
    }
  }
}

class FakeQuery {
  constructor(db, path, state = {}) { this.db = db; this.path = path; this.state = state; }
  where(field, operator, value) { return this.next({ filters: [...(this.state.filters || []), { field, operator, value }] }); }
  orderBy(field, direction = 'asc') { return this.next({ order: { direction, field } }); }
  limit(value) { return this.next({ limit: value }); }
  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ data, path }));
    for (const filter of this.state.filters || []) rows = rows.filter(({ data }) => filter.operator === '==' && data[filter.field] === filter.value);
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ data, path }) => snapshot(path, data)) };
  }
  next(update) { return new FakeQuery(this.db, this.path, { ...this.state, ...update }); }
}

function snapshot(path, data) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: { path } };
}
