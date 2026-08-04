import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  materializeRoomSupportLeaderboard,
  projectCommittedRoomGift,
  reconcileRoomGiftProjectionBatch,
  reconcileRoomSupportPeriod,
} = require('./roomSupportProjectionService');

const nowMs = Date.parse('2026-07-29T12:00:00.000Z');
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomSupportProjectionService', () => {
  it('projects a gift exactly once into day/week supporter totals and deterministic shards', async () => {
    const db = seededDb();
    const event = gift({ eventId: 'event-1', price: 250 });
    const args = { clock, db, event, fieldValue, roomId: 'room-1' };
    const first = await projectCommittedRoomGift(args);
    const replay = await projectCommittedRoomGift(args);
    const weekId = first.fact.weekId;
    const dayId = first.fact.dayId;

    expect(first).toMatchObject({ replayed: false });
    expect(replay).toMatchObject({ replayed: true });
    expect(db.read(`rooms/room-1/supportPeriods/${weekId}/supporters/sender-1`)).toMatchObject({
      eligibleSpendCoins: 250,
      giftCount: 1,
      supportPoints: 250,
    });
    expect(db.read(`rooms/room-1/supportPeriods/${dayId}/supporters/sender-1`)).toMatchObject({
      eligibleSpendCoins: 250,
      giftCount: 1,
    });
    expect([...db.documents.keys()].filter((path) => path.startsWith('canonicalRoomGiftFacts/'))).toHaveLength(1);
    expect([...db.documents.keys()].filter((path) => path.startsWith('roomSupportLeaderboardRefreshes/'))).toHaveLength(2);
  });

  it('serializes duplicate delivery and cannot double count', async () => {
    const db = seededDb();
    const event = gift({ eventId: 'event-concurrent', price: 80 });
    const [first, second] = await Promise.all([
      projectCommittedRoomGift({ clock, db, event, fieldValue, roomId: 'room-1' }),
      projectCommittedRoomGift({ clock, db, event, fieldValue, roomId: 'room-1' }),
    ]);
    expect([first, second].filter((result) => result.replayed === false)).toHaveLength(1);
    expect([first, second].filter((result) => result.replayed === true)).toHaveLength(1);
    const fact = first.fact || second.fact;
    expect(db.read(`rooms/room-1/supportPeriods/${fact.weekId}/supporters/sender-1`).eligibleSpendCoins).toBe(80);
    await expect(projectCommittedRoomGift({
      clock,
      db,
      event: { ...event, price: 81 },
      fieldValue,
      roomId: 'room-1',
    })).resolves.toEqual({ errorCode: 'PROJECTION_CONFLICT' });
  });

  it('serializes a same-supporter burst without losing a contribution', async () => {
    const db = seededDb();
    const events = Array.from({ length: 20 }, (_, index) => gift({
      eventId: `burst-${index}`,
      price: 100,
    }));
    const results = await Promise.all(events.map((event) => projectCommittedRoomGift({
      clock,
      db,
      event,
      fieldValue,
      roomId: 'room-1',
    })));
    const weekId = results[0].fact.weekId;
    expect(db.read(`rooms/room-1/supportPeriods/${weekId}/supporters/sender-1`)).toMatchObject({
      eligibleSpendCoins: 2000,
      giftCount: 20,
    });
  });

  it('preserves the earliest timestamp when delayed gifts arrive out of order', async () => {
    const db = seededDb();
    const later = gift({ createdAt: timestamp(nowMs + 1000), eventId: 'event-later' });
    const earlier = gift({ createdAt: timestamp(nowMs - 1000), eventId: 'event-earlier' });
    const first = await projectCommittedRoomGift({ clock, db, event: later, fieldValue, roomId: 'room-1' });
    await projectCommittedRoomGift({ clock, db, event: earlier, fieldValue, roomId: 'room-1' });
    const aggregate = db.read(`rooms/room-1/supportPeriods/${first.fact.weekId}/supporters/sender-1`);
    expect(aggregate.firstContributionAt.toMillis()).toBe(nowMs - 1000);
    expect(aggregate.lastContributionAt.toMillis()).toBe(nowMs + 1000);
    expect(aggregate.giftCount).toBe(2);
  });

  it('does not accrue while the independent rankings flag is disabled', async () => {
    const db = seededDb();
    db.documents.set('appConfig/voiceRoomFeatures', { voice_room_supporter_rankings: false });
    const result = await projectCommittedRoomGift({
      clock,
      db,
      event: gift({ eventId: 'event-disabled' }),
      fieldValue,
      roomId: 'room-1',
    });
    expect(result).toEqual({ skipped: true, reason: 'feature-disabled' });
    expect(db.read('canonicalRoomGiftFacts/event-disabled')).toBeUndefined();
  });

  it('materializes one compact deterministic leaderboard with sharded totals', async () => {
    const db = seededDb();
    const first = await projectCommittedRoomGift({
      clock,
      db,
      event: gift({ createdAt: timestamp(nowMs + 500), eventId: 'event-a', price: 500, senderUid: 'sender-2' }),
      fieldValue,
      roomId: 'room-1',
    });
    await projectCommittedRoomGift({
      clock,
      db,
      event: gift({ createdAt: timestamp(nowMs), eventId: 'event-b', price: 500, senderUid: 'sender-1' }),
      fieldValue,
      roomId: 'room-1',
    });
    const period = [...db.documents.values()].find((data) => data.periodId === first.fact.weekId && data.periodKey);
    const result = await materializeRoomSupportLeaderboard({
      clock,
      db,
      fieldValue,
      periodKey: period.periodKey,
    });
    expect(result.leaderboard.entries.map((entry) => entry.uid)).toEqual(['sender-1', 'sender-2']);
    expect(result.leaderboard.totals).toEqual({
      eligibleSpendCoins: 1000,
      giftCount: 2,
      supportPoints: 1000,
    });
    expect(db.read(`rooms/room-1/supportLeaderboards/${first.fact.weekId}`).entries).toHaveLength(2);
  });

  it('detects and safely repairs aggregate drift from canonical facts', async () => {
    const db = seededDb();
    const projected = await projectCommittedRoomGift({
      clock,
      db,
      event: gift({ eventId: 'event-drift', price: 300 }),
      fieldValue,
      roomId: 'room-1',
    });
    const period = [...db.documents.values()].find((data) => data.periodId === projected.fact.weekId && data.periodKey);
    const aggregatePath = `rooms/room-1/supportPeriods/${projected.fact.weekId}/supporters/sender-1`;
    db.documents.set(aggregatePath, { ...db.read(aggregatePath), eligibleSpendCoins: 999 });

    const report = await reconcileRoomSupportPeriod({
      apply: false,
      clock,
      db,
      fieldValue,
      periodKey: period.periodKey,
    });
    expect(report).toMatchObject({
      balanced: false,
      factCount: 1,
      supporterDrift: [{ id: 'sender-1', kind: 'mismatch' }],
    });
    await reconcileRoomSupportPeriod({
      apply: true,
      clock,
      db,
      fieldValue,
      periodKey: period.periodKey,
    });
    expect(db.read(aggregatePath).eligibleSpendCoins).toBe(300);
  });

  it('resumes the raw-event reconciler from a bounded cursor and replays safely', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-1/giftEvents/event-a', gift({ eventId: 'event-a', price: 10 }));
    db.documents.set('rooms/room-1/giftEvents/event-b', gift({ eventId: 'event-b', price: 20 }));
    const dependencies = {
      clock,
      db,
      documentIdField: '__name__',
      fieldValue,
      limit: 1,
    };
    const first = await reconcileRoomGiftProjectionBatch(dependencies);
    const second = await reconcileRoomGiftProjectionBatch({ ...dependencies, cursor: first.nextCursor });
    const replay = await reconcileRoomGiftProjectionBatch(dependencies);
    expect(first).toMatchObject({ projected: 1, replayed: 0, scanned: 1 });
    expect(second).toMatchObject({ projected: 1, replayed: 0, scanned: 1 });
    expect(replay).toMatchObject({ projected: 0, replayed: 1, scanned: 1 });
    expect([...db.documents.keys()].filter((path) => path.startsWith('canonicalRoomGiftFacts/'))).toHaveLength(2);
  });
});

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': { voice_room_supporter_rankings: true },
    'publicProfiles/sender-1': {
      avatarLabel: 'S',
      avatarUrl: 'https://example.com/s1.png',
      displayName: 'Sender One',
      uid: 'sender-1',
    },
    'publicProfiles/sender-2': {
      avatarLabel: 'T',
      avatarUrl: 'https://example.com/s2.png',
      displayName: 'Sender Two',
      uid: 'sender-2',
    },
    'rooms/room-1': {
      availability: 'active',
      roomId: 'room-1',
      status: 'active',
      visibility: 'public',
    },
  });
}

