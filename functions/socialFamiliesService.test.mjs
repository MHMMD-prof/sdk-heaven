import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getMyFamily, mutateFamily } = require('./socialFamiliesService');

const fieldValue = {
  delete: () => ({ __delete: true }),
  increment: (value) => ({ __increment: value }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

describe('socialFamiliesService', () => {
  it('requires the growth families flag', async () => {
    const db = familyDb({ families: false });
    await expect(getMyFamily({ db, uid: 'owner' }))
      .resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('creates, invites, accepts, kicks, and dissolves deterministically', async () => {
    const db = familyDb({ families: true });

    const created = await mutateFamily(command('create-family', db, 'owner', {
      nameAr: 'عائلة السماء',
      badgeColor: '#5B8C5A',
    }, 'create_family_abcdef12'));
    expect(created.result.status).toBe('joined');
    expect(created.result.role).toBe('owner');
    expect(db.documents.get('publicProfiles/owner').family.nameAr).toBe('عائلة السماء');
    const familyId = created.result.family.familyId;
    const inviteCode = created.result.family.inviteCode;
    expect(db.documents.has(`familyInviteCodes/${inviteCode}`)).toBe(true);

    await expect(mutateFamily(command('invite-to-family', db, 'owner', { targetUid: 'member' }, 'invite_family_abcdef1')))
      .resolves.toEqual({ result: { status: 'outgoing' } });

    await expect(mutateFamily(command('accept-family-invite', db, 'member', { familyId }, 'accept_family_abcdef')))
      .resolves.toMatchObject({ result: { status: 'joined', role: 'member' } });
    expect(db.documents.get('publicProfiles/member').family.familyId).toBe(familyId);
    expect(db.documents.get(`families/${familyId}`).memberCount).toBe(2);

    await expect(mutateFamily(command('kick-family-member', db, 'owner', { targetUid: 'member' }, 'kick_family_abcdef12')))
      .resolves.toEqual({ result: { status: 'kicked', targetUid: 'member' } });
    expect(db.documents.has('familyMemberships/member')).toBe(false);
    expect(db.documents.get('publicProfiles/member').family).toBeUndefined();

    const joined = await mutateFamily(command('join-family', db, 'member', { inviteCode }, 'join_family_abcdef12'));
    expect(joined.result.status).toBe('joined');

    await expect(mutateFamily(command('leave-family', db, 'member', undefined, 'leave_family_abcdef1')))
      .resolves.toEqual({ result: { status: 'none' } });

    await expect(mutateFamily(command('dissolve-family', db, 'owner', undefined, 'dissolve_family_abcd')))
      .resolves.toEqual({ result: { status: 'none' } });
    expect(db.documents.get(`families/${familyId}`).status).toBe('dissolved');
    expect(db.documents.has('familyMemberships/owner')).toBe(false);
    expect(db.documents.get('publicProfiles/owner').family).toBeUndefined();
  });

  it('replays create-family with the same request id', async () => {
    const db = familyDb({ families: true });
    const input = command('create-family', db, 'owner', { nameAr: 'عائلة' }, 'same_family_request1');
    const first = await mutateFamily(input);
    const second = await mutateFamily(input);
    expect(second).toEqual(first);
    expect([...db.documents.keys()].filter((path) => path.startsWith('families/'))).toHaveLength(1);
  });

  it('blocks invite across either blocking direction', async () => {
    const db = familyDb({ families: true });
    await mutateFamily(command('create-family', db, 'owner', { nameAr: 'عائلة' }, 'create_blocked_abcd'));
    db.documents.set('blocks/member/blocked/owner', { createdAt: timestamp() });
    await expect(mutateFamily(command('invite-to-family', db, 'owner', { targetUid: 'member' }, 'invite_blocked_abcd')))
      .resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });
  });

  it('prevents owner leave without dissolve', async () => {
    const db = familyDb({ families: true });
    await mutateFamily(command('create-family', db, 'owner', { nameAr: 'عائلة' }, 'create_owner_leave1'));
    await expect(mutateFamily(command('leave-family', db, 'owner', undefined, 'leave_owner_abcdef')))
      .resolves.toEqual({ errorCode: 'CONFLICT' });
  });
});

function command(action, db, uid, payload, requestId) {
  return {
    action,
    db,
    fieldValue,
    input: payload,
    requestId,
    uid,
  };
}

function familyDb(flags) {
  return new FakeFirestore({
    'appConfig/growthFeatures': flags,
    'publicProfiles/owner': publicProfile('owner', 'Owner', '1111111'),
    'publicProfiles/member': publicProfile('member', 'Member', '2222222'),
    'publicIds/1111111': reservation('owner'),
    'publicIds/2222222': reservation('member'),
  });
}

function publicProfile(uid, displayName, publicId) {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 0,
    createdAt: timestamp(),
    displayName,
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: displayName.toLowerCase(),
    publicId,
    uid,
    updatedAt: timestamp(),
  };
}

function reservation(uid) {
  return { createdAt: timestamp(), uid };
}

function timestamp() {
  return { toMillis: () => 1 };
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

  delete(ref) {
    this.operations.push({ kind: 'delete', path: ref.path });
  }

  set(ref, data, options = {}) {
    this.operations.push({
      data,
      kind: options.merge ? 'setMerge' : 'set',
      path: ref.path,
    });
  }

  update(ref, data) {
    this.operations.push({ kind: 'update', path: ref.path, data });
  }

  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'delete') {
        this.db.documents.delete(operation.path);
        continue;
      }
      if (operation.kind === 'create') {
        if (this.db.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
        continue;
      }
      const current = this.db.documents.get(operation.path) || {};
      const next = operation.kind === 'set'
        ? { ...operation.data }
        : { ...current, ...operation.data };
      for (const [key, value] of Object.entries(next)) {
        if (value && typeof value === 'object' && value.__delete === true) {
          delete next[key];
        }
      }
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

  orderBy(field, direction = 'asc') {
    return this.next({ order: { field, direction } });
  }

  limit(value) {
    return this.next({ limit: value });
  }

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));
    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => (filter.operator === 'array-contains'
        ? Array.isArray(data[filter.field]) && data[filter.field].includes(filter.value)
        : data[filter.field] === filter.value));
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ path, data }) => createSnapshot(path, data)) };
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
