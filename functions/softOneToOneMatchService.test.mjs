import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredSoftMatchRecords,
  expireSoftMatchQueueAndSessions,
  softMatchCancel,
  softMatchEnqueue,
  softMatchStatus,
} = require('./softOneToOneMatchService');

const fieldValue = {
  increment: (value) => ({ __increment: value }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

describe('softOneToOneMatchService', () => {
  it('fails closed when softOneToOneMatch is off', async () => {
    const db = softDb({ softOneToOneMatch: false });
    await expect(softMatchEnqueue({
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk1',
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('enqueues waiting, pairs next caller, and respects blocks', async () => {
    const db = softDb({ softOneToOneMatch: true });
    db.documents.set('blocks/u1/blocked/u2', { targetUid: 'u2' });
    db.documents.set('blocks/u2/blocked/u1', { targetUid: 'u1' });
    const clock = { now: () => 1_700_000_000_000 };

    const first = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk1',
      uid: 'u1',
    });
    expect(first.result.status).toBe('waiting');
    expect(db.documents.get('softMatchQueue/u1').status).toBe('waiting');

    const blocked = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk2',
      uid: 'u2',
    });
    // u2 blocked from u1 — should wait separately.
    expect(blocked.result.status).toBe('waiting');
    expect(db.documents.get('rooms') || true).toBeTruthy();
    expect([...db.documents.keys()].some((key) => key.startsWith('rooms/'))).toBe(false);

    db.documents.delete('blocks/u1/blocked/u2');
    db.documents.delete('blocks/u2/blocked/u1');

    // Expire u2 waiting ticket so u3 can pair with u1.
    db.documents.set('softMatchQueue/u2', {
      ...db.documents.get('softMatchQueue/u2'),
      expiresAtMs: clock.now() - 1,
      status: 'waiting',
    });

    const paired = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk3',
      uid: 'u3',
    });
    expect(paired.result.status).toBe('matched');
    expect(paired.result.roomId).toBeTruthy();
    expect(db.documents.get(`rooms/${paired.result.roomId}`).softMatch).toBe(true);
    expect(db.documents.get(`rooms/${paired.result.roomId}`).participantCount).toBe(2);
    expect(db.documents.get(`rooms/${paired.result.roomId}/members/u3`).role).toBe('host');
    expect(db.documents.get(`rooms/${paired.result.roomId}/members/u1`).role).toBe('speaker');
    expect(db.documents.get('softMatchQueue/u1').status).toBe('matched');
    expect(db.documents.get('appRuntime/growthTelemetry').softMatchPaired.__increment).toBe(1);

    const status = await softMatchStatus({ clock, db, uid: 'u3' });
    expect(status.result.status).toBe('matched');
    expect(status.result.roomId).toBe(paired.result.roomId);
  });

  it('cancels a waiting ticket to idle', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_000_000 };
    await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk4',
      uid: 'u1',
    });
    const cancelled = await softMatchCancel({
      clock,
      db,
      fieldValue,
      requestId: 'softcancel_abcdefghijk1',
      uid: 'u1',
    });
    expect(cancelled.result).toEqual({ status: 'idle' });
    expect(db.documents.get('softMatchQueue/u1').status).toBe('cancelled');
  });

  it('denies suspended profiles', async () => {
    const db = softDb({ softOneToOneMatch: true });
    db.documents.set('publicProfiles/u1', {
      ...db.documents.get('publicProfiles/u1'),
      moderationStatus: 'suspended',
    });
    await expect(softMatchEnqueue({
      db,
      fieldValue,
      requestId: 'softmatch_abcdefghijk5',
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });
  });

  it('does not clobber a matched ticket when a second enqueue races', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_000_000 };
    db._serializeTransactions = true;

    await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_waiter________',
      uid: 'u1',
    });

    const [first, second] = await Promise.all([
      softMatchEnqueue({
        clock,
        db,
        fieldValue,
        requestId: 'softmatch_finder_aaaaaaa',
        uid: 'u2',
      }),
      softMatchEnqueue({
        clock,
        db,
        fieldValue,
        requestId: 'softmatch_finder_bbbbbbb',
        uid: 'u2',
      }),
    ]);

    expect([first.result?.status, second.result?.status]).toContain('matched');
    expect(db.documents.get('softMatchQueue/u2').status).toBe('matched');
    expect(db.documents.get('softMatchQueue/u1').status).toBe('matched');
  });

  it('ignores expired waiting tickets when pairing', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const nowMs = 1_700_000_000_000;
    const clock = { now: () => nowMs };

    for (let index = 0; index < 24; index += 1) {
      const uid = `expired_${index}`;
      db.documents.set(`publicProfiles/${uid}`, {
        countryCode: 'IQ',
        displayName: uid,
        gender: 'female',
        moderationStatus: 'active',
        uid,
      });
      db.documents.set(`softMatchQueue/${uid}`, {
        enqueuedAtMs: nowMs - 60_000 - index,
        expiresAtMs: nowMs - 1,
        gender: 'female',
        preferGender: '',
        status: 'waiting',
        uid,
      });
    }

    db.documents.set('softMatchQueue/u1', {
      enqueuedAtMs: nowMs - 10,
      expiresAtMs: nowMs + 60_000,
      gender: 'female',
      preferGender: '',
      status: 'waiting',
      uid: 'u1',
    });

    const paired = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_finder_live____',
      uid: 'u2',
    });
    expect(paired.result.status).toBe('matched');
    expect(db.documents.get('softMatchQueue/u1').status).toBe('matched');
  });

  it('replays a live waiting ticket without rate limiting', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_000_000 };

    await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_probe_wait____',
      uid: 'u1',
    });

    db.documents.set('softMatchRateLimits/u1', {
      attemptsMs: Array.from({ length: 15 }, (_, index) => clock.now() - index),
      count: 15,
      uid: 'u1',
      windowStartedAt: clock.now() - 1000,
    });

    const replay = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_probe_replay__',
      uid: 'u1',
    });
    expect(replay.result.status).toBe('waiting');
  });

  it('refuses to pair when a block appears before commit', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_000_000 };
    let pairAttempts = 0;
    const originalRunTransaction = db.runTransaction.bind(db);
    db.runTransaction = async (callback) => {
      pairAttempts += 1;
      // First txn is u1 waiting enqueue; second is u2 pair attempt.
      if (pairAttempts === 2) {
        db.documents.set('blocks/u1/blocked/u2', { targetUid: 'u2' });
        db.documents.set('blocks/u2/blocked/u1', { targetUid: 'u1' });
      }
      return originalRunTransaction(callback);
    };

    await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_waiter_block___',
      uid: 'u1',
    });

    const result = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_finder_block___',
      uid: 'u2',
    });

    expect(result.result.status).toBe('waiting');
    expect([...db.documents.keys()].some((key) => key.startsWith('rooms/'))).toBe(false);
    expect(db.documents.get('softMatchQueue/u1').status).toBe('waiting');
  });

  it('refuses to pair when the finder is suspended before commit', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_000_000 };
    let pairAttempts = 0;
    const originalRunTransaction = db.runTransaction.bind(db);
    db.runTransaction = async (callback) => {
      pairAttempts += 1;
      if (pairAttempts === 2) {
        db.documents.set('publicProfiles/u2', {
          ...db.documents.get('publicProfiles/u2'),
          moderationStatus: 'suspended',
        });
      }
      return originalRunTransaction(callback);
    };

    await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_waiter_actor___',
      uid: 'u1',
    });

    const result = await softMatchEnqueue({
      clock,
      db,
      fieldValue,
      requestId: 'softmatch_finder_actor___',
      uid: 'u2',
    });

    expect(result).toEqual({ errorCode: 'PERMISSION_DENIED' });
    expect([...db.documents.keys()].some((key) => key.startsWith('rooms/'))).toBe(false);
    expect(db.documents.get('softMatchQueue/u1').status).toBe('waiting');
  });

  it('expires waiting tickets and soft-match sessions then purges', async () => {
    const db = softDb({ softOneToOneMatch: true });
    const clock = { now: () => 1_700_000_100_000 };
    db.documents.set('softMatchQueue/u1', {
      expiresAtMs: clock.now() - 1,
      status: 'waiting',
      uid: 'u1',
    });
    db.documents.set('softMatchSessions/sms_old', {
      expiresAtMs: clock.now() - 1,
      peerUids: ['u2', 'u3'],
      roomId: 'room_soft_old',
      sessionId: 'sms_old',
      status: 'active',
    });
    db.documents.set('rooms/room_soft_old', {
      availability: 'active',
      softMatch: true,
      status: 'active',
    });
    db.documents.set('softMatchQueue/u2', {
      sessionId: 'sms_old',
      status: 'matched',
      uid: 'u2',
    });

    const expired = await expireSoftMatchQueueAndSessions({ clock, db, fieldValue });
    expect(expired.expiredQueue).toBe(1);
    expect(expired.expiredSessions).toBe(1);
    expect(db.documents.get('softMatchQueue/u1').status).toBe('expired');
    expect(db.documents.get('softMatchSessions/sms_old').status).toBe('expired');
    expect(db.documents.get('rooms/room_soft_old').status).toBe('closed');
    expect(db.documents.get('softMatchQueue/u2').status).toBe('expired');

    const purgeAt = db.documents.get('softMatchQueue/u1').purgeAfterMs;
    clock.now = () => purgeAt + 1;
    const cleaned = await cleanupExpiredSoftMatchRecords({ clock, db });
    expect(cleaned.cleaned).toBeGreaterThanOrEqual(2);
    expect(db.documents.has('softMatchQueue/u1')).toBe(false);
    expect(db.documents.has('softMatchSessions/sms_old')).toBe(false);
  });

});

