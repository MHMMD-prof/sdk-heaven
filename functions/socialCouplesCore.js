const crypto = require('node:crypto');

const COUPLE_MUTATION_ACTIONS = Object.freeze([
  'send-couple-request',
  'accept-couple-request',
  'decline-couple-request',
  'cancel-couple-request',
  'dissolve-couple',
]);

function createCoupleId(firstUid, secondUid) {
  const members = [firstUid, secondUid].sort();
  return crypto
    .createHash('sha256')
    .update(`social-couple-v1\u0000${members[0]}\u0000${members[1]}`)
    .digest('hex');
}

function normalizeCoupleTargetInput(input, requestingUid) {
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

function resolveCoupleRelationship({ couple, request, requestingUid }) {
  if (couple && Array.isArray(couple.memberUids) && couple.memberUids.includes(requestingUid)) {
    return 'coupled';
  }

  if (request?.status !== 'pending') return 'none';
  if (request.senderUid === requestingUid) return 'outgoing';
  if (request.recipientUid === requestingUid) return 'incoming';
  return 'none';
}

function otherCoupleUid(memberUids, requestingUid) {
  return Array.isArray(memberUids)
    ? memberUids.find((uid) => typeof uid === 'string' && uid !== requestingUid)
    : undefined;
}

module.exports = {
  COUPLE_MUTATION_ACTIONS,
  createCoupleId,
  normalizeCoupleTargetInput,
  otherCoupleUid,
  resolveCoupleRelationship,
};
