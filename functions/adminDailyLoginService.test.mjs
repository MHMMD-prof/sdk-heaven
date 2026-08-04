import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  activateScheduledDailyLoginCampaign,
  mutateAdminDailyLoginCampaign,
} = require('./adminDailyLoginService');

const fieldValue = {
  delete: () => DELETE,
  serverTimestamp: () => timestamp(nowMillis),
};
const decodedToken = { adminRole: 'owner', email: 'owner@example.com', uid: 'owner-1' };
let nowMillis = Date.parse('2026-07-31T12:00:00.000Z');

describe('adminDailyLoginService', () => {
  it('publishes immutable versions at the next Baghdad midnight and replays safely', async () => {
    nowMillis = Date.parse('2026-07-31T12:00:00.000Z');
    const db = seededDb();
    const clock = createClock();
    const input = mutation('publish', 0, 'daily_publish_0001');
    const first = await mutateAdminDailyLoginCampaign({ clock, db, decodedToken, fieldValue, input });
    const replay = await mutateAdminDailyLoginCampaign({ clock, db, decodedToken, fieldValue, input });
    expect(first).toMatchObject({
      effectiveAtMillis: Date.parse('2026-07-31T21:00:00.000Z'),
      publishedRevision: 1,
      replayed: false,
      revision: 1,
    });
    expect(replay).toMatchObject({ replayed: true, revision: 1 });
    expect(db.read('dailyLoginCampaign/current')).toMatchObject({
      activeRevision: 1,
      claimsPaused: false,
      emergencyDisabled: false,
      lastPublishedRevision: 1,
      presentationVisible: true,
    });
    expect(db.read('dailyLoginCampaign/current/versions/1')).toMatchObject({
      publicationStatus: 'published',
      revision: 1,
      schemaVersion: 1,
      timeZone: 'Asia/Baghdad',
    });
    expect(db.read('adminAuditEvents/daily_login_daily_publish_0001')).toMatchObject({
      action: 'daily-login-publish',
      actorRole: 'owner',
      status: 'completed',
    });
  });

  it('schedules a later revision and activates it idempotently when due', async () => {
    nowMillis = Date.parse('2026-07-31T12:00:00.000Z');
    const db = seededDb();
    const clock = createClock();
    await mutateAdminDailyLoginCampaign({
      clock,
      db,
      decodedToken,
      fieldValue,
      input: mutation('publish', 0, 'daily_publish_0002'),
    });
    await mutateAdminDailyLoginCampaign({
      clock,
      db,
      decodedToken,
      fieldValue,
      input: mutation('publish', 1, 'daily_publish_0003'),
    });
    expect(db.read('dailyLoginCampaign/current')).toMatchObject({
      activeRevision: 1,
      lastPublishedRevision: 2,
      scheduledRevision: 2,
    });
    expect(await activateScheduledDailyLoginCampaign({ clock, db, fieldValue })).toMatchObject({
      activated: false,
      reason: 'not-due',
    });
    nowMillis = Date.parse('2026-07-31T21:00:00.000Z');
    expect(await activateScheduledDailyLoginCampaign({ clock, db, fieldValue })).toMatchObject({
      activated: true,
      revision: 2,
    });
    expect(db.read('dailyLoginCampaign/current')).toMatchObject({ activeRevision: 2 });
    expect(db.read('dailyLoginCampaign/current').scheduledRevision).toBeUndefined();
    expect(await activateScheduledDailyLoginCampaign({ clock, db, fieldValue })).toMatchObject({
      activated: false,
      reason: 'not-scheduled',
    });
  });

  it('allows only the active Platform Owner to mutate rewards', async () => {
    const db = seededDb();
    await expect(mutateAdminDailyLoginCampaign({
      clock: createClock(),
      db,
      decodedToken: { ...decodedToken, adminRole: 'super_admin' },
      fieldValue,
      input: mutation('publish', 0, 'daily_publish_0004'),
    })).rejects.toMatchObject({ status: 403 });
    db.documents.set('adminProfiles/owner-1', {
      role: 'owner',
      status: 'suspended',
      uid: 'owner-1',
    });
    await expect(mutateAdminDailyLoginCampaign({
      clock: createClock(),
      db,
      decodedToken,
      fieldValue,
      input: mutation('publish', 0, 'daily_publish_0005'),
    })).rejects.toMatchObject({ status: 403 });
  });
});

function mutation(operation, expectedRevision, requestId) {
  return {
    expectedRevision,
    operation,
    reason: 'Daily reward campaign change',
    requestId,
    template: template(),
  };
}

function template() {
  return {
    minimumClientVersion: '1.0.0',
    rewards: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      reward: {
        coins: (index + 1) * 10,
        diamonds: index + 1,
        items: [],
        schemaVersion: 1,
      },
    })),
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function seededDb() {
  const db = new FakeFirestore();
  db.documents.set('adminProfiles/owner-1', {
    role: 'owner',
    status: 'active',
    uid: 'owner-1',
  });
  return db;
}

function createClock() {
  return { nowMillis: () => nowMillis, timestampFromMillis: timestamp };
}

function timestamp(value) {
  return { toMillis: () => value };
}

const DELETE = Symbol('delete');

class FakeFirestore {
  constructor() {
    this.documents = new Map();
  }
  doc(path) {
    return makeDoc(this, path);
  }
  read(path) {
    return this.documents.get(path);
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
    return snapshot(this.db, ref.path);
  }
  create(ref, data) {
    if (this.db.documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
    this.operations.push({ kind: 'set', data, merge: false, path: ref.path });
  }
  delete(ref) {
    this.operations.push({ kind: 'delete', path: ref.path });
  }
  set(ref, data, options) {
    this.operations.push({ kind: 'set', data, merge: options?.merge === true, path: ref.path });
  }
  update(ref, data) {
    if (!this.db.documents.has(ref.path)) throw new Error(`missing: ${ref.path}`);
    this.operations.push({ kind: 'set', data, merge: true, path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'delete') {
        this.db.documents.delete(operation.path);
        continue;
      }
      const current = this.db.documents.get(operation.path) || {};
      const next = operation.merge ? { ...current, ...operation.data } : { ...operation.data };
      for (const [key, value] of Object.entries(next)) {
        if (value === DELETE) delete next[key];
      }
      this.db.documents.set(operation.path, next);
    }
  }
}

function makeDoc(db, path) {
  return {
    collection: (name) => makeCollection(db, `${path}/${name}`),
    get: async () => snapshot(db, path),
    id: path.split('/').at(-1),
    path,
  };
}

function makeCollection(db, path) {
  const query = {
    doc: (id) => makeDoc(db, `${path}/${id}`),
    get: async () => {
      const docs = [...db.documents.keys()]
        .filter((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
        .map((candidate) => snapshot(db, candidate));
      return { docs, size: docs.length };
    },
    limit: () => query,
    orderBy: () => query,
  };
  return query;
}

function snapshot(db, path) {
  const data = db.documents.get(path);
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeDoc(db, path),
  };
}