function gift(overrides = {}) {
  const price = overrides.price ?? 100;
  return {
    createdAt: timestamp(nowMs),
    currency: 'coins',
    eventId: 'event-1',
    price,
    recipientUid: 'target-1',
    reconciliation: {
      balanced: true,
      platformCredit: Math.floor(price / 10),
      recipientCredit: price - Math.floor(price / 10),
      senderDebit: price,
    },
    roomAvailability: 'active',
    roomId: 'room-1',
    roomStatus: 'active',
    roomVisibility: 'public',
    scoreValue: 3,
    senderDisplayName: 'Sender',
    senderUid: 'sender-1',
    status: 'committed',
    ...overrides,
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
    return new FakeQuery(this, path, false);
  }
  collectionGroup(name) {
    return new FakeQuery(this, name, true);
  }
  read(path) {
    return this.documents.get(path);
  }
  async getAll(...refs) {
    return refs.map((ref) => snapshot(this, ref.path, this.documents.get(ref.path)));
  }
  batch() {
    return new FakeBatch(this);
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
    applyOperations(this.db, this.operations);
  }
}

class FakeBatch {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }
  set(ref, data, options) {
    this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path });
  }
  update(ref, data) {
    this.operations.push({ data, kind: 'update', path: ref.path });
  }
  delete(ref) {
    this.operations.push({ kind: 'delete', path: ref.path });
  }
  async commit() {
    applyOperations(this.db, this.operations);
  }
}

