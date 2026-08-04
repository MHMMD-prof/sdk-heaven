import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAdminCosmeticsAssetMutation,
  normalizeAdminCosmeticsAssetQuery,
  transitionCosmeticAssetSummary,
} = require('./adminCosmeticsAssetCore');

describe('admin cosmetics asset input', () => {
  it('derives validation identity without accepting a client URL/path', () => {
    const result = normalizeAdminCosmeticsAssetMutation({
      asset: {
        assetId: 'gold-entry',
        assetVersionId: 'v1-aaaaaaaaaaaa',
        category: 'entry-effect',
        fallbackAssetId: 'gold-entry-poster',
        fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
        format: 'mp4',
        loop: false,
        minimumClientVersion: '1.0.0',
        ownerType: 'platform',
        performanceTier: 'high',
        slot: 'entry-effect',
        storagePath: 'https://attacker.invalid/file.mp4',
        usage: 'one-shot',
      },
      expectedRevision: 0,
      operation: 'validate-version',
      reason: 'Validate controlled upload',
      requestId: 'asset_validate_request_001',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        asset: {
          assetId: 'gold-entry',
          fallbackAssetId: 'gold-entry-poster',
          sourceExtension: 'mp4',
        },
      },
    });
    expect(result.value.asset).not.toHaveProperty('storagePath');
  });

  it('requires exact confirmations for destructive transitions', () => {
    const base = {
      assetId: 'gold-entry',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      expectedRevision: 2,
      reason: 'Operational rollback',
      requestId: 'asset_rollback_request_01',
    };
    expect(normalizeAdminCosmeticsAssetMutation({
      ...base,
      operation: 'rollback-version',
    }).ok).toBe(false);
    expect(normalizeAdminCosmeticsAssetMutation({
      ...base,
      confirmation: 'ROLLBACK gold-entry v1-aaaaaaaaaaaa',
      operation: 'rollback-version',
    }).ok).toBe(true);
    expect(normalizeAdminCosmeticsAssetMutation({
      ...base,
      confirmation: 'SUSPEND gold-entry',
      operation: 'suspend',
    }).ok).toBe(true);
  });

  it('bounds inventory filters', () => {
    expect(normalizeAdminCosmeticsAssetQuery({
      category: 'avatar-frame',
      limit: 500,
      moderationStatus: 'approved',
      publicationStatus: 'published',
    })).toMatchObject({ ok: true, value: { limit: 50 } });
    expect(normalizeAdminCosmeticsAssetQuery({ category: 'script-effect' }).ok).toBe(false);
  });
});

describe('cosmetics asset state transitions', () => {
  const version = {
    assetId: 'gold-frame',
    assetVersionId: 'v1-aaaaaaaaaaaa',
    category: 'avatar-frame',
    ownerType: 'platform',
    slot: 'avatar-frame',
  };

  it('registers a pending version without making it public', () => {
    expect(transitionCosmeticAssetSummary({
      operation: 'validate-version',
      version,
    })).toMatchObject({
      moderationStatus: 'pending',
      publicationStatus: 'unpublished',
      publishedVersionId: '',
      renderingEnabled: false,
      revision: 1,
    });
  });

  it('keeps an old published version live while a replacement is pending', () => {
    const existing = {
      assetId: 'gold-frame',
      approvedVersionId: 'v1-111111111111',
      approvalId: 'approval-old',
      category: 'avatar-frame',
      currentVersionId: 'v1-111111111111',
      moderationStatus: 'approved',
      ownerType: 'platform',
      pendingVersionId: '',
      publicationStatus: 'published',
      publishedVersionId: 'v1-111111111111',
      renderingEnabled: true,
      revision: 4,
      schemaVersion: 1,
      slot: 'avatar-frame',
    };
    expect(transitionCosmeticAssetSummary({
      existing,
      operation: 'validate-version',
      version: { ...version, assetVersionId: 'v2-aaaaaaaaaaaa' },
    })).toMatchObject({
      pendingVersionId: 'v2-aaaaaaaaaaaa',
      publishedVersionId: 'v1-111111111111',
      renderingEnabled: true,
      revision: 5,
    });
  });

  it('publishes, disables, and rolls back only through summary pointers', () => {
    const pending = transitionCosmeticAssetSummary({
      operation: 'validate-version',
      version,
    });
    const approved = transitionCosmeticAssetSummary({
      approvalId: 'gold-frame__v1-aaaaaaaaaaaa',
      existing: pending,
      operation: 'approve-version',
      version,
    });
    const published = transitionCosmeticAssetSummary({
      approvalId: 'gold-frame__v1-aaaaaaaaaaaa',
      existing: approved,
      operation: 'publish-version',
      version,
    });
    expect(published).toMatchObject({
      publicationStatus: 'published',
      publishedVersionId: version.assetVersionId,
      renderingEnabled: true,
    });
    expect(transitionCosmeticAssetSummary({
      existing: published,
      operation: 'emergency-disable',
    })).toMatchObject({
      publicationStatus: 'disabled',
      publishedVersionId: version.assetVersionId,
      renderingEnabled: false,
    });
  });
});
