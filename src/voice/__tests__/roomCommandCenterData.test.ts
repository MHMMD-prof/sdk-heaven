import { describe, expect, it } from 'vitest';

import {
  mapModerationEvent,
  mapRoomBan,
  mapSeatInvite,
  mapSeatRequest,
} from '../roomCommandCenterData';

describe('roomCommandCenterData', () => {
  it('maps only pending seat requests and invitations with valid seat IDs', () => {
    expect(mapSeatRequest({
      createdAt: { seconds: 10 },
      requesterUid: 'member-1',
      requestedSeatId: '09',
      status: 'pending',
    })).toMatchObject({ createdAtMs: 10_000, requesterUid: 'member-1', requestedSeatId: '09' });
    expect(mapSeatRequest({ requesterUid: 'member-1', requestedSeatId: '21', status: 'pending' })).toBeNull();
    expect(mapSeatInvite({
      invitedByUid: 'owner-1',
      seatId: '20',
      status: 'pending',
      targetUid: 'member-1',
    })).toMatchObject({ invitedByUid: 'owner-1', seatId: '20', targetUid: 'member-1' });
    expect(mapSeatInvite({ invitedByUid: '', seatId: '01', status: 'pending', targetUid: 'member-1' })).toBeNull();
  });

  it('normalizes bounded moderation and active-ban records', () => {
    expect(mapModerationEvent('event-1', {
      action: 'ban-member',
      actorAuthority: 'owner',
      actorUid: 'owner-1',
      createdAt: { nanoseconds: 500_000_000, seconds: 10 },
      reason: 'spam',
      status: 'applied',
      targetUid: 'member-1',
    })).toMatchObject({ action: 'ban-member', createdAtMs: 10_500, id: 'event-1' });
    expect(mapRoomBan('member-1', {
      actorUid: 'owner-1',
      reason: 'spam',
      status: 'active',
    })).toMatchObject({ status: 'active', targetUid: 'member-1' });
    expect(mapRoomBan('member-1', { status: 'revoked' })).toBeNull();
  });
});
