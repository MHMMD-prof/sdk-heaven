import { describe, expect, it } from 'vitest';

import {
  mapRoomRocketCycleV1,
  mapRoomRocketPublicConfigV1,
  mapRoomRocketPublicTemplateV1,
} from '../roomRocketContract';

const timestamp = (value: number) => ({ toMillis: () => value });

function asset(format: 'webp' | 'animated-webp' | 'mp4' | 'lottie-json') {
  return { format, height: 1000, uri: `https://cdn.example.com/${format}`, width: 800 };
}

function cycle() {
  return {
    appearance: {
      animationAsset: asset('animated-webp'),
      name: { ar: 'الصاروخ', en: 'Rocket' },
      staticAsset: asset('webp'),
    },
    cycleId: 'weekly_2026-07-27_asia-baghdad',
    enabledRankCount: 1,
    endAt: timestamp(20),
    finalPodium: [{
      eligibleSpendCoins: 100,
      rank: 1,
      rewardBundle: { coins: 10, diamonds: 0, items: [], schemaVersion: 1 },
      supportPoints: 100,
      uid: 'user-1',
    }],
    roomId: 'room-1',
    startAt: timestamp(10),
    state: 'settled',
    supportPoints: 1000,
    targetSupportPoints: 1000,
    templateRevision: 2,
  };
}

describe('roomRocketContract', () => {
  it('maps the safe client projection', () => {
    expect(mapRoomRocketCycleV1(cycle(), 'room-1')).toMatchObject({
      finalPodium: [{ rank: 1, uid: 'user-1' }],
      state: 'settled',
      templateRevision: 2,
    });
  });

  it('rejects a wrong room or unsupported animation format', () => {
    expect(mapRoomRocketCycleV1(cycle(), 'room-2')).toBeUndefined();
    const invalid = cycle();
    invalid.appearance.animationAsset.format = 'webp';
    expect(mapRoomRocketCycleV1(invalid, 'room-1')).toBeUndefined();
  });

  it('accepts mp4 and lottie-json rocket animations', () => {
    for (const format of ['mp4', 'lottie-json'] as const) {
      const next = cycle();
      next.appearance.animationAsset = asset(format);
      expect(mapRoomRocketCycleV1(next, 'room-1')?.appearance.animationAsset?.format).toBe(format);
    }
  });

  it('maps the public emergency rendering kill switch', () => {
    expect(mapRoomRocketPublicConfigV1({
      renderingEnabled: false,
      revision: 3,
      schemaVersion: 1,
    })).toEqual({
      effectiveFromAtMillis: 0,
      effectiveFromCycleId: '',
      minimumClientVersion: '',
      renderingEnabled: false,
      revision: 3,
      schemaVersion: 1,
    });
  });

  it('maps a sanitized published template for rooms without a cycle yet', () => {
    expect(mapRoomRocketPublicTemplateV1({
      effectiveFromAt: timestamp(10),
      effectiveFromCycleId: 'weekly_2026-07-27_asia-baghdad',
      revision: 2,
      schemaVersion: 1,
      template: {
        appearance: cycle().appearance,
        enabledRankCount: 1,
        minimumClientVersion: '1.0.0',
        rewards: {
          1: { coins: 10, diamonds: 0, items: [], schemaVersion: 1 },
        },
        targetSupportPoints: 1000,
        timeZone: 'Asia/Baghdad',
      },
    })).toMatchObject({
      effectiveFromCycleId: 'weekly_2026-07-27_asia-baghdad',
      rewards: { 1: { coins: 10 } },
      targetSupportPoints: 1000,
    });
  });
});
