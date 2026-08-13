import { createSocialRequestId } from '../social/publicProfile';
import type { SocialCommandRequest } from '../social/types';
import type { CosmeticsFeatureFlags } from './featureFlags';

export const CUSTOM_V1_CATEGORIES = ['avatar-frame', 'profile-skin', 'entry-effect'] as const;
export type CustomCosmeticCategory = (typeof CUSTOM_V1_CATEGORIES)[number];

export type CustomSubmissionStatus =
  | 'authorized'
  | 'processed'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'abandoned';

export type CustomSubmissionSummary = {
  approvedAssetId: string;
  assetVersionId: string;
  category: string;
  format: string;
  revision: number;
  status: string;
  submissionId: string;
  updatedAt?: unknown;
};

export type CustomUploadAuthorization = {
  assetVersionId: string;
  contentType: string;
  expiresAt: unknown;
  maxBytes: number;
  sizeBytes: number;
  sourcePath: string;
  submissionId: string;
};

export type CustomEligibilitySnapshot = {
  active: boolean;
  categories: CustomCosmeticCategory[];
};

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const ATTESTATION_MIN = 12;
const ATTESTATION_MAX = 500;

const FORMAT_BY_CONTENT_TYPE: Record<string, { categoryFormats: Partial<Record<CustomCosmeticCategory, string>>; format: string }> = {
  'application/json': { categoryFormats: { 'entry-effect': 'lottie-json' }, format: 'lottie-json' },
  'image/jpeg': { categoryFormats: { 'profile-skin': 'jpeg' }, format: 'jpeg' },
  'image/png': { categoryFormats: { 'avatar-frame': 'png', 'profile-skin': 'png' }, format: 'png' },
};

export function canUseCustomSubmissions(
  flags: CosmeticsFeatureFlags,
  eligibility: CustomEligibilitySnapshot | undefined,
  category?: CustomCosmeticCategory,
) {
  if (!flags.customSubmissions || !eligibility?.active) return false;
  if (category && !eligibility.categories.includes(category)) return false;
  return eligibility.categories.some((value) => CUSTOM_V1_CATEGORIES.includes(value));
}

export function canRenderCustomCosmetics(flags: CosmeticsFeatureFlags) {
  return flags.customRendering === true
    && flags.assetRegistry === true
    && flags.sharedRenderer === true;
}

export function isCustomEquipmentProjection(value: unknown): value is {
  assetId: string;
  assetVersionId: string;
  itemId: string;
  source: 'custom';
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.source === 'custom'
    && ASSET_ID_PATTERN.test(readString(candidate.assetId))
    && VERSION_ID_PATTERN.test(readString(candidate.assetVersionId))
    && ASSET_ID_PATTERN.test(readString(candidate.itemId));
}

export function buildCreateCustomUploadRequest(
  input: {
    category: CustomCosmeticCategory;
    contentType: string;
    fallbackAssetId?: string;
    fallbackAssetVersionId?: string;
    format: string;
    sizeBytes: number;
  },
  requestId = createSocialRequestId('customupload'),
): SocialCommandRequest<'create-cosmetic-custom-upload', typeof input> {
  return {
    action: 'create-cosmetic-custom-upload',
    payload: input,
    requestId,
    version: 1,
  };
}

export function buildFinalizeCustomUploadRequest(
  submissionId: string,
  requestId = createSocialRequestId('customfinalize'),
): SocialCommandRequest<'finalize-cosmetic-custom-upload', { submissionId: string }> {
  return {
    action: 'finalize-cosmetic-custom-upload',
    payload: { submissionId },
    requestId,
    version: 1,
  };
}

export function buildAttestCustomSubmissionRequest(
  submissionId: string,
  attestation: string,
  requestId = createSocialRequestId('customattest'),
): SocialCommandRequest<'attest-cosmetic-custom-submission', { attestation: string; submissionId: string }> {
  return {
    action: 'attest-cosmetic-custom-submission',
    payload: { attestation, submissionId },
    requestId,
    version: 1,
  };
}

