import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createCoupleIdHash,
  createRelationshipId,
  inspectApprovedCoupleEffect,
  mapCoupleEffectPresentation,
} = require('./coupleEffectsCore');

describe('coupleEffectsCore', () => {
  it('creates history-bound relationship and public identifiers', () => {
    const first = createRelationshipId('couple-1', 'accept-1');
    const second = createRelationshipId('couple-1', 'accept-2');
    expect(first).toMatch(/^rel_[a-f0-9]{40}$/);
    expect(second).not.toBe(first);
    expect(createCoupleIdHash(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires exact presentation modes', () => {
    expect(mapCoupleEffectPresentation({
      borderMode: 'looping',
      entranceMode: 'one-shot',
      profileMode: 'static',
    })).toBeTruthy();
    expect(mapCoupleEffectPresentation({
      borderMode: 'off',
      entranceMode: 'off',
      profileMode: 'off',
    })).toBeUndefined();
  });

  it('accepts Lottie only with its exact approved published PNG fallback', () => {
    const reference = { assetId: 'pair-motion', assetVersionId: 'v1-123456789abc' };
    const version = {
      ...reference,
      category: 'couple-effect',
      fallbackAssetId: 'pair-static',
      fallbackAssetVersionId: 'v1-abcdef123456',
      format: 'lottie-json',
      sha256: 'motion',
    };
    const input = {
      approval: approval('pair-motion', 'v1-123456789abc', 'motion'),
      fallback: {
        approval: approval('pair-static', 'v1-abcdef123456', 'static'),
        summary: summary('pair-static', 'v1-abcdef123456'),
        version: {
          assetId: 'pair-static',
          assetVersionId: 'v1-abcdef123456',
          category: 'couple-effect',
          format: 'png',
          sha256: 'static',
        },
      },
      reference,
      summary: summary('pair-motion', 'v1-123456789abc'),
      version,
    };
    expect(inspectApprovedCoupleEffect(input)).toMatchObject({
      ok: true,
      descriptor: { fallbackAssetId: 'pair-static', format: 'lottie-json' },
    });
    expect(inspectApprovedCoupleEffect({
      ...input,
      fallback: { ...input.fallback, approval: { ...input.fallback.approval, checksum: 'forged' } },
    })).toEqual({ ok: false });
  });
});

function summary(assetId, assetVersionId) {
  return {
    approvalId: `${assetId}__${assetVersionId}`,
    approvedVersionId: assetVersionId,
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: assetVersionId,
    renderingEnabled: true,
  };
}

function approval(assetId, assetVersionId, checksum) {
  return { assetId, assetVersionId, checksum, decision: 'approved' };
}
