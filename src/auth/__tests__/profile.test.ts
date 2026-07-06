import { describe, expect, it } from 'vitest';

import { createProfilePayload, isCompleteProfile, mapUserProfileDocument, validateProfileInput } from '../profile';

describe('profile model', () => {
  it('trims and accepts a valid profile input', () => {
    expect(validateProfileInput({ displayName: '  Salem  ', avatarLabel: ' س ' })).toEqual({
      ok: true,
      value: {
        avatarLabel: 'س',
        displayName: 'Salem',
      },
    });
  });

  it('rejects invalid display names and avatar labels', () => {
    expect(validateProfileInput({ displayName: 'A', avatarLabel: 'A' }).ok).toBe(false);
    expect(validateProfileInput({ displayName: 'Valid', avatarLabel: 'AB' }).ok).toBe(false);
  });

  it('detects complete profiles', () => {
    expect(
      isCompleteProfile({
        avatarLabel: 'S',
        displayName: 'Salem',
        email: 'salem@example.com',
        uid: 'uid-1',
      }),
    ).toBe(true);
    expect(isCompleteProfile(null)).toBe(false);
  });

  it('maps Firestore-like data into the profile payload', () => {
    expect(createProfilePayload('uid-1', 'salem@example.com', { displayName: ' Salem ', avatarLabel: 'S' })).toEqual({
      avatarLabel: 'S',
      displayName: 'Salem',
      email: 'salem@example.com',
      uid: 'uid-1',
    });
    expect(mapUserProfileDocument({ uid: 'uid-1', email: 'a@b.com', displayName: 'A B', avatarLabel: 'A' })).toEqual({
      avatarLabel: 'A',
      displayName: 'A B',
      email: 'a@b.com',
      uid: 'uid-1',
    });
  });
});
