'use strict';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ROOM_WATCH_CATALOG,
  listRoomWatchCatalog,
  resolveClaimWatchLease,
  resolveWatchAuthority,
  validateRoomWatchRequest,
  normalizeRoomWatchBody,
} = require('./roomWatchCore');

describe('roomWatchCore', () => {
  it('keeps catalog HTTPS-only and fail-closed without flag', () => {
    expect(Object.values(ROOM_WATCH_CATALOG).every((item) => item.playbackUri.startsWith('https://'))).toBe(true);
    expect(listRoomWatchCatalog({ growthFlags: { watchTogether: false } }).ok).toBe(false);
    expect(listRoomWatchCatalog({ growthFlags: { watchTogether: true } }).ok).toBe(true);
  });

  it('requires host/moderator/dj for claim', () => {
    const denied = resolveWatchAuthority({
      actorMembership: { status: 'active', authorityRole: 'member', privileges: {} },
      room: { ownerUid: 'owner' },
      senderUid: 'member',
    });
    expect(denied.ok).toBe(false);

    const allowed = resolveClaimWatchLease({
      actorMembership: { status: 'active', authorityRole: 'owner', privileges: {} },
      activeLease: undefined,
      command: { itemId: 'big-buck-bunny', roomId: 'room1' },
      growthFlags: { watchTogether: true },
      leaseId: 'rwl_testlease_abcdef',
      nowMs: 1_000,
      publicProfile: { displayName: 'Host' },
      room: { ownerUid: 'owner', status: 'active' },
      senderUid: 'owner',
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.value.lease.nowPlaying.itemId).toBe('big-buck-bunny');
  });

  it('validates protocol and unknown items', () => {
    expect(validateRoomWatchRequest(normalizeRoomWatchBody({
      action: 'claim-watch-lease',
      clientVersion: '1.0.0',
      itemId: 'nope',
      protocolVersion: 1,
      requestId: 'rwc_abcdefghijklmnop',
      roomId: 'room1',
    })).ok).toBe(false);
  });
});