class FakeQuery {
  constructor(db, path, collectionGroup, filters = [], orders = [], max = Infinity, cursor = '') {
    this.db = db;
    this.path = path;
    this.collectionGroupQuery = collectionGroup;
    this.filters = filters;
    this.orders = orders;
    this.max = max;
    this.cursor = cursor;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, this.collectionGroupQuery, [...this.filters, { field, operator, value }], this.orders, this.max, this.cursor);
  }
  orderBy(field, direction = 'asc') {
    return new FakeQuery(this.db, this.path, this.collectionGroupQuery, this.filters, [...this.orders, { direction, field }], this.max, this.cursor);
  }
  limit(max) {
    return new FakeQuery(this.db, this.path, this.collectionGroupQuery, this.filters, this.orders, max, this.cursor);
  }
  startAfter(cursor) {
    return new FakeQuery(this.db, this.path, this.collectionGroupQuery, this.filters, this.orders, this.max, cursor);
  }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => this.collectionGroupQuery
        ? path.split('/').at(-2) === this.path
        : path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => {
        if (operator === '==') return data[field] === value;
        if (operator === 'array-contains') return Array.isArray(data[field]) && data[field].includes(value);
        return false;
      }))
      .sort((left, right) => compareDocuments(left, right, this.orders))
      .filter(([path, data]) => !this.cursor || String(
        this.orders[0]?.field === '__name__'
          ? path
          : data[this.orders[0]?.field] || path.split('/').at(-1),
      ) > this.cursor)
      .slice(0, this.max)
      .map(([path, data]) => snapshot(this.db, path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(db, path) {
  const segments = path.split('/');
  const parentPath = segments.slice(0, -1).join('/');
  return {
    get: async () => snapshot(db, path, db.documents.get(path)),
    id: segments.at(-1),
    parent: {
      id: segments.at(-2),
      parent: segments.length >= 3 ? { id: segments.at(-3) } : null,
      path: parentPath,
    },
    path,
    set: async (data, options) => {
      applyOperations(db, [{ data, kind: 'set', merge: options?.merge === true, path }]);
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

function applyOperations(db, operations) {
  for (const operation of operations) {
    if (operation.kind === 'delete') {
      db.documents.delete(operation.path);
      continue;
    }
    if (operation.kind === 'create' && db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
    const current = db.documents.get(operation.path) || {};
    db.documents.set(
      operation.path,
      operation.kind === 'update' || operation.merge
        ? { ...current, ...operation.data }
        : operation.data,
    );
  }
}

function compareDocuments(left, right, orders) {
  for (const { direction, field } of orders) {
    const a = comparable(field === '__name__' ? left[0] : left[1][field] ?? left[0]);
    const b = comparable(field === '__name__' ? right[0] : right[1][field] ?? right[0]);
    if (a === b) continue;
    const result = a < b ? -1 : 1;
    return direction === 'desc' ? -result : result;
  }
  return left[0].localeCompare(right[0]);
}

function comparable(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : value;
}
