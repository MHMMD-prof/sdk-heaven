const {
  DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
  DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
  DIRECT_CHAT_RETENTION_POLICY_PATH,
  DIRECT_CHAT_RETENTION_POLICY_VERSION,
  DIRECT_CHAT_RETENTION_SWEEP_PATH,
  mapDirectChatRetentionPolicy,
} = require('./directChatRetentionCore');
const { mapDirectChatFlags, mapDirectChatRestriction } = require('./directChatCore');
const { resolveDirectChatStageFromFlags } = require('./directChatRolloutCore');

const DIRECT_CHAT_RESTRICT_AUDIT_ACTIONS = Object.freeze([
  'direct-chat-restrict-direct-chat',
  'direct-chat-clear-direct-chat-restriction',
]);
const DIRECT_CHAT_USER_RESTRICT_AUDIT_LIMIT = 8;

function retentionPolicyFields(policy) {
  return {
    evidenceRetentionDays: policy.evidenceRetentionDays,
    legalHoldRetentionDays: policy.legalHoldRetentionDays,
    messageRetentionDays: policy.messageRetentionDays,
    policyVersion: policy.policyVersion,
  };
}

function retentionBoundsPayload() {
  return {
    evidenceRetentionDays: DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
    legalHoldRetentionDays: DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
    messageRetentionDays: DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
  };
}

function isSameRetentionPolicy(current, requested) {
  return current.evidenceRetentionDays === requested.evidenceRetentionDays
    && current.legalHoldRetentionDays === requested.legalHoldRetentionDays
    && current.messageRetentionDays === requested.messageRetentionDays;
}

function mapAdminDirectChatRestriction(value, uid, nowMs = Date.now()) {
  const mapped = mapDirectChatRestriction(value, uid, nowMs);
  if (!mapped) return null;
  const reportId = typeof value?.reportId === 'string' ? value.reportId.trim() : '';
  return {
    active: mapped.active,
    actorUid: mapped.actorUid,
    endsAt: Number.isFinite(mapped.endsAtMs) ? new Date(mapped.endsAtMs).toISOString() : '',
    reason: mapped.reason,
    reportId,
    startsAt: Number.isFinite(mapped.startsAtMs) ? new Date(mapped.startsAtMs).toISOString() : '',
    state: mapped.state,
  };
}

function mapAdminDirectChatRestrictAudit(id, data = {}) {
  const action = typeof data.action === 'string' ? data.action : '';
  if (!DIRECT_CHAT_RESTRICT_AUDIT_ACTIONS.includes(action)) return null;
  return {
    action,
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    createdAt: readIso(data.createdAt),
    id,
    note: typeof data.note === 'string' ? data.note.slice(0, 300) : '',
    reportId: typeof data.reportId === 'string' ? data.reportId : '',
    status: typeof data.status === 'string' ? data.status : '',
  };
}

async function resolveDirectChatRetentionPolicy(db) {
  const snapshot = await db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH).get();
  const policy = mapDirectChatRetentionPolicy(snapshot.exists ? snapshot.data() : undefined);
  return {
    bounds: retentionBoundsPayload(),
    policy: {
      ...retentionPolicyFields(policy),
      source: policy.source,
      updatedAt: snapshot.exists ? readIso(snapshot.data()?.updatedAt) : '',
      updatedBy: typeof snapshot.data()?.updatedBy === 'string' ? snapshot.data().updatedBy : '',
    },
  };
}

