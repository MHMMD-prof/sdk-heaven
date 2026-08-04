const { mapCommissionPolicy, timestampToMillis } = require('./roomGiftCore');

const ROOM_GIFT_POLICY_ACTION = 'room-gift-policy-update';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

function normalizeRoomGiftPolicyUpdate(body = {}) {
  const commissionBps = Number(body.commissionBps);
  const expectedVersion = Number(body.expectedVersion);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    return policyError(400, 'commissionBps must be an integer from 0 to 10000.');
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return policyError(400, 'A valid expected policy version is required.');
  }
  if (reason.length < 3) {
    return policyError(400, 'A reason with at least 3 characters is required.');
  }
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return policyError(400, 'A valid requestId is required.');
  }
  return {
    ok: true,
    value: {
      commissionBps,
      expectedVersion,
      reason,
      requestId,
    },
  };
}

function mapRoomGiftPolicyForAdmin(data) {
  const policy = mapCommissionPolicy(data);
  if (!policy) {
    return {
      commissionBps: 0,
      configured: false,
      effectiveAt: '',
      updatedAt: '',
      updatedBy: '',
      version: 0,
    };
  }
  return {
    commissionBps: policy.commissionBps,
    configured: true,
    effectiveAt: timestampToIso(data?.effectiveAt),
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
    version: policy.version,
  };
}

function timestampToIso(value) {
  const millis = timestampToMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : '';
}

function policyError(status, error) {
  return { ok: false, status, error };
}

module.exports = {
  ROOM_GIFT_POLICY_ACTION,
  mapRoomGiftPolicyForAdmin,
  normalizeRoomGiftPolicyUpdate,
};
