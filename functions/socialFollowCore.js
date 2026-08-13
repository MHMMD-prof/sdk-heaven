const FOLLOW_MUTATION_ACTIONS = Object.freeze(['follow-user', 'unfollow-user']);

function normalizeFollowTargetInput(input, requestingUid) {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'targetUid')
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';

  if (!targetUid || targetUid.length > 128 || targetUid === requestingUid || targetUid.includes('/')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return { ok: true, value: { targetUid } };
}

function normalizeFollowListInput(input, requestingUid) {
  if (input === undefined || input === null) {
    return { ok: true, value: { targetUid: requestingUid } };
  }

  if (
    typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'targetUid')
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  if (input.targetUid === undefined) {
    return { ok: true, value: { targetUid: requestingUid } };
  }

  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!targetUid || targetUid.length > 128 || targetUid.includes('/')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return { ok: true, value: { targetUid } };
}

function resolveFollowRelationship({ followingEdge, followedByEdge }) {
  return {
    followedBy: followedByEdge === true,
    status: followingEdge === true ? 'following' : 'none',
  };
}

function readFollowCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  FOLLOW_MUTATION_ACTIONS,
  normalizeFollowListInput,
  normalizeFollowTargetInput,
  readFollowCount,
  resolveFollowRelationship,
};
