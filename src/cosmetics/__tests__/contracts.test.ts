import { describe, expect, it } from 'vitest';

import {
  COSMETIC_LAYER_ORDER,
  isCosmeticClientVersionCompatible,
  resolveCosmeticViewerMode,
  validateCosmeticAssetDescriptorV1,
  type CosmeticAssetDescriptorV1,
} from '../contracts';

const approvedPng: CosmeticAssetDescriptorV1 = {
  schemaVersion: 1,
  assetId: 'gold-frame',
  assetVersionId: 'v1-aaaaaaaaaaaa',
  ownerType: 'platform',
  category: 'avatar-frame',
  slot: 'avatar-frame',
  format: 'png',
  usage: 'static',
  uri: 'https://cdn.example.test/cosmetics/gold-frame.png',
  width: 512,
  height: 512,
  byteSize: 200_000,
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

describe('cosmetic asset contract', () => {
  it('accepts an approved and published PNG avatar frame', () => {
    expect(validateCosmeticAssetDescriptorV1(approvedPng, {
      requireRenderable: true,
    })).toEqual({ ok: true, descriptor: approvedPng });
  });

  it('requires approved animation fallbacks and enforces budgets', () => {
    const lottie: CosmeticAssetDescriptorV1 = {
      ...approvedPng,
      assetId: 'gold-frame-motion',
      assetVersionId: 'v2-bbbbbbbbbbbb',
      format: 'lottie-json',
      usage: 'looping',
      fallbackAssetId: 'gold-frame',
      fallbackAssetVersionId: 'v1-aaaaaaaaaaaa',
      durationMs: 3_000,
      frameRate: 30,
      byteSize: 600_000,
      loop: true,
    };

    expect(validateCosmeticAssetDescriptorV1(lottie).ok).toBe(true);
    expect(validateCosmeticAssetDescriptorV1({
      ...lottie,
      fallbackAssetVersionId: undefined,
    }).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1({
      ...lottie,
      byteSize: 1_048_577,
    }).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1({
      ...lottie,
      frameRate: 60,
    }).ok).toBe(false);
  });

  it('allows opaque MP4 only on approved cinematic categories', () => {
    const video: CosmeticAssetDescriptorV1 = {
      ...approvedPng,
      assetId: 'gift-burst',
      assetVersionId: 'v3-cccccccccccc',
      category: 'gift-effect',
      slot: undefined,
      format: 'mp4',
      usage: 'one-shot',
      fallbackAssetId: 'gift-burst-poster',
      fallbackAssetVersionId: 'v1-aaaaaaaaaaaa',
      durationMs: 5_000,
      frameRate: 30,
      byteSize: 4_000_000,
      width: 1_280,
      height: 720,
      transparent: false,
    };

    expect(validateCosmeticAssetDescriptorV1(video).ok).toBe(true);
    expect(validateCosmeticAssetDescriptorV1({
      ...video,
      category: 'avatar-frame',
      slot: 'avatar-frame',
    }).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1({
      ...video,
      transparent: true,
    }).ok).toBe(false);
  });

  it('keeps legacy WebP behind an explicit compatibility option', () => {
    const legacy: CosmeticAssetDescriptorV1 = {
      ...approvedPng,
      format: 'legacy-webp',
    };

    expect(validateCosmeticAssetDescriptorV1(legacy).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1(legacy, {
      allowLegacyWebp: true,
    }).ok).toBe(true);
  });

  it('does not render pending, unpublished, or mismatched assets', () => {
    expect(validateCosmeticAssetDescriptorV1({
      ...approvedPng,
      approvalId: undefined,
      moderationStatus: 'pending',
    }, { requireRenderable: true }).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1({
      ...approvedPng,
      publicationStatus: 'unpublished',
    }, { requireRenderable: true }).ok).toBe(false);
    expect(validateCosmeticAssetDescriptorV1({
      ...approvedPng,
      slot: 'chat-bubble',
    }).ok).toBe(false);
  });

  it('freezes safety layer precedence above cosmetic effects', () => {
    expect(COSMETIC_LAYER_ORDER.avatarFrame)
      .toBeLessThan(COSMETIC_LAYER_ORDER.authorityBadges);
    expect(COSMETIC_LAYER_ORDER.majorEffect)
      .toBeLessThan(COSMETIC_LAYER_ORDER.safetyAndConnectionNotice);
  });
});

describe('cosmetic viewer policy', () => {
  it('honors off before reduced motion and low-memory fallbacks', () => {
    expect(resolveCosmeticViewerMode({})).toBe('full');
    expect(resolveCosmeticViewerMode({ appReducedMotion: true })).toBe('reduced');
    expect(resolveCosmeticViewerMode({ lowMemory: true })).toBe('reduced');
    expect(resolveCosmeticViewerMode({
      appReducedMotion: true,
      expensiveEffectsDisabled: true,
    })).toBe('off');
  });

  it('compares strict three-part client versions', () => {
    expect(isCosmeticClientVersionCompatible('1.2.0', '1.2.0')).toBe(true);
    expect(isCosmeticClientVersionCompatible('1.2.0', '1.10.0')).toBe(true);
    expect(isCosmeticClientVersionCompatible('2.0.0', '1.99.99')).toBe(false);
    expect(isCosmeticClientVersionCompatible('1.2', '1.2.0')).toBe(false);
  });
});
