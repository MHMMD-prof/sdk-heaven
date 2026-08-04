import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  finalizeRoomRocketCycle,
  processRoomRocketRewardNotifications,
  projectRoomRocketGiftFact,
} = require('./roomRocketService');
const { createRoomSupportPeriodKey } = require('./roomSupportProjectionCore');

const weekStart = Date.parse('2026-07-27T00:00:00.000+03:00');
const weekEnd = Date.parse('2026-08-03T00:00:00.000+03:00');
const nowMs = weekEnd + 20 * 60 * 1000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: timestamp,
};
const fieldValue = {
  increment: (amount) => ({ __increment: amount }),
  serverTimestamp: () => timestamp(nowMs),
};

describe('roomRocketService', () => {
  it('snapshots the effective template, crosses once, and preserves idempotency', async () => {
    const db = seededDb();
    const first = await projectRoomRocketGiftFact({
      clock,
      db,
      fact: giftFact({ eventId: 'gift-1', supportPoints: 950 }),
      fieldValue,
    });
    const crossed = await projectRoomRocketGiftFact({
      clock,
      db,
      fact: giftFact({ eventId: 'gift-2', supportPoints: 50 }),
      fieldValue,
    });
    const replay = await projectRoomRocketGiftFact({
      clock,
      db,
      fact: giftFact({ eventId: 'gift-2', supportPoints: 50 }),
      fieldValue,
    });
    expect(first).toMatchObject({ crossedGoal: false, replayed: false, supportPoints: 950 });
    expect(crossed).toMatchObject({ crossedGoal: true, replayed: false, state: 'unlocked' });
    expect(replay).toEqual({ replayed: true });
    expect(db.read('rooms/room-1/rocketCycles/weekly_2026-07-27_asia-baghdad')).toMatchObject({
      giftCount: 2,
      state: 'unlocked',
      supportPoints: 1000,
      targetSupportPoints: 1000,
      templateRevision: 1,
    });
    expect([...db.documents.keys()].filter((path) => path.includes('/events/rrg_'))).toHaveLength(1);
    const goalEvent = [...db.documents.entries()].find(([path]) => path.includes('/events/rrg_'))?.[1];
    expect(goalEvent.type).toBe('rocket-goal-crossed');
    expect(goalEvent.createdAt.toMillis()).toBe(nowMs);
    expect(goalEvent.occurredAt.toMillis()).toBe(nowMs);
  });

  it('locks a deterministic podium, promotes held users, and remains ready while payouts are off', async () => {
    const db = seededDb();
    const cycleId = 'weekly_2026-07-27_asia-baghdad';
    db.documents.set(`rooms/room-1/rocketCycles/${cycleId}`, cycle({ state: 'unlocked' }));
    db.documents.set(`roomSupportPeriods/${createRoomSupportPeriodKey('room-1', cycleId)}`, {
      endAt: timestamp(weekEnd),
      lastReconciledAt: timestamp(nowMs),
      periodId: cycleId,
      periodKey: createRoomSupportPeriodKey('room-1', cycleId),
      periodType: 'week',
      roomId: 'room-1',
    });
    seedSupporter(db, cycleId, 'held-user', 900, 1);
    seedSupporter(db, cycleId, 'winner-a', 800, 2);
    seedSupporter(db, cycleId, 'winner-b', 700, 3);
    seedSupporter(db, cycleId, 'winner-c', 600, 4);
    for (const uid of ['held-user', 'winner-a', 'winner-b', 'winner-c']) {
      db.documents.set(`publicProfiles/${uid}`, { moderationStatus: 'active', uid });
    }
    db.documents.set('weeklyIncentiveHolds/held-user', { active: true });
    const result = await finalizeRoomRocketCycle({
      clock, db, fieldValue, roomId: 'room-1', cycleId,
    });
    expect(result).toMatchObject({ payoutEnabled: false, state: 'ready' });
    const stored = db.read(`rooms/room-1/rocketCycles/${cycleId}`);
    expect(stored.finalPodium.map(({ uid }) => uid)).toEqual(['winner-a', 'winner-b', 'winner-c']);
    expect(stored.disqualified).toEqual([{ reason: 'PAYOUT_HOLD', uid: 'held-user' }]);
    expect([...db.documents.keys()].filter((path) => path.startsWith('rewardSettlementJobs/'))).toHaveLength(0);
  });

  it('waits for another reconciliation when a delayed gift was projected after the watermark', async () => {
    const db = seededDb();
    const cycleId = 'weekly_2026-07-27_asia-baghdad';
    const periodKey = createRoomSupportPeriodKey('room-1', cycleId);
    db.documents.set(`rooms/room-1/rocketCycles/${cycleId}`, cycle({ state: 'unlocked' }));
    db.documents.set(`roomSupportPeriods/${periodKey}`, {
      endAt: timestamp(weekEnd),
      lastReconciledAt: timestamp(nowMs - 1000),
      periodId: cycleId,
      periodKey,
      periodType: 'week',
      roomId: 'room-1',
    });
    db.documents.set('canonicalRoomGiftFacts/delayed-gift', {
      periodIds: [cycleId],
      projectedAt: timestamp(nowMs),
      roomId: 'room-1',
    });
    await expect(finalizeRoomRocketCycle({
      clock, db, fieldValue, roomId: 'room-1', cycleId,
    })).resolves.toEqual({ skipped: true, reason: 'awaiting-reconciliation' });
    expect(db.read(`rooms/room-1/rocketCycles/${cycleId}`).state).toBe('unlocked');
  });

  it('retries notification delivery independently from an already-paid settlement', async () => {
    const db = seededDb();
    db.documents.set('roomRocketRewardNotifications/settlement-1', {
      createdAt: timestamp(1),
      recipientUid: 'winner-a',
      requestId: 'settlement-1',
      state: 'queued',
    });
    let calls = 0;
    const first = await processRoomRocketRewardNotifications({
      db,
      deliver: async () => {
        calls += 1;
        return { status: 'failed' };
      },
      fieldValue,
    });
    const second = await processRoomRocketRewardNotifications({
      db,
      deliver: async () => {
        calls += 1;
        return { status: 'submitted' };
      },
      fieldValue,
    });
    expect(first.results[0].state).toBe('queued');
    expect(second.results[0].state).toBe('delivered');
    expect(calls).toBe(2);
    expect([...db.documents.keys()].filter((path) => path.startsWith('rewardSettlementJobs/'))).toHaveLength(0);
  });
});

