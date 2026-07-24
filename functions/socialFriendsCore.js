const crypto = require('node:crypto');

const FRIEND_MUTATION_ACTIONS = Object.freeze([
  'send-friend-request',
  'accept-friend-request',
  'decline-friend-request',
  'cancel-friend-request',
  'remove-friend',
]);

function createFriendshipId(firstUid, secondUid) {
  const members = [firstUid, secondUid].sort();
  return crypto
    .createHash('sha256')
    .update(`social-friendship-v1\u0000${members[0]}\u0000${members[1]}`)
    .digest('hex');
}

function normalizeFriendTargetInput(input, requestingUid) {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'targetUid')
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';

  if (!targetUid || targetUid.length > 128 || targetUid === requestingUid) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return { ok: true, value: { targetUid } };
}

function resolveFriendRelationship({ friendship, request, requestingUid }) {
  if (
    friendship
    && Array.isArray(friendship.memberUids)
    && friendship.memberUids.includes(requestingUid)
  ) {
    return 'friends';
  }

  if (request?.status !== 'pending') {
    return 'none';
  }

  if (request.senderUid === requestingUid) {
    return 'outgoing';
  }

  if (request.recipientUid === requestingUid) {
    return 'incoming';
  }

  return 'none';
}

function otherMemberUid(memberUids, requestingUid) {
  return Array.isArray(memberUids)
    ? memberUids.find((uid) => typeof uid === 'string' && uid !== requestingUid)
    : undefined;
}

module.exports = {
  FRIEND_MUTATION_ACTIONS,
  createFriendshipId,
  normalizeFriendTargetInput,
  otherMemberUid,
  resolveFriendRelationship,
};
