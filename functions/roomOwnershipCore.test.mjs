import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COOLDOWN_MS,
  OFFER_TTL_MS,
  createOwnershipTransferId,
  normalizeRoomOwnershipBody,
  resolveOwnershipOffer,
  resolveOwnershipResponse,
  validateRoomOwnershipRequest,
} = require('./roomOwnershipCore');

const nowMs = 2_000_000_000_000;
const actorProfile = {
  avatarLabel: 'O',
  countryCode: 'IQ',
  displayName: 'Owner',
  moderationStatus: 'active',
  uid: 'owner-1',
};
const targetProfile = {
  avatarLabel: 'T',
  countryCode: 'IQ',
  displayName: 'Target',
  moderationStatus: 'active',
  uid: 'target-1',
};
const actorPrivateProfile = {
  avatarLabel: 'O',
  displayName: 'Owner',
  email: 'owner@example.test',
  uid: 'owner-1',
};
const targetPrivateProfile = {
  avatarLabel: 'T',
  displayName: 'Target',
  email: 'target@example.test',
  uid: 'target-1',
};
const room = {
  availability: 'active',
  hostId: 'owner-1',
  moderatorCount: 1,
  ownerUid: 'owner-1',
  ownershipRevision: 3,
  revision: 8,
  schemaVersion: 2,
  status: 'active',
};
const offerCommand = normalizeRoomOwnershipBody({
  action: 'offer-ownership-transfer',
  expectedOwnershipRevision: 3,
  requestId: 'ownership_request_0001',
  roomId: 'room-1',
  targetUid: 'target-1',
});

describe('roomOwnershipCore', () => {
  it('validates bounded offer and response commands', () => {
    expect(validateRoomOwnershipRequest(offerCommand).ok).toBe(true);
    expect(validateRoomOwnershipRequest(normalizeRoomOwnershipBody({
      action: 'accept-ownership-transfer',
      requestId: 'ownership_accept_0001',
      roomId: 'room-1',
      transferId: createOwnershipTransferId('ownership_request_0001'),
    })).ok).toBe(true);
    expect(validateRoomOwnershipRequest(normalizeRoomOwnershipBody({
      action: 'offer-ownership-transfer',
      requestId: 'short',
      roomId: 'room-1',
      targetUid: 'target-1',
    })).code).toBe('INVALID_REQUEST');
  });

  it('requires feature enablement, fresh auth, eligible active target, and matching revision', () => {
    const base = {
      actorMembership: { authorityRole: 'owner', status: 'active', uid: 'owner-1' },
      actorPrivateProfile,
      actorPublicProfile: actorProfile,
      blocksExist: false,
      command: offerCommand,
      decodedToken: { auth_time: Math.floor((nowMs - 60_000) / 1000), uid: 'owner-1' },
      featureFlags: { voice_room_ownership_transfer: true },
      nowMs,
      room,
      targetMembership: { authorityRole: 'member', status: 'active', uid: 'target-1' },
      targetPrivateProfile,
      targetPublicProfile: targetProfile,
    };
    expect(resolveOwnershipOffer(base)).toMatchObject({
      ok: true,
      value: { expiresAtMs: nowMs + OFFER_TTL_MS, fromOwnershipRevision: 3 },
    });
    expect(resolveOwnershipOffer({ ...base, featureFlags: {} }).code).toBe('FEATURE_DISABLED');
    expect(resolveOwnershipOffer({
      ...base,
      decodedToken: { auth_time: Math.floor((nowMs - 11 * 60_000) / 1000), uid: 'owner-1' },
    }).code).toBe('RECENT_AUTH_REQUIRED');
    expect(resolveOwnershipOffer({
      ...base,
      command: { ...offerCommand, expectedOwnershipRevision: 2 },
    }).code).toBe('OWNERSHIP_REVISION_CONFLICT');
    expect(resolveOwnershipOffer({ ...base, blocksExist: true }).code).toBe('BLOCK_RESTRICTION');
  });

  it('accepts only a fresh recipient against the exact pending transfer', () => {
    const transferId = createOwnershipTransferId('ownership_request_0001');
    const transfer = {
      expiresAt: nowMs + 60_000,
      fromOwnershipRevision: 3,
      fromUid: 'owner-1',
      id: transferId,
      roomId: 'room-1',
      status: 'pending',
      toUid: 'target-1',
    };
    const command = normalizeRoomOwnershipBody({
      action: 'accept-ownership-transfer',
      requestId: 'ownership_accept_0001',
      roomId: 'room-1',
      transferId,
    });
    const result = resolveOwnershipResponse({
      actorMembership: { authorityRole: 'member', status: 'active', uid: 'target-1' },
      actorPrivateProfile: targetPrivateProfile,
      actorPublicProfile: targetProfile,
      blocksExist: false,
      command,
      currentOwnerMembership: { authorityRole: 'owner', status: 'active', uid: 'owner-1' },
      currentOwnerPublicProfile: actorProfile,
      decodedToken: { auth_time: Math.floor((nowMs - 30_000) / 1000), uid: 'target-1' },
      featureFlags: { voice_room_ownership_transfer: true },
      nowMs,
      room: { ...room, pendingOwnershipTransferId: transferId },
      transfer,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        cooldownUntilMs: nowMs + COOLDOWN_MS,
        disposition: 'accepted',
        nextOwnershipRevision: 4,
        nextRevision: 9,
      },
    });
  });

  it('rejects expired, replayed, stale, and unauthorized responses', () => {
    const transferId = createOwnershipTransferId('ownership_request_0001');
    const base = {
      actorMembership: { authorityRole: 'member', status: 'active', uid: 'target-1' },
      actorPrivateProfile: targetPrivateProfile,
      actorPublicProfile: targetProfile,
      blocksExist: false,
      command: normalizeRoomOwnershipBody({
        action: 'accept-ownership-transfer',
        requestId: 'ownership_accept_0002',
        roomId: 'room-1',
        transferId,
      }),
      currentOwnerMembership: { authorityRole: 'owner', status: 'active', uid: 'owner-1' },
      currentOwnerPublicProfile: actorProfile,
      decodedToken: { auth_time: Math.floor(nowMs / 1000), uid: 'target-1' },
      featureFlags: { voice_room_ownership_transfer: true },
      nowMs,
      room: { ...room, pendingOwnershipTransferId: transferId },
      transfer: {
        expiresAt: nowMs + 60_000,
        fromOwnershipRevision: 3,
        fromUid: 'owner-1',
        id: transferId,
        roomId: 'room-1',
        status: 'pending',
        toUid: 'target-1',
      },
    };
    expect(resolveOwnershipResponse({
      ...base,
      transfer: { ...base.transfer, expiresAt: nowMs - 1 },
    }).code).toBe('TRANSFER_EXPIRED');
    expect(resolveOwnershipResponse({
      ...base,
      transfer: { ...base.transfer, status: 'accepted' },
    }).code).toBe('TRANSFER_NOT_PENDING');
    expect(resolveOwnershipResponse({
      ...base,
      room: { ...base.room, ownershipRevision: 4 },
    }).code).toBe('TRANSFER_STALE');
    expect(resolveOwnershipResponse({
      ...base,
      actorPrivateProfile: { ...targetPrivateProfile, uid: 'other-1' },
      actorPublicProfile: { ...targetProfile, uid: 'other-1' },
      decodedToken: { ...base.decodedToken, uid: 'other-1' },
    }).code).toBe('RECIPIENT_REQUIRED');
  });
});
