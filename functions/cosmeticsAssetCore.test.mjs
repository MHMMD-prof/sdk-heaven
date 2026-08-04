import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cosmeticAssetPolicyV1,
  inspectVectorLottieV1,
} = require('./cosmeticsAssetCore.js');
const bundledWave0Fixture = require('../assets/cosmetics-lab/wave0-ring.json');

const vectorFixture = {
  v: '5.12.2',
  fr: 30,
  ip: 0,
  op: 90,
  w: 256,
  h: 256,
  assets: [],
  layers: [
    {
      ty: 4,
      ddd: 0,
      shapes: [{ ty: 'el' }, { ty: 'st' }],
    },
  ],
};

describe('cosmeticsAssetCore', () => {
  it('freezes moderation and equipment policy values', () => {
    expect(cosmeticAssetPolicyV1.schemaVersion).toBe(1);
    expect(cosmeticAssetPolicyV1.publicationStatuses).toEqual([
      'unpublished',
      'published',
      'disabled',
    ]);
    expect(cosmeticAssetPolicyV1.equipmentSlots).toContain('avatar-frame');
    expect(cosmeticAssetPolicyV1.formats).not.toContain('gif');
  });

  it('accepts a bounded vector-only Lottie document', () => {
    expect(inspectVectorLottieV1(vectorFixture, {
      byteSize: 12_000,
    })).toEqual({
      ok: true,
      metadata: {
        durationMs: 3000,
        frameRate: 30,
        height: 256,
        width: 256,
      },
    });
    expect(inspectVectorLottieV1(bundledWave0Fixture, {
      byteSize: 1595,
    }).ok).toBe(true);
  });

  it('rejects remote images, text, expressions, effects, and oversized files', () => {
    expect(inspectVectorLottieV1({
      ...vectorFixture,
      assets: [{ id: 'image_0', p: 'https://example.test/image.png' }],
    }, { byteSize: 12_000 }).ok).toBe(false);

    expect(inspectVectorLottieV1({
      ...vectorFixture,
      layers: [{ ty: 5 }],
    }, { byteSize: 12_000 }).ok).toBe(false);

    expect(inspectVectorLottieV1({
      ...vectorFixture,
      layers: [{ ty: 4, ks: { r: { x: 'time * 20' } } }],
    }, { byteSize: 12_000 }).ok).toBe(false);

    expect(inspectVectorLottieV1({
      ...vectorFixture,
      layers: [{ ty: 4, ef: [{ ty: 29 }] }],
    }, { byteSize: 12_000 }).ok).toBe(false);

    expect(inspectVectorLottieV1(vectorFixture, {
      byteSize: 1024 * 1024 + 1,
    }).ok).toBe(false);
  });
});
