import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  filterVisibleDiscoveryProfiles,
  mapDiscoveryProfile,
  normalizeUserDiscoveryInput,
} = require('./socialDiscoveryCore');

describe('socialDiscoveryCore', () => {
  it('normalizes Arabic name, numeric ID, and featured discovery modes', () => {
    expect(normalizeUserDiscoveryInput({ query: '  مُـحَمَّد  ' })).toMatchObject({
      ok: true,
      value: { mode: 'name', normalizedQuery: 'محمد' },
    });
    expect(normalizeUserDiscoveryInput({ query: '1234567' })).toMatchObject({
      ok: true,
      value: { mode: 'public-id' },
    });
    expect(normalizeUserDiscoveryInput({})).toMatchObject({
      ok: true,
      value: { mode: 'featured', limit: 12 },
    });
  });

  it('rejects too-short searches and unsupported countries', () => {
    expect(normalizeUserDiscoveryInput({ query: 'ع' })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(normalizeUserDiscoveryInput({ countryCode: 'US' })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(normalizeUserDiscoveryInput({ limit: 21 })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(normalizeUserDiscoveryInput({ query: 'x'.repeat(65) })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(normalizeUserDiscoveryInput({ unexpected: true })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('removes self, blocked users, and nonmatching countries', () => {
    const profiles = [
      { uid: 'self', countryCode: 'IQ' },
      { uid: 'blocked', countryCode: 'IQ' },
      { uid: 'visible', countryCode: 'IQ' },
      { uid: 'other-country', countryCode: 'LB' },
    ];
    expect(filterVisibleDiscoveryProfiles({
      blockedUids: new Set(['blocked']),
      countryCode: 'IQ',
      profiles,
      requestingUid: 'self',
    })).toEqual([{ uid: 'visible', countryCode: 'IQ' }]);
  });

  it('removes moderated avatar URLs from callable responses', () => {
    expect(mapDiscoveryProfile({
      avatarModerationStatus: 'removed',
      avatarUrl: 'https://example.com/removed.jpg',
      bio: '',
      countryCode: 'IQ',
      displayName: 'Ali',
      moderationStatus: 'active',
      normalizedName: 'ali',
      publicId: '1234567',
      uid: 'u1',
    })).toMatchObject({ avatarUrl: '', uid: 'u1' });
  });

  it('maps only the server-owned representative badge projection', () => {
    expect(mapDiscoveryProfile({
      avatarModerationStatus: 'clear',
      bio: '',
      countryCode: 'IQ',
      displayName: 'Ali',
      moderationStatus: 'active',
      normalizedName: 'ali',
      publicId: '1234567',
      representativeBadge: { active: true },
      uid: 'u1',
    })).toMatchObject({ representativeBadgeActive: true });

    expect(mapDiscoveryProfile({
      avatarModerationStatus: 'clear',
      bio: '',
      countryCode: 'IQ',
      displayName: 'Ali',
      moderationStatus: 'active',
      normalizedName: 'ali',
      publicId: '1234567',
      representativeBadgeActive: true,
      uid: 'u1',
    })).toMatchObject({ representativeBadgeActive: false });
  });
});