function template() {
  return {
    animationApproval: {
      approvalId: 'physical_test_001',
      fallbackVerified: true,
      memoryVerified: true,
      physicalAndroidDevice: 'Pixel 6a physical',
      reducedMotionVerified: true,
      testedClientVersion: '1.0.0',
    },
    appearance: {
      animationAsset: {
        bytes: 1000, durationMs: 2000, format: 'animated-webp', height: 1000,
        storagePath: 'room-rockets/global-room-rocket/v1/animation.webp',
        uri: 'https://cdn.example.com/animation.webp', version: 1, width: 800,
      },
      name: { ar: 'الصاروخ', en: 'Rocket' },
      staticAsset: {
        bytes: 1000, format: 'webp', height: 1000,
        storagePath: 'room-rockets/global-room-rocket/v1/static.webp',
        uri: 'https://cdn.example.com/static.webp', version: 1, width: 800,
      },
    },
    enabledRankCount: 3,
    minimumClientVersion: '1.0.0',
    publicationStatus: 'published',
    rewards: {
      1: { coins: 100, diamonds: 0, items: [], schemaVersion: 1 },
      2: { coins: 50, diamonds: 0, items: [], schemaVersion: 1 },
      3: { coins: 25, diamonds: 0, items: [], schemaVersion: 1 },
    },
    schemaVersion: 1,
    targetSupportPoints: 1000,
    templateId: 'global-room-rocket',
    templateVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function cycle(overrides = {}) {
  return {
    appearance: template().appearance,
    cycleId: 'weekly_2026-07-27_asia-baghdad',
    enabledRankCount: 3,
    endAt: timestamp(weekEnd),
    giftCount: 4,
    rewards: template().rewards,
    rewardLiability: { coins: 175, diamonds: 0, itemGrantCount: 0, rankCount: 3 },
    roomId: 'room-1',
    state: 'unlocked',
    supportPoints: 3000,
    targetSupportPoints: 1000,
    ...overrides,
  };
}

function giftFact(overrides = {}) {
  return {
    eventId: 'gift-1',
    roomId: 'room-1',
    senderUid: 'sender-1',
    supportPoints: 100,
    weekEndAtMillis: weekEnd,
    weekId: 'weekly_2026-07-27_asia-baghdad',
    weekStartAtMillis: weekStart,
    ...overrides,
  };
}

function seedSupporter(db, cycleId, uid, eligibleSpendCoins, firstContributionAtMillis) {
  db.documents.set(`rooms/room-1/supportPeriods/${cycleId}/supporters/${uid}`, {
    eligibleSpendCoins,
    firstContributionAt: timestamp(firstContributionAtMillis),
    supportPoints: eligibleSpendCoins,
    uid,
  });
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': {
      voice_room_rocket_rewards: false,
      voice_room_supporter_rankings: true,
    },
    'roomRocketCampaign/current': {
      emergencyDisabled: false,
      lastPublishedRevision: 1,
      revision: 1,
    },
    'roomRocketCampaign/current/versions/v1': {
      effectiveFromAt: timestamp(weekStart - 1),
      revision: 1,
      template: template(),
    },
    'rooms/room-1': { roomId: 'room-1', status: 'active' },
  });
}

