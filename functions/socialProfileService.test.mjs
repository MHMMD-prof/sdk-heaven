import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getProfileReadiness, provisionPublicProfile } = require('./socialProfileService');

const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };

describe('socialProfileService', () => {
  it('retries reserved ID collisions and creates a permanent reservation', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicIds/1000000': { uid: 'other-user' },
    });
    const candidates = [1000000, 1000001];
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      randomInt: () => candidates.shift(),
      requestId: 'request_123456789',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ created: true, provisioned: true, publicId: '1000001' });
    expect(db.read('publicIds/1000001')).toMatchObject({ uid: 'u1' });
    expect(db.read('publicIds/1000000')).toMatchObject({ uid: 'other-user' });
  });

  it('does not allocate a normal ID listed or owned as a custom ID', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'specialIdCatalog/1000000': { specialId: '1000000', status: 'available' },
      'specialIds/1000001': { uid: 'other-user' },
    });
    const candidates = [1000000, 1000001, 1000002];
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      randomInt: () => candidates.shift(),
      requestId: 'custom_collision_001',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ publicId: '1000002' });
    expect(db.read('publicIds/1000002')).toMatchObject({ uid: 'u1' });
  });

  it('replaces an eight-digit legacy ID and removes its owned reservation', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': { ...storedPublicProfile('u1'), publicId: '12345678' },
      'publicIds/12345678': { createdAt: fakeTimestamp(1), uid: 'u1' },
    });
    const result = await provisionPublicProfile({
      bypassRateLimit: true,
      db,
      fieldValue,
      randomInt: () => 2345678,
      requestId: 'seven_digit_migrate_001',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ publicId: '2345678', repaired: true });
    expect(db.read('publicIds/12345678')).toBeUndefined();
    expect(db.read('publicIds/2345678')).toMatchObject({ uid: 'u1' });
  });

  it('does not silently discard an invalid legacy custom ID during migration', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': { ...storedPublicProfile('u1'), publicId: '12345678', specialId: '777' },
      'publicIds/12345678': { createdAt: fakeTimestamp(1), uid: 'u1' },
    });
    const result = await provisionPublicProfile({
      bypassRateLimit: true,
      db,
      fieldValue,
      randomInt: () => 2345678,
      requestId: 'blocked_custom_migrate_1',
      uid: 'u1',
    });

    expect(result).toEqual({ done: true, errorCode: 'PROFILE_INCOMPLETE' });
    expect(db.read('publicProfiles/u1')).toMatchObject({ publicId: '12345678', specialId: '777' });
    expect(db.read('publicIds/12345678')).toMatchObject({ uid: 'u1' });
  });

  it('is naturally idempotent without persisting bootstrap request records', async () => {
    const db = new FakeFirestore({ 'users/u1': privateProfile('u1') });
    const input = {
      db,
      fieldValue,
      randomInt: () => 1234567,
      requestId: 'same_request_1234',
      uid: 'u1',
    };

    const first = await provisionPublicProfile(input);
    const second = await provisionPublicProfile({ ...input, randomInt: () => 8765432 });

    expect(second.result).toMatchObject({
      created: false,
      provisioned: true,
      publicId: first.result.publicId,
    });
    expect(db.paths('adminAuditEvents/')).toHaveLength(1);
    expect(db.paths('socialCommandRequests/')).toHaveLength(0);
    expect(db.read('publicIds/8765432')).toBeUndefined();
  });

  it('converges concurrent bootstrap commands on one public ID', async () => {
    const db = new FakeFirestore({ 'users/u1': privateProfile('u1') });
    const [first, second] = await Promise.all([
      provisionPublicProfile({
        db,
        fieldValue,
        randomInt: () => 1234567,
        requestId: 'concurrent_req_001',
        uid: 'u1',
      }),
      provisionPublicProfile({
        db,
        fieldValue,
        randomInt: () => 8765432,
        requestId: 'concurrent_req_002',
        uid: 'u1',
      }),
    ]);

    expect(first.result.publicId).toBe(second.result.publicId);
    expect(db.paths('publicIds/')).toHaveLength(1);
  });

  it('repairs an existing profile whose reservation belongs to another user', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': { publicId: '1234567', uid: 'u1' },
      'publicIds/1234567': { uid: 'other-user' },
    });
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      randomInt: () => 2345678,
      requestId: 'repair_request_001',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ publicId: '2345678', repaired: true });
    expect(db.read('publicProfiles/u1')).toMatchObject({ publicId: '2345678' });
  });

  it('repairs a malformed reservation without allocating a new public ID', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': storedPublicProfile('u1'),
      'publicIds/1234567': { createdAt: 'broken', uid: 'u1' },
      'adminUserSearch/u1': {
        displayName: 'User One',
        email: 'u1@example.com',
        normalizedName: 'user one',
        uid: 'u1',
        updatedAt: fakeTimestamp(2),
      },
    });
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      randomInt: () => 8765432,
      requestId: 'repair_reserve_001',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ publicId: '1234567', repaired: true });
    expect(db.read('publicIds/1234567')).toMatchObject({ createdAt: { __serverTimestamp: true }, uid: 'u1' });
    expect(db.read('publicIds/8765432')).toBeUndefined();
  });

  it('rejects missing and malformed legacy private profiles', async () => {
    const db = new FakeFirestore({
      'users/u1': { uid: 'u1', email: 'u1@example.com', displayName: '', avatarLabel: 'U' },
    });
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      randomInt: () => 1234567,
      requestId: 'invalid_request_001',
      uid: 'u1',
    });

    expect(result).toEqual({ done: true, errorCode: 'PROFILE_INCOMPLETE' });
    expect(db.read('publicProfiles/u1')).toBeUndefined();
  });

  it('rate limits only bootstrap requests that would mutate state', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': storedPublicProfile('u1'),
      'publicIds/1234567': { createdAt: fakeTimestamp(1), uid: 'u1' },
      'socialRateLimits/u1': { lastMutationAt: fakeTimestamp(9_500), uid: 'u1' },
    });
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      nowMs: 10_000,
      randomInt: () => 8765432,
      requestId: 'rate_limit_req_001',
      uid: 'u1',
    });

    expect(result).toEqual({ done: true, errorCode: 'RATE_LIMITED' });
    expect(db.paths('adminAuditEvents/')).toHaveLength(0);
  });

  it('does not rate limit a healthy no-op readiness bootstrap', async () => {
    const db = new FakeFirestore({
      'users/u1': privateProfile('u1'),
      'publicProfiles/u1': storedPublicProfile('u1'),
      'publicIds/1234567': { createdAt: fakeTimestamp(1), uid: 'u1' },
      'adminUserSearch/u1': {
        displayName: 'User One',
        email: 'u1@example.com',
        normalizedName: 'user one',
        uid: 'u1',
        updatedAt: fakeTimestamp(2),
      },
      'socialRateLimits/u1': { lastMutationAt: fakeTimestamp(9_500), uid: 'u1' },
    });
    const result = await provisionPublicProfile({
      db,
      fieldValue,
      nowMs: 10_000,
      randomInt: () => 8765432,
      requestId: 'healthy_noop_req_1',
      uid: 'u1',
    });

    expect(result.result).toMatchObject({ provisioned: true, publicId: '1234567' });
    expect(db.paths('adminAuditEvents/')).toHaveLength(0);
  });

  it('reports unready when a public ID reservation is missing or owned by someone else', async () => {
    const missingReservationDb = new FakeFirestore({
      'publicProfiles/u1': storedPublicProfile('u1'),
    });
    expect(await getProfileReadiness(missingReservationDb, 'u1')).toMatchObject({ provisioned: false });

    const wrongReservationDb = new FakeFirestore({
      'publicProfiles/u1': storedPublicProfile('u1'),
      'publicIds/1234567': { createdAt: fakeTimestamp(1), uid: 'other' },
    });
    expect(await getProfileReadiness(wrongReservationDb, 'u1')).toMatchObject({ provisioned: false });
  });
});