export function buildListCustomSubmissionsRequest(
  limit = 25,
  requestId = createSocialRequestId('customlist'),
): SocialCommandRequest<'list-cosmetic-custom-submissions', { limit: number }> {
  return {
    action: 'list-cosmetic-custom-submissions',
    payload: { limit },
    requestId,
    version: 1,
  };
}

export function buildEquipCustomAssetRequest(
  assetId: string,
  requestId = createSocialRequestId('customequip'),
): SocialCommandRequest<'equip-cosmetic-custom-asset', { assetId: string }> {
  return {
    action: 'equip-cosmetic-custom-asset',
    payload: { assetId },
    requestId,
    version: 1,
  };
}

export function buildUnequipCustomAssetRequest(
  category: CustomCosmeticCategory,
  requestId = createSocialRequestId('customunequip'),
): SocialCommandRequest<'unequip-cosmetic-custom-asset', { category: CustomCosmeticCategory }> {
  return {
    action: 'unequip-cosmetic-custom-asset',
    payload: { category },
    requestId,
    version: 1,
  };
}

export function resolveCustomUploadDraft(input: {
  category: CustomCosmeticCategory;
  contentType: string;
  fallbackAssetId?: string;
  fallbackAssetVersionId?: string;
  sizeBytes: number;
  uri: string;
}) {
  if (input.contentType === 'video/mp4' || input.contentType.startsWith('video/')) {
    return { ok: false as const, reason: 'CUSTOM_MP4_DISABLED' };
  }
  const mapped = FORMAT_BY_CONTENT_TYPE[input.contentType];
  const format = mapped?.categoryFormats[input.category];
  if (!mapped || !format) return { ok: false as const, reason: 'UNSUPPORTED_FORMAT' };
  if (format === 'mp4') return { ok: false as const, reason: 'CUSTOM_MP4_DISABLED' };
  const maxBytes = format === 'lottie-json' ? 1 * 1024 * 1024 : 3 * 1024 * 1024;
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > maxBytes) {
    return { ok: false as const, reason: 'SIZE_INVALID' };
  }
  if (format === 'lottie-json') {
    if (
      !ASSET_ID_PATTERN.test(input.fallbackAssetId || '')
      || !VERSION_ID_PATTERN.test(input.fallbackAssetVersionId || '')
    ) {
      return { ok: false as const, reason: 'FALLBACK_REQUIRED' };
    }
  } else if (input.fallbackAssetId || input.fallbackAssetVersionId) {
    return { ok: false as const, reason: 'FALLBACK_FORBIDDEN' };
  }
  return {
    ok: true as const,
    value: {
      category: input.category,
      contentType: input.contentType,
      ...(format === 'lottie-json' ? {
        fallbackAssetId: input.fallbackAssetId!,
        fallbackAssetVersionId: input.fallbackAssetVersionId!,
      } : {}),
      format,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    },
  };
}

export function validateCustomAttestation(attestation: string) {
  const value = attestation.trim();
  return value.length >= ATTESTATION_MIN && value.length <= ATTESTATION_MAX;
}

export function mapCustomSubmissionSummaries(value: unknown): CustomSubmissionSummary[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const submissions = (value as { submissions?: unknown }).submissions;
  if (!Array.isArray(submissions)) return [];
  return submissions.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const submissionId = readString(row.submissionId);
    if (!SUBMISSION_ID_PATTERN.test(submissionId) || 'sourcePath' in row) return [];
    return [{
      approvedAssetId: readString(row.approvedAssetId),
      assetVersionId: readString(row.assetVersionId),
      category: readString(row.category),
      format: readString(row.format),
      revision: Number(row.revision || 0),
      status: readString(row.status),
      submissionId,
      updatedAt: row.updatedAt,
    }];
  });
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
