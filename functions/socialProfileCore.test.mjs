import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildPublicProfileDocument,
  createDisabledFeatureFlags,
  createPublicIdCandidate,
  inspectPublicProfile,
  isAdminUserSearchReady,
  isValidPublicId,
  mergeSocialFeatureFlags,
  normalizeSearchName,
  resolveSocialCommandRequest,
  socialError,
  validatePrivateProfile,
} = require('./socialProfileCore');

describe('socialProfileCore', () => {
  it('allocates fixed-width public ID candidates', () => {
    expect(createPublicIdCandidate(() => 1000000)).toBe('1000000');
    expect(createPublicIdCandidate(() => 9999999)).toBe('9999999');
    expect(isValidPublicId('1234567')).toBe(true);
    expect(isValidPublicId('0123456')).toBe(false);
    expect(isValidPublicId('12345678')).toBe(false);
    expect(isValidPublicId('1234')).toBe(false);
  });

  it('normalizes Arabic search names and whitespace', () => {
    expect(normalizeSearchName('  مُـحَمَّد   علي  ')).toBe('محمد علي');
  });

  it('validates legacy private profile input', () => {
    expect(validatePrivateProfile({ uid: 'u1', email: 'a@b.c', displayName: ' Ali ', avatarLabel: 'A' }, 'u1')).toMatchObject({
      ok: true,
      value: { displayName: 'Ali' },
    });
    expect(validatePrivateProfile({ uid: 'wrong', email: 'a@b.c', displayName: 'Ali', avatarLabel: 'A' }, 'u1')).toEqual({
      ok: false,
      code: 'PROFILE_INCOMPLETE',
    });
    expect(validatePrivateProfile({ uid: 'u1', email: 'a@b.c', displayName: '\u0640\u0640', avatarLabel: 'A' }, 'u1')).toEqual({
      ok: false,
      code: 'PROFILE_INCOMPLETE',
    });
  });

  it('requires authenticated versioned commands and safe request IDs', () => {
    expect(resolveSocialCommandRequest({ auth: undefined, data: {} })).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: { action: 'bootstrap-profile', requestId: 'request_123456789', version: 1 },
    })).toEqual({
      ok: true,
      value: { action: 'bootstrap-profile', requestId: 'request_123456789', uid: 'u1', version: 1 },
    });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: { action: 'gift', requestId: 'request_123456789', version: 1 },
    })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: { action: 'representative-transfer', payload: { amount: 1, currency: 'coins', recipientPublicId: '2222222' }, requestId: 'request_123456789', version: 1 },
    })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: {
        action: 'search-users',
        payload: { query: 'Ali' },
        requestId: 'discovery_1234567',
        version: 1,
      },
    })).toMatchObject({
      ok: true,
      value: { action: 'search-users', payload: { query: 'Ali' }, uid: 'u1' },
    });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: {
        action: 'send-friend-request',
        payload: { targetUid: 'u2' },
        requestId: 'friend_123456789',
        version: 1,
      },
    })).toMatchObject({
      ok: true,
      value: { action: 'send-friend-request', payload: { targetUid: 'u2' }, uid: 'u1' },
    });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: {
        action: 'purchase-special-id',
        payload: { specialId: '0000777' },
        requestId: 'wallet_123456789',
        version: 1,
      },
    })).toMatchObject({
      ok: true,
      value: { action: 'purchase-special-id', payload: { specialId: '0000777' }, uid: 'u1' },
    });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: { action: 'purchase-store-item', payload: { currency: 'coins', itemId: 'gold-car' }, requestId: 'store_12345678901', version: 1 },
    })).toMatchObject({ ok: true, value: { action: 'purchase-store-item', uid: 'u1' } });
    expect(resolveSocialCommandRequest({
      auth: { uid: 'u1' },
      data: {
        action: 'send-gift',
        payload: { giftId: 'rose', targetUid: 'u2' },
        requestId: 'gift_12345678901',
        version: 1,
      },
    })).toMatchObject({ ok: true, value: { action: 'send-gift', uid: 'u1' } });
  });

  it('repairs malformed optional public data while preserving valid state', () => {
    const timestamp = { sentinel: true };
    expect(buildPublicProfileDocument({
      existing: {
        avatarUrl: ' https://example.com/a.jpg ',
        bio: ' hello ',
        countryCode: 'US',
        friendCount: -1,
        gender: 'unknown',
        giftScore: 9,
        moderationStatus: 'suspended',
      },
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp,
    })).toEqual({
      uid: 'u1',
      publicId: '1234567',
      displayName: 'Ali',
      normalizedName: 'ali',
      avatarUrl: 'https://example.com/a.jpg',
      countryCode: 'IQ',
      bio: 'hello',
      giftScore: 9,
      friendCount: 0,
      followerCount: 0,
      followingCount: 0,
      coupleLevel: 0,
      moderationStatus: 'suspended',
      avatarModerationStatus: 'clear',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it('replaces malformed creation timestamps instead of preserving truthy garbage', () => {
    const timestamp = { __serverTimestamp: true };
    const profile = buildPublicProfileDocument({
      existing: { createdAt: 'not-a-timestamp' },
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp,
    });

    expect(profile.createdAt).toBe(timestamp);
  });

  it('preserves only the valid server-owned representative badge projection', () => {
    const badgeUpdatedAt = { toMillis: () => 1 };
    const profile = buildPublicProfileDocument({
      existing: {
        representativeBadge: { active: true, updatedAt: badgeUpdatedAt },
      },
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp: { toMillis: () => 2 },
    });
    expect(profile.representativeBadge).toEqual({
      active: true,
      updatedAt: badgeUpdatedAt,
    });

    const malformed = buildPublicProfileDocument({
      existing: {
        representativeBadge: { active: true, updatedAt: 'client-value' },
      },
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp: { toMillis: () => 2 },
    });
    expect(malformed.representativeBadge).toBeUndefined();
  });

  it('preserves bounded equipped cosmetics during profile repair', () => {
    const profile = buildPublicProfileDocument({
      existing: {
        equippedAvatarFrame: { assetUrl: 'https://cdn.example/frame.png', itemId: 'frame-item' },
        equippedCosmetics: {
          avatarFrame: { assetId: 'frame-asset', assetVersionId: 'v1-123456789abc', itemId: 'frame-item' },
          seatEffect: { assetId: 'seat-asset', assetVersionId: 'v1-123456789abc', itemId: 'seat-item' },
          staffBadge: { assetId: 'fake-staff', assetVersionId: 'v1-123456789abc', itemId: 'fake-staff-item' },
        },
      },
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp: { toMillis: () => 2 },
    });
    expect(profile.equippedAvatarFrame).toEqual({ assetUrl: 'https://cdn.example/frame.png', itemId: 'frame-item' });
    expect(profile.equippedCosmetics).toEqual({
      avatarFrame: { assetId: 'frame-asset', assetVersionId: 'v1-123456789abc', itemId: 'frame-item' },
      seatEffect: { assetId: 'seat-asset', assetVersionId: 'v1-123456789abc', itemId: 'seat-item' },
    });
  });

  it('requires the complete public schema and an owned permanent reservation', () => {
    const timestamp = { __serverTimestamp: true };
    const profile = buildPublicProfileDocument({
      privateProfile: { uid: 'u1', displayName: 'Ali', email: 'a@b.c', avatarLabel: 'A' },
      publicId: '1234567',
      timestamp,
    });

    expect(inspectPublicProfile(profile, { createdAt: timestamp, uid: 'u1' }, 'u1')).toEqual({
      ok: true,
      reason: 'ready',
    });
    expect(inspectPublicProfile(profile, { createdAt: timestamp, uid: 'other' }, 'u1')).toMatchObject({
      ok: false,
      reason: 'invalid-reservation',
    });
    expect(inspectPublicProfile({ ...profile, countryCode: 'US' }, { createdAt: timestamp, uid: 'u1' }, 'u1'))
      .toMatchObject({ ok: false, reason: 'invalid-profile' });
    expect(inspectPublicProfile({ ...profile, specialId: '0000777' }, { createdAt: timestamp, uid: 'u1' }, 'u1'))
      .toMatchObject({ ok: true });
    expect(inspectPublicProfile({ ...profile, specialId: '@vip' }, { createdAt: timestamp, uid: 'u1' }, 'u1'))
      .toMatchObject({ ok: false, reason: 'invalid-profile' });
  });

  it('validates the private admin search projection', () => {
    const timestamp = { __serverTimestamp: true };
    const privateProfile = { uid: 'u1', displayName: 'Ali', email: 'A@B.C', avatarLabel: 'A' };
    expect(isAdminUserSearchReady({
      displayName: 'Ali',
      email: 'a@b.c',
      normalizedName: 'ali',
      uid: 'u1',
      updatedAt: timestamp,
    }, privateProfile)).toBe(true);
  });

  it('provides disabled defaults and stable Arabic-friendly errors', () => {
    expect(Object.values(createDisabledFeatureFlags()).every((value) => value === false)).toBe(true);
    expect(socialError('RATE_LIMITED')).toMatchObject({
      code: 'RATE_LIMITED',
      httpsCode: 'resource-exhausted',
    });
    expect(socialError('INSUFFICIENT_FUNDS')).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      httpsCode: 'failed-precondition',
    });
    expect(socialError('unknown')).toMatchObject({ code: 'INTERNAL', httpsCode: 'internal' });
  });

  it('merges partial feature flag changes without disabling existing flags', () => {
    expect(mergeSocialFeatureFlags(
      { friends: true, gifts: true },
      { friends: false },
    )).toMatchObject({
      friends: false,
      gifts: true,
      usersDiscovery: false,
    });
    expect(mergeSocialFeatureFlags({ wallet: true }, { representativeTransfers: true })).toMatchObject({
      representativeTransfers: true,
      wallet: true,
    });
  });
});
