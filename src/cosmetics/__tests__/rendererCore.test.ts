import { describe, expect, it } from 'vitest';

import type { CosmeticAssetDescriptorV1 } from '../contracts';
import { disabledCosmeticsFeatureFlags } from '../featureFlags';
import { resolveCosmeticRenderPlan } from '../rendererCore';

const fallback: CosmeticAssetDescriptorV1 = {
  schemaVersion: 1,
  assetId: 'gift-poster',
  assetVersionId: 'v1-aaaaaaaaaaaa',
  ownerType: 'platform',
  category: 'gift-effect',
  format: 'png',
  usage: 'static',
  uri: 'https://cdn.example.test/gift-poster.png',
  width: 1280,
  height: 720,
  byteSize: 100_000,
  sha256: 'a'.repeat(64),
  transparent: true,
  loop: false,
  performanceTier: 'low',
  minimumClientVersion: '1.0.0',
  moderationStatus: 'approved',
  publicationStatus: 'published',
  approvalId: 'approval_123456789',
  revision: 1,
};

const animation: CosmeticAssetDescriptorV1 = {
  ...fallback,
  assetId: 'gift-motion',
  assetVersionId: 'v2-bbbbbbbbbbbb',
  format: 'lottie-json',
  usage: 'one-shot',
  fallbackAssetId: fallback.assetId,
  fallbackAssetVersionId: fallback.assetVersionId,
  durationMs: 3000,
  frameRate: 30,
  byteSize: 200_000,
  sha256: 'b'.repeat(64),
};

const enabled = {
  ...disabledCosmeticsFeatureFlags,
  animatedAvatarFrames: false,
  assetRegistry: true,
  effectAudio: false,
  lottie: true,
  sharedRenderer: true,
  unifiedAvatarFrames: false,
  video: false,
};

function plan(overrides: Partial<Parameters<typeof resolveCosmeticRenderPlan>[0]> = {}) {
  return resolveCosmeticRenderPlan({
    currentClientVersion: '1.0.0',
    descriptor: animation,
    fallbackDescriptor: fallback,
    flags: enabled,
    viewerMode: 'full',
    ...overrides,
  });
}

describe('cosmetics renderer planning', () => {
  it('keeps the shared renderer dark and falls back safely', () => {
    expect(plan({ flags: disabledCosmeticsFeatureFlags })).toMatchObject({
      reason: 'feature-disabled',
      renderer: 'static',
      source: 'fallback',
    });
  });

  it('selects a verified published Lottie only when its exact gate is enabled', () => {
    expect(plan()).toMatchObject({ renderer: 'lottie', source: 'primary' });
    expect(plan({ flags: { ...enabled, lottie: false } })).toMatchObject({
      reason: 'renderer-disabled',
      source: 'fallback',
    });
  });

  it('falls back for reduced motion, low performance, checksum, and client gates', () => {
    expect(plan({ viewerMode: 'reduced' }).reason).toBe('reduced-motion');
    expect(plan({
      descriptor: { ...animation, performanceTier: 'high' },
      deviceTier: 'low',
    }).reason).toBe('low-performance');
    expect(plan({ integrity: 'failed' }).reason).toBe('checksum-failed');
    expect(plan({
      descriptor: { ...animation, minimumClientVersion: '2.0.0' },
    }).reason).toBe('client-incompatible');
  });

  it('uses only a validated HTTPS compatibility image when no registry fallback exists', () => {
    expect(plan({
      fallbackDescriptor: undefined,
      flags: disabledCosmeticsFeatureFlags,
      compatibilityUri: 'https://cdn.example.test/legacy.png',
    })).toMatchObject({ renderer: 'static', source: 'compatibility' });
    expect(plan({
      fallbackDescriptor: undefined,
      flags: disabledCosmeticsFeatureFlags,
      compatibilityUri: 'http://unsafe.example.test/legacy.png',
    })).toMatchObject({ renderer: 'none', source: 'none' });
  });
});
