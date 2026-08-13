import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ACCOUNT_DELETION_GRACE_MS,
  AVATAR_MAX_BYTES,
  avatarPublishedPath,
  avatarQuarantinePath,
  createAvatarUploadId,
  deletionSubject,
  normalizeAvatarUploadInput,
  normalizeProfilePresentation,
  normalizeSearchName,
} = require('./profileProductionCore');

describe('profile production contracts', () => {
  it('normalizes an atomic presentation and its Arabic search projection', () => {
    expect(normalizeProfilePresentation({ avatarLabel: ' س ', bio: ' نبذة ', countryCode: 'iq', displayName: '  سَلام   كريم ', gender: 'male' })).toEqual({
      ok: true,
      value: { avatarLabel: 'س', bio: 'نبذة', countryCode: 'IQ', displayName: 'سَلام كريم', gender: 'male' },
    });
    expect(normalizeSearchName('سَلام كريم')).toBe('سلام كريم');
  });

  it('rejects oversized, unsupported, or checksum-less avatar sources', () => {
    expect(normalizeAvatarUploadInput({ contentType: 'image/gif', sha256: 'a'.repeat(64), sizeBytes: 1 }).ok).toBe(false);
    expect(normalizeAvatarUploadInput({ contentType: 'image/png', sha256: '', sizeBytes: 1 }).ok).toBe(false);
    expect(normalizeAvatarUploadInput({ contentType: 'image/png', sha256: 'a'.repeat(64), sizeBytes: AVATAR_MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('creates stable owner-scoped immutable paths and deletion subjects', () => {
    const requestId = 'avatar_1234567890abcdef';
    const uploadId = createAvatarUploadId('user-1', requestId);
    expect(uploadId).toMatch(/^avu_[a-f0-9]{40}$/);
    expect(createAvatarUploadId('user-1', requestId)).toBe(uploadId);
    expect(avatarQuarantinePath('user-1', uploadId, 'png')).toBe(`avatar-quarantine/user-1/${uploadId}/source.png`);
    expect(avatarPublishedPath('user-1', uploadId)).toBe(`avatars-public/user-1/${uploadId}.webp`);
    expect(deletionSubject('user-1', 'production-secret-value')).toMatch(/^deleted_[a-f0-9]{32}$/);
    expect(ACCOUNT_DELETION_GRACE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
