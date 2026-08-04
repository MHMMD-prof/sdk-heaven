const { validateRoomTargetTemplateV1 } = require('./roomTargetCore');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

function normalizeAdminRoomTargetMutation(body = {}) {
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
    !['save-draft', 'publish', 'emergency-disable', 'rollback'].includes(operation)
    || !REQUEST_ID_PATTERN.test(requestId)
    || reason.length < 3
    || expectedRevision === null
  ) return { ok: false, status: 400, error: 'A valid Room Target campaign mutation is required.' };
  if (operation === 'rollback') {
    return rollbackRevision === null
      ? { ok: false, status: 400, error: 'A rollback revision is required.' }
      : { ok: true, value: { expectedRevision, operation, reason, requestId, rollbackRevision } };
  }
  if (operation === 'emergency-disable') {
    return { ok: true, value: { expectedRevision, operation, reason, requestId } };
  }
  const candidate = body.template && typeof body.template === 'object'
    ? {
        ...body.template,
        publicationStatus: operation === 'publish' ? 'published' : 'draft',
        schemaVersion: 1,
        templateId: 'global-room-target',
        templateVersion: 1,
      }
    : undefined;
  const template = candidate ? validateRoomTargetTemplateV1(candidate) : undefined;
  if (!template) {
    return {
      ok: false,
      status: 400,
      error: 'The Room Target campaign configuration is invalid.',
    };
  }
  return { ok: true, value: { expectedRevision, operation, reason, requestId, template } };
}

function normalizeAdminRoomTargetMemberHold(body = {}) {
  const operation = typeof body.operation === 'string' ? body.operation.trim() : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const roomId = normalizeId(body.roomId, 128);
  const cycleId = normalizeId(body.cycleId, 120);
  const targetUid = normalizeId(body.targetUid, 128);
  if (
    !['apply', 'release'].includes(operation)
    || !REQUEST_ID_PATTERN.test(requestId)
    || reason.length < 3
    || !roomId
    || !cycleId
    || !targetUid
  ) return { ok: false, status: 400, error: 'A valid Room Target member hold is required.' };
  return {
    ok: true,
    value: { cycleId, operation, reason, requestId, roomId, targetUid },
  };
}

function normalizeId(value, maxLength) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= maxLength && !id.includes('/') ? id : '';
}

module.exports = {
  normalizeAdminRoomTargetMemberHold,
  normalizeAdminRoomTargetMutation,
};
