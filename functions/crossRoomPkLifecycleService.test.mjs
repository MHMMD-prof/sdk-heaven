import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredCrossRoomPkRecentPointers,
  drainCrossRoomPkOnFlagOff,
  expireCrossRoomPkChallenges,
  processCrossRoomPkRoomLifecycle,
  resolveCrossRoomPkRoomInvalidation,
} = require('./crossRoomPkLifecycleService');

const nowMs = 2_000_000_000_000;
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };
const clock = { nowMillis: () => nowMs, timestampFromMillis: timestamp };
const sessionId = 'crpks_lifecycle_service_0001';

describe('crossRoomPkLifecycleService', () => {
  it('classifies only transitions that invalidate an active room', () => {
    const active = room('room-red-1');
    expect(resolveCrossRoomPkRoomInvalidation(active, { ...active, status: 'closed' })).toBe('room_closed');
    expect(resolveCrossRoomPkRoomInvalidation(active, { ...active, availability: 'removed' })).toBe('room_removed');
    expect(resolveCrossRoomPkRoomInvalidation(active, { ...active, staffLockdown: { byUid: 'staff-1' } }))
      .toBe('staff_lockdown');
    expect(resolveCrossRoomPkRoomInvalidation(active, { ...active, giftsPaused: true })).toBe('gifts_paused');
    expect(resolveCrossRoomPkRoomInvalidation(active, { ...active, title: 'Changed' })).toBe('');
  });

  it('cancels a pending challenge and conditionally clears both pointers', async () => {
    const challengeId = 'crpkc_lifecycle_pending_0001';
    const db = new FakeFirestore({
      [`roomPkChallenges/${challengeId}`]: pendingChallenge(challengeId),
      'rooms/room-blue-1': { ...room('room-blue-1'), pendingPkChallengeId: challengeId },
      'rooms/room-red-1': { ...room('room-red-1', { status: 'closed' }), pendingPkChallengeId: challengeId },
    });
    expect(await processCrossRoomPkRoomLifecycle({
      clock, db, fieldValue, reason: 'room_closed', roomId: 'room-red-1',
    })).toMatchObject({ challengeCancelled: true, processed: true });
    expect(db.read(`roomPkChallenges/${challengeId}`)).toMatchObject({
      resolutionReason: 'room_closed', status: 'cancelled',
    });
    expect(db.read('rooms/room-red-1').pendingPkChallengeId).toBeNull();
    expect(db.read('rooms/room-blue-1').pendingPkChallengeId).toBeNull();
  });

  it('moves a closing room session to verified forfeit settlement and preserves both pointers', async () => {
    const db = sessionDb();
    db.documents.set('rooms/room-red-1', room('room-red-1', {
      activePkSessionId: sessionId, status: 'closed',
    }));
    const result = await processCrossRoomPkRoomLifecycle({
      clock, db, fieldValue, reason: 'room_closed', roomId: 'room-red-1',
    });
    expect(result).toMatchObject({ processed: true, sessionSettling: true });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      endReason: 'room_closed', forfeitSide: 'red', scoringEndsAtMs: nowMs,
      settleAfterMs: nowMs + 15_000, status: 'settling',
    });
    expect(db.read(`roomPkReconciliations/${sessionId}`)).toMatchObject({ status: 'pending' });
    expect(db.read('rooms/room-red-1').activePkSessionId).toBe(sessionId);
    expect(db.read('rooms/room-blue-1').activePkSessionId).toBe(sessionId);
  });

  it('serializes two room invalidations into a dual-invalid void marker', async () => {
    const db = sessionDb();
    db.documents.set('rooms/room-red-1', room('room-red-1', {
      activePkSessionId: sessionId, status: 'closed',
    }));
    await processCrossRoomPkRoomLifecycle({
      clock, db, fieldValue, reason: 'room_closed', roomId: 'room-red-1',
    });
    db.documents.set('rooms/room-blue-1', room('room-blue-1', {
      activePkSessionId: sessionId, staffLockdown: { byUid: 'staff-1' },
    }));
    await processCrossRoomPkRoomLifecycle({
      clock, db, fieldValue, reason: 'staff_lockdown', roomId: 'room-blue-1',
    });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      endReason: 'both_rooms_invalid', forfeitSide: 'both', status: 'settling',
    });
  });

  it('expires pending challenges and clears only matching room pointers', async () => {
    const challengeId = 'crpkc_lifecycle_expired_0001';
    const db = new FakeFirestore({
      [`roomPkChallenges/${challengeId}`]: pendingChallenge(challengeId, nowMs - 1),
      'rooms/room-blue-1': { ...room('room-blue-1'), pendingPkChallengeId: 'newer-challenge' },
      'rooms/room-red-1': { ...room('room-red-1'), pendingPkChallengeId: challengeId },
    });
    expect(await expireCrossRoomPkChallenges({ clock, db, fieldValue, limit: 10 }))
      .toEqual({ expired: 1, scanned: 1 });
    expect(db.read(`roomPkChallenges/${challengeId}`).status).toBe('expired');
    expect(db.read('rooms/room-red-1').pendingPkChallengeId).toBeNull();
    expect(db.read('rooms/room-blue-1').pendingPkChallengeId).toBe('newer-challenge');
  });

  it('drains cross-room work on flag-off while preserving an active V1 session', async () => {
    const challengeId = 'crpkc_flag_off_pending_0001';
    const db = sessionDb({
      'appConfig/growthFeatures': { crossRoomPk: false, roomPk: true },
      [`roomPkChallenges/${challengeId}`]: pendingChallenge(challengeId),
      'roomPkSessions/in-room-v1': {
        mode: 'in-room-teams', pkId: 'in-room-v1', roomId: 'room-v1', schemaVersion: 1, status: 'active',
      },
      'rooms/room-pending-blue': { ...room('room-pending-blue'), pendingPkChallengeId: challengeId },
      'rooms/room-pending-red': { ...room('room-pending-red'), pendingPkChallengeId: challengeId },
    });
    db.documents.set(`roomPkChallenges/${challengeId}`, pendingChallenge(challengeId, nowMs + 60_000, {
      challengerRoomId: 'room-pending-red', opponentRoomId: 'room-pending-blue',
    }));
    const result = await drainCrossRoomPkOnFlagOff({ clock, db, fieldValue, limit: 10 });
    expect(result).toMatchObject({
      challenges: { cancelled: 1 }, sessions: { started: 1 },
    });
    expect(db.read(`roomPkChallenges/${challengeId}`)).toMatchObject({
      resolutionReason: 'feature_flag_off', status: 'cancelled',
    });
    expect(db.read(`roomPkSessions/${sessionId}`)).toMatchObject({
      endReason: 'feature_flag_off', status: 'settling',
    });
    expect(db.read('roomPkSessions/in-room-v1').status).toBe('active');
  });

  it('clears expired recent-result pointers without touching a newer pointer', async () => {
    const db = new FakeFirestore({
      'rooms/room-blue-1': {
        recentPkExpiresAt: timestamp(nowMs - 1), recentPkSessionId: 'recent-blue',
      },
      'rooms/room-red-1': {
        recentPkExpiresAt: timestamp(nowMs + 1), recentPkSessionId: 'recent-red',
      },
    });
    expect(await cleanupExpiredCrossRoomPkRecentPointers({ clock, db, fieldValue, limit: 10 }))
      .toEqual({ cleared: 1, scanned: 1 });
    expect(db.read('rooms/room-blue-1')).toMatchObject({ recentPkExpiresAt: null, recentPkSessionId: null });
    expect(db.read('rooms/room-red-1').recentPkSessionId).toBe('recent-red');
  });

  it('never mutates an in-room V1 active pointer during cross-room lifecycle handling', async () => {
    const db = new FakeFirestore({
      'roomPkSessions/in-room-v1': {
        mode: 'in-room-teams', pkId: 'in-room-v1', roomId: 'room-v1', schemaVersion: 1, status: 'active',
      },
      'rooms/room-v1': room('room-v1', { activePkSessionId: 'in-room-v1', status: 'closed' }),
    });
    expect(await processCrossRoomPkRoomLifecycle({
      clock, db, fieldValue, reason: 'room_closed', roomId: 'room-v1',
    })).toMatchObject({ processed: false });
    expect(db.read('rooms/room-v1').activePkSessionId).toBe('in-room-v1');
    expect(db.read('roomPkSessions/in-room-v1').status).toBe('active');
  });
});

