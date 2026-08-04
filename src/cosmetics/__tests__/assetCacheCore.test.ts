import { describe, expect, it } from 'vitest';

import {
  COSMETICS_CACHE_MAX_BYTES,
  COSMETICS_CACHE_MAX_FILES,
  bytesToHex,
  cosmeticAssetCacheFileName,
  selectCosmeticCacheEvictions,
} from '../assetCacheCore';

describe('cosmetics cache policy', () => {
  it('builds a canonical filename without using a URL or storage path', () => {
    expect(cosmeticAssetCacheFileName({
      assetId: 'gift-motion',
      assetVersionId: 'v2-bbbbbbbbbbbb',
      format: 'lottie-json',
      sha256: 'c'.repeat(64),
    })).toBe('gift-motion__v2-bbbbbbbbbbbb__cccccccccccccccc.json');
  });

  it('evicts least-recently-modified files while preserving the active file', () => {
    const files = Array.from({ length: COSMETICS_CACHE_MAX_FILES + 2 }, (_, index) => ({
      modificationTime: index,
      name: `asset-${index}.png`,
      size: Math.ceil(COSMETICS_CACHE_MAX_BYTES / COSMETICS_CACHE_MAX_FILES),
    }));
    const evictions = selectCosmeticCacheEvictions(files, 'asset-0.png');
    expect(evictions).not.toContain('asset-0.png');
    expect(evictions[0]).toBe('asset-1.png');
    expect(evictions.length).toBeGreaterThanOrEqual(2);
  });

  it('encodes digest bytes as lowercase hexadecimal', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 16, 255]).buffer)).toBe('000f10ff');
  });
});