function softDb(flags) {
  return new FakeFirestore({
    'appConfig/growthFeatures': flags,
    'appRuntime/growthTelemetry': {},
    'publicProfiles/u1': {
      countryCode: 'IQ',
      displayName: 'User One',
      gender: 'male',
      moderationStatus: 'active',
      uid: 'u1',
    },
    'publicProfiles/u2': {
      countryCode: 'IQ',
      displayName: 'User Two',
      gender: 'female',
      moderationStatus: 'active',
      uid: 'u2',
    },
    'publicProfiles/u3': {
      countryCode: 'IQ',
      displayName: 'User Three',
      gender: 'female',
      moderationStatus: 'active',
      uid: 'u3',
    },
  });
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this._txLock = Promise.resolve();
    this._serializeTransactions = false;
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  doc(path) {
    return {
      delete: async () => { this.documents.delete(path); },
      get: async () => createSnapshot(path, this.documents.get(path), this),
      path,
      set: async (data, options = {}) => {
        const current = this.documents.get(path) || {};
        this.documents.set(path, options.merge ? { ...current, ...data } : { ...data });
      },
    };
  }

  async getAll(...refs) {
    return refs.map((ref) => createSnapshot(ref.path, this.documents.get(ref.path)));
  }

  async runTransaction(callback) {
    if (!this._serializeTransactions) {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    }
    const run = this._txLock.then(async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    });
    this._txLock = run.then(() => undefined, () => undefined);
    return run;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(ref) {
    return createSnapshot(ref.path, this.db.documents.get(ref.path), this.db);
  }

  set(ref, data, options = {}) {
    this.operations.push({
      data,
      kind: options.merge ? 'setMerge' : 'set',
      path: ref.path,
    });
  }

  commit() {
    for (const operation of this.operations) {
      const current = this.db.documents.get(operation.path) || {};
      const next = operation.kind === 'set' ? { ...operation.data } : { ...current, ...operation.data };
      this.db.documents.set(operation.path, next);
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

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));
    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => {
        const value = data[filter.field];
        if (filter.operator === '==') return value === filter.value;
        if (filter.operator === '>') return value > filter.value;
        if (filter.operator === '>=') return value >= filter.value;
        if (filter.operator === '<') return value < filter.value;
        if (filter.operator === '<=') return value <= filter.value;
        return false;
      });
    }
    const order = this.state.order;
    if (order) {
      rows.sort((left, right) => {
        const lv = left.data[order.field];
        const rv = right.data[order.field];
        if (lv === rv) return 0;
        const cmp = lv > rv ? 1 : -1;
        return order.direction === 'desc' ? -cmp : cmp;
      });
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ path, data }) => createSnapshot(path, data, this.db)), empty: rows.length === 0 };
  }

  orderBy(field, direction = 'asc') {
    return this.next({ order: { direction, field } });
  }

  limit(value) {
    return this.next({ limit: value });
  }

  next(update) {
    return new FakeQuery(this.db, this.path, { ...this.state, ...update });
  }
}

function createSnapshot(path, data, db) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: {
      delete: async () => { if (db) db.documents.delete(path); },
      path,
      set: async (next, options = {}) => {
        if (!db) return;
        const current = db.documents.get(path) || {};
        db.documents.set(path, options.merge ? { ...current, ...next } : { ...next });
      },
    },
  };
}