function sessionDb(extra = {}) {
  return new FakeFirestore({
    'appConfig/growthFeatures': { crossRoomPk: true, roomPk: true },
    [`roomPkSessions/${sessionId}`]: activeSession(),
    'rooms/room-blue-1': room('room-blue-1', { activePkSessionId: sessionId }),
    'rooms/room-red-1': room('room-red-1', { activePkSessionId: sessionId }),
    ...extra,
  });
}

function activeSession() {
  const startedAtMs = nowMs - 60_000;
  const endsAtMs = nowMs + 120_000;
  const settleAfterMs = endsAtMs + 15_000;
  return {
    acceptedByUid: 'host-blue-1',
    blueRoomId: 'room-blue-1',
    challengeId: 'crpkc_lifecycle_session_0001',
    createdByUid: 'host-red-1',
    distinctGifterCount: 0,
    durationMs: endsAtMs - startedAtMs,
    endsAt: timestamp(endsAtMs),
    endsAtMs,
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
    status: 'active',
    teams: {
      blue: { authorityUid: 'host-blue-1', distinctGifterCount: 0, roomId: 'room-blue-1', roomImageUrl: '', roomTitle: 'Blue', score: 0 },
      red: { authorityUid: 'host-red-1', distinctGifterCount: 0, roomId: 'room-red-1', roomImageUrl: '', roomTitle: 'Red', score: 0 },
    },
    winner: null,
    winnerReason: '',
  };
}

