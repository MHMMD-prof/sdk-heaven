import { describe, expect, it } from 'vitest';

import {
  estimateRoomWatchServerNowMs,
  resolveRoomWatchTargetPositionMs,
  shouldSeekRoomWatch,
} from '../roomWatchSync';

describe('roomWatchSync', () => {
  it('advances position while playing using server clock', () => {
    const target = resolveRoomWatchTargetPositionMs(
      {
        durationMs: 10_000,
        itemId: 'x',
        playbackState: 'playing',
        playbackUri: 'https://example.test/a.mp4',
        positionMs: 1_000,
        titleAr: 't',
        updatedAtMs: 5_000,
      },
      estimateRoomWatchServerNowMs(8_000, 0),
    );
    expect(target).toBe(4_000);
  });

  it('seeks only outside tolerance', () => {
    expect(shouldSeekRoomWatch(1000, 1500, 1200)).toBe(false);
    expect(shouldSeekRoomWatch(1000, 3000, 1200)).toBe(true);
  });
});
