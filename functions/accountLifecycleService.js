const { ACCOUNT_DELETION_GRACE_MS, deletionSubject } = require('./profileProductionCore');

const RECENT_AUTH_MS = 10 * 60 * 1000;

function deletionStatus(snapshot, nowMs = Date.now()) {
  if (!snapshot?.exists) return { state: 'active' };
  const data = snapshot.data();
  return {
    canCancel: data.state === 'deletion-pending' && data.purgeAfter?.toMillis?.() > nowMs,
    purgeAfterMillis: data.purgeAfter?.toMillis?.() || 0,
    requestedAtMillis: data.requestedAt?.toMillis?.() || 0,
    state: data.state || 'active',
  };
}

async function requestAccountDeletion({ auth, authTimeMillis, clock, db, fieldValue, reason, requestId, uid }) {
  if (!Number.isFinite(authTimeMillis) || clock.nowMillis() - authTimeMillis > RECENT_AUTH_MS) return { errorCode: 'RECENT_LOGIN_REQUIRED' };
  const lifecycleRef = db.doc(`accountLifecycles/${uid}`);
  const result = await db.runTransaction(async (transaction) => {
    const [lifecycle, profile, user] = await Promise.all([
      transaction.get(lifecycleRef), transaction.get(db.doc(`publicProfiles/${uid}`)), transaction.get(db.doc(`users/${uid}`)),
    ]);
    if (!user.exists) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (lifecycle.exists && lifecycle.data()?.state === 'deletion-pending') return { result: deletionStatus(lifecycle, clock.nowMillis()) };
    if (lifecycle.exists && lifecycle.data()?.state === 'purging') return { errorCode: 'REQUEST_CONFLICT' };
    const requestedAt = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(clock.nowMillis() + ACCOUNT_DELETION_GRACE_MS);
    transaction.set(lifecycleRef, {
      checkpoints: {},
      hold: false,
      priorModerationStatus: profile.data()?.moderationStatus || 'active',
      purgeAfter,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 240) : '',
      requestId,
      requestedAt,
      retryCount: 0,
      state: 'deletion-pending',
      uid,
      updatedAt: requestedAt,
    });
    if (profile.exists) transaction.update(profile.ref, { moderationStatus: 'removed', updatedAt: requestedAt });
    return { result: { canCancel: true, purgeAfterMillis: clock.nowMillis() + ACCOUNT_DELETION_GRACE_MS, requestedAtMillis: clock.nowMillis(), state: 'deletion-pending' } };
  });
  if (result.errorCode) return result;
  const userRecord = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(userRecord.customClaims || {}), accountDeletionPending: true });
  await auth.revokeRefreshTokens(uid);
  const devices = await db.collection(`pushDevices/${uid}/tokens`).limit(500).get().catch(() => undefined);
  if (devices?.size) {
    const batch = db.batch();
    devices.docs.forEach((document) => batch.set(document.ref, { active: false, revokedAt: fieldValue.serverTimestamp() }, { merge: true }));
    await batch.commit();
  }
  await db.recursiveDelete(db.doc(`softMatchQueue/${uid}`)).catch(() => undefined);
  return result;
}

async function cancelAccountDeletion({ auth, authTimeMillis, clock, db, fieldValue, uid }) {
  if (!Number.isFinite(authTimeMillis) || clock.nowMillis() - authTimeMillis > RECENT_AUTH_MS) return { errorCode: 'RECENT_LOGIN_REQUIRED' };
  const lifecycleRef = db.doc(`accountLifecycles/${uid}`);
  const result = await db.runTransaction(async (transaction) => {
    const [lifecycle, profile] = await Promise.all([
      transaction.get(lifecycleRef),
      transaction.get(db.doc(`publicProfiles/${uid}`)),
    ]);
    if (lifecycle.exists && lifecycle.data()?.state === 'cancelled') return { result: { state: 'cancelled' } };
    if (!lifecycle.exists || lifecycle.data()?.state !== 'deletion-pending') return { errorCode: 'REQUEST_CONFLICT' };
    if (lifecycle.data()?.purgeAfter?.toMillis?.() <= clock.nowMillis()) return { errorCode: 'REQUEST_CONFLICT' };
    const now = fieldValue.serverTimestamp();
    transaction.update(lifecycleRef, { cancelledAt: now, state: 'cancelled', updatedAt: now });
    if (profile.exists) transaction.update(profile.ref, { moderationStatus: lifecycle.data()?.priorModerationStatus === 'active' ? 'active' : lifecycle.data()?.priorModerationStatus || 'active', updatedAt: now });
    return { result: { state: 'cancelled' } };
  });
  if (result.errorCode) return result;
  const userRecord = await auth.getUser(uid);
  const claims = { ...(userRecord.customClaims || {}) };
  delete claims.accountDeletionPending;
  await auth.setCustomUserClaims(uid, claims);
  await auth.revokeRefreshTokens(uid);
  return result;
}

async function getAccountDeletionStatus({ db, uid }) {
  return { result: deletionStatus(await db.doc(`accountLifecycles/${uid}`).get()) };
}

