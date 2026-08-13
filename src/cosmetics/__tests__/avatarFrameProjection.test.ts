import { describe, expect, it } from 'vitest';

import {
  readAvatarFrameProjection,
  readProjectedAvatarFrame,
} from '../avatarFrameProjection';

describe('avatar frame public projection', () => {
  it('combines the exact canonical reference with the legacy static fallback', () => {
    expect(readAvatarFrameProjection({
      equippedAvatarFrame: {
        assetUrl: 'https://cdn.example.test/frame.png',
        itemId: 'gold-frame',
      },
      equippedCosmetics: {
        avatarFrame: {
          assetId: 'gold-frame-asset',
          assetVersionId: 'v2-bbbbbbbbbbbb',
          itemId: 'gold-frame',
        },
      },
    })).toEqual({
      assetUrl: 'https://cdn.example.test/frame.png',
      canonicalAsset: {
        assetId: 'gold-frame-asset',
        assetVersionId: 'v2-bbbbbbbbbbbb',
      },
      itemId: 'gold-frame',
    });
  });

  it('fails closed on a mismatched item while retaining safe legacy compatibility', () => {
    expect(readAvatarFrameProjection({
      equippedAvatarFrame: {
        assetUrl: 'https://cdn.example.test/frame.png',
        itemId: 'gold-frame',
      },
      equippedCosmetics: {
        avatarFrame: {
          assetId: 'gold-frame-asset',
          assetVersionId: 'v2-bbbbbbbbbbbb',
          itemId: 'other-frame',
        },
      },
    })).toEqual({
      assetUrl: 'https://cdn.example.test/frame.png',
      itemId: 'gold-frame',
    });
  });

  it('maps custom-only avatar frames without requiring a legacy assetUrl', () => {
    expect(readAvatarFrameProjection({
      equippedCosmetics: {
        avatarFrame: {
          assetId: 'cu-av-aaaaaaaaaaaaaaaaaaaa',
          assetVersionId: 'v1-123456789abc',
          itemId: 'cu-av-aaaaaaaaaaaaaaaaaaaa',
          source: 'custom',
        },
      },
    })).toEqual({
      canonicalAsset: {
        assetId: 'cu-av-aaaaaaaaaaaaaaaaaaaa',
        assetVersionId: 'v1-123456789abc',
      },
      itemId: 'cu-av-aaaaaaaaaaaaaaaaaaaa',
      source: 'custom',
    });
  });

  it('maps immutable chat/gift snapshots without accepting arbitrary URLs', () => {
    expect(readProjectedAvatarFrame({
      assetUrl: 'https://cdn.example.test/frame.png',
      canonicalAsset: {
        assetId: 'gold-frame-asset',
        assetVersionId: 'v2-bbbbbbbbbbbb',
      },
      itemId: 'gold-frame',
    })?.canonicalAsset?.assetId).toBe('gold-frame-asset');
    expect(readProjectedAvatarFrame({
      assetUrl: 'http://unsafe.example.test/frame.png',
      itemId: 'gold-frame',
    })).toBeUndefined();
  });
});
