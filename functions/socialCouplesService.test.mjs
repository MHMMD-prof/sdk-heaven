import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getCoupleOverview, getCoupleStatus, mutateCouple } = require('./socialCouplesService');

const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };

describe('socialCouplesService', () => {
  it('requires the remotely controlled couples flag', async () => {
    const db = socialDb({ couples: false });
    await expect(getCoupleStatus({ db, input: { targetUid: 'target' }, uid: 'self' }))
      .resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('creates, accepts, and dissolves one relationship transactionally', async () => {
    const db = socialDb({ couples: true });
    await expect(mutateCouple(command('send-couple-request', db, 'self', 'target', 'send_couple_123456')))
      .resolves.toEqual({ result: { status: 'outgoing' } });
    await expect(getCoupleStatus({ db, input: { targetUid: 'self' }, uid: 'target' }))
      .resolves.toMatchObject({ result: { status: 'incoming' } });

    await expect(mutateCouple(command('accept-couple-request', db, 'target', 'self', 'accept_couple_1234')))
      .resolves.toEqual({ result: { status: 'coupled' } });
    expect(db.documents.get('publicProfiles/self').coupleLevel).toBe(1);
    expect(db.documents.get('publicProfiles/target').coupleLevel).toBe(1);
    expect(db.documents.get('coupleMemberships/self').partnerUid).toBe('target');
    expect(db.documents.get('coupleMemberships/target').partnerUid).toBe('self');

    const overview = await getCoupleOverview({ db, uid: 'self' });
    expect(overview.result.current.profile.uid).toBe('target');
    expect(overview.result.incoming).toEqual([]);

    await expect(mutateCouple(command('dissolve-couple', db, 'self', 'target', 'dissolve_couple_12')))
      .resolves.toEqual({ result: { status: 'none' } });
    expect(db.documents.has('coupleMemberships/self')).toBe(false);
    expect(db.documents.has('coupleMemberships/target')).toBe(false);
    expect(db.documents.get('publicProfiles/self').coupleLevel).toBe(0);
  });

  it('uses request IDs idempotently', async () => {
    const db = socialDb({ couples: true });
    const input = command('send-couple-request', db, 'self', 'target', 'same_couple_1234567');
    await expect(mutateCouple(input)).resolves.toEqual({ result: { status: 'outgoing' } });
    await expect(mutateCouple(input)).resolves.toEqual({ result: { status: 'outgoing' } });
    expect([...db.documents.keys()].filter((path) => path.startsWith('coupleRequests/'))).toHaveLength(1);
  });

  it('prevents a second relationship when either account has a membership lock', async () => {
    const db = socialDb({ couples: true });
    db.documents.set('coupleMemberships/target', { coupleId: 'another', partnerUid: 'third', uid: 'target' });
    await expect(mutateCouple(command('send-couple-request', db, 'self', 'target', 'locked_couple_12345')))
      .resolves.toEqual({ errorCode: 'CONFLICT' });
  });

  it('rejects operations across either blocking direction', async () => {
    const db = socialDb({ couples: true });
    db.documents.set('blocks/target/blocked/self', { createdAt: timestamp() });
    await expect(mutateCouple(command('send-couple-request', db, 'self', 'target', 'blocked_couple_1234')))
      .resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });
  });
});

function command(action, db, uid, targetUid, requestId) {
  return { action, db, fieldValue, input: { targetUid }, requestId, uid };
}

function socialDb(flags) {
  return new FakeFirestore({
    'appConfig/socialFeatures': flags,
    'publicProfiles/self': publicProfile('self', 'Self', '1111111'),
    'publicProfiles/target': publicProfile('target', 'Target', '2222222'),
    'publicIds/1111111': reservation('self'),
    'publicIds/2222222': reservation('target'),
  });
}

function publicProfile(uid, displayName, publicId) {
  return {
    avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', coupleLevel: 0,
    createdAt: timestamp(), displayName, friendCount: 0, giftScore: 0, moderationStatus: 'active',
    normalizedName: displayName.toLowerCase(), publicId, uid, updatedAt: timestamp(),
  };
}

function reservation(uid) { return { createdAt: timestamp(), uid }; }
function timestamp() { return { toMillis: () => 1 }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  collection(path) { return new FakeQuery(this, path); }
  doc(path) { return { get: async () => createSnapshot(path, this.documents.get(path)), path }; }
  async getAll(...refs) { return refs.map((ref) => createSnapshot(ref.path, this.documents.get(ref.path))); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return createSnapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', path: ref.path, data }); }
  delete(ref) { this.operations.push({ kind: 'delete', path: ref.path }); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', path: ref.path, data }); }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'delete') this.db.documents.delete(operation.path);
      else if (operation.kind === 'update') this.db.documents.set(operation.path, { ...this.db.documents.get(operation.path), ...operation.data });
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
  orderBy(field, direction = 'asc') { return this.next({ order: { field, direction } }); }
  limit(value) { return this.next({ limit: value }); }
  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));
    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => filter.operator === 'array-contains'
        ? Array.isArray(data[filter.field]) && data[filter.field].includes(filter.value)
        : data[filter.field] === filter.value);
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ path, data }) => createSnapshot(path, data)) };
  }
  next(update) { return new FakeQuery(this.db, this.path, { ...this.state, ...update }); }
}

function createSnapshot(path, data) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: { path } };
}
