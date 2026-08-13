import { describe, expect, it } from 'vitest';

import {
  gateSharedCoupleEffect,
  readCoupleEffectProjection,
  resolveCoupleEffectSurface,
} from '../coupleEffects';

const projection = {
  assetId: 'couple-hearts',
  assetVersionId: 'v1-123456789abc',
  borderMode: 'looping',
  coupleIdHash: 'a'.repeat(64),
  entranceMode: 'one-shot',
  fallbackAssetId: 'couple-hearts-static',
  fallbackAssetVersionId: 'v1-abcdef123456',
  format: 'lottie-json',
  itemId: 'couple-hearts-item',
  profileMode: 'looping',
} as const;

describe('couple effect projections', () => {
  it('accepts only the exact public projection keys and expected relationship hash', () => {
    expect(readCoupleEffectProjection(projection, projection.coupleIdHash)).toEqual(projection);
    expect(readCoupleEffectProjection({ ...projection, partnerUid: 'private' })).toBeUndefined();
    expect(readCoupleEffectProjection(projection, 'b'.repeat(64))).toBeUndefined();
    const { entranceMode: _missing, ...missing } = projection;
    expect(readCoupleEffectProjection(missing)).toBeUndefined();
  });

  it('gates pair presentation on identical hashes and canonical projections', () => {
    expect(gateSharedCoupleEffect(projection, { ...projection })).toEqual(projection);
    expect(gateSharedCoupleEffect(projection, {
      ...projection,
      coupleIdHash: 'b'.repeat(64),
    })).toBeUndefined();
    expect(gateSharedCoupleEffect(projection, {
      ...projection,
      assetId: 'different-effect',
    })).toBeUndefined();
  });

  it('keeps individual cosmetics as fallback when unavailable, off, or reduced', () => {
    expect(resolveCoupleEffectSurface({
      enabled: false,
      projection,
      reducedMotion: false,
      surface: 'profile',
    })).toEqual({
      preserveIndividualCosmetics: true,
      renderCoupleEffect: false,
      viewerMode: 'off',
    });
    expect(resolveCoupleEffectSurface({
      enabled: true,
      projection,
      reducedMotion: true,
      surface: 'border',
    })).toEqual({
      preserveIndividualCosmetics: true,
      renderCoupleEffect: true,
      viewerMode: 'reduced',
    });
    expect(resolveCoupleEffectSurface({
      enabled: true,
      projection: { ...projection, profileMode: 'off' },
      reducedMotion: false,
      surface: 'profile',
    }).preserveIndividualCosmetics).toBe(true);
  });
});
