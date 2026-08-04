import { describe, expect, it } from 'vitest';

import {
  MAX_LIVE_AVATAR_FRAME_PROJECTIONS,
  normalizeLiveAvatarFrameUids,
} from '../useAvatarFrameProjection';

describe('live avatar-frame projection budget', () => {
  it('deduplicates, validates, and caps live identity listeners', () => {
    const input = Array.from({ length: 80 }, (_, index) => `user-${String(index).padStart(2, '0')}`);
    input.push('user-00', 'invalid/uid', '');
    const result = normalizeLiveAvatarFrameUids(input);
    expect(result).toHaveLength(MAX_LIVE_AVATAR_FRAME_PROJECTIONS);
    expect(new Set(result).size).toBe(result.length);
    expect(result).not.toContain('invalid/uid');
  });
});
