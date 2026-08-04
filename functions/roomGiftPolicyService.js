const { resolveAdminRole } = require('./adminClaimsCore');
const { mapRoomGiftPolicyForAdmin } = require('./roomGiftPolicyCore');

const POLICY_PATH = 'appConfig/roomGiftCommissionPolicy';
const POLICY_HISTORY_COLLECTION = 'roomGiftCommissionPolicyVersions';

async function resolveRoomGiftPolicy(db) {
  const snapshot = await db.doc(POLICY_PATH).get();
  return mapRoomGiftPolicyForAdmin(snapshot.exists ? snapshot.data() : undefined);
}

async function updateRoomGiftPolicy({
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  if (resolveAdminRole(decodedToken) !== 'owner') {
    throw serviceError(403, 'Only a Platform Owner can change the room gift commission.');
  }
  const policyRef = db.doc(POLICY_PATH);
  const auditRef = db.doc(`adminAuditEvents/room_gift_policy_${input.requestId}`);

  return db.runTransaction(async (transaction) => {
    const [policySnapshot, auditSnapshot] = await Promise.all([
      transaction.get(policyRef),
      transaction.get(auditRef),
    ]);

    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (
        previous.action === 'room-gift-policy-update'
        && previous.actorUid === decodedToken.uid
        && previous.requestId === input.requestId
        && previous.after?.commissionBps === input.commissionBps
        && previous.before?.version === input.expectedVersion
      ) {
        return { eventId: auditRef.id, policy: previous.after, replayed: true };
      }
      throw serviceError(409, 'This request ID conflicts with an existing operation.');
    }

    const before = mapRoomGiftPolicyForAdmin(policySnapshot.exists ? policySnapshot.data() : undefined);
    if (before.version !== input.expectedVersion) {
      throw serviceError(409, 'The gift commission policy changed. Refresh before saving again.');
    }

    const version = before.version + 1;
    const historyRef = db.doc(`${POLICY_HISTORY_COLLECTION}/v_${String(version).padStart(8, '0')}`);
    const historySnapshot = await transaction.get(historyRef);
    if (historySnapshot.exists) {
      throw serviceError(409, 'The next gift commission policy version already exists.');
    }

    const timestamp = fieldValue.serverTimestamp();
    const afterDocument = {
      commissionBps: input.commissionBps,
      effectiveAt: timestamp,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
      version,
    };
    const after = {
      commissionBps: input.commissionBps,
      configured: true,
      effectiveAt: timestamp,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
      version,
    };

    transaction.set(policyRef, afterDocument);
    transaction.create(historyRef, {
      ...afterDocument,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      policyId: historyRef.id,
      reason: input.reason,
      source: 'admin-dashboard',
    });
    transaction.create(auditRef, {
      action: 'room-gift-policy-update',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after,
      before,
      createdAt: timestamp,
      kind: 'economy',
      note: input.reason,
      requestId: input.requestId,
      source: 'admin-dashboard',
      status: 'completed',
      targetUid: POLICY_PATH,
    });

    return { eventId: auditRef.id, policy: after, replayed: false };
  });
}

function serviceError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = {
  POLICY_HISTORY_COLLECTION,
  POLICY_PATH,
  resolveRoomGiftPolicy,
  updateRoomGiftPolicy,
};