async function purgeDueAccounts({ auth, bucket, clock, db, fieldValue, pseudonymSecret, limit = 25 }) {
  const snapshot = await db.collection('accountLifecycles').where('state', 'in', ['deletion-pending', 'failed']).where('purgeAfter', '<=', clock.timestampFromMillis(clock.nowMillis())).limit(limit).get();
  const results = [];
  for (const lifecycleDocument of snapshot.docs) {
    const uid = lifecycleDocument.id;
    const data = lifecycleDocument.data();
    if (data.hold === true) {
      await lifecycleDocument.ref.set({ heldAt: fieldValue.serverTimestamp(), retainedCategories: data.retainedCategories || ['all-user-data'], state: 'held', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      results.push({ state: 'held', uid });
      continue;
    }
    const subject = deletionSubject(uid, pseudonymSecret);
    try {
      await lifecycleDocument.ref.set({ state: 'purging', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      const userRecord = await auth.getUser(uid).catch(() => undefined);
      if (userRecord) await auth.setCustomUserClaims(uid, { ...(userRecord.customClaims || {}), accountDeletionPending: true, accountPurging: true });
      await deleteUidDocuments(db, uid);
      await lifecycleDocument.ref.set({ 'checkpoints.documentsDeletedAt': fieldValue.serverTimestamp() }, { merge: true });
      await deletePrefix(bucket, `avatar-quarantine/${uid}/`);
      await deletePrefix(bucket, `avatars-public/${uid}/`);
      await deletePrefix(bucket, `avatars/${uid}/`);
      await lifecycleDocument.ref.set({ 'checkpoints.mediaDeletedAt': fieldValue.serverTimestamp() }, { merge: true });
      await pseudonymizeLedgers(db, uid, subject, fieldValue);
      await lifecycleDocument.ref.set({ 'checkpoints.ledgersPseudonymizedAt': fieldValue.serverTimestamp() }, { merge: true });
      await Promise.all([
        db.doc(`publicProfiles/${uid}`).delete(),
        db.doc(`users/${uid}`).delete(),
        db.doc(`adminUserSearch/${uid}`).delete(),
      ]);
      await auth.deleteUser(uid).catch((error) => { if (error?.code !== 'auth/user-not-found') throw error; });
      await lifecycleDocument.ref.set({ completedAt: fieldValue.serverTimestamp(), deletedCategories: ['identity', 'social', 'devices', 'media', 'eligible-messages', 'operational-documents'], deletedSubjectId: subject, retainedCategories: ['financial-ledgers', 'fraud', 'moderation', 'audit'], state: 'completed', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      results.push({ state: 'completed', uid });
    } catch (error) {
      await lifecycleDocument.ref.set({ lastError: String(error?.message || error).slice(0, 500), retryCount: Number(data.retryCount || 0) + 1, state: 'failed', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      results.push({ state: 'failed', uid });
    }
  }
  return { results, scanned: snapshot.size };
}

async function deleteUidDocuments(db, uid) {
  const directPaths = [
    `pushDevices/${uid}`, `notificationPreferences/${uid}`, `wallets/${uid}`, `socialRateLimits/${uid}`,
    `adminUserRestrictions/${uid}`, `directChatRestrictions/${uid}`, `familyMemberships/${uid}`,
    `avatarUploadAuthorizations/${uid}`, `cosmeticUploadAuthorizations/${uid}`,
    `avatarUploadRateLimits/${uid}`,
    `blocks/${uid}`, `friends/${uid}`, `followers/${uid}`, `following/${uid}`,
  ];
  await Promise.all(directPaths.map((path) => db.recursiveDelete(db.doc(path)).catch(() => undefined)));
  const querySpecs = [
    ['avatarSubmissions', 'uid'], ['friendRequests', 'requesterUid'], ['friendRequests', 'targetUid'],
    ['socialBlocks', 'actorUid'], ['socialBlocks', 'targetUid'], ['directChatUploads', 'uid'],
    ['cosmeticSubmissions', 'ownerUid'], ['storeOwnerships', 'uid'], ['softMatchQueue', 'uid'],
  ];
  for (const [collection, field] of querySpecs) {
    const matches = await db.collection(collection).where(field, '==', uid).limit(500).get().catch(() => undefined);
    if (!matches) continue;
    await Promise.all(matches.docs.map((document) => db.recursiveDelete(document.ref)));
  }
  const eligibleMessages = await db.collectionGroup('messages').where('senderUid', '==', uid).limit(500).get().catch(() => undefined);
  if (eligibleMessages) await Promise.all(eligibleMessages.docs.map((document) => db.recursiveDelete(document.ref)));
}

async function pseudonymizeLedgers(db, uid, subject, fieldValue) {
  const specs = [
    ['walletLedger', ['uid', 'actorUid', 'recipientUid']], ['storeTransactions', ['uid', 'recipientUid']],
    ['socialGiftTransactions', ['senderUid', 'recipientUid']], ['representativeTransfers', ['senderUid', 'recipientUid']],
    ['payrollSettlements', ['uid']], ['adminAuditEvents', ['actorUid', 'targetUid']],
  ];
  for (const [collection, fields] of specs) {
    for (const field of fields) {
      const matches = await db.collection(collection).where(field, '==', uid).limit(500).get().catch(() => undefined);
      if (!matches?.size) continue;
      const batch = db.batch();
      matches.docs.forEach((document) => batch.set(document.ref, {
        [field]: subject,
        actorEmail: fieldValue.delete(), email: fieldValue.delete(), displayName: fieldValue.delete(), publicId: fieldValue.delete(), specialId: fieldValue.delete(),
        pseudonymizedAt: fieldValue.serverTimestamp(),
      }, { merge: true }));
      await batch.commit();
    }
  }
}

async function deletePrefix(bucket, prefix) {
  await bucket.deleteFiles({ prefix }).catch(() => undefined);
}

module.exports = { _test: { deletionStatus }, cancelAccountDeletion, getAccountDeletionStatus, purgeDueAccounts, requestAccountDeletion };
