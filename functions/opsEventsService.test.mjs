import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  claimOpsMission,
  getOpsMissionsOverview,
  mutateAdminOpsEvent,
  recordOpsMissionProgress,
} = require('./opsEventsService');

const fieldValue = {
  delete: () => ({ __delete: true }),
  increment: (value) => ({ __increment: value }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

describe('opsEventsService', () => {
  it('requires growth mission flags', async () => {
    const db = opsDb({ dailyMissions: false, opsEvents: false });
    await expect(getOpsMissionsOverview({ db, uid: 'u1' }))
      .resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('tracks gift progress, claims once, and replays request ids', async () => {
    const db = opsDb({ dailyMissions: true, opsEvents: true });
    const clock = { now: () => 1_700_000_000_000 };

    await recordOpsMissionProgress({
      amount: 3,
      clock,
      db,
      fieldValue,
      kind: 'send_gifts',
      uid: 'u1',
    });

    const overview = await getOpsMissionsOverview({ clock, db, uid: 'u1' });
    expect(overview.result.missions[0]).toMatchObject({
      claimable: true,
      missionId: 'daily_send_gifts_3',
      progress: 3,
    });

    const claimInput = {
      db,
      fieldValue,
      clock,
      input: { missionId: 'daily_send_gifts_3' },
      requestId: 'opsclaim_abcdefghijk1',
      uid: 'u1',
    };
    const first = await claimOpsMission(claimInput);
    expect(first.result.amount).toBe(50);
    expect(first.result.alreadyClaimed).toBe(false);
    expect(db.documents.get('walletSummaries/u1').balances.coins).toBe(50);

    const second = await claimOpsMission(claimInput);
    expect(second.result).toEqual(first.result);
    expect(db.documents.get('walletSummaries/u1').balances.coins).toBe(50);

    await expect(claimOpsMission({
      ...claimInput,
      requestId: 'opsclaim_abcdefghijk2',
    })).resolves.toMatchObject({ result: { alreadyClaimed: true, amount: 50 } });
  });

  it('publishes and retires ops events', async () => {
    const db = opsDb({ dailyMissions: true, opsEvents: true });
    const published = await mutateAdminOpsEvent({
      actorUid: 'admin',
      db,
      fieldValue,
      input: {
        action: 'publish',
        titleAr: 'ليلة الهدايا',
        themeAr: 'أرسل هدية واربح',
        startsAtMs: Date.now() - 1000,
        endsAtMs: Date.now() + 86_400_000,
        reason: 'نشر اختبار',
        requestId: 'ops_evt_publish_abcdef',
      },
    });
    expect(published.result.status).toBe('published');
    expect(db.documents.get('opsEventsConfig/current').activeEventId).toBe(published.result.event.eventId);

    const retired = await mutateAdminOpsEvent({
      actorUid: 'admin',
      db,
      fieldValue,
      input: {
        action: 'retire',
        eventId: published.result.event.eventId,
        reason: 'إيقاف اختبار',
        requestId: 'ops_evt_retire_abcdef1',
      },
    });
    expect(retired.result.status).toBe('retired');
    expect(db.documents.get(`opsEvents/${published.result.event.eventId}`).status).toBe('retired');
  });
});

function opsDb(flags) {
  return new FakeFirestore({
    'appConfig/growthFeatures': flags,
    'walletSummaries/u1': {
      balances: { coins: 0, diamonds: 0 },
      lifetimeCredit: { coins: 0, diamonds: 0 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'u1',
    },
  });
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

  batch() {
    const ops = [];
    return {
      set: (ref, data, options = {}) => {
        ops.push({ data, merge: options.merge === true, path: ref.path });
      },
      commit: async () => {
        for (const op of ops) {
          const current = this.documents.get(op.path) || {};
          this.documents.set(op.path, op.merge ? { ...current, ...op.data } : { ...op.data });
        }
      },
    };
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
    this.operations.push({ kind: 'create', path: ref.path, data });
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
      if (operation.kind === 'create') {
        if (this.db.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
        continue;
      }
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

  orderBy() {
    return this;
  }

  limit(value) {
    return this.next({ limit: value });
  }

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));
    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => data[filter.field] === filter.value);
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ path, data }) => createSnapshot(path, data)), empty: rows.length === 0 };
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
