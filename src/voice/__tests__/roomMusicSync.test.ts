import { describe, expect, it } from 'vitest';

import {
  estimateRoomMusicServerNowMs,
  resolveRoomMusicTargetPositionMs,
  shouldSeekRoomMusic,
} from '../roomMusicSync';

const track = {
  artist: 'Artist',
  durationMs: 120_000,
  playbackState: 'playing',
  playbackUri: 'https://example.test/track.mp3',
  positionMs: 10_000,
  title: 'Track',
  trackId: 'track-1',
  updatedAtMs: 1_000_000,
};

describe('roomMusicSync', () => {
  it('advances playing tracks from the authoritative server timestamp', () => {
    expect(resolveRoomMusicTargetPositionMs(track, 1_005_500)).toBe(15_500);
  });

  it('keeps paused tracks fixed and clamps positions to duration', () => {
    expect(resolveRoomMusicTargetPositionMs({
      ...track,
      playbackState: 'paused',
      positionMs: 15_000,
    }, 2_000_000)).toBe(15_000);
    expect(resolveRoomMusicTargetPositionMs(track, 2_000_000)).toBe(120_000);
  });

  it('corrects client clock skew before calculating playback position', () => {
    expect(estimateRoomMusicServerNowMs(1_010_000, 4_500)).toBe(1_005_500);
  });

  it('seeks only outside the drift tolerance', () => {
    expect(shouldSeekRoomMusic(10_000, 10_900)).toBe(false);
    expect(shouldSeekRoomMusic(10_000, 11_300)).toBe(true);
  });
});
