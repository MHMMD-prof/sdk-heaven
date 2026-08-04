import { describe, expect, it } from 'vitest';

import {
  mapRewardBundleV1,
  mapWeeklyCycleV1,
} from '../weeklyIncentiveContract';

describe('weeklyIncentiveContract', () => {
  it('accepts only the versioned weekly cycle shape', () => {
    expect(mapWeeklyCycleV1({
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      endAtMillis: 604_800_000,
      schemaVersion: 1,
      startAtMillis: 0,
      state: 'active',
      templateVersion: 3,
      timeZone: 'Asia/Baghdad',
    })).toBeDefined();
    expect(mapWeeklyCycleV1({
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      endAtMillis: 1,
      schemaVersion: 2,
      startAtMillis: 0,
      state: 'active',
      templateVersion: 3,
      timeZone: 'Asia/Baghdad',
    })).toBeUndefined();
  });

  it('fails closed for malformed or empty reward bundles', () => {
    expect(mapRewardBundleV1({
      coins: 10,
      diamonds: 2,
      items: [{
        duplicateFallback: { amount: 3, currency: 'coins' },
        itemId: 'gold-frame',
      }],
      schemaVersion: 1,
    })).toBeDefined();
    expect(mapRewardBundleV1({
      coins: 0,
      diamonds: 0,
      items: [],
      schemaVersion: 1,
    })).toBeUndefined();
  });
});
