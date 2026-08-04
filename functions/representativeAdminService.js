const {
  mapRepresentativeAdminTransfer,
  mapRepresentativeOperationalEvent,
  mapRepresentativePolicy,
} = require('./representativeAdminCore');

async function resolveRepresentativeOperations({ clock = { nowMillis: () => Date.now() }, db, publicReference = '' }) {
  const [policy, transfers, reversals, security, audits] = await Promise.all([
    db.doc('appConfig/representativeTransferPolicy').get(),
    db.collection('representativeTransfers').orderBy('createdAt', 'desc').limit(30).get(),
    db.collection('representativeTransferReversals').orderBy('createdAt', 'desc').limit(30).get(),
    db.collection('representativePortalSecurityEvents').orderBy('createdAt', 'desc').limit(30).get(),
    db.collection('adminAuditEvents').orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const reversalByTransfer = new Map(reversals.docs.map((document) => [document.id, document.data()]));
  const recentTransfers = transfers.docs
    .map((document) => mapRepresentativeAdminTransfer(document.id, document.data(), reversalByTransfer.get(document.id), undefined, clock.nowMillis()))
    .filter(Boolean);
  let receipt;
  if (publicReference) {
    const reference = await db.doc(`representativePublicReferences/${publicReference}`).get();
    const transferId = reference.exists && typeof reference.data()?.transferId === 'string' ? reference.data().transferId : '';
    if (transferId) {
      const [transfer, reversal] = await Promise.all([
        db.doc(`representativeTransfers/${transferId}`).get(),
        db.doc(`representativeTransferReversals/${transferId}`).get(),
      ]);
      const recipientUid = transfer.data()?.recipientUid;
      const recipientWallet = recipientUid ? await db.doc(`walletSummaries/${recipientUid}`).get() : undefined;
      const currency = transfer.data()?.currency;
      const recipientBalance = ['coins', 'diamonds'].includes(currency)
        ? recipientWallet?.data()?.balances?.[currency]
        : undefined;
      receipt = transfer.exists
        ? mapRepresentativeAdminTransfer(transferId, transfer.data(), reversal.data(), recipientBalance, clock.nowMillis())
        : undefined;
    }
  }
  return {
    auditHistory: audits.docs
      .filter((document) => String(document.data()?.action || '').startsWith('representative-'))
      .slice(0, 30)
      .map((document) => mapRepresentativeOperationalEvent(document.id, document.data())).filter(Boolean),
    policy: mapRepresentativePolicy(policy.data()),
    receipt: receipt || null,
    recentReversals: reversals.docs
      .map((document) => mapRepresentativeOperationalEvent(document.id, document.data())).filter(Boolean),
    recentSecurityEvents: security.docs
      .map((document) => mapRepresentativeOperationalEvent(document.id, document.data())).filter(Boolean),
    recentTransfers,
  };
}

async function executeRepresentativePolicyUpdate({ db, decodedToken, fieldValue, input }) {
  const policyRef = db.doc('appConfig/representativeTransferPolicy');
  const auditRef = db.doc(`adminAuditEvents/representative-policy_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [policy, audit] = await Promise.all([transaction.get(policyRef), transaction.get(auditRef)]);
    if (audit.exists) return idempotentAudit(audit, decodedToken.uid, 'representative-policy-update', auditRef.id);
    requireCurrentRevision(policy, input.expectedUpdatedAt, 'Representative policy');
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(policyRef, {
      contractVersion: 1,
      limits: input.limits,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    transaction.create(auditRef, {
      action: 'representative-policy-update',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: { limits: input.limits },
      before: { limits: policy.data()?.limits || {} },
      createdAt: timestamp,
      kind: 'economy',
      note: input.reason,
      status: 'completed',
      targetUid: 'appConfig/representativeTransferPolicy',
    });
    return auditRef.id;
  });
}

async function executeRepresentativeOverrideUpdate({ db, decodedToken, fieldValue, input }) {
  const privilegeRef = db.doc(`representativePrivileges/${input.targetUid}`);
  const auditRef = db.doc(`adminAuditEvents/representative-override_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [privilege, audit] = await Promise.all([transaction.get(privilegeRef), transaction.get(auditRef)]);
    if (audit.exists) return idempotentAudit(audit, decodedToken.uid, 'representative-override-update', auditRef.id);
    if (!privilege.exists) throw httpError(404, 'Representative privilege was not found.');
    requireCurrentRevision(privilege, input.expectedUpdatedAt, 'Representative override');
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(privilegeRef, {
      ...privilege.data(),
      limits: input.limits,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    transaction.create(auditRef, {
      action: 'representative-override-update',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: { limits: input.limits },
      before: { limits: privilege.data()?.limits || {} },
      createdAt: timestamp,
      kind: 'economy',
      note: input.reason,
      status: 'completed',
      targetUid: input.targetUid,
    });
    return auditRef.id;
  });
}

async function executeRepresentativePinReset({ db, decodedToken, fieldValue, input }) {
  const pinRef = db.doc(`representativeTransferPins/${input.targetUid}`);
  const auditRef = db.doc(`adminAuditEvents/representative-pin-reset_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [pin, audit] = await Promise.all([transaction.get(pinRef), transaction.get(auditRef)]);
    if (audit.exists) return idempotentAudit(audit, decodedToken.uid, 'representative-pin-reset', auditRef.id);
    if (!pin.exists) throw httpError(409, 'The representative has not configured a transfer PIN.');
    requireCurrentRevision(pin, input.expectedUpdatedAt, 'Representative PIN');
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(pinRef, {
      ...pin.data(),
      failedAttempts: 0,
      lockedUntil: null,
      resetRequired: true,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    transaction.create(auditRef, {
      action: 'representative-pin-reset',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      kind: 'economy',
      note: input.reason,
      status: 'completed',
      targetUid: input.targetUid,
    });
    return auditRef.id;
  });
}

function requireCurrentRevision(snapshot, expectedUpdatedAt, label) {
  const current = snapshot.exists ? timestampIso(snapshot.data()?.updatedAt) || 'missing' : 'missing';
  if (current !== expectedUpdatedAt) {
    throw httpError(409, `${label} changed since it was loaded. Refresh before continuing.`);
  }
}

function idempotentAudit(snapshot, actorUid, action, eventId) {
  if (snapshot.data()?.actorUid === actorUid && snapshot.data()?.action === action) return eventId;
  throw httpError(409, 'Admin request ID conflicts with an existing operation.');
}

function timestampIso(value) {
  return value && typeof value.toMillis === 'function' ? new Date(value.toMillis()).toISOString() : '';
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = {
  executeRepresentativeOverrideUpdate,
  executeRepresentativePinReset,
  executeRepresentativePolicyUpdate,
  resolveRepresentativeOperations,
};