function timestamp(value) {
  return { toMillis: () => value };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) { return makeRef(this, path); }
  collection(path) { return new FakeQuery(this, path, false); }
  collectionGroup(name) { return new FakeQuery(this, name, true); }
  read(path) { return this.documents.get(path); }
  async getAll(...refs) { return refs.map((ref) => snapshot(this, ref.path, this.documents.get(ref.path))); }
  batch() { return new FakeBatch(this); }
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
  async get(ref) { return snapshot(this.db, ref.path, this.db.documents.get(ref.path)); }
  async getAll(...refs) { return refs.map((ref) => snapshot(this.db, ref.path, this.db.documents.get(ref.path))); }
  create(ref, data) { this.operations.push({ data, kind: 'create', path: ref.path }); }
  set(ref, data, options) { this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  commit() { applyOperations(this.db, this.operations); }
}

class FakeBatch {
  constructor(db) { this.db = db; this.operations = []; }
  set(ref, data, options) { this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  async commit() { applyOperations(this.db, this.operations); }
}

class FakeQuery {
  constructor(db, path, group, filters = [], orders = [], max = Infinity) {
    this.db = db; this.path = path; this.group = group; this.filters = filters; this.orders = orders; this.max = max;
  }
  where(field, operator, value) { return new FakeQuery(this.db, this.path, this.group, [...this.filters, { field, operator, value }], this.orders, this.max); }
  orderBy(field, direction = 'asc') { return new FakeQuery(this.db, this.path, this.group, this.filters, [...this.orders, { field, direction }], this.max); }
  limit(max) { return new FakeQuery(this.db, this.path, this.group, this.filters, this.orders, max); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => this.group
        ? path.split('/').at(-2) === this.path
        : path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => {
        const left = comparable(data[field]);
        const right = comparable(value);
        if (operator === '==') return left === right;
        if (operator === '<=') return left <= right;
        if (operator === 'array-contains') return Array.isArray(left) && left.includes(right);
        return false;
      }))
      .sort((left, right) => compareDocuments(left, right, this.orders))
      .slice(0, this.max)
      .map(([path, data]) => snapshot(this.db, path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(db, path) {
  const segments = path.split('/');
  return {
    collection: (name) => new FakeQuery(db, `${path}/${name}`, false),
    get: async () => snapshot(db, path, db.documents.get(path)),
    id: segments.at(-1),
    parent: {
      id: segments.at(-2),
      parent: segments.length >= 3 ? { id: segments.at(-3) } : null,
    },
    path,
    set: async (data, options) => applyOperations(db, [{ data, kind: 'set', merge: options?.merge === true, path }]),
  };
}

function snapshot(db, path, data) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: makeRef(db, path) };
}

function applyOperations(db, operations) {
  for (const operation of operations) {
    if (operation.kind === 'create' && db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
    const current = db.documents.get(operation.path) || {};
    const next = operation.kind === 'update' || operation.merge ? { ...current, ...operation.data } : operation.data;
    for (const [key, value] of Object.entries(next)) {
      if (value && value.__increment) next[key] = Number(current[key] || 0) + value.__increment;
    }
    db.documents.set(operation.path, next);
  }
}

function compareDocuments(left, right, orders) {
  for (const { direction, field } of orders) {
    const a = comparable(left[1][field]);
    const b = comparable(right[1][field]);
    if (a === b) continue;
    return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
  }
  return left[0].localeCompare(right[0]);
}

function comparable(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : value;
}
