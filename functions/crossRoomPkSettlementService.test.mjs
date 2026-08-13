import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  beginCrossRoomPkSessionSettlement,
  beginCrossRoomPkSettlement,
  processCrossRoomPkReconciliations,
  projectCrossRoomPkGift,
} = require('./crossRoomPkSettlementService');

const baseNowMs = 2_000_000_000_000;
const fieldValue = { serverTimestamp: () => timestamp(baseNowMs) };

describe('crossRoomPkSettlementService', () => {
  it('projects each committed gift once and counts a repeated gifter once', async () => {
    const db = seededDb(activeSession());
    const first = gift('gift-red-1', 'room-red-1', 'gifter-1', 100);
    const second = gift('gift-red-2', 'room-red-1', 'gifter-1', 50);

    expect(await project(db, first)).toMatchObject({ duplicate: false, ok: true, side: 'red' });
    expect(await project(db, first)).toMatchObject({ duplicate: true, ok: true, side: 'red' });
    expect(await project(db, second)).toMatchObject({ duplicate: false, ok: true, side: 'red' });

    const redShards = paths(db, `roomPkSessions/${sessionId}/scoreShards/red_`)
      .map((path) => db.read(path));
    expect(redShards.reduce((total, shard) => total + shard.score, 0)).toBe(150);
    expect(redShards.reduce((total, shard) => total + shard.giftCount, 0)).toBe(2);
    expect(redShards.reduce((total, shard) => total + shard.distinctGifterCount, 0)).toBe(1);
    expect(paths(db, 'roomPkGiftFacts/')).toHaveLength(2);
    expect(paths(db, `roomPkSessions/${sessionId}/gifters/`)).toHaveLength(1);
  });

  it('accepts a delayed projector delivery while settling when the gift occurred in-window', async () => {
    const session = activeSession({ status: 'settling' });
    const db = seededDb(session);
    const event = gift('gift-delayed-1', 'room-blue-1', 'gifter-blue', 75);
    expect(await project(db, event)).toMatchObject({ duplicate: false, ok: true, side: 'blue' });
  });

  it('reconciles committed source events, finalizes verified totals, records drift, and moves both pointers', async () => {
    const session = activeSession({
      endsAtMs: baseNowMs - 20_000,
      settleAfterMs: baseNowMs - 5_000,
      startedAtMs: baseNowMs - 200_000,
    });
    const db = seededDb(session);
    db.documents.set(`roomPkSessions/${sessionId}/scoreShards/red_00`, shard('red', 0, { score: 90 }));
    db.documents.set(`rooms/room-red-1/giftEvents/gift-red-source`,
      gift('gift-red-source', 'room-red-1', 'gifter-red', 100, session));
    db.documents.set(`rooms/room-blue-1/giftEvents/gift-blue-source`,
      gift('gift-blue-source', 'room-blue-1', 'gifter-blue', 50, session));

    const started = await beginCrossRoomPkSettlement({
      clock: clock(baseNowMs), db, fieldValue, limit: 10, nowMs: baseNowMs,
    });
    expect(started).toMatchObject({ started: 1 });
    expect(db.read(`roomPkSessions/${sessionId}`).status).toBe('settling');

    const processed = await processCrossRoomPkReconciliations({
      clock: clock(baseNowMs), db, fieldValue, limit: 10, workerId: 'worker-settlement-1',
    });
    expect(processed).toMatchObject({ completed: 1, processed: 1 });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      distinctGifterCount: 2,
      status: 'ended',
      teams: { blue: expect.objectContaining({ score: 50 }), red: expect.objectContaining({ score: 100 }) },
      verificationDrift: { blue: -50, red: -10 },
      winner: 'red',
      winnerReason: 'higher_score',
    });
    expect(db.read(`roomPkReconciliations/${sessionId}`)).toMatchObject({ status: 'complete' });
    expect(db.read('rooms/room-red-1')).toMatchObject({
      activePkSessionId: null, recentPkSessionId: sessionId,
    });
    expect(db.read('rooms/room-blue-1')).toMatchObject({
      activePkSessionId: null, recentPkSessionId: sessionId,
    });
  });

  it('resumes from an exact checkpoint after lease expiry without double-counting a full page', async () => {
    const session = activeSession({
      endsAtMs: baseNowMs - 20_000,
      settleAfterMs: baseNowMs - 5_000,
      startedAtMs: baseNowMs - 200_000,
    });
    const db = seededDb(session);
    for (let index = 0; index < 102; index += 1) {
      const eventId = `gift-red-page-${String(index).padStart(3, '0')}`;
      db.documents.set(`rooms/room-red-1/giftEvents/${eventId}`,
        gift(eventId, 'room-red-1', `gifter-red-${index}`, 1, session));
    }
    db.documents.set('rooms/room-blue-1/giftEvents/gift-blue-page-000',
      gift('gift-blue-page-000', 'room-blue-1', 'gifter-blue-page', 1, session));
    await beginCrossRoomPkSettlement({ clock: clock(baseNowMs), db, fieldValue, limit: 10 });

    const first = await processCrossRoomPkReconciliations({
      clock: clock(baseNowMs), db, fieldValue, jobLimit: 10, maxPagesPerSide: 1, workerId: 'worker-page-1',
    });
    expect(first).toMatchObject({ completed: 0, processed: 1 });
    expect(db.read(`roomPkReconciliations/${sessionId}`).red).toMatchObject({
      cursorEventId: 'gift-red-page-099', eventCount: 100, done: false,
    });
    expect(await processCrossRoomPkReconciliations({
      clock: clock(baseNowMs + 1), db, fieldValue, jobLimit: 10, maxPagesPerSide: 1, workerId: 'worker-page-2',
    })).toMatchObject({ completed: 0, processed: 0 });

    const resumed = await processCrossRoomPkReconciliations({
      clock: clock(baseNowMs + 60_001), db, fieldValue, jobLimit: 10, maxPagesPerSide: 1,
      workerId: 'worker-page-2',
    });
    expect(resumed).toMatchObject({ completed: 1, processed: 1 });
    expect(db.read(`roomPkReconciliations/${sessionId}`).red).toMatchObject({
      cursorEventId: 'gift-red-page-101', eventCount: 102, score: 102,
    });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      distinctGifterCount: 103,
      teams: { blue: expect.objectContaining({ score: 1 }), red: expect.objectContaining({ score: 102 }) },
      winner: 'red',
    });
  });

  it('reconciles surrender gifts but applies the opponent forfeit win over score', async () => {
    const session = activeSession();
    const db = seededDb(session);
    db.documents.set('rooms/room-red-1/giftEvents/gift-red-forfeit',
      gift('gift-red-forfeit', 'room-red-1', 'gifter-red-forfeit', 1_000, session));
    db.documents.set('rooms/room-blue-1/giftEvents/gift-blue-forfeit',
      gift('gift-blue-forfeit', 'room-blue-1', 'gifter-blue-forfeit', 1, session));
    db.documents.set('rooms/room-red-1/giftEvents/gift-red-after-forfeit', {
      ...gift('gift-red-after-forfeit', 'room-red-1', 'gifter-red-late', 500, session),
      createdAt: timestamp(baseNowMs + 1),
      createdAtMs: baseNowMs + 1,
    });

    expect(await beginCrossRoomPkSessionSettlement({
      clock: clock(baseNowMs), db, fieldValue, forfeitSide: 'red', pkId: sessionId, reason: 'surrender',
    })).toMatchObject({ ok: true, alreadySettling: false });
    const processed = await processCrossRoomPkReconciliations({
      clock: clock(baseNowMs + 15_001), db, fieldValue, jobLimit: 10, workerId: 'worker-forfeit-1',
    });
    expect(processed).toMatchObject({ completed: 1, processed: 1 });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      forfeitSide: 'red',
      scoringEndsAtMs: baseNowMs,
      status: 'forfeited',
      teams: { blue: expect.objectContaining({ score: 1 }), red: expect.objectContaining({ score: 1_000 }) },
      winner: 'blue',
      winnerReason: 'red_forfeit',
    });
  });
});

