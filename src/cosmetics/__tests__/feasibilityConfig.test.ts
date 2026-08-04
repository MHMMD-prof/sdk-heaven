import { describe, expect, it } from 'vitest';

import { readCosmeticsFeasibilityConfig } from '../feasibilityConfig';

describe('readCosmeticsFeasibilityConfig', () => {
  it('accepts only credential-free HTTPS fixture URLs', () => {
    expect(readCosmeticsFeasibilityConfig({
      EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL: ' https://cdn.example.test/effect.m4a ',
      EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL: 'https://cdn.example.test/effect.mp4',
    })).toEqual({
      audioUrl: 'https://cdn.example.test/effect.m4a',
      videoUrl: 'https://cdn.example.test/effect.mp4',
    });

    expect(readCosmeticsFeasibilityConfig({
      EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL: 'http://example.test/effect.m4a',
      EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL: 'https://user:secret@example.test/effect.mp4',
    })).toEqual({
      audioUrl: undefined,
      videoUrl: undefined,
    });
  });

  it('treats missing and malformed values as unconfigured', () => {
    expect(readCosmeticsFeasibilityConfig({})).toEqual({
      audioUrl: undefined,
      videoUrl: undefined,
    });
    expect(readCosmeticsFeasibilityConfig({
      EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL: 'not a url',
    }).audioUrl).toBeUndefined();
  });
});
