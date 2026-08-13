import { describe, expect, it } from 'vitest';

import {
  buildAttestCustomSubmissionRequest,
  buildCreateCustomUploadRequest,
  buildEquipCustomAssetRequest,
  buildFinalizeCustomUploadRequest,
  buildListCustomSubmissionsRequest,
  buildUnequipCustomAssetRequest,
  canRenderCustomCosmetics,
  canUseCustomSubmissions,
  isCustomEquipmentProjection,
  mapCustomSubmissionSummaries,
  resolveCustomUploadDraft,
  validateCustomAttestation,
} from '../customSubmissions';
import { disabledCosmeticsFeatureFlags } from '../featureFlags';

describe('custom submission client mapping', () => {
  it('builds exact social command payloads', () => {
    expect(buildCreateCustomUploadRequest({
      category: 'profile-skin',
      contentType: 'image/png',
      format: 'png',
      sizeBytes: 128,
    }, 'req_create')).toEqual({
      action: 'create-cosmetic-custom-upload',
      payload: {
        category: 'profile-skin',
        contentType: 'image/png',
        format: 'png',
        sizeBytes: 128,
      },
      requestId: 'req_create',
      version: 1,
    });
    expect(buildFinalizeCustomUploadRequest('submission_1234567890ab', 'req_fin')).toEqual({
      action: 'finalize-cosmetic-custom-upload',
      payload: { submissionId: 'submission_1234567890ab' },
      requestId: 'req_fin',
      version: 1,
    });
    expect(buildAttestCustomSubmissionRequest(
      'submission_1234567890ab',
      'I own this artwork and grant review.',
      'req_att',
    ).action).toBe('attest-cosmetic-custom-submission');
    expect(buildListCustomSubmissionsRequest(10, 'req_list')).toEqual({
      action: 'list-cosmetic-custom-submissions',
      payload: { limit: 10 },
      requestId: 'req_list',
      version: 1,
    });
    expect(buildEquipCustomAssetRequest('cu-pr-aaaaaaaaaaaaaaaaaaaa', 'req_eq').action)
      .toBe('equip-cosmetic-custom-asset');
    expect(buildUnequipCustomAssetRequest('avatar-frame', 'req_un').payload).toEqual({
      category: 'avatar-frame',
    });
  });

  it('fails closed on flags, eligibility, mp4, and quarantine leakage', () => {
    expect(canUseCustomSubmissions(disabledCosmeticsFeatureFlags, {
      active: true,
      categories: ['profile-skin'],
    })).toBe(false);
    expect(canUseCustomSubmissions({
      ...disabledCosmeticsFeatureFlags,
      customSubmissions: true,
    }, { active: true, categories: [] })).toBe(false);
    expect(canUseCustomSubmissions({
      ...disabledCosmeticsFeatureFlags,
      customSubmissions: true,
    }, { active: true, categories: ['profile-skin'] }, 'avatar-frame')).toBe(false);
    expect(canUseCustomSubmissions({
      ...disabledCosmeticsFeatureFlags,
      customSubmissions: true,
    }, { active: true, categories: ['profile-skin'] }, 'profile-skin')).toBe(true);
    expect(canRenderCustomCosmetics({
      ...disabledCosmeticsFeatureFlags,
      assetRegistry: true,
      customRendering: true,
      sharedRenderer: true,
    })).toBe(true);
    expect(resolveCustomUploadDraft({
      category: 'entry-effect',
      contentType: 'video/mp4',
      sizeBytes: 1024,
      uri: 'file:///x.mp4',
    })).toEqual({ ok: false, reason: 'CUSTOM_MP4_DISABLED' });
    expect(validateCustomAttestation('too-short')).toBe(false);
    expect(mapCustomSubmissionSummaries({
      submissions: [{
        category: 'profile-skin',
        format: 'png',
        revision: 2,
        sourcePath: 'cosmetic-submissions/u1/x/y/source.png',
        status: 'pending',
        submissionId: 'submission_1234567890ab',
      }],
    })).toEqual([]);
    expect(isCustomEquipmentProjection({
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      source: 'custom',
    })).toBe(true);
  });

  it('accepts entry-effect Lottie JSON drafts and still rejects custom MP4', () => {
    expect(resolveCustomUploadDraft({
      category: 'entry-effect',
      contentType: 'application/json',
      fallbackAssetId: 'entry-fallback-static',
      fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
      sizeBytes: 12_000,
      uri: 'file:///entrance.json',
    })).toMatchObject({
      ok: true,
      value: { format: 'lottie-json' },
    });
    expect(resolveCustomUploadDraft({
      category: 'entry-effect',
      contentType: 'application/json',
      sizeBytes: 12_000,
      uri: 'file:///entrance.json',
    })).toEqual({ ok: false, reason: 'FALLBACK_REQUIRED' });
    expect(resolveCustomUploadDraft({
      category: 'entry-effect',
      contentType: 'video/mp4',
      sizeBytes: 1024,
      uri: 'file:///x.mp4',
    })).toEqual({ ok: false, reason: 'CUSTOM_MP4_DISABLED' });
  });
});