function project(db, event) {
  return projectCrossRoomPkGift({
    clock: clock(baseNowMs), db, event, eventId: event.eventId, fieldValue, roomId: event.roomId,
  });
}

const sessionId = 'crpks_settlement_service_0001';

function activeSession(overrides = {}) {
  const startedAtMs = overrides.startedAtMs ?? baseNowMs - 60_000;
  const endsAtMs = overrides.endsAtMs ?? baseNowMs + 120_000;
  const settleAfterMs = overrides.settleAfterMs ?? endsAtMs + 15_000;
  return {
    acceptedAt: timestamp(startedAtMs),
    acceptedAtMs: startedAtMs,
    acceptedByUid: 'host-blue-1',
    blueRoomId: 'room-blue-1',
    challengeId: 'crpkc_settlement_service_0001',
    createdAt: timestamp(startedAtMs - 1_000),
    createdAtMs: startedAtMs - 1_000,
    createdByUid: 'host-red-1',
    distinctGifterCount: 0,
    durationMs: endsAtMs - startedAtMs,
    endsAt: timestamp(endsAtMs),
    endsAtMs,
    giftCount: 0,
    mode: 'cross-room',
    pkId: sessionId,
    purgeAfter: timestamp(settleAfterMs + 604_800_000),
    purgeAfterMs: settleAfterMs + 604_800_000,
    redRoomId: 'room-red-1',
    roomId: 'room-red-1',
    roomIds: ['room-red-1', 'room-blue-1'],
    schemaVersion: 2,
    scoreShardCount: 16,
    settleAfter: timestamp(settleAfterMs),
    settleAfterMs,
    startedAt: timestamp(startedAtMs),
    startedAtMs,
    status: overrides.status || 'active',
    teams: {
      blue: { authorityUid: 'host-blue-1', distinctGifterCount: 0, roomId: 'room-blue-1', roomImageUrl: '', roomTitle: 'Blue room', score: 0 },
      red: { authorityUid: 'host-red-1', distinctGifterCount: 0, roomId: 'room-red-1', roomImageUrl: '', roomTitle: 'Red room', score: 0 },
    },
    updatedAt: timestamp(startedAtMs),
    winner: null,
    winnerReason: null,
  };
}

