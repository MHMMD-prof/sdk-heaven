import { describe, expect, it } from 'vitest';

import {
  buildCosmeticDependencyAssetId,
  entryAssetRequirement,
  getStoreCosmeticAssetRequirement,
  giftAssetRequirement,
  roomThemeAmbientRequirement,
  roomThemeBackgroundRequirement,
} from './cosmeticAssetAuthoring';

describe('cosmetic asset authoring requirements', () => {
  it.each([
    ['avatar-frames', 'avatar-frame'], ['profile-skins', 'profile-skin'], ['chat-bubbles', 'chat-bubble'],
    ['nameplates', 'nameplate'], ['cosmetic-badges', 'cosmetic-badge'], ['seat-effects', 'seat-effect'],
    ['couple-effects', 'couple-effect'], ['stickers', 'room-reaction'],
  ] as const)('maps %s to %s', (storeCategory, assetCategory) => {
    expect(getStoreCosmeticAssetRequirement(storeCategory)?.category).toBe(assetCategory);
  });

  it('keeps non-rendered store families outside authoring', () => {
    expect(getStoreCosmeticAssetRequirement('game-items')).toBeUndefined();
    expect(getStoreCosmeticAssetRequirement('custom-ids')).toBeUndefined();
  });

  it('defines compatible one-shot and room-theme formats', () => {
    expect(giftAssetRequirement.formats).toEqual(['lottie-json', 'mp4']);
    expect(entryAssetRequirement.usage).toBe('one-shot');
    expect(roomThemeBackgroundRequirement.formats).toEqual(['mp4']);
    expect(roomThemeAmbientRequirement.formats).toEqual(['lottie-json']);
  });

  it('creates bounded version-scoped dependency IDs for long primary IDs', () => {
    const primary = `asset-${'a'.repeat(74)}`;
    const first = buildCosmeticDependencyAssetId(primary, 'fallback', 'v1-aaaaaaaaaaaa');
    const second = buildCosmeticDependencyAssetId(primary, 'fallback', 'v1-bbbbbbbbbbbb');
    const audio = buildCosmeticDependencyAssetId(primary, 'audio', 'v1-aaaaaaaaaaaa');

    expect(first).toMatch(/^[a-z0-9][a-z0-9_-]{2,79}$/);
    expect(first.length).toBeLessThanOrEqual(80);
    expect(first).not.toBe(second);
    expect(audio).not.toBe(first);
  });

  it.each([
    ['avatar-frames', ['png', 'lottie-json', 'legacy-webp']],
    ['profile-skins', ['png', 'jpeg', 'legacy-webp']],
    ['chat-bubbles', ['png', 'lottie-json', 'legacy-webp']],
    ['nameplates', ['png', 'lottie-json', 'legacy-webp']],
    ['cosmetic-badges', ['png', 'lottie-json', 'legacy-webp']],
    ['seat-effects', ['png', 'lottie-json', 'legacy-webp']],
    ['couple-effects', ['png', 'lottie-json']],
    ['stickers', ['png', 'lottie-json', 'legacy-webp']],
  ] as const)('restricts %s to its rendering formats', (category, formats) => {
    expect(getStoreCosmeticAssetRequirement(category)?.formats).toEqual(formats);
  });
});
