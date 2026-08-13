import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeFollowListInput,
  normalizeFollowTargetInput,
  readFollowCount,
  resolveFollowRelationship,
} = require('./socialFollowCore');

describe('socialFollowCore', () => {
  it('requires one safe target different from the requester', () => {
    expect(normalizeFollowTargetInput({ targetUid: ' target ' }, 'self')).toEqual({
      ok: true,
      value: { targetUid: 'target' },
    });
    expect(normalizeFollowTargetInput({ targetUid: 'self' }, 'self')).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(normalizeFollowTargetInput({ targetUid: 'a/b' }, 'self')).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('defaults follow list subject to the requester', () => {
    expect(normalizeFollowListInput(undefined, 'self')).toEqual({
      ok: true,
      value: { targetUid: 'self' },
    });
    expect(normalizeFollowListInput({ targetUid: 'peer' }, 'self')).toEqual({
      ok: true,
      value: { targetUid: 'peer' },
    });
  });

  it('maps follow edge state from the requesting user perspective', () => {
    expect(resolveFollowRelationship({ followedByEdge: true, followingEdge: true })).toEqual({
      followedBy: true,
      status: 'following',
    });
    expect(resolveFollowRelationship({ followedByEdge: false, followingEdge: false })).toEqual({
      followedBy: false,
      status: 'none',
    });
  });

  it('reads missing follow counts as zero', () => {
    expect(readFollowCount(undefined)).toBe(0);
    expect(readFollowCount(-1)).toBe(0);
    expect(readFollowCount(3)).toBe(3);
  });
});
