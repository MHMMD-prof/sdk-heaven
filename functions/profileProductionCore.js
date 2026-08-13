const crypto = require('node:crypto');

const AVATAR_UPLOAD_TTL_MS = 15 * 60 * 1000;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const UID_PATTERN = /^[^/]{1,128}$/;
const CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function normalizeProfilePresentation(input) {
  if (!input || typeof input !== 'object') return { ok: false, code: 'INVALID_REQUEST' };
  const displayName = normalizeDisplayName(input.displayName);
  const avatarLabel = typeof input.avatarLabel === 'string' ? [...input.avatarLabel.trim()][0] || '' : '';
  const bio = typeof input.bio === 'string' ? input.bio.trim() : '';
  const countryCode = typeof input.countryCode === 'string' ? input.countryCode.trim().toUpperCase() : '';
  const gender = input.gender === 'male' || input.gender === 'female' ? input.gender : undefined;
  if (displayName.length < 2 || displayName.length > 32 || !avatarLabel || bio.length > 160 || !/^[A-Z]{2}$/.test(countryCode)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { avatarLabel, bio, countryCode, displayName, gender } };
}

function normalizeAvatarUploadInput(input) {
  if (!input || typeof input !== 'object') return { ok: false, code: 'INVALID_REQUEST' };
  const contentType = typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : '';
  const sizeBytes = Number(input.sizeBytes);
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.trim().toLowerCase() : '';
  if (!CONTENT_TYPES.has(contentType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > AVATAR_MAX_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, code: 'UPLOAD_INVALID' };
  }
  return { ok: true, value: { contentType, extension: CONTENT_TYPES.get(contentType), sha256, sizeBytes } };
}

function createAvatarUploadId(uid, requestId) {
  if (!UID_PATTERN.test(uid || '') || !REQUEST_ID_PATTERN.test(requestId || '')) return '';
  return `avu_${crypto.createHash('sha256').update(`avatar-v1\0${uid}\0${requestId}`).digest('hex').slice(0, 40)}`;
}

function avatarQuarantinePath(uid, uploadId, extension) {
  return `avatar-quarantine/${uid}/${uploadId}/source.${extension}`;
}

function avatarPublishedPath(uid, uploadId) {
  return `avatars-public/${uid}/${uploadId}.webp`;
}

function normalizeDisplayName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').normalize('NFKC') : '';
}

function normalizeSearchName(value) {
  return normalizeDisplayName(value)
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .toLocaleLowerCase('ar');
}

function deletionSubject(uid, secret) {
  if (!UID_PATTERN.test(uid || '') || typeof secret !== 'string' || secret.length < 16) return '';
  return `deleted_${crypto.createHmac('sha256', secret).update(uid).digest('hex').slice(0, 32)}`;
}

module.exports = {
  ACCOUNT_DELETION_GRACE_MS,
  AVATAR_MAX_BYTES,
  AVATAR_UPLOAD_TTL_MS,
  avatarPublishedPath,
  avatarQuarantinePath,
  createAvatarUploadId,
  deletionSubject,
  normalizeAvatarUploadInput,
  normalizeProfilePresentation,
  normalizeSearchName,
};
