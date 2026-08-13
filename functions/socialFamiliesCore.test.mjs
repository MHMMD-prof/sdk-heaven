'use strict';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  FAMILY_MEMBER_CAP,
  canKickTarget,
  createFamilyInviteId,
  mapFamilyBadge,
  normalizeCreateFamilyInput,
  normalizeJoinFamilyInput,
} = require('./socialFamiliesCore');

describe('socialFamiliesCore', () => {
  it('normalizes create input and rejects short names', () => {
    expect(normalizeCreateFamilyInput({ nameAr: 'أ' }).ok).toBe(false);
    expect(normalizeCreateFamilyInput({ nameAr: 'عائلة النور', badgeColor: '#AABBCC' })).toEqual({
      ok: true,
      value: {
        badgeColor: '#AABBCC',
        homeRoomId: '',
        nameAr: 'عائلة النور',
      },
    });
  });

  it('accepts only hex invite codes', () => {
    expect(normalizeJoinFamilyInput({ inviteCode: 'abc123' }).value.inviteCode).toBe('ABC123');
    expect(normalizeJoinFamilyInput({ inviteCode: 'nope' }).ok).toBe(false);
  });

  it('maps family badges and kick permissions', () => {
    expect(mapFamilyBadge({
      badgeColor: '#112233',
      familyId: 'fam1',
      nameAr: 'عائلة',
      role: 'owner',
    })).toMatchObject({ familyId: 'fam1', role: 'owner' });
    expect(canKickTarget('owner', 'elder')).toBe(true);
    expect(canKickTarget('elder', 'elder')).toBe(false);
    expect(canKickTarget('elder', 'owner')).toBe(false);
    expect(createFamilyInviteId('fam', 'uid')).toBe('fam_uid');
    expect(FAMILY_MEMBER_CAP).toBe(30);
  });
});
