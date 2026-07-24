import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildArabicNotification,
  buildRepresentativeReversalNotificationCommands,
  createNotificationDeliveryId,
  createPushTokenId,
  mapNotificationPreferences,
  normalizeNotificationPreferencesInput,
  normalizePushDeviceInput,
  normalizeUnregisterPushDeviceInput,
  notificationCategoryForKind,
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

  it('requires a complete boolean preference payload', () => {
    const preferences = { coupleRequests: true, friendRequests: false, gifts: true, walletTransfers: false };
    expect(normalizeNotificationPreferencesInput(preferences)).toEqual({ ok: true, value: preferences });
    expect(normalizeNotificationPreferencesInput({ coupleRequests: true, friendRequests: true, gifts: false })).toEqual({ ok: true, value: { coupleRequests: true, friendRequests: true, gifts: false, walletTransfers: true } });
    expect(normalizeNotificationPreferencesInput({ gifts: true }).ok).toBe(false);
    expect(mapNotificationPreferences({ gifts: false })).toEqual({ coupleRequests: true, friendRequests: true, gifts: false, walletTransfers: true });
  });

  it('maps social events to Arabic-safe categories and destinations', () => {
    expect(notificationCategoryForKind('friend-request')).toBe('friendRequests');
    expect(notificationCategoryForKind('gift-received')).toBe('gifts');
    expect(notificationCategoryForKind('store-gift-received')).toBe('gifts');
    expect(notificationCategoryForKind('representative-transfer-received')).toBe('walletTransfers');
    expect(buildArabicNotification('representative-transfer-sent', 'وكيل', 'actor-1')).toMatchObject({ route: 'RepresentativeTransfer' });
    expect(notificationCategoryForKind('representative-reversal-recipient')).toBe('walletTransfers');
    expect(buildArabicNotification('representative-reversal-representative', 'مستلم', 'actor-2')).toMatchObject({
      route: 'RepresentativeTransfer',
    });
    expect(buildArabicNotification('store-gift-sent', 'سارة', 'actor-1')).toMatchObject({ route: 'Store' });
    expect(buildArabicNotification('couple-request', 'سارة', 'actor-1')).toMatchObject({
      actorUid: 'actor-1',
      kind: 'couple-request',
      route: 'UserProfile',
      title: 'طلب ارتباط جديد',
    });
    expect(buildArabicNotification('unknown', 'سارة', 'actor-1')).toBeUndefined();
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
