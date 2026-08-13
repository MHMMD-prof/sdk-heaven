import { describe, expect, it } from 'vitest';

import {
  disabledGrowthFeatureFlags,
  mapGrowthFeatureFlags,
} from '../featureFlags';
import {
  clearGrowthMatchMask,
  getGrowthMatchMask,
  setGrowthMatchMask,
} from '../matchSession';

describe('growth feature flags', () => {
  it('fails closed by default', () => {
    expect(mapGrowthFeatureFlags(undefined)).toEqual(disabledGrowthFeatureFlags);
    expect(mapGrowthFeatureFlags({ quickMatch: true, luckyBag: 'yes' })).toMatchObject({
      luckyBag: false,
      quickMatch: true,
    });
  });
});

describe('growth match session', () => {
  it('stores and clears an in-memory mask', () => {
    clearGrowthMatchMask();
    setGrowthMatchMask({
      expiresAtMs: Date.now() + 60_000,
      labelAr: 'ضيف مقنع',
      roomId: 'room-1',
    });
    expect(getGrowthMatchMask('room-1')?.labelAr).toBe('ضيف مقنع');
    expect(getGrowthMatchMask('other')).toBeNull();
    clearGrowthMatchMask();
    expect(getGrowthMatchMask('room-1')).toBeNull();
  });
});
