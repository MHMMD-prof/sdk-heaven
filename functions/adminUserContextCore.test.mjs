import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { mapUserGiftEvent, mapUserOwnership, mapUserRelationship, mapUserRoomModeration, mapUserTransferReceipt, sortRecent, summarizeUserReports } = require('./adminUserContextCore');
const timestamp = (iso) => ({ toDate: () => new Date(iso) });

describe('adminUserContextCore', () => {
  it('maps relationships without exposing the subject as the peer', () => {
    expect(mapUserRelationship('pair', { createdAt: timestamp('2026-07-20T10:00:00Z'), memberUids: ['user-1', 'user-2'], updatedAt: timestamp('2026-07-21T10:00:00Z') }, 'user-1', 'friend')).toMatchObject({ kind: 'friend', peerUid: 'user-2', status: 'active' });
    expect(mapUserRelationship('request', { recipientUid: 'user-1', senderUid: 'user-2', status: 'pending' }, 'user-1', 'friend-request-incoming')).toMatchObject({ peerUid: 'user-2' });
    expect(mapUserRelationship('peer-2', { createdAt: timestamp('2026-07-20T10:00:00Z'), targetUid: 'peer-2' }, 'user-1', 'following')).toMatchObject({ kind: 'following', peerUid: 'peer-2', status: 'active' });
    expect(mapUserRelationship('peer-3', { createdAt: timestamp('2026-07-20T10:00:00Z'), followerUid: 'peer-3' }, 'user-1', 'follower')).toMatchObject({ kind: 'follower', peerUid: 'peer-3', status: 'active' });
    expect(mapUserRelationship('broken', { memberUids: ['user-1'] }, 'user-1', 'friend')).toBeNull();
  });

  it('maps social and Store gifts in both directions', () => {
    const gift = { createdAt: timestamp('2026-07-21T10:00:00Z'), giftId: 'crown', nameAr: 'تاج', price: 25, recipientUid: 'user-2', senderUid: 'user-1' };
    expect(mapUserGiftEvent('gift-1', gift, 'user-1', 'social')).toMatchObject({ amount: 25, direction: 'sent', peerUid: 'user-2' });
    expect(mapUserGiftEvent('gift-1', gift, 'user-2', 'social')).toMatchObject({ direction: 'received', peerUid: 'user-1' });
  });

  it('maps ownership, transfer, and room moderation context', () => {
    expect(mapUserOwnership('car', { acquiredAt: timestamp('2026-07-20T10:00:00Z'), category: 'cars', equipped: true, itemId: 'car', kind: 'store-ownership', state: 'active' }, { name: { ar: 'السيارة الملكية' }, thumbnailUrl: 'https://example.test/car.webp' }, 'gift')).toMatchObject({ acquisitionSource: 'gift', equipped: true, nameAr: 'السيارة الملكية' });
    expect(mapUserTransferReceipt('transfer-1', { amount: 50, createdAt: timestamp('2026-07-21T10:00:00Z'), currency: 'coins', recipientPublicId: '1001', recipientUid: 'user-2', status: 'completed' }, 'sent')).toMatchObject({ amount: 50, direction: 'sent', peerUid: 'user-2' });
    expect(mapUserRoomModeration('event-1', { action: 'mute-member', roomId: 'room-1', targetUid: 'user-1' })).toMatchObject({ action: 'mute-member', roomId: 'room-1' });
  });

  it('summarizes safety reports and bounds recent rows', () => {
    const reports = [
      { id: 'open', severity: 'critical', status: 'open', updatedAt: '2026-07-21T10:00:00Z' },
      { id: 'resolved', resolvedAt: '2026-07-15T10:00:00Z', severity: 'low', status: 'resolved', updatedAt: '2026-07-15T10:00:00Z' },
    ];
    expect(summarizeUserReports(reports, Date.parse('2026-07-21T12:00:00Z'))).toEqual({ open: 1, recentResolved: 1, total: 2, urgent: 1 });
    expect(sortRecent(reports, 1).map((item) => item.id)).toEqual(['open']);
    expect(sortRecent([{ id: 'old', acquiredAt: '2026-07-01T10:00:00Z' }, { id: 'new', acquiredAt: '2026-07-20T10:00:00Z' }], 1).map((item) => item.id)).toEqual(['new']);
  });
});