function gift(eventId, roomId, senderUid, priceCoins, session = activeSession()) {
  return {
    createdAt: timestamp(session.startedAtMs + 1_000),
    createdAtMs: session.startedAtMs + 1_000,
    eventId,
    pkContext: { mode: 'cross-room', pkId: session.pkId },
    priceCoins,
    roomId,
    senderUid,
    status: 'committed',
  };
}

function shard(side, index, overrides = {}) {
  return { distinctGifterCount: 0, giftCount: 0, index, score: 0, side, ...overrides };
}

function seededDb(session) {
  const db = new FakeFirestore({
    [`roomPkSessions/${sessionId}`]: session,
    'rooms/room-blue-1': { activePkSessionId: sessionId, id: 'room-blue-1' },
    'rooms/room-red-1': { activePkSessionId: sessionId, id: 'room-red-1' },
  });
  for (const side of ['red', 'blue']) for (let index = 0; index < 16; index += 1) {
    const id = `${side}_${String(index).padStart(2, '0')}`;
    db.documents.set(`roomPkSessions/${sessionId}/scoreShards/${id}`, shard(side, index));
  }
  return db;
}

function clock(nowMs) {
  return { nowMillis: () => nowMs, timestampFromMillis: timestamp };
}

function timestamp(value) {
  return { toDate: () => new Date(value), toMillis: () => value };
}

