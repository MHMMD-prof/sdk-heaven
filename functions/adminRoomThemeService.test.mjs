import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isSilentThemeMotionVersion } = require('./adminRoomThemeService');

describe('adminRoomThemeService', () => {
  it('accepts only motion assets whose inspected media contains no audio track', () => {
    expect(isSilentThemeMotionVersion({ audioCodec: '' })).toBe(true);
    expect(isSilentThemeMotionVersion({ audioCodec: 'aac' })).toBe(false);
    expect(isSilentThemeMotionVersion({})).toBe(false);
  });
});
