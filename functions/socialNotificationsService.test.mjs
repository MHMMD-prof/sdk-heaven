import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPushTokenId } = require('./socialNotificationsCore');
const {
  deliverDirectChatNotification,
  deliverNotificationForCommand,
  deliverSocialNotification,
  getNotificationSettings,
  mutateNotificationSettings,
  processPendingNotificationReceipts,
} = require('./socialNotificationsService');
const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const conversationId = 'a'.repeat(64);

describe('socialNotificationsService', () => {
  it('keeps registration behind the remote feature flag', async () => {
    const db = socialDb(false);
    await expect(getNotificationSettings({ db, uid: 'self' })).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('registers devices and updates preferences idempotently', async () => {
    const db = socialDb(true);
    const registration = {
      action: 'register-push-device', db, fieldValue,
      input: { deviceName: 'Phone', platform: 'android', token },
      requestId: 'push_register_12345', uid: 'self',
    };
    await expect(mutateNotificationSettings(registration)).resolves.toMatchObject({ result: { registered: true } });
    await expect(mutateNotificationSettings(registration)).resolves.toMatchObject({ result: { registered: true } });
    expect(db.documents.get(`pushDevices/self/tokens/${createPushTokenId(token)}`).active).toBe(true);

    const preferences = {
      coupleRequests: false,
      directMessageRequests: true,
      directMessages: true,
      follows: true,
      friendRequests: true,
      gifts: false,
      readReceipts: true,
      showMessagePreview: true,
      showOnlineStatus: true,
      walletTransfers: true,
    };
    await expect(mutateNotificationSettings({
      action: 'update-notification-preferences', db, fieldValue,
      input: { coupleRequests: false, friendRequests: true, gifts: false, walletTransfers: true },
      requestId: 'push_prefs_1234567', uid: 'self',
    })).resolves.toEqual({ result: { preferences } });
    await expect(getNotificationSettings({ db, uid: 'self' })).resolves.toMatchObject({ result: { preferences, registeredDeviceCount: 1 } });
  });

  it('transfers a device token away from the previous signed-in account', async () => {
    const db = socialDb(true);
    await mutateNotificationSettings({
      action: 'register-push-device', db, fieldValue,
      input: { deviceName: 'Shared phone', platform: 'android', token },
      requestId: 'owner_self_1234567', uid: 'self',
    });
    await mutateNotificationSettings({
      action: 'register-push-device', db, fieldValue,
      input: { deviceName: 'Shared phone', platform: 'android', token },
      requestId: 'owner_target_12345', uid: 'target',
    });
    const tokenId = createPushTokenId(token);
    expect(db.documents.get(`pushDevices/self/tokens/${tokenId}`).active).toBe(false);
    expect(db.documents.get(`pushDevices/target/tokens/${tokenId}`).active).toBe(true);
    expect(db.documents.get(`pushTokenOwners/${tokenId}`).uid).toBe('target');
  });

  it('deduplicates delivery and disables immediately rejected tokens', async () => {
    const db = socialDb(true);
    const tokenId = createPushTokenId(token);
    db.documents.set('socialCommandRequests/self/requests/social_event_1234', {
      notificationKind: 'friend-request', notificationRecipientUid: 'target', requestId: 'social_event_1234', uid: 'self',
    });
    db.documents.set(`pushDevices/target/tokens/${tokenId}`, { active: true, token });
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ data: [{ details: { error: 'DeviceNotRegistered' }, status: 'error' }] }),
      ok: true,
      status: 200,
    }));

    await expect(deliverNotificationForCommand({ db, fieldValue, fetchImpl, requestId: 'social_event_1234', uid: 'self' }))
      .resolves.toMatchObject({ status: 'submitted', acceptedCount: 0 });
    expect(db.documents.get(`pushDevices/target/tokens/${tokenId}`).active).toBe(false);
    await expect(deliverNotificationForCommand({ db, fieldValue, fetchImpl, requestId: 'social_event_1234', uid: 'self' }))
      .resolves.toEqual({ status: 'duplicate' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lets users disable representative transfer alerts without disabling gifts', async () => {
    const db = socialDb(true);
    db.documents.set('notificationPreferences/target', { coupleRequests: true, friendRequests: true, gifts: true, walletTransfers: false });
    const fetchImpl = vi.fn();
    await expect(deliverSocialNotification({ actorUid: 'self', db, fieldValue, fetchImpl, kind: 'representative-transfer-received', recipientUid: 'target', requestId: 'wallet_alert_12345' })).resolves.toEqual({ status: 'preference-disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('delivers accepted direct messages and suppresses muted blocked preference and duplicate pushes', async () => {
    const db = socialDb(true);
    const tokenId = createPushTokenId(token);
    db.documents.set(`pushDevices/target/tokens/${tokenId}`, { active: true, token });
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ data: [{ id: 'ticket-dm-1', status: 'ok' }] }),
      ok: true,
      status: 200,
    }));

    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 1_000_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000001',
      text: 'hello friend',
    })).resolves.toMatchObject({ status: 'submitted' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)[0]).toMatchObject({
      body: 'hello friend',
      data: { route: 'DirectChat', targetUid: 'self' },
      title: 'Self',
    });

    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 1_000_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000001',
      text: 'hello friend',
    })).resolves.toEqual({ status: 'duplicate' });

    db.documents.set(`directConversationMembers/target/items/${conversationId}`, { muted: true });
    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 1_100_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000002',
      text: 'muted',
    })).resolves.toEqual({ status: 'muted' });

    db.documents.delete(`directConversationMembers/target/items/${conversationId}`);
    db.documents.set('blocks/target/blocked/self', { targetUid: 'self' });
    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 1_100_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000003',
      text: 'blocked',
    })).resolves.toEqual({ status: 'blocked' });

    db.documents.delete('blocks/target/blocked/self');
    db.documents.set('notificationPreferences/target', {
      coupleRequests: true,
      directMessageRequests: true,
      directMessages: false,
      friendRequests: true,
      gifts: true,
      readReceipts: true,
      showMessagePreview: true,
      showOnlineStatus: true,
      walletTransfers: true,
    });
    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 1_100_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000004',
      text: 'disabled',
    })).resolves.toEqual({ status: 'preference-disabled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('hides request and preview-off content and coalesces rapid conversation pushes', async () => {
    const db = socialDb(true);
    const tokenId = createPushTokenId(token);
    db.documents.set(`pushDevices/target/tokens/${tokenId}`, { active: true, token });
    db.documents.set('notificationPreferences/target', {
      coupleRequests: true,
      directMessageRequests: true,
      directMessages: true,
      friendRequests: true,
      gifts: true,
      readReceipts: true,
      showMessagePreview: false,
      showOnlineStatus: true,
      walletTransfers: true,
    });
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ data: [{ id: 'ticket-dm-2', status: 'ok' }] }),
      ok: true,
      status: 200,
    }));

    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message-request',
      messageKind: 'text',
      nowMs: 2_000_000,
      recipientUid: 'target',
      requestId: 'dm_req_000000000001',
      text: 'please reply',
    })).resolves.toMatchObject({ status: 'submitted' });
    const requestPayload = JSON.parse(fetchImpl.mock.calls[0][1].body)[0];
    expect(requestPayload.title).toBe('طلب رسالة جديدة');
    expect(requestPayload.body).toBe('لديك طلب رسالة جديد');
    expect(requestPayload.body).not.toContain('please');
    expect(requestPayload.title).not.toContain('Self');

    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 2_010_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000010',
      text: 'secret body',
    })).resolves.toEqual({ status: 'coalesced' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(deliverDirectChatNotification({
      actorUid: 'self',
      conversationId,
      db,
      fieldValue,
      fetchImpl,
      kind: 'direct-message',
      messageKind: 'text',
      nowMs: 2_100_000,
      recipientUid: 'target',
      requestId: 'dm_push_000000000011',
      text: 'secret body',
    })).resolves.toMatchObject({ status: 'submitted' });
    const hiddenPayload = JSON.parse(fetchImpl.mock.calls[1][1].body)[0];
    expect(hiddenPayload).toMatchObject({ body: 'لديك رسالة جديدة', title: 'رسالة جديدة' });
    expect(hiddenPayload.body).not.toContain('secret');
    expect(hiddenPayload.title).not.toContain('Self');
  });

  it('processes Expo receipts and disables tokens rejected after submission', async () => {
    const db = socialDb(true);
    const tokenId = createPushTokenId(token);
    db.documents.set('socialCommandRequests/self/requests/receipt_event_1234', {
      notificationKind: 'gift-received', notificationRecipientUid: 'target', requestId: 'receipt_event_1234', uid: 'self',
    });
    db.documents.set(`pushDevices/target/tokens/${tokenId}`, { active: true, token });
    await deliverNotificationForCommand({
      db, fieldValue, requestId: 'receipt_event_1234', uid: 'self',
      fetchImpl: async () => ({ json: async () => ({ data: [{ id: 'ticket-1', status: 'ok' }] }), ok: true, status: 200 }),
    });
    await expect(processPendingNotificationReceipts({
      db, fieldValue,
      fetchImpl: async () => ({ json: async () => ({ data: { 'ticket-1': { details: { error: 'DeviceNotRegistered' }, status: 'error' } } }), ok: true, status: 200 }),
    })).resolves.toMatchObject({ checked: 1, invalidated: 1 });
    expect(db.documents.get(`pushDevices/target/tokens/${tokenId}`).active).toBe(false);
  });
});

