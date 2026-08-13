import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  clearAdminUidCache,
  normalizeAdminPushAudience,
  normalizeAdminPushSendInput,
  unionRecipientUids,
  resolveAdminPushAudience,
} = require('./adminPushAudienceCore');

describe('adminPushAudienceCore', () => {
  it('rejects empty audiences and invalid roles', () => {
    expect(normalizeAdminPushAudience({})).toMatchObject({ ok: false });
    expect(normalizeAdminPushAudience({ roles: ['mods'], uids: [] })).toMatchObject({ ok: false });
    expect(normalizeAdminPushAudience({ roles: ['staff'], uids: ['u1'] })).toMatchObject({
      ok: true,
      value: { roles: ['staff'], uids: ['u1'] },
    });
  });

  it('dedupes pasted UIDs and role selections', () => {
    expect(normalizeAdminPushAudience({
      roles: ['staff', 'staff', 'admins'],
      uids: ['a', 'b', 'a'],
    })).toEqual({
      ok: true,
      value: { roles: ['staff', 'admins'], uids: ['a', 'b'] },
    });
  });

  it('unions recipient groups with a hard cap', () => {
    const first = unionRecipientUids([['a', 'b'], ['b', 'c']]);
    expect(first).toEqual({ recipientUids: ['a', 'b', 'c'], truncated: false });
  });

  it('requires title body reason and requestId for send', () => {
    expect(normalizeAdminPushSendInput({
      audience: { roles: ['staff'], uids: [] },
      body: 'نص',
      reason: 'ops',
      requestId: 'push_campaign_12345',
      title: 'عنوان',
    })).toMatchObject({ ok: true });
    expect(normalizeAdminPushSendInput({
      audience: { roles: ['staff'], uids: [] },
      body: 'نص',
      reason: 'ab',
      requestId: 'push_campaign_12345',
      title: 'عنوان',
    })).toMatchObject({ ok: false });
  });

  it('resolves and unions staff room owners reps and uids', async () => {
    clearAdminUidCache();
    const db = new FakeFirestore({
      'payrollEnrollments/staff1': {
        currentConfig: { effectiveFromCycleId: '1970-W01', state: 'active', planId: 'p1', uid: 'staff1' },
      },
      'payrollEnrollments/staff-ended': {
        currentConfig: { effectiveFromCycleId: '1970-W01', state: 'ended', planId: 'p1', uid: 'staff-ended' },
      },
      'rooms/room1': { ownerUid: 'owner1' },
      'rooms/room2': { hostId: 'owner1' },
      'rooms/room3': { ownerUid: 'owner2' },
      'representativePrivileges/rep1': { active: true, currencies: { coins: true, diamonds: false } },
      'representativePrivileges/rep-inactive': { active: false, currencies: { coins: true } },
      'representativePrivileges/rep-empty': { active: true, currencies: { coins: false, diamonds: false } },
    });
    const listUsers = vi.fn(async () => ({
      pageToken: undefined,
      users: [
        { customClaims: { admin: true, adminRole: 'moderator' }, uid: 'mod1' },
        { customClaims: { admin: false }, uid: 'user' },
      ],
    }));
    const auth = { listUsers };

    const resolved = await resolveAdminPushAudience({
      audience: {
        roles: ['staff', 'room-owners', 'admins', 'representatives'],
        uids: ['manual1', 'owner1'],
      },
      auth,
      db,
      nowMillis: Date.parse('2026-01-07T12:00:00.000Z'),
    });

    expect(resolved.breakdown).toMatchObject({
      admins: 1,
      representatives: 1,
      'room-owners': 2,
      staff: 1,
      uids: 2,
    });
    expect(new Set(resolved.recipientUids)).toEqual(new Set([
      'manual1', 'owner1', 'staff1', 'owner2', 'mod1', 'rep1',
    ]));

    await resolveAdminPushAudience({
      audience: { roles: ['admins'], uids: [] },
      auth,
      db,
      nowMillis: Date.parse('2026-01-07T12:00:00.000Z'),
    });
    expect(listUsers).toHaveBeenCalledTimes(1);
  });
});

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) {
    const ref = {
      get: async () => snapshot(ref, this.documents.get(path)),
      path,
    };
    return ref;
  }
  collection(path) { return new FakeQuery(this, path); }
}

class FakeQuery {
  constructor(db, path, limitValue = 100) { this.db = db; this.path = path; this.limitValue = limitValue; }
  where() { return this; }
  orderBy() { return this; }
  limit(value) { return new FakeQuery(this.db, this.path, value); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .slice(0, this.limitValue)
      .map(([path, data]) => snapshot(this.db.doc(path), data));
    return { docs, size: docs.length };
  }
}

function snapshot(ref, data) {
  return { data: () => data, exists: data !== undefined, id: ref.path.split('/').at(-1), ref };
}