function pendingChallenge(challengeId, expiresAtMs = nowMs + 60_000, overrides = {}) {
  return {
    challengeId,
    challengerRoomId: 'room-red-1',
    expiresAt: timestamp(expiresAtMs),
    mode: 'cross-room',
    opponentRoomId: 'room-blue-1',
    schemaVersion: 1,
    status: 'pending',
    ...overrides,
  };
}

function room(id, overrides = {}) {
  return { availability: 'active', id, status: 'active', ...overrides };
}

function timestamp(value) { return { toDate: () => new Date(value), toMillis: () => value }; }

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
    this.db = db; this.path = path; this.filters = state.filters || [];
    this.limitCount = state.limitCount || 100; this.orders = state.orders || [];
  }
  where(field, operator, value) { return this.copy({ filters: [...this.filters, { field, operator, value }] }); }
  orderBy(field, direction = 'asc') { return this.copy({ orders: [...this.orders, { direction, field }] }); }
  limit(limitCount) { return this.copy({ limitCount }); }
  copy(patch) { return new FakeQuery(this.db, this.path, {
    filters: this.filters, limitCount: this.limitCount, orders: this.orders, ...patch,
  }); }
  async get() {
    const prefix = `${this.path}/`;
    const depth = this.path.split('/').length + 1;
    const values = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.split('/').length === depth)
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => {
        const actual = comparable(getField(data, field));
        const expected = comparable(value);
        if (operator === '==') return actual === expected;
        if (operator === '<=') return actual <= expected;
        throw new Error(`Unsupported operator: ${operator}`);
      }))
      .sort(([, a], [, b]) => {
        for (const { direction, field } of this.orders) {
          const left = comparable(getField(a, field));
          const right = comparable(getField(b, field));
          if (left !== right) return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
    const docs = values.slice(0, this.limitCount).map(([path, data]) => snapshot(path, data, this.db));
    return { docs, size: docs.length };
  }
}

function comparable(value) { return typeof value?.toMillis === 'function' ? value.toMillis() : value; }
function getField(data, field) { return field.split('.').reduce((value, key) => value?.[key], data); }
function makeRef(path, db) { return {
  get: async () => snapshot(path, db.documents.get(path), db), id: path.split('/').at(-1), path,
}; }
function snapshot(path, data, db) { return {
  data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: makeRef(path, db),
}; }
