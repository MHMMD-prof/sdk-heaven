import { describe, expect, it } from 'vitest';

import { disabledStatusFeatureFlags, mapStatusFeatureFlags } from '../featureFlags';

describe('Wave 4 status feature flags', () => {
  it('fails closed without the versioned config', () => {
    expect(mapStatusFeatureFlags({ statusPresentation: true })).toBe(disabledStatusFeatureFlags);
  });

  it('keeps Me cards independently controllable from authority and each other', () => {
    expect(mapStatusFeatureFlags({
      schemaVersion: 1,
      statusPresentation: true,
      svipCard: true,
      aristocracyCard: false,
      vipProgression: false,
      aristocracyShop: false,
    })).toMatchObject({ statusPresentation: true, svipCard: true, aristocracyCard: false });
  });
});