function socialDb(enabled) {
  return new FakeFirestore({
    'appConfig/socialFeatures': { pushNotifications: enabled },
    'publicProfiles/self': publicProfile('self', 'Self', '1111111'),
    'publicProfiles/target': publicProfile('target', 'Target', '2222222'),
    'publicIds/1111111': { createdAt: timestamp(), uid: 'self' },
    'publicIds/2222222': { createdAt: timestamp(), uid: 'target' },
  });
}

function publicProfile(uid, displayName, publicId) {
  return {
    avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', coupleLevel: 0,
    createdAt: timestamp(), displayName, friendCount: 0, giftScore: 0, moderationStatus: 'active',
    normalizedName: displayName.toLowerCase(), publicId, uid, updatedAt: timestamp(),
  };
}
function timestamp() { return { toMillis: () => 1 }; }

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
  async getAll(...refs) { return refs.map((ref) => snapshot(ref, this.documents.get(ref.path))); }
  async runTransaction(callback) {
    const tx = new FakeTransaction(this);
    const result = await callback(tx);
    tx.commit();
    return result;
  }
  batch() {
    const operations = [];
    return {
      commit: async () => operations.forEach(({ ref, data }) => this.documents.set(ref.path, { ...this.documents.get(ref.path), ...data })),
      update: (ref, data) => operations.push({ ref, data }),
    };
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', ref, data }); }
  delete(ref) { this.operations.push({ kind: 'delete', ref }); }
  set(ref, data) { this.operations.push({ kind: 'set', ref, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', ref, data }); }
  commit() {
    this.operations.forEach(({ kind, ref, data }) => {
      if (kind === 'delete') { this.db.documents.delete(ref.path); return; }
      if (kind === 'create' && this.db.documents.has(ref.path)) throw new Error('exists');
      this.db.documents.set(ref.path, kind === 'update' ? { ...this.db.documents.get(ref.path), ...data } : data);
    });
  }
}

class FakeQuery {
  constructor(db, path, filters = [], limitValue = 100) { this.db = db; this.path = path; this.filters = filters; this.limitValue = limitValue; }
  where(field, operator, value) { return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.limitValue); }
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