function privateProfile(uid) {
  return {
    avatarLabel: 'U',
    displayName: 'User One',
    email: `${uid}@example.com`,
    uid,
  };
}

function storedPublicProfile(uid) {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 0,
    createdAt: fakeTimestamp(1),
    displayName: 'User One',
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: 'user one',
    publicId: '1234567',
    uid,
    updatedAt: fakeTimestamp(2),
  };
}

function fakeTimestamp(ms) {
  return { toMillis: () => ms };
}

class FakeFirestore {
  constructor(initial = {}) {
    this.documents = new Map(Object.entries(initial));
    this.nextId = 1;
    this.queue = Promise.resolve();
  }

  collection(path) {
    return {
      doc: () => this.doc(`${path}/auto-${this.nextId++}`),
    };
  }

  doc(path) {
    return {
      get: async () => snapshot(this.documents.get(path)),
      path,
    };
  }

  paths(prefix) {
    return [...this.documents.keys()].filter((path) => path.startsWith(prefix));
  }

  read(path) {
    return this.documents.get(path);
  }

  runTransaction(callback) {
    const run = async () => {
      const writes = [];
      const transaction = {
        create: (ref, data) => writes.push({ kind: 'create', path: ref.path, data }),
        delete: (ref) => writes.push({ kind: 'delete', path: ref.path }),
        get: async (ref) => snapshot(this.documents.get(ref.path)),
        set: (ref, data) => writes.push({ kind: 'set', path: ref.path, data }),
      };
      const result = await callback(transaction);

      for (const write of writes) {
        if (write.kind === 'delete') {
          this.documents.delete(write.path);
          continue;
        }
        if (write.kind === 'create' && this.documents.has(write.path)) {
          throw new Error(`Document already exists: ${write.path}`);
        }

        this.documents.set(write.path, write.data);
      }

      return result;
    };

    const pending = this.queue.then(run, run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}

function snapshot(data) {
  return {
    exists: data !== undefined,
    data: () => data,
  };
}
