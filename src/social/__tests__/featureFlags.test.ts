import { describe, expect, it } from 'vitest';

import { disabledSocialFeatureFlags, mapSocialFeatureFlags } from '../featureFlags';

describe('social feature flags', () => {
  it('defaults every unfinished feature to disabled', () => {
    expect(mapSocialFeatureFlags(undefined)).toEqual(disabledSocialFeatureFlags);
  });

  it('accepts only explicit true values', () => {
    expect(mapSocialFeatureFlags({ usersDiscovery: true, friends: 1, following: true, wallet: false })).toEqual({
      ...disabledSocialFeatureFlags,
      following: true,
      usersDiscovery: true,
    });
  });

  it('keeps representative transfers disabled unless explicitly enabled', () => {
    expect(mapSocialFeatureFlags({ wallet: true })).toMatchObject({ representativeTransfers: false, wallet: true });
    expect(mapSocialFeatureFlags({ representativeTransfers: true, wallet: true })).toMatchObject({ representativeTransfers: true, wallet: true });
  });

  it('keeps every direct-chat layer independently fail-closed', () => {
    expect(mapSocialFeatureFlags({ directMessages: true })).toMatchObject({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: true,
    });
    expect(mapSocialFeatureFlags({
      directMessageMedia: true,
      directMessageRequests: true,
      directMessages: true,
    })).toMatchObject({
      directMessageMedia: true,
      directMessageRequests: true,
      directMessages: true,
    });
  });

  it('keeps the replacement chat presentation independently fail-closed', () => {
    expect(mapSocialFeatureFlags({ directMessages: true })).toMatchObject({
      directMessages: true,
      personalChatsFrontendV2: false,
    });
    expect(mapSocialFeatureFlags({ personalChatsFrontendV2: true })).toMatchObject({
      directMessages: false,
      personalChatsFrontendV2: true,
    });
  });
});
