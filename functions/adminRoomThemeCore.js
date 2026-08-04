const { validateRoomThemeManifestV1 } = require('./roomThemeCore');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function normalizeAdminRoomThemeLookup(body = {}) {
  const themeId = readThemeId(body.themeId);
  return themeId
    ? { ok: true, value: { themeId } }
    : { ok: false, status: 400, error: 'A valid themeId is required.' };
}

function normalizeAdminRoomThemeMutation(body = {}) {
  const themeId = readThemeId(body.themeId);
  const operation = typeof body.operation === 'string' ? body.operation.trim() : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const expectedRevision = Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0
    ? body.expectedRevision
    : null;
  const rollbackRevision = Number.isSafeInteger(body.rollbackRevision) && body.rollbackRevision >= 1
    ? body.rollbackRevision
    : null;
  if (
    !themeId
    || !['save-draft', 'publish', 'emergency-disable', 'rollback'].includes(operation)
    || !REQUEST_ID_PATTERN.test(requestId)
    || reason.length < 3
    || expectedRevision === null
  ) return { ok: false, status: 400, error: 'A valid room-theme mutation is required.' };
  if (operation === 'rollback') {
    if (rollbackRevision === null) return { ok: false, status: 400, error: 'A rollback revision is required.' };
    return { ok: true, value: { expectedRevision, operation, reason, requestId, rollbackRevision, themeId } };
  }
  if (operation === 'emergency-disable') {
    return { ok: true, value: { expectedRevision, operation, reason, requestId, themeId } };
  }
  const candidate = body.manifest && typeof body.manifest === 'object'
    ? {
        ...body.manifest,
        manifestVersion: 1,
        publicationStatus: operation === 'publish' ? 'published' : 'draft',
        revision: Math.max(1, expectedRevision + 1),
        themeId,
      }
    : undefined;
  const manifest = candidate ? validateRoomThemeManifestV1(candidate, themeId) : undefined;
  if (!manifest) return { ok: false, status: 400, error: 'The room-theme manifest is invalid.' };
  if (operation === 'publish' && !manifest.assets.background) {
    return { ok: false, status: 400, error: 'A versioned background asset is required before publishing.' };
  }
  return { ok: true, value: { expectedRevision, manifest, operation, reason, requestId, themeId } };
}

function readThemeId(value) {
  const themeId = typeof value === 'string' ? value.trim() : '';
  return THEME_ID_PATTERN.test(themeId) ? themeId : '';
}

module.exports = {
  normalizeAdminRoomThemeLookup,
  normalizeAdminRoomThemeMutation,
};
