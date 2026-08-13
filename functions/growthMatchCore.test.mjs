import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  LUCKY_BAG_COIN_AMOUNT,
  buildMaskedMatchProjection,
  isQuickMatchEligibleRoom,
  normalizeQuickMatchInput,
  pickQuickMatchRoom,
  scoreQuickMatchRoom,
} = require('./growthMatchCore');

function room(overrides = {}) {
  return {
    availability: 'active',
    countryCode: 'IQ',
    hostDisplayName: 'Host',
    hostId: 'host-1',
    id: 'room-1',
    ownerUid: 'host-1',
    participantCount: 2,
    status: 'active',
    title: 'Majlis',
    visibility: 'public',
    ...overrides,
  };
}

describe('growthMatchCore', () => {
  it('rejects private, locked, full, and own rooms', () => {
    expect(isQuickMatchEligibleRoom(room({ visibility: 'private' }))).toBe(false);
    expect(isQuickMatchEligibleRoom(room({
      staffLockdown: { byUid: 'staff-1' },
    }))).toBe(false);
    expect(isQuickMatchEligibleRoom(room({ participantCount: 40 }))).toBe(false);
    expect(isQuickMatchEligibleRoom(room({ hostId: 'me' }), { uid: 'me' })).toBe(false);
    expect(isQuickMatchEligibleRoom(room())).toBe(true);
  });

  it('prefers fill-assist empty rooms and same country', () => {
    const emptyLocal = scoreQuickMatchRoom(room({ id: 'a', participantCount: 0, countryCode: 'IQ' }), {
      preferredCountryCode: 'IQ',
    });
    const busyForeign = scoreQuickMatchRoom(room({ id: 'b', participantCount: 20, countryCode: 'SA' }), {
      preferredCountryCode: 'IQ',
    });
    expect(emptyLocal).toBeGreaterThan(busyForeign);
  });

  it('picks from the top pool with deterministic random', () => {
    const selected = pickQuickMatchRoom([
      room({ id: 'quiet', participantCount: 0, countryCode: 'IQ' }),
      room({ id: 'busy', participantCount: 18, countryCode: 'SA' }),
      room({ id: 'private', visibility: 'private' }),
    ], { preferredCountryCode: 'IQ', random: () => 0 });
    expect(selected?.id).toBe('quiet');
  });

  it('normalizes preferred country and builds mask projections', () => {
    expect(normalizeQuickMatchInput({ preferredCountryCode: 'iq' })).toMatchObject({
      ok: true,
      value: { preferredCountryCode: 'IQ' },
    });
    expect(normalizeQuickMatchInput({ preferredCountryCode: 'ZZ' }).ok).toBe(false);
    expect(buildMaskedMatchProjection({
      enabled: true,
      nowMs: 1_000,
      roomId: 'room-1',
      uid: 'user-1',
    })).toMatchObject({
      labelAr: 'ضيف مقنع',
      roomId: 'room-1',
      uid: 'user-1',
    });
    expect(buildMaskedMatchProjection({
      enabled: false,
      roomId: 'room-1',
      uid: 'user-1',
    })).toBeNull();
    expect(LUCKY_BAG_COIN_AMOUNT).toBe(25);
  });
});
