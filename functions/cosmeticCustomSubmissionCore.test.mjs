import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildCustomEquipmentProjection,
  buildPublicCustomEquipmentProjection,
  createCosmeticSubmissionId,
  inspectApprovedCustomOwnership,
  inspectCustomEligibility,
  inspectCustomFeatureFlags,
  isCustomMp4Rejected,
  mapAdminCustomSubmission,
  normalizeAttestCustomSubmissionInput,
  normalizeCreateCustomUploadInput,
  normalizeAdminCustomSubmissionMutation,
  normalizeAdminCustomSubmissionQuery,
  validateUploadedCustomObject,
} = require('./cosmeticCustomSubmissionCore');

describe('cosmeticCustomSubmissionCore', () => {
  it('keeps source on private equipment projections and strips it from public profile projections', () => {
    expect(buildCustomEquipmentProjection({
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      category: 'profile-skin',
    })).toEqual({
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      source: 'custom',
    });
    expect(buildPublicCustomEquipmentProjection({
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      category: 'profile-skin',
    })).toEqual({
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
    });
    expect(buildPublicCustomEquipmentProjection({
      assetId: 'cu-en-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      category: 'entry-effect',
    })).toBeUndefined();
  });

  it('creates immutable submission ids and rejects custom MP4', () => {
    const first = createCosmeticSubmissionId({ requestId: 'request_custom_0001', uid: 'u1' });
    const second = createCosmeticSubmissionId({ requestId: 'request_custom_0002', uid: 'u1' });
    expect(first).toMatch(/^submission_[a-f0-9]{24}$/);
    expect(second).not.toBe(first);
    expect(isCustomMp4Rejected('mp4', 'video/mp4')).toBe(true);
    expect(normalizeCreateCustomUploadInput({
      category: 'entry-effect',
      contentType: 'video/mp4',
      format: 'mp4',
      sizeBytes: 1024,
    }).ok).toBe(false);
  });

  it('requires eligibility, attestation length, and flag gates fail closed', () => {
    expect(inspectCustomFeatureFlags({})).toEqual({ ok: false, code: 'FEATURE_DISABLED' });
    expect(inspectCustomFeatureFlags({
      cosmetics_custom_submissions: true,
      cosmetics_custom_rendering: false,
    }, { rendering: true })).toEqual({ ok: false, code: 'FEATURE_DISABLED' });
    expect(inspectCustomEligibility({ active: true, uid: 'u1' }, {
      category: 'profile-skin',
      nowMs: 1_000,
      uid: 'u1',
    })).toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(inspectCustomEligibility({
      active: true,
      categories: ['profile-skin'],
      uid: 'u1',
    }, {
      category: 'profile-skin',
      nowMs: 1_000,
      uid: 'u1',
    })).toMatchObject({ ok: true, value: { categories: ['profile-skin'], pendingCount: 0 } });
    expect(inspectCustomEligibility({
      active: true,
      categories: [],
      uid: 'u1',
    }, {
      category: 'profile-skin',
      nowMs: 1_000,
      uid: 'u1',
    })).toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(inspectCustomEligibility({ active: false, categories: ['profile-skin'], uid: 'u1' }, {
      category: 'profile-skin',
      nowMs: 1_000,
      uid: 'u1',
    })).toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(normalizeAttestCustomSubmissionInput({
      attestation: 'short',
      submissionId: 'submission_1234567890ab',
    }).ok).toBe(false);
    expect(normalizeAttestCustomSubmissionInput({
      attestation: 'I own this artwork and grant review rights.',
      submissionId: 'submission_1234567890ab',
    })).toMatchObject({ ok: true });
  });

  it('rejects expired authorizations and forged ownership checksums', () => {
    expect(validateUploadedCustomObject({
      authorization: {
        active: true,
        contentType: 'image/png',
        expiresAt: { toMillis: () => 500 },
        format: 'png',
        maxBytes: 1024,
        sizeBytes: 8,
        submissionId: 'submission_1234567890ab',
        uid: 'u1',
      },
      metadata: {
        contentType: 'image/png',
        metadata: { submissionId: 'submission_1234567890ab', uploaderUid: 'u1' },
        size: 8,
      },
      nowMs: 1_000,
      sourceByteLength: 8,
    })).toEqual({ ok: false, code: 'UPLOAD_INVALID' });

    const ownership = {
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      checksum: 'real',
      state: 'active',
      uid: 'u1',
    };
    const summary = {
      approvalId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa__v1-123456789abc',
      approvedVersionId: 'v1-123456789abc',
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      moderationStatus: 'approved',
      ownerType: 'user',
      ownerUid: 'u1',
      publicationStatus: 'published',
      publishedVersionId: 'v1-123456789abc',
      renderingEnabled: true,
      visibility: 'owner-bound',
    };
    const version = {
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      category: 'profile-skin',
      contentType: 'image/png',
      format: 'png',
      ownerType: 'user',
      ownerUid: 'u1',
      sha256: 'real',
    };
    const approval = {
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      checksum: 'real',
      decision: 'approved',
    };
    expect(inspectApprovedCustomOwnership({
      approval,
      ownership,
      summary,
      uid: 'u1',
      version,
    })).toMatchObject({ ok: true });
    expect(inspectApprovedCustomOwnership({
      approval: { ...approval, checksum: 'forged' },
      ownership,
      summary,
      uid: 'u1',
      version,
    })).toEqual({ ok: false });
    expect(inspectApprovedCustomOwnership({
      approval,
      ownership,
      summary: { ...summary, visibility: 'catalog' },
      uid: 'u1',
      version,
    })).toEqual({ ok: false });
  });

  it('normalizes admin custom submission mutations', () => {
    expect(normalizeAdminCustomSubmissionMutation({
      expectedRevision: 2,
      operation: 'approve-custom-submission',
      reason: 'Looks clean',
      requestId: 'custom_approve_req_001',
      submissionId: 'submission_1234567890ab',
    })).toMatchObject({ ok: true });
    expect(normalizeAdminCustomSubmissionMutation({
      expectedRevision: 2,
      operation: 'approve-custom-submission',
      reason: 'no',
      requestId: 'custom_approve_req_001',
      submissionId: 'submission_1234567890ab',
    }).ok).toBe(false);
  });

  it('maps admin queue rows without quarantine paths and bounds eligibility grants', () => {
    expect(normalizeAdminCustomSubmissionQuery({ status: 'pending', limit: 500 })).toMatchObject({
      ok: true,
      value: { limit: 50, status: 'pending' },
    });
    const mapped = mapAdminCustomSubmission('submission_1234567890ab', {
      category: 'profile-skin',
      copyrightAttestation: 'I own this artwork and grant review rights.',
      format: 'png',
      ownerUid: 'u1',
      revision: 3,
      sha256: 'abc',
      sourcePath: 'cosmetic-submissions/u1/submission_1234567890ab/v1-aaaaaaaaaaaa/source.png',
      status: 'pending',
      submissionId: 'submission_1234567890ab',
      width: 64,
      height: 64,
    });
    expect(mapped).toMatchObject({
      category: 'profile-skin',
      ownerUid: 'u1',
      status: 'pending',
      submissionId: 'submission_1234567890ab',
    });
    expect(mapped).not.toHaveProperty('sourcePath');
    expect(normalizeAdminCustomSubmissionMutation({
      categories: ['profile-skin', 'avatar-frame'],
      operation: 'grant-custom-eligibility',
      reason: 'Allowlisted test creator',
      requestId: 'custom_grant_req_000001',
      uid: 'u1',
    })).toMatchObject({
      ok: true,
      value: {
        categories: ['profile-skin', 'avatar-frame'],
        operation: 'grant-custom-eligibility',
      },
    });
  });
});
