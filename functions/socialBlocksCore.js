const BLOCK_MUTATION_ACTIONS = Object.freeze(['block-user', 'unblock-user']);

function normalizeBlockTargetInput(input, requestingUid) {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'targetUid')
  ) return { ok: false, code: 'INVALID_REQUEST' };
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!targetUid || targetUid.length > 128 || targetUid === requestingUid || targetUid.includes('/')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { targetUid } };
}

module.exports = { BLOCK_MUTATION_ACTIONS, normalizeBlockTargetInput };