function paths(db, fragment) {
  return [...db.documents.keys()].filter((path) => path.includes(fragment));
}

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); this.transactionTail = Promise.resolve(); }
  collection(path) { return new FakeQuery(this, path); }
  doc(path) { return makeRef(path, this); }
  read(path) { return this.documents.get(path); }
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
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path), this.db); }
  create(ref, data) { this.operations.push({ data, kind: 'create', path: ref.path }); }
  set(ref, data, options) { this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
      if (operation.kind === 'update' && !this.db.documents.has(operation.path)) throw new Error(`Missing: ${operation.path}`);
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(operation.path,
        operation.kind === 'set' && !operation.merge ? operation.data : { ...current, ...operation.data });
    }
  }
}

class FakeQuery {
  constructor(db, path, state = {}) {
    this.db = db;
    this.path = path;
    this.filters = state.filters || [];
    this.limitCount = state.limitCount || 100;
    this.orders = state.orders || [];
    this.startValues = state.startValues || null;
  }
  where(field, operator, value) {
    return this.copy({ filters: [...this.filters, { field, operator, value }] });
  }
  orderBy(field, direction = 'asc') {
    return this.copy({ orders: [...this.orders, { direction, field }] });
  }
  startAfter(...values) { return this.copy({ startValues: values }); }
  limit(limitCount) { return this.copy({ limitCount }); }
  copy(patch) {
    return new FakeQuery(this.db, this.path, {
      filters: this.filters, limitCount: this.limitCount, orders: this.orders, startValues: this.startValues, ...patch,
    });
  }
  async get() {
    const prefix = `${this.path}/`;
    const expectedSegments = this.path.split('/').length + 1;
    let values = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.split('/').length === expectedSegments)
      .filter(([, data]) => this.filters.every((filter) => matches(data, filter)));
    values.sort(([pathA, dataA], [pathB, dataB]) => compareRows(
      { data: dataA, id: pathA.split('/').at(-1) },
      { data: dataB, id: pathB.split('/').at(-1) }, this.orders,
    ));
    if (this.startValues) values = values.filter(([path, data]) => compareToCursor(
      { data, id: path.split('/').at(-1) }, this.orders, this.startValues,
    ) > 0);
    const docs = values.slice(0, this.limitCount).map(([path, data]) => snapshot(path, data, this.db));
    return { docs, size: docs.length };
  }
}

function matches(data, { field, operator, value }) {
  const actual = getField(data, field);
  if (operator === '==') return comparable(actual) === comparable(value);
  if (operator === 'in') return value.some((candidate) => comparable(actual) === comparable(candidate));
  if (operator === '<=') return comparable(actual) <= comparable(value);
  throw new Error(`Unsupported operator: ${operator}`);
}

function compareRows(a, b, orders) {
  for (const order of orders) {
    const left = order.field === '__name__' ? a.id : comparable(getField(a.data, order.field));
    const right = order.field === '__name__' ? b.id : comparable(getField(b.data, order.field));
    if (left < right) return order.direction === 'desc' ? 1 : -1;
    if (left > right) return order.direction === 'desc' ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}

function compareToCursor(row, orders, cursor) {
  const cursorRow = { data: {}, id: '' };
  orders.forEach((order, index) => {
    if (order.field === '__name__') cursorRow.id = cursor[index];
    else cursorRow.data[order.field] = cursor[index];
  });
  return compareRows(row, cursorRow, orders);
}

function comparable(value) { return typeof value?.toMillis === 'function' ? value.toMillis() : value; }
function getField(data, field) { return field.split('.').reduce((value, key) => value?.[key], data); }

function makeRef(path, db) {
  return {
    collection(name) { return new FakeQuery(db, `${path}/${name}`); },
    get: async () => snapshot(path, db.documents.get(path), db),
    id: path.split('/').at(-1),
    path,
  };
}

function snapshot(path, data, db) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: makeRef(path, db) };
}