async function executeDirectChatRetentionPolicySet(db, decodedToken, input, fieldValue) {
  const policyRef = db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH);
  const auditRef = db.doc(`adminAuditEvents/direct_chat_retention_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [policySnapshot, auditSnapshot] = await Promise.all([
      transaction.get(policyRef),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      const existing = auditSnapshot.data();
      if (existing?.actorUid === decodedToken.uid) {
        return { eventId: auditRef.id, unchanged: existing.status === 'unchanged' };
      }
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    const current = mapDirectChatRetentionPolicy(policySnapshot.exists ? policySnapshot.data() : undefined);
    const requested = mapDirectChatRetentionPolicy({
      evidenceRetentionDays: input.evidenceRetentionDays ?? current.evidenceRetentionDays,
      legalHoldRetentionDays: input.legalHoldRetentionDays ?? current.legalHoldRetentionDays,
      messageRetentionDays: input.messageRetentionDays ?? current.messageRetentionDays,
      policyVersion: DIRECT_CHAT_RETENTION_POLICY_VERSION,
    });
    const timestamp = fieldValue.serverTimestamp();
    if (isSameRetentionPolicy(current, requested)) {
      transaction.create(auditRef, {
        action: 'direct-chat-retention-policy',
        actorEmail: decodedToken.email || '',
        actorUid: decodedToken.uid,
        after: retentionPolicyFields(requested),
        before: retentionPolicyFields(current),
        createdAt: timestamp,
        entityId: 'current',
        entityType: 'system',
        kind: 'direct-chat-retention',
        note: input.reason,
        source: 'admin-dashboard',
        status: 'unchanged',
      });
      return { eventId: auditRef.id, unchanged: true };
    }
    transaction.set(policyRef, {
      evidenceRetentionDays: requested.evidenceRetentionDays,
      legalHoldRetentionDays: requested.legalHoldRetentionDays,
      messageRetentionDays: requested.messageRetentionDays,
      policyVersion: requested.policyVersion,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'direct-chat-retention-policy',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: retentionPolicyFields(requested),
      before: retentionPolicyFields(current),
      createdAt: timestamp,
      entityId: 'current',
      entityType: 'system',
      kind: 'direct-chat-retention',
      note: input.reason,
      source: 'admin-dashboard',
      status: 'completed',
    });
    return {
      eventId: auditRef.id,
      policy: retentionPolicyFields(requested),
      unchanged: false,
    };
  });
}

async function resolveDirectChatOpsStatus(db) {
  const [configSnapshot, rolloutSnapshot, policySnapshot, sweepSnapshot, restrictionSnapshot, reconcileSnapshot] = await Promise.all([
    db.doc('appConfig/socialFeatures').get(),
    db.doc('appRuntime/directChatRollout').get(),
    db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH).get(),
    db.doc(DIRECT_CHAT_RETENTION_SWEEP_PATH).get(),
    safeQuery(() => db.collection('directChatRestrictions').where('state', '==', 'restricted').limit(100).get()),
    safeQuery(() => db.collection('adminAuditEvents').where('action', '==', 'direct-chat-reconcile').orderBy('createdAt', 'desc').limit(1).get()),
  ]);
  const flags = mapDirectChatFlags(configSnapshot.exists ? configSnapshot.data() : undefined);
  const stage = resolveDirectChatStageFromFlags(flags);
  const policy = mapDirectChatRetentionPolicy(policySnapshot.exists ? policySnapshot.data() : undefined);
  const sweep = sweepSnapshot.exists ? sweepSnapshot.data() : undefined;
  const lastReconcileDoc = reconcileSnapshot?.docs?.[0];
  const lastReconcileData = lastReconcileDoc?.data();
  return {
    flags,
    lastReconcile: lastReconcileDoc
      ? {
        createdAt: readIso(lastReconcileData?.createdAt),
        id: lastReconcileDoc.id,
      }
      : null,
    retention: {
      ...retentionPolicyFields(policy),
      source: policy.source,
      sweepCursor: typeof sweep?.cursor === 'string' ? sweep.cursor : '',
      sweepUpdatedAt: sweep ? readIso(sweep.updatedAt) : '',
      sweepWrapped: sweep?.wrapped === true,
    },
    restrictedAccountSampleCount: restrictionSnapshot ? restrictionSnapshot.size : null,
    rollout: rolloutSnapshot.exists
      ? {
        note: typeof rolloutSnapshot.data()?.note === 'string' ? rolloutSnapshot.data().note : '',
        stageId: Number.isSafeInteger(rolloutSnapshot.data()?.stageId) ? rolloutSnapshot.data().stageId : null,
        updatedAt: readIso(rolloutSnapshot.data()?.updatedAt),
        updatedBy: typeof rolloutSnapshot.data()?.updatedBy === 'string' ? rolloutSnapshot.data().updatedBy : '',
      }
      : null,
    stage: stage
      ? { name: stage.name, stageId: stage.stageId }
      : null,
  };
}

async function resolveAdminUserDirectChatContext(db, targetUid, nowMs = Date.now()) {
  const [restrictionSnapshot, auditSnapshot] = await Promise.all([
    safeQuery(() => db.doc(`directChatRestrictions/${targetUid}`).get()),
    safeQuery(() => db.collection('adminAuditEvents')
      .where('targetUid', '==', targetUid)
      .orderBy('createdAt', 'desc')
      .limit(DIRECT_CHAT_USER_RESTRICT_AUDIT_LIMIT * 4)
      .get()),
  ]);
  const restrictionData = restrictionSnapshot?.exists ? restrictionSnapshot.data() : undefined;
  const recentAudits = (auditSnapshot?.docs || [])
    .map((doc) => mapAdminDirectChatRestrictAudit(doc.id, doc.data()))
    .filter(Boolean)
    .slice(0, DIRECT_CHAT_USER_RESTRICT_AUDIT_LIMIT);
  return {
    recentAudits,
    restriction: mapAdminDirectChatRestriction(restrictionData, targetUid, nowMs),
  };
}

async function safeQuery(factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn('[directChatAdminOps] optional query failed:', error?.code || error?.message || 'query-failed');
    return null;
  }
}

function readIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return '';
}

module.exports = {
  DIRECT_CHAT_RESTRICT_AUDIT_ACTIONS,
  executeDirectChatRetentionPolicySet,
  isSameRetentionPolicy,
  mapAdminDirectChatRestrictAudit,
  mapAdminDirectChatRestriction,
  resolveAdminUserDirectChatContext,
  resolveDirectChatOpsStatus,
  resolveDirectChatRetentionPolicy,
  retentionBoundsPayload,
  retentionPolicyFields,
};
