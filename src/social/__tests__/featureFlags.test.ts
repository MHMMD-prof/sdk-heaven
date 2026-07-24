import { describe, expect, it } from 'vitest';

import { disabledSocialFeatureFlags, mapSocialFeatureFlags } from '../featureFlags';

describe('social feature flags', () => {
  it('defaults every unfinished feature to disabled', () => {
    expect(mapSocialFeatureFlags(undefined)).toEqual(disabledSocialFeatureFlags);
  });

  it('accepts only explicit true values', () => {
    expect(mapSocialFeatureFlags({ usersDiscovery: true, friends: 1, wallet: false })).toEqual({
      ...disabledSocialFeatureFlags,
      usersDiscovery: true,
    });
  });

  it('keeps representative transfers disabled unless explicitly enabled', () => {
    expect(mapSocialFeatureFlags({ wallet: true })).toMatchObject({ representativeTransfers: false, wallet: true });
    expect(mapSocialFeatureFlags({ representativeTransfers: true, wallet: true })).toMatchObject({ representativeTransfers: true, wallet: true });
  });
});
