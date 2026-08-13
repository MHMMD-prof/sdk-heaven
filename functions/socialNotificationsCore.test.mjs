import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildArabicNotification,
  buildDirectChatNotificationContent,
  buildRepresentativeReversalNotificationCommands,
  createDefaultNotificationPreferences,
  createDirectChatCoalesceId,
  createNotificationDeliveryId,
  createPushTokenId,
  mapNotificationPreferences,
  normalizeNotificationPreferencesInput,
  normalizePushDeviceInput,
  normalizeUnregisterPushDeviceInput,
  notificationCategoryForKind,
  shouldCoalesceDirectChatNotification,
} = require('./socialNotificationsCore');

describe('socialNotificationsCore', () => {
  const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]';

  it('normalizes supported Expo device tokens without exposing them as document ids', () => {
    expect(normalizePushDeviceInput({ deviceName: ' Phone ', platform: 'android', token })).toEqual({
      ok: true,
      value: { deviceName: 'Phone', platform: 'android', token, tokenId: createPushTokenId(token) },
    });
    expect(createPushTokenId(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(createPushTokenId(token)).not.toContain('ExponentPushToken');
    expect(normalizePushDeviceInput({ platform: 'web', token }).ok).toBe(false);
    expect(normalizeUnregisterPushDeviceInput({ token, extra: true }).ok).toBe(false);
  });

  it('accepts legacy preference payloads and fills chat defaults', () => {
    const legacy = { coupleRequests: true, friendRequests: false, gifts: true };
    expect(normalizeNotificationPreferencesInput(legacy)).toEqual({
      ok: true,
      value: {
        ...createDefaultNotificationPreferences(),
        friendRequests: false,
      },
    });
    expect(normalizeNotificationPreferencesInput({
      coupleRequests: true,
      friendRequests: true,
      gifts: false,
      walletTransfers: false,
    })).toEqual({
      ok: true,
      value: {
        ...createDefaultNotificationPreferences(),
        gifts: false,
        walletTransfers: false,
      },
    });
    const full = createDefaultNotificationPreferences();
    full.directMessages = false;
    full.showMessagePreview = false;
    expect(normalizeNotificationPreferencesInput(full)).toEqual({ ok: true, value: full });
    expect(normalizeNotificationPreferencesInput({ gifts: true }).ok).toBe(false);
    expect(mapNotificationPreferences({ gifts: false })).toEqual({
      ...createDefaultNotificationPreferences(),
      gifts: false,
    });
  });

  it('maps social and direct-chat events to categories and destinations', () => {
    expect(notificationCategoryForKind('friend-request')).toBe('friendRequests');
    expect(notificationCategoryForKind('new-follower')).toBe('follows');
    expect(notificationCategoryForKind('gift-received')).toBe('gifts');
    expect(buildArabicNotification('new-follower', 'سارة', 'actor-1')).toMatchObject({
      kind: 'new-follower',
      route: 'UserProfile',
      title: 'متابع جديد',
    });
    expect(notificationCategoryForKind('store-gift-received')).toBe('gifts');
    expect(notificationCategoryForKind('representative-transfer-received')).toBe('walletTransfers');
    expect(notificationCategoryForKind('direct-message')).toBe('directMessages');
    expect(notificationCategoryForKind('direct-message-request')).toBe('directMessageRequests');
    expect(buildArabicNotification('representative-transfer-sent', 'وكيل', 'actor-1')).toMatchObject({ route: 'RepresentativeTransfer' });
    expect(buildArabicNotification('couple-request', 'سارة', 'actor-1')).toMatchObject({
      actorUid: 'actor-1',
      kind: 'couple-request',
      route: 'UserProfile',
      title: 'طلب ارتباط جديد',
    });
    expect(buildArabicNotification('unknown', 'سارة', 'actor-1')).toBeUndefined();
  });

  it('builds direct-chat previews that never leak request content', () => {
    expect(buildDirectChatNotificationContent({
      actorDisplayName: 'سارة',
      actorUid: 'actor-1',
      kind: 'direct-message-request',
      messageKind: 'text',
      showMessagePreview: true,
      text: 'secret request body',
    })).toEqual({
      actorUid: 'actor-1',
      body: 'لديك طلب رسالة جديد',
      kind: 'direct-message-request',
      route: 'DirectChat',
      title: 'طلب رسالة جديدة',
    });
    expect(buildDirectChatNotificationContent({
      actorDisplayName: 'سارة',
      actorUid: 'actor-1',
      kind: 'direct-message',
      messageKind: 'text',
      showMessagePreview: false,
      text: 'hello there',
    })).toEqual({
      actorUid: 'actor-1',
      body: 'لديك رسالة جديدة',
      kind: 'direct-message',
      route: 'DirectChat',
      title: 'رسالة جديدة',
    });
    expect(buildDirectChatNotificationContent({
      actorDisplayName: 'سارة',
      actorUid: 'actor-1',
      kind: 'direct-message',
      messageKind: 'text',
      showMessagePreview: true,
      text: 'hello there',
    })).toMatchObject({ body: 'hello there', route: 'DirectChat', title: 'سارة' });
    expect(buildDirectChatNotificationContent({
      actorDisplayName: 'سارة',
      actorUid: 'actor-1',
      kind: 'direct-message',
      messageKind: 'image',
      showMessagePreview: true,
      text: '',
    })).toMatchObject({ body: 'صورة', title: 'سارة' });
  });

  it('coalesces only within the short conversation window', () => {
    const nowMs = 1_000_000;
    expect(shouldCoalesceDirectChatNotification({ lastSentAtMs: nowMs - 1_000, nowMs })).toBe(true);
    expect(shouldCoalesceDirectChatNotification({ lastSentAtMs: nowMs - 31_000, nowMs })).toBe(false);
    expect(createDirectChatCoalesceId('user-2', 'conversation-1')).toMatch(/^[a-f0-9]{64}$/);
    expect(createDirectChatCoalesceId('user-2', 'conversation-1'))
      .not.toBe(createDirectChatCoalesceId('user-2', 'conversation-2'));
  });

  it('coalesces a notification flood inside one conversation window', () => {
    const windowStart = 5_000_000;
    for (let index = 1; index <= 20; index += 1) {
      expect(shouldCoalesceDirectChatNotification({
        lastSentAtMs: windowStart,
        nowMs: windowStart + (index * 500),
      })).toBe(true);
    }
    expect(shouldCoalesceDirectChatNotification({
      lastSentAtMs: windowStart,
      nowMs: windowStart + 31_000,
    })).toBe(false);
  });

  it('creates idempotent delivery ids per command request', () => {
    expect(createNotificationDeliveryId('uid', 'request-1')).toBe(createNotificationDeliveryId('uid', 'request-1'));
    expect(createNotificationDeliveryId('uid', 'request-1')).not.toBe(createNotificationDeliveryId('uid', 'request-2'));
  });

  it('builds exactly one reversal notification for each affected user', () => {
    expect(buildRepresentativeReversalNotificationCommands({
      recipientUid: 'recipient',
      representativeUid: 'representative',
    }, 'reversal_request_1')).toEqual([
      {
        actorUid: 'representative',
        kind: 'representative-reversal-recipient',
        recipientUid: 'recipient',
        requestId: 'representative_reversal_recipient_reversal_request_1',
      },
      {
        actorUid: 'recipient',
        kind: 'representative-reversal-representative',
        recipientUid: 'representative',
        requestId: 'representative_reversal_representative_reversal_request_1',
      },
    ]);
  });
});
