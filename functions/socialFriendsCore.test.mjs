import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createFriendshipId,
  normalizeFriendTargetInput,
  otherMemberUid,
  resolveFriendRelationship,
} = require('./socialFriendsCore');

describe('socialFriendsCore', () => {
  it('creates one stable relationship ID regardless of member order', () => {
    expect(createFriendshipId('uid-b', 'uid-a')).toBe(createFriendshipId('uid-a', 'uid-b'));
    expect(createFriendshipId('uid-a', 'uid-b')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires one safe target different from the requester', () => {
    expect(normalizeFriendTargetInput({ targetUid: ' target ' }, 'self')).toEqual({
      ok: true,
      value: { targetUid: 'target' },
    });
    expect(normalizeFriendTargetInput({ targetUid: 'self' }, 'self')).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(normalizeFriendTargetInput({ targetUid: 'target', extra: true }, 'self')).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('maps pair state from the requesting user perspective', () => {
    expect(resolveFriendRelationship({
      friendship: { memberUids: ['self', 'target'] },
      request: undefined,
      requestingUid: 'self',
    })).toBe('friends');
    expect(resolveFriendRelationship({
      friendship: undefined,
      request: { recipientUid: 'target', senderUid: 'self', status: 'pending' },
      requestingUid: 'self',
    })).toBe('outgoing');
    expect(resolveFriendRelationship({
      friendship: undefined,
      request: { recipientUid: 'self', senderUid: 'target', status: 'pending' },
      requestingUid: 'self',
    })).toBe('incoming');
  });

  it('finds the other member without depending on array order', () => {
    expect(otherMemberUid(['self', 'target'], 'self')).toBe('target');
    expect(otherMemberUid(['target', 'self'], 'self')).toBe('target');
  });
});
