import { describe, expect, it } from 'vitest';

import { mapPublishedCosmeticDescriptor } from '../assetRegistryCore';

const summary = {
  schemaVersion: 1,
  assetId: 'gift-poster',
  approvedVersionId: 'v1-aaaaaaaaaaaa',
  publishedVersionId: 'v1-aaaaaaaaaaaa',
  moderationStatus: 'approved',
  publicationStatus: 'published',
  renderingEnabled: true,
  approvalId: 'approval_123456789',
  revision: 3,
};

const version = {
  schemaVersion: 1,
  assetId: 'gift-poster',
  assetVersionId: 'v1-aaaaaaaaaaaa',
  ownerType: 'platform',
  category: 'gift-effect',
  format: 'png',
  usage: 'static',
  width: 1280,
  height: 720,
  byteSize: 100_000,
  sha256: 'a'.repeat(64),
  transparent: true,
  loop: false,
  performanceTier: 'low',
  minimumClientVersion: '1.0.0',
};

describe('published cosmetic registry mapping', () => {
  it('maps only the exact approved and published immutable version', () => {
    expect(mapPublishedCosmeticDescriptor(
      summary,
      version,
      'https://cdn.example.test/gift-poster.png',
    )).toMatchObject({
      assetId: 'gift-poster',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      moderationStatus: 'approved',
      publicationStatus: 'published',
    });
  });

  it('rejects disabled, pending, mismatched, and non-HTTPS assets', () => {
    expect(mapPublishedCosmeticDescriptor(
      { ...summary, renderingEnabled: false },
      version,
      'https://cdn.example.test/gift-poster.png',
    )).toBeUndefined();
    expect(mapPublishedCosmeticDescriptor(
      { ...summary, moderationStatus: 'pending' },
      version,
      'https://cdn.example.test/gift-poster.png',
    )).toBeUndefined();
    expect(mapPublishedCosmeticDescriptor(
      summary,
      { ...version, assetVersionId: 'v2-bbbbbbbbbbbb' },
      'https://cdn.example.test/gift-poster.png',
    )).toBeUndefined();
    expect(mapPublishedCosmeticDescriptor(
      summary,
      version,
      'http://cdn.example.test/gift-poster.png',
    )).toBeUndefined();
  });
});
