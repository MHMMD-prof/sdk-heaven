import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeAdminRoomRocketMutation } = require('./adminRoomRocketCore');
const {
  getAdminRoomRocketCampaign,
  mutateAdminRoomRocketCampaign,
} = require('./adminRoomRocketService');

const nowMs = Date.parse('2026-07-29T12:00:00.000Z');
const clock = { nowMillis: () => nowMs, timestampFromMillis: timestamp };
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };
const decodedToken = { email: 'owner@example.com', uid: 'owner-1' };

describe('adminRoomRocketService', () => {
  it('publishes immutably for the next weekly cycle and replays an audit request safely', async () => {
    const db = new FakeFirestore();
    const input = normalized('publish', 0, 'rocket_publish_0001');
    const first = await mutateAdminRoomRocketCampaign({ clock, db, decodedToken, fieldValue, input });
    const replay = await mutateAdminRoomRocketCampaign({ clock, db, decodedToken, fieldValue, input });
    expect(first).toMatchObject({
      effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
      replayed: false,
      revision: 1,
    });
    expect(replay).toMatchObject({ replayed: true, revision: 1 });
    expect(db.read('roomRocketCampaign/current/versions/v1')).toMatchObject({
      effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
      revision: 1,
    });
    expect(db.read('appConfig/roomRocketPublic')).toMatchObject({
      effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
      renderingEnabled: true,
      revision: 1,
    });
    expect(db.read('roomRocketPublicVersions/v1')).toMatchObject({
      effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
      revision: 1,
      template: {
        minimumClientVersion: '1.0.0',
        targetSupportPoints: 1000,
      },
    });
    expect(db.read('roomRocketPublicVersions/v1').template.animationApproval).toBeUndefined();
    expect(db.read('roomRocketPublicVersions/v1').template.appearance.staticAsset.storagePath).toBeUndefined();
    const detail = await getAdminRoomRocketCampaign({ db });
    expect(detail.campaign).toMatchObject({ emergencyDisabled: false, lastPublishedRevision: 1, revision: 1 });
    expect(detail.versions).toHaveLength(1);
  });

  it('emergency-disables rendering without deleting the immutable published version', async () => {
    const db = new FakeFirestore();
    await mutateAdminRoomRocketCampaign({
      clock, db, decodedToken, fieldValue, input: normalized('publish', 0, 'rocket_publish_0002'),
    });
    const disabled = await mutateAdminRoomRocketCampaign({
      clock,
      db,
      decodedToken,
      fieldValue,
      input: {
        expectedRevision: 1,
        operation: 'emergency-disable',
        reason: 'Unsafe rendering asset',
        requestId: 'rocket_disable_0002',
      },
    });
    expect(disabled.revision).toBe(2);
    expect(db.read('roomRocketCampaign/current').emergencyDisabled).toBe(true);
    expect(db.read('appConfig/roomRocketPublic')).toMatchObject({ renderingEnabled: false, revision: 2 });
    expect(db.read('roomRocketCampaign/current/versions/v1')).toBeTruthy();
  });
});

function normalized(operation, expectedRevision, requestId) {
  const result = normalizeAdminRoomRocketMutation({
    expectedRevision,
    operation,
    reason: 'Weekly campaign publication',
    requestId,
    template: template(),
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

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
    enabledRankCount: 1,
    minimumClientVersion: '1.0.0',
    rewards: { 1: { coins: 100, diamonds: 0, items: [] } },
    targetSupportPoints: 1000,
    timeZone: 'Asia/Baghdad',
  };
}

function timestamp(value) { return { toMillis: () => value }; }

class FakeFirestore {
  constructor() { this.documents = new Map(); }
  doc(path) { return makeDoc(this, path); }
  read(path) { return this.documents.get(path); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async getAll(...refs) { return refs.map((ref) => snapshot(this.db, ref.path)); }
  create(ref, data) { this.operations.push({ data, merge: false, path: ref.path }); }
  set(ref, data, options) { this.operations.push({ data, merge: options?.merge === true, path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(operation.path, operation.merge ? { ...current, ...operation.data } : operation.data);
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
    limit: () => query,
    orderBy: () => query,
    get: async () => {
      const docs = [...db.documents.keys()]
        .filter((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
        .sort((left, right) => Number(db.documents.get(right)?.revision || 0) - Number(db.documents.get(left)?.revision || 0))
        .map((candidate) => snapshot(db, candidate));
      return { docs, size: docs.length };
    },
  };
  return query;
}

function snapshot(db, path) {
  const data = db.documents.get(path);
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: makeDoc(db, path) };
}
