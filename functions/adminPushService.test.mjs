import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPushTokenId } = require('./socialNotificationsCore');
const {
  createAdminPushCampaign,
  deliverAdminPushNotification,
  processAdminPushCampaigns,
} = require('./adminPushService');

const fieldValue = {
  serverTimestamp: () => ({ toMillis: () => 1 }),
};
const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]';

describe('adminPushService', () => {
  it('skips delivery when the platform flag is off', async () => {
    const db = new FakeFirestore({ 'appConfig/socialFeatures': { pushNotifications: false } });
    await expect(deliverAdminPushNotification({
      actorUid: 'admin',
      body: 'نص الإشعار',
      db,
      fieldValue,
      recipientUid: 'user1',
      requestId: 'push_one_user_12345',
      title: 'عنوان',
    })).resolves.toEqual({ status: 'disabled' });
  });

  it('records no-devices without calling Expo', async () => {
    const db = new FakeFirestore({ 'appConfig/socialFeatures': { pushNotifications: true } });
    const fetchImpl = vi.fn();
    await expect(deliverAdminPushNotification({
      actorUid: 'admin',
      body: 'نص الإشعار',
      db,
      fieldValue,
      fetchImpl,
      recipientUid: 'user1',
      requestId: 'push_one_user_12345',
      title: 'عنوان',
    })).resolves.toEqual({ status: 'no-devices' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('submits Expo tickets and deactivates DeviceNotRegistered tokens', async () => {
    const tokenId = createPushTokenId(token);
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { pushNotifications: true },
      [`pushDevices/user1/tokens/${tokenId}`]: { active: true, token },
    });
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ data: [{ details: { error: 'DeviceNotRegistered' }, status: 'error' }] }),
      ok: true,
      status: 200,
    }));

    await expect(deliverAdminPushNotification({
      actorUid: 'admin',
      body: 'نص الإشعار',
      db,
      fieldValue,
      fetchImpl,
      recipientUid: 'user1',
      requestId: 'push_one_user_12345',
      route: 'Store',
      title: 'عنوان',
    })).resolves.toMatchObject({ acceptedCount: 0, status: 'submitted' });
    expect(db.documents.get(`pushDevices/user1/tokens/${tokenId}`).active).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enqueues a campaign without delivering inline and replays with a full campaign', async () => {
    const tokenId = createPushTokenId(token);
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { pushNotifications: true },
      [`pushDevices/user1/tokens/${tokenId}`]: { active: true, token },
    });
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ data: [{ id: 'ticket-1', status: 'ok' }] }),
      ok: true,
      status: 200,
    }));
    const input = {
      audience: { roles: [], uids: ['user1'] },
      body: 'نص الإشعار',
      reason: 'اختبار الإرسال',
      requestId: 'push_campaign_abc123',
      route: 'Store',
      title: 'عنوان',
    };

    const created = await createAdminPushCampaign({
      auth: { listUsers: async () => ({ users: [], pageToken: undefined }) },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'admin' },
      fieldValue,
      input,
    });

    expect(created.campaign.status).toBe('queued');
    expect(created.campaign.counts).toMatchObject({ submitted: 0, targeted: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.documents.get('adminAuditEvents/push_push_campaign_abc123')).toMatchObject({
      action: 'push-notification-send',
      actorUid: 'admin',
      status: 'queued',
    });

    const replay = await createAdminPushCampaign({
      auth: { listUsers: async () => ({ users: [], pageToken: undefined }) },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'admin' },
      fieldValue,
      input,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.campaign).toMatchObject({
      campaignId: 'push_campaign_abc123',
      status: 'queued',
      title: 'عنوان',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await processAdminPushCampaigns({
      campaignId: 'push_campaign_abc123',
      db,
      fieldValue,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.documents.get('adminPushCampaigns/push_campaign_abc123').status).toBe('completed');
    expect(db.documents.get('adminAuditEvents/push_push_campaign_abc123').status).toBe('completed');
  });

  it('resumes when campaign exists without audit for the same request', async () => {
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { pushNotifications: true },
      'adminPushCampaigns/push_orphan_camp_01': {
        actorUid: 'admin',
        body: 'نص',
        counts: { failed: 0, noDevices: 0, skipped: 0, submitted: 0, targeted: 1 },
        createdAt: { toMillis: () => 1 },
        cursor: 0,
        recipientUids: ['user1'],
        requestId: 'push_orphan_camp_01',
        status: 'queued',
        title: 'عنوان',
        audience: { roles: [], uidCount: 1 },
        breakdown: { admins: 0, representatives: 0, 'room-owners': 0, staff: 0, uids: 1 },
        reason: 'سبب كافٍ',
        route: '',
        truncated: false,
      },
    });

    const result = await createAdminPushCampaign({
      auth: { listUsers: async () => ({ users: [], pageToken: undefined }) },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'admin' },
      fieldValue,
      input: {
        audience: { roles: [], uids: ['user1'] },
        body: 'نص الإشعار',
        reason: 'سبب كافٍ',
        requestId: 'push_orphan_camp_01',
        route: '',
        title: 'عنوان',
      },
    });

    expect(result.campaign.status).toBe('queued');
    expect(db.documents.get('adminAuditEvents/push_push_orphan_camp_01')).toMatchObject({
      action: 'push-notification-send',
      actorUid: 'admin',
    });
  });

  it('continues a sending campaign in batches', async () => {
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { pushNotifications: true },
      'adminPushCampaigns/camp1': {
        actorUid: 'admin',
        body: 'نص',
        counts: { failed: 0, noDevices: 0, skipped: 0, submitted: 0, targeted: 2 },
        createdAt: { toMillis: () => 1 },
        cursor: 0,
        recipientUids: ['u1', 'u2'],
        requestId: 'camp1',
        status: 'queued',
        title: 'عنوان',
      },
    });
    const first = await processAdminPushCampaigns({
      campaignId: 'camp1',
      db,
      fieldValue,
      fetchImpl: async () => ({ json: async () => ({ data: [] }), ok: true, status: 200 }),
      limit: 1,
    });
    expect(first.results[0]).toMatchObject({ cursor: 1, status: 'sending' });
    const second = await processAdminPushCampaigns({
      campaignId: 'camp1',
      db,
      fieldValue,
      limit: 1,
    });
    expect(second.results[0]).toMatchObject({ cursor: 2, status: 'completed' });
  });
});

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) {
    const ref = {
      create: async (data) => {
        if (this.documents.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        this.documents.set(path, data);
      },
      get: async () => snapshot(ref, this.documents.get(path)),
      path,
      set: async (data, options) => {
        this.documents.set(path, options?.merge
          ? { ...(this.documents.get(path) || {}), ...data }
          : data);
      },
      update: async (data) => this.documents.set(path, { ...this.documents.get(path), ...data }),
    };
    return ref;
  }
  collection(path) { return new FakeQuery(this, path); }
  async runTransaction(callback) {
    const tx = new FakeTransaction(this);
    const result = await callback(tx);
    tx.commit();
    return result;
  }
  batch() {
    const operations = [];
    return {
      commit: async () => operations.forEach(({ ref, data }) => {
        this.documents.set(ref.path, { ...this.documents.get(ref.path), ...data });
      }),
      update: (ref, data) => operations.push({ ref, data }),
    };
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', ref, data }); }
  set(ref, data, options) { this.operations.push({ kind: 'set', ref, data, options }); }
  update(ref, data) { this.operations.push({ kind: 'update', ref, data }); }
  commit() {
    this.operations.forEach(({ kind, ref, data, options }) => {
      if (kind === 'create') {
        if (this.db.documents.has(ref.path)) throw Object.assign(new Error('exists'), { code: 6 });
        this.db.documents.set(ref.path, data);
        return;
      }
      if (kind === 'set') {
        this.db.documents.set(ref.path, options?.merge
          ? { ...(this.db.documents.get(ref.path) || {}), ...data }
          : data);
        return;
      }
      this.db.documents.set(ref.path, { ...this.db.documents.get(ref.path), ...data });
    });
  }
}

class FakeQuery {
  constructor(db, path, filters = [], limitValue = 100) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.limitValue = limitValue;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.limitValue);
  }
  orderBy() { return this; }
  limit(value) { return new FakeQuery(this.db, this.path, this.filters, value); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) => this.filters.every((filter) => filter.operator === '==' && data[filter.field] === filter.value))
      .slice(0, this.limitValue)
      .map(([path, data]) => snapshot(this.db.doc(path), data));
    return { docs, size: docs.length };
  }
}

function snapshot(ref, data) {
  return { data: () => data, exists: data !== undefined, id: ref.path.split('/').at(-1), ref };
}
