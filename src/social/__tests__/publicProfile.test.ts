import { describe, expect, it } from 'vitest';

import {
  createSocialRequestId,
  mapPublicUserProfile,
  validatePublicProfilePresentation,
} from '../publicProfile';

const validProfile = {
  avatarModerationStatus: 'clear',
  avatarUrl: '',
  bio: 'مرحباً',
  countryCode: 'IQ',
  coupleLevel: 0,
  displayName: 'علي',
  friendCount: 4,
  giftScore: 9,
  moderationStatus: 'active',
  normalizedName: 'علي',
  publicId: '1234567',
  uid: 'u1',
};

describe('public profile mapping', () => {
  it('maps a supported complete public profile', () => {
    expect(mapPublicUserProfile({ ...validProfile, specialId: '0000777' }, 'u1')).toMatchObject({
      countryCode: 'IQ',
      displayName: 'علي',
      publicId: '1234567',
      specialId: '0000777',
      uid: 'u1',
    });
  });

  it('maps only the server-owned active representative projection', () => {
    expect(mapPublicUserProfile({
      ...validProfile,
      representativeBadge: { active: true, updatedAt: {} },
    }, 'u1')?.representativeBadgeActive).toBe(true);
    expect(mapPublicUserProfile({
      ...validProfile,
      representativeBadge: { active: false, updatedAt: {} },
    }, 'u1')?.representativeBadgeActive).toBe(false);
    expect(mapPublicUserProfile({
      ...validProfile,
      representativeBadgeActive: true,
    }, 'u1')?.representativeBadgeActive).toBe(false);
  });

  it('maps only bounded server-owned equipment cosmetic projections', () => {
    expect(mapPublicUserProfile({
      ...validProfile,
      equippedCosmetics: {
        chatBubble: { assetId: 'safe-bubble', assetVersionId: 'v1-123456789abc', itemId: 'safe-bubble-item' },
        cosmeticBadge: { assetId: 'bad', assetVersionId: 'latest', itemId: 'bad-item' },
      },
    }, 'u1')?.equippedCosmetics).toEqual({
      chatBubble: { assetId: 'safe-bubble', assetVersionId: 'v1-123456789abc', itemId: 'safe-bubble-item' },
    });
  });

  it('ignores malformed optional special IDs without invalidating the functional account ID', () => {
    expect(mapPublicUserProfile({ ...validProfile, specialId: '@ali' }, 'u1')).toMatchObject({
      publicId: '1234567',
    });
    expect(mapPublicUserProfile({ ...validProfile, specialId: '@ali' }, 'u1')?.specialId).toBeUndefined();
  });

  it('rejects mismatched users, malformed IDs, and unsupported countries', () => {
    expect(mapPublicUserProfile(validProfile, 'other')).toBeUndefined();
    expect(mapPublicUserProfile({ ...validProfile, publicId: '123' }, 'u1')).toBeUndefined();
    expect(mapPublicUserProfile({ ...validProfile, countryCode: 'US' }, 'u1')).toBeUndefined();
    expect(mapPublicUserProfile({ ...validProfile, normalizedName: 'different' }, 'u1')).toBeUndefined();
  });

  it('normalizes presentation edits and enforces bounds', () => {
    expect(validatePublicProfilePresentation({ bio: '  أهلاً  ', countryCode: 'LB' })).toEqual({
      ok: true,
      value: { bio: 'أهلاً', countryCode: 'LB' },
    });
    expect(validatePublicProfilePresentation({ bio: 'x'.repeat(161), countryCode: 'IQ' })).toMatchObject({
      ok: false,
    });
  });

  it('creates callable-safe request IDs', () => {
    expect(createSocialRequestId('profile', 1_000, 0.5)).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
  });
});
