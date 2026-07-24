const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const { applyWalletMutation, buildWalletDocument, buildWalletTransaction, mapWalletSummary } = require('./socialWalletCore');
const { mapRepresentativePrivilege, mapRepresentativeTransferReceipt, normalizeRepresentativeTransferInput } = require('./representativeCore');
const { normalizeRepresentativePinHash, verifyRepresentativePin } = require('./representativePinCore');
const {
  REPRESENTATIVE_PIN_LOCK_SECONDS,
  REPRESENTATIVE_PIN_MAX_ATTEMPTS,
  REPRESENTATIVE_REVERSAL_WINDOW_SECONDS,
  areRepresentativeTransfersEnabled,
  createRepresentativePublicReference,
  hashRepresentativeOpaqueToken,
  normalizeRepresentativePortalOrigin,
  normalizeRepresentativeTransferPolicy,
} = require('./representativePortalCore');

async function getRepresentativeStatus({ clock = systemClock(), db, input, portalOrigin = '', uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const dayBucket = utcDayBucket(clock.nowMillis());
  const [feature, profile, reservation, privilege, wallet, receipts, policySnapshot, pin, dailyCounter] = await Promise.all([
    db.doc('appConfig/socialFeatures').get(), db.doc(`publicProfiles/${uid}`).get(),
    readReservation(db, uid), db.doc(`representativePrivileges/${uid}`).get(), db.doc(`walletSummaries/${uid}`).get(),
    db.collection(`representativeTransferReceipts/${uid}/items`).orderBy('createdAt', 'desc').limit(20).get(),
    db.doc('appConfig/representativeTransferPolicy').get(), db.doc(`representativeTransferPins/${uid}`).get(),
    db.doc(`representativeTransferCounters/${uid}/days/${dayBucket}`).get(),
  ]);
  if (!inspectPublicProfile(profile.data(), reservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
  const mappedPrivilege = mapRepresentativePrivilege(privilege.data(), uid);
  const policy = resolveRepresentativeTransferPolicy(policySnapshot.data(), privilege.data());
  const portalConfigured = normalizeRepresentativePortalOrigin(portalOrigin).ok;
  const enabled = areRepresentativeTransfersEnabled(feature.data());
  const recentTransfers = receipts.docs.map((document) => mapRepresentativeTransferReceipt(document.data(), document.id)).filter(Boolean);
  return {
    result: {
      dailyAllowance: mapDailyAllowance(policy, dailyCounter.data()),
      feature: { available: enabled && portalConfigured && policy.configured, enabled, policyConfigured: policy.configured, portalConfigured },
      limits: policy,
      pin: mapRepresentativePinState(pin.data(), clock.nowMillis()),
      privilege: mappedPrivilege,
      recentTransfers,
      wallet: mapWalletSummary(wallet.data(), uid),
    },
  };
}

async function transferRepresentativeFunds({
  clock = systemClock(), createPublicReference = createRepresentativePublicReference, db, fieldValue, input,
  portalOrigin, portalSessionId, requestId, uid, verifyPin = verifyRepresentativePin,
}) {
  const normalized = normalizeRepresentativeTransferInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId || '') || !/^[a-f0-9]{64}$/.test(portalSessionId || '')
    || !normalizeRepresentativePortalOrigin(portalOrigin).ok) return { errorCode: 'INVALID_REQUEST' };
  const { amount, currency, pin, proof } = normalized.value;
  const proofId = hashRepresentativeOpaqueToken(proof);
  if (!proofId) return { errorCode: 'INVALID_REQUEST' };
  const commandRef = db.doc(`representativeTransferCommands/${uid}/requests/${requestId}`);
  const nowMillis = clock.nowMillis();
  const [existingCommand, featureSnapshot, policySnapshot, privilegeSnapshot, sessionSnapshot] = await Promise.all([
    commandRef.get(), db.doc('appConfig/socialFeatures').get(), db.doc('appConfig/representativeTransferPolicy').get(),
    db.doc(`representativePrivileges/${uid}`).get(), db.doc(`representativePortalSessions/${portalSessionId}`).get(),
  ]);
  if (!areRepresentativeTransfersEnabled(featureSnapshot.data())) return { errorCode: 'FEATURE_DISABLED' };
  const initialPermission = mapRepresentativePrivilege(privilegeSnapshot.data(), uid);
  if (!initialPermission.active || initialPermission.currencies[currency] !== true) return { errorCode: 'PERMISSION_DENIED' };
  if (!resolveRepresentativeTransferPolicy(policySnapshot.data(), privilegeSnapshot.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
  if (!isActivePortalSession(sessionSnapshot, portalOrigin, uid, nowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };
  if (existingCommand.exists) {
    return mapCompletedRepresentativeCommand(existingCommand.data(), { amount, currency, proofId });
  }

  const [proofSnapshot, pinSnapshot] = await Promise.all([
    db.doc(`representativeRecipientProofs/${proofId}`).get(), db.doc(`representativeTransferPins/${uid}`).get(),
  ]);
  const proofData = proofSnapshot.data();
  const recipientUid = typeof proofData?.recipientUid === 'string' ? proofData.recipientUid : '';
  const recipientPublicId = typeof proofData?.recipientPublicId === 'string' ? proofData.recipientPublicId : '';
  if (!recipientUid || recipientUid === uid || !recipientPublicId) return { errorCode: 'PROOF_INVALID' };
  const pinData = pinSnapshot.data();
  if (!normalizeRepresentativePinHash(pinData)) return { errorCode: 'PIN_NOT_CONFIGURED' };
  if (pinData.resetRequired === true) return { errorCode: 'PIN_RESET_REQUIRED' };
  if (timestampMillis(pinData.lockedUntil) > nowMillis) return { errorCode: 'PIN_LOCKED' };
  if (!await verifyPin(pin, pinData)) {
    return recordRepresentativePinFailure({ clock, db, expectedPin: pinData, portalOrigin, portalSessionId, uid });
  }

  const publicReference = createPublicReference();
  const dayBucket = utcDayBucket(nowMillis);
  const hourBucket = utcHourBucket(nowMillis);

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: commandRef,
      dailyCounter: db.doc(`representativeTransferCounters/${uid}/days/${dayBucket}`),
      event: db.doc(`representativeTransfers/${uid}_${requestId}`),
      hourlyCounter: db.doc(`representativeTransferCounters/${uid}/hours/${hourBucket}`),
      pin: db.doc(`representativeTransferPins/${uid}`),
      proof: db.doc(`representativeRecipientProofs/${proofId}`),
      publicReference: db.doc(`representativePublicReferences/${publicReference}`),
      receipt: db.doc(`representativeTransferReceipts/${uid}/items/${uid}_${requestId}`),
      recipientReceipt: db.doc(`walletRechargeReceipts/${recipientUid}/items/${uid}_${requestId}`),
      feature: db.doc('appConfig/socialFeatures'), policy: db.doc('appConfig/representativeTransferPolicy'), privilege: db.doc(`representativePrivileges/${uid}`),
      recipientIdentity: db.doc(`publicIds/${recipientPublicId}`), recipientProfile: db.doc(`publicProfiles/${recipientUid}`),
      session: db.doc(`representativePortalSessions/${portalSessionId}`),
      recipientWallet: db.doc(`walletSummaries/${recipientUid}`), senderProfile: db.doc(`publicProfiles/${uid}`),
      senderWallet: db.doc(`walletSummaries/${uid}`),
    };
    const [command, feature, policySnapshot, privilege, senderProfile, recipientProfile, recipientIdentity, senderWallet, recipientWallet,
      currentProof, currentPin, session, dailyCounter, hourlyCounter, existingReference] = await Promise.all([
      transaction.get(refs.command), transaction.get(refs.feature), transaction.get(refs.policy), transaction.get(refs.privilege), transaction.get(refs.senderProfile),
      transaction.get(refs.recipientProfile), transaction.get(refs.recipientIdentity), transaction.get(refs.senderWallet), transaction.get(refs.recipientWallet),
      transaction.get(refs.proof), transaction.get(refs.pin), transaction.get(refs.session), transaction.get(refs.dailyCounter), transaction.get(refs.hourlyCounter), transaction.get(refs.publicReference),
    ]);
    if (command.exists) return mapCompletedRepresentativeCommand(command.data(), { amount, currency, proofId });
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active || permission.currencies[currency] !== true) return { errorCode: 'PERMISSION_DENIED' };
    const policy = resolveRepresentativeTransferPolicy(policySnapshot.data(), privilege.data());
    if (!policy.configured || !policy.effective) return { errorCode: 'FEATURE_DISABLED' };
    if (!isActivePortalSession(session, portalOrigin, uid, nowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };
    if (!sameRepresentativePinHash(currentPin.data(), pinData)) return { errorCode: 'PIN_CHANGED' };
    if (currentPin.data()?.resetRequired === true) return { errorCode: 'PIN_RESET_REQUIRED' };
    if (timestampMillis(currentPin.data()?.lockedUntil) > nowMillis) return { errorCode: 'PIN_LOCKED' };
    const verifiedProof = currentProof.data();
    if (!currentProof.exists || verifiedProof?.state !== 'unused' || verifiedProof?.representativeUid !== uid
      || verifiedProof?.recipientUid !== recipientUid || verifiedProof?.recipientPublicId !== recipientPublicId
      || timestampMillis(verifiedProof?.expiresAt) <= nowMillis) return { errorCode: 'PROOF_INVALID' };
    if (recipientIdentity.data()?.uid !== recipientUid) return { errorCode: 'INVALID_RECIPIENT' };
    const [senderReservation, recipientReservation] = await Promise.all([
      readReservationInTransaction(db, transaction, senderProfile.data()),
      readReservationInTransaction(db, transaction, recipientProfile.data()),
    ]);
    if (!inspectPublicProfile(senderProfile.data(), senderReservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (!inspectPublicProfile(recipientProfile.data(), recipientReservation?.data(), recipientUid).ok) return { errorCode: 'INVALID_RECIPIENT' };

    const limits = policy.effective[currency];
    const timestamp = fieldValue.serverTimestamp();
    const securityEventRef = db.doc(`representativePortalSecurityEvents/transfer_limit_${uid}_${requestId}`);
    if (amount > limits.maxPerTransfer) {
      transaction.set(securityEventRef, {
        amount, createdAt: timestamp, currency, kind: 'transfer-limit-exceeded',
        limitKind: 'per-transfer', representativeUid: uid,
      });
      return { errorCode: 'TRANSFER_LIMIT_EXCEEDED' };
    }
    const dailyAmount = readCounterValue(dailyCounter.data()?.amounts?.[currency]);
    const hourlyCount = readCounterValue(hourlyCounter.data()?.counts?.[currency]);
    if (dailyAmount + amount > limits.maxPerDay) {
      transaction.set(securityEventRef, {
        amount, createdAt: timestamp, currency, kind: 'transfer-limit-exceeded',
        limitKind: 'daily', representativeUid: uid,
      });
      return { errorCode: 'TRANSFER_LIMIT_EXCEEDED' };
    }
    if (hourlyCount + 1 > limits.maxTransfersPerHour) {
      transaction.set(securityEventRef, {
        amount, createdAt: timestamp, currency, kind: 'rapid-transfer-limit',
        limitKind: 'hourly-count', representativeUid: uid,
      });
      return { errorCode: 'TRANSFER_RATE_LIMITED' };
    }
    if (existingReference.exists) return { errorCode: 'REQUEST_CONFLICT' };

    const sender = mapWalletSummary(senderWallet.data(), uid);
    const recipient = mapWalletSummary(recipientWallet.data(), recipientUid);
    const debit = applyWalletMutation(sender, { amount, currency, type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };
    const credit = applyWalletMutation(recipient, { amount, currency, type: 'credit' });
    if (!credit.ok) return { errorCode: credit.code };
    const representativePublicId = senderProfile.data().publicId;
    const result = {
      amount, balances: debit.value.wallet.balances, currency, publicReference,
      recipient: { displayName: recipientProfile.data().displayName, publicId: recipientPublicId },
      recipientUid, transferId: refs.event.path.split('/').at(-1),
    };
    transaction.set(refs.senderWallet, buildWalletDocument(debit.value.wallet, { createdAt: createdAt(senderWallet, timestamp), updatedAt: timestamp }));
    transaction.set(refs.recipientWallet, buildWalletDocument(credit.value.wallet, { createdAt: createdAt(recipientWallet, timestamp), updatedAt: timestamp }));
    transaction.create(db.doc(`walletTransactions/representative_debit_${uid}_${requestId}`), buildWalletTransaction({ actorUid: uid, amount, balanceAfter: debit.value.balanceAfter, createdAt: timestamp, currency, referenceId: refs.event.path, source: 'representative-transfer', type: 'transfer', uid }));
    transaction.create(db.doc(`walletTransactions/representative_credit_${recipientUid}_${requestId}`), buildWalletTransaction({ actorUid: uid, amount, balanceAfter: credit.value.balanceAfter, createdAt: timestamp, currency, referenceId: refs.event.path, source: 'representative-transfer', type: 'transfer', uid: recipientUid }));
    transaction.create(refs.event, {
      amount, createdAt: timestamp, currency, publicReference, recipientDisplayName: recipientProfile.data().displayName,
      recipientPublicId, recipientUid, representativeDisplayName: senderProfile.data().displayName, representativePublicId,
      representativeUid: uid, requestId, status: 'completed',
    });
    transaction.create(refs.publicReference, { createdAt: timestamp, publicReference, representativeUid: uid, transferId: result.transferId });
    transaction.create(refs.receipt, {
      amount, balanceAfter: debit.value.balanceAfter, balanceBefore: sender.balances[currency], createdAt: timestamp, currency, publicReference,
      recipientDisplayName: recipientProfile.data().displayName, recipientPublicId, recipientUid,
      representativeDisplayName: senderProfile.data().displayName, representativePublicId, status: 'completed', transferId: result.transferId, uid,
    });
    transaction.create(refs.recipientReceipt, {
      amount, balanceAfter: credit.value.balanceAfter, balanceBefore: recipient.balances[currency], createdAt: timestamp, currency, publicReference,
      recipientDisplayName: recipientProfile.data().displayName, recipientPublicId, recipientUid,
      representativeDisplayName: senderProfile.data().displayName, representativePublicId, representativeUid: uid,
      status: 'completed', transferId: result.transferId,
    });
    transaction.set(refs.proof, { ...verifiedProof, consumedAt: timestamp, consumedByRequestId: requestId, state: 'consumed' });
    transaction.set(refs.pin, { ...currentPin.data(), failedAttempts: 0, lockedUntil: null, updatedAt: timestamp });
    transaction.set(refs.dailyCounter, {
      amounts: { coins: readCounterValue(dailyCounter.data()?.amounts?.coins), diamonds: readCounterValue(dailyCounter.data()?.amounts?.diamonds), [currency]: dailyAmount + amount },
      dayBucket, representativeUid: uid, updatedAt: timestamp,
    });
    transaction.set(refs.hourlyCounter, {
      counts: { coins: readCounterValue(hourlyCounter.data()?.counts?.coins), diamonds: readCounterValue(hourlyCounter.data()?.counts?.diamonds), [currency]: hourlyCount + 1 },
      hourBucket, representativeUid: uid, updatedAt: timestamp,
    });
    transaction.create(refs.command, { action: 'representative-transfer', amount, createdAt: timestamp, currency, proofId, requestId, result, uid });
    return { result };
  });
}

async function recordRepresentativePinFailure({ clock, db, expectedPin, portalOrigin, portalSessionId, uid }) {
  const nowMillis = clock.nowMillis();
  return db.runTransaction(async (transaction) => {
    const refs = {
      feature: db.doc('appConfig/socialFeatures'),
      pin: db.doc(`representativeTransferPins/${uid}`),
      policy: db.doc('appConfig/representativeTransferPolicy'),
      privilege: db.doc(`representativePrivileges/${uid}`),
      session: db.doc(`representativePortalSessions/${portalSessionId}`),
    };
    const [feature, pin, policy, privilege, session] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.pin), transaction.get(refs.policy), transaction.get(refs.privilege), transaction.get(refs.session),
    ]);
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
    if (!resolveRepresentativeTransferPolicy(policy.data(), privilege.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
    if (!isActivePortalSession(session, portalOrigin, uid, nowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };
    const current = pin.data();
    if (!sameRepresentativePinHash(current, expectedPin)) return { errorCode: 'PIN_CHANGED' };
    if (current?.resetRequired === true) return { errorCode: 'PIN_RESET_REQUIRED' };
    if (timestampMillis(current?.lockedUntil) > nowMillis) return { errorCode: 'PIN_LOCKED' };
    const failedAttempts = readCounterValue(current?.failedAttempts) + 1;
    const locked = failedAttempts >= REPRESENTATIVE_PIN_MAX_ATTEMPTS;
    transaction.set(refs.pin, {
      ...current,
      failedAttempts: locked ? 0 : failedAttempts,
      lockedUntil: locked ? clock.timestampFromMillis(nowMillis + REPRESENTATIVE_PIN_LOCK_SECONDS * 1000) : null,
      updatedAt: clock.timestampFromMillis(nowMillis),
    });
    const eventRef = db.doc(`representativePortalSecurityEvents/pin_${uid}_${nowMillis}_${failedAttempts}`);
    transaction.create(eventRef, { createdAt: clock.timestampFromMillis(nowMillis), kind: locked ? 'pin-locked' : 'pin-failed', representativeUid: uid });
    return { errorCode: locked ? 'PIN_LOCKED' : 'PIN_INVALID' };
  });
}

async function executeAdminRepresentativeUpdate({ db, decodedToken, fieldValue, input }) {
  return db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`publicProfiles/${input.targetUid}`);
    const privilegeRef = db.doc(`representativePrivileges/${input.targetUid}`);
    const auditRef = db.doc(`adminAuditEvents/representative_${input.requestId}`);
    const [profile, privilege, audit] = await Promise.all([transaction.get(profileRef), transaction.get(privilegeRef), transaction.get(auditRef)]);
    if (audit.exists) {
      const previous = audit.data();
      if (previous.action === 'representative-update' && previous.actorUid === decodedToken.uid && previous.targetUid === input.targetUid && previous.active === input.active && previous.currencies?.coins === input.currencies.coins && previous.currencies?.diamonds === input.currencies.diamonds) return auditRef.id;
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    if (!profile.exists) throw Object.assign(new Error('Target public profile was not found.'), { status: 404 });
    const currentUpdatedAt = privilege.exists && isTimestampLike(privilege.data()?.updatedAt)
      ? new Date(privilege.data().updatedAt.toMillis()).toISOString()
      : '';
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentUpdatedAt) {
      throw Object.assign(new Error('Representative permissions changed since the user record was opened. Refresh before continuing.'), { status: 409 });
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(privilegeRef, { active: input.active, createdAt: privilege.exists && privilege.data()?.createdAt ? privilege.data().createdAt : timestamp, currencies: input.currencies, grantedBy: decodedToken.uid, uid: input.targetUid, updatedAt: timestamp });
    transaction.update(profileRef, {
      representativeBadge: {
        active: input.active,
        updatedAt: timestamp,
      },
      updatedAt: timestamp,
    });
    transaction.create(auditRef, { action: 'representative-update', active: input.active, actorEmail: decodedToken.email || '', actorUid: decodedToken.uid, createdAt: timestamp, currencies: input.currencies, kind: 'economy', targetUid: input.targetUid });
    return auditRef.id;
  });
}

async function reverseRepresentativeTransfer({ clock = systemClock(), db, decodedToken, fieldValue, input }) {
  const operation = await db.runTransaction(async (transaction) => {
    const auditRef = db.doc(`adminAuditEvents/representative-reversal_${input.requestId}`);
    const referenceRef = db.doc(`representativePublicReferences/${input.publicReference}`);
    const [audit, reference] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(referenceRef),
    ]);

    if (audit.exists) {
      const previous = audit.data();
      if (previous.action === 'representative-reversal'
        && previous.actorUid === decodedToken.uid
        && previous.publicReference === input.publicReference
        && previous.expectedAmount === input.expectedAmount
        && previous.expectedCurrency === input.expectedCurrency
        && previous.result) {
        return { result: previous.result };
      }
      return reversalFailure('REQUEST_CONFLICT', 409, 'Admin request ID conflicts with an existing operation.');
    }

    const referenceData = reference.data();
    const transferId = typeof referenceData?.transferId === 'string' ? referenceData.transferId : '';
    const representativeUid = typeof referenceData?.representativeUid === 'string' ? referenceData.representativeUid : '';
    if (!reference.exists || !transferId || !representativeUid) {
      return reversalFailure('TRANSFER_NOT_FOUND', 404, 'The referenced transfer was not found.');
    }

    const transferRef = db.doc(`representativeTransfers/${transferId}`);
    const reversalRef = db.doc(`representativeTransferReversals/${transferId}`);
    const [transfer, reversal] = await Promise.all([
      transaction.get(transferRef),
      transaction.get(reversalRef),
    ]);
    const transferData = transfer.data();
    const recipientUid = typeof transferData?.recipientUid === 'string' ? transferData.recipientUid : '';
    const currency = transferData?.currency;
    const amount = transferData?.amount;
    const createdAtMillis = timestampMillis(transferData?.createdAt);
    const validOriginal = transfer.exists
      && transferData?.status === 'completed'
      && transferData?.publicReference === input.publicReference
      && transferData?.representativeUid === representativeUid
      && recipientUid
      && recipientUid !== representativeUid
      && Number.isSafeInteger(amount)
      && amount > 0
      && ['coins', 'diamonds'].includes(currency)
      && createdAtMillis > 0;

    const securityRef = db.doc(`representativePortalSecurityEvents/reversal_${input.requestId}`);
    const nowMillis = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();

    if (!validOriginal || amount !== input.expectedAmount || currency !== input.expectedCurrency) {
      transaction.set(securityRef, {
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        kind: 'reversal-record-mismatch',
        publicReference: input.publicReference,
      });
      return reversalFailure('TRANSFER_MISMATCH', 409, 'The reviewed transfer value no longer matches the authoritative record.');
    }
    if (reversal.exists) {
      transaction.set(securityRef, {
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        kind: 'repeated-reversal-attempt',
        publicReference: input.publicReference,
        transferId,
      });
      return reversalFailure('ALREADY_REVERSED', 409, 'This transfer has already been reversed.');
    }
    if (nowMillis - createdAtMillis > REPRESENTATIVE_REVERSAL_WINDOW_SECONDS * 1000) {
      transaction.set(securityRef, {
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        kind: 'expired-reversal-attempt',
        publicReference: input.publicReference,
        transferId,
      });
      return reversalFailure('REVERSAL_EXPIRED', 409, 'The 24-hour reversal window has expired.');
    }

    const representativeWalletRef = db.doc(`walletSummaries/${representativeUid}`);
    const recipientWalletRef = db.doc(`walletSummaries/${recipientUid}`);
    const [representativeWalletSnapshot, recipientWalletSnapshot] = await Promise.all([
      transaction.get(representativeWalletRef),
      transaction.get(recipientWalletRef),
    ]);
    if (!representativeWalletSnapshot.exists || !recipientWalletSnapshot.exists) {
      return reversalFailure('WALLET_NOT_FOUND', 409, 'A transfer wallet is unavailable.');
    }

    const representativeWallet = mapWalletSummary(representativeWalletSnapshot.data(), representativeUid);
    const recipientWallet = mapWalletSummary(recipientWalletSnapshot.data(), recipientUid);
    const recipientDebit = applyWalletMutation(recipientWallet, { amount, currency, type: 'debit' });
    if (!recipientDebit.ok) {
      transaction.set(securityRef, {
        actorUid: decodedToken.uid,
        amount,
        createdAt: timestamp,
        currency,
        kind: 'reversal-insufficient-recipient-funds',
        publicReference: input.publicReference,
        recipientUid,
        transferId,
      });
      return reversalFailure('RECIPIENT_FUNDS_CHANGED', 409, 'The recipient no longer holds the full transferred amount.');
    }
    const representativeCredit = applyWalletMutation(representativeWallet, { amount, currency, type: 'credit' });
    if (!representativeCredit.ok) {
      return reversalFailure('WALLET_CONFLICT', 409, 'The representative wallet cannot accept the refund.');
    }

    const eventId = `reversal_${transferId}`;
    const result = {
      amount,
      currency,
      eventId,
      publicReference: input.publicReference,
      recipientUid,
      representativeUid,
      status: 'reversed',
      transferId,
    };
    transaction.set(representativeWalletRef, buildWalletDocument(representativeCredit.value.wallet, {
      createdAt: createdAt(representativeWalletSnapshot, timestamp),
      updatedAt: timestamp,
    }));
    transaction.set(recipientWalletRef, buildWalletDocument(recipientDebit.value.wallet, {
      createdAt: createdAt(recipientWalletSnapshot, timestamp),
      updatedAt: timestamp,
    }));
    transaction.create(db.doc(`walletTransactions/representative_reversal_credit_${representativeUid}_${transferId}`), buildWalletTransaction({
      actorUid: decodedToken.uid,
      amount,
      balanceAfter: representativeCredit.value.balanceAfter,
      createdAt: timestamp,
      currency,
      note: input.reason,
      referenceId: reversalRef.path,
      source: 'representative-transfer-reversal',
      type: 'transfer',
      uid: representativeUid,
    }));
    transaction.create(db.doc(`walletTransactions/representative_reversal_debit_${recipientUid}_${transferId}`), buildWalletTransaction({
      actorUid: decodedToken.uid,
      amount,
      balanceAfter: recipientDebit.value.balanceAfter,
      createdAt: timestamp,
      currency,
      note: input.reason,
      referenceId: reversalRef.path,
      source: 'representative-transfer-reversal',
      type: 'transfer',
      uid: recipientUid,
    }));
    transaction.create(reversalRef, {
      amount,
      createdAt: timestamp,
      currency,
      publicReference: input.publicReference,
      reason: input.reason,
      recipientBalanceAfter: recipientDebit.value.balanceAfter,
      recipientUid,
      representativeBalanceAfter: representativeCredit.value.balanceAfter,
      representativeUid,
      reversedBy: decodedToken.uid,
      status: 'completed',
      transferId,
    });
    transaction.create(db.doc(`representativeTransferReceipts/${representativeUid}/items/${eventId}`), {
      amount,
      balanceAfter: representativeCredit.value.balanceAfter,
      balanceBefore: representativeWallet.balances[currency],
      createdAt: timestamp,
      currency,
      kind: 'reversal',
      publicReference: input.publicReference,
      recipientDisplayName: transferData.recipientDisplayName,
      recipientPublicId: transferData.recipientPublicId,
      recipientUid,
      reversalOf: transferId,
      status: 'reversed',
      transferId: eventId,
      uid: representativeUid,
    });
    transaction.create(db.doc(`walletRechargeReceipts/${recipientUid}/items/${eventId}`), {
      amount,
      balanceAfter: recipientDebit.value.balanceAfter,
      balanceBefore: recipientWallet.balances[currency],
      createdAt: timestamp,
      currency,
      kind: 'reversal',
      publicReference: input.publicReference,
      recipientDisplayName: transferData.recipientDisplayName,
      recipientPublicId: transferData.recipientPublicId,
      recipientUid,
      representativeDisplayName: transferData.representativeDisplayName,
      representativePublicId: transferData.representativePublicId,
      representativeUid,
      reversalOf: transferId,
      status: 'reversed',
      transferId: eventId,
    });
    transaction.create(auditRef, {
      action: 'representative-reversal',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      expectedAmount: input.expectedAmount,
      expectedCurrency: input.expectedCurrency,
      kind: 'economy',
      note: input.reason,
      publicReference: input.publicReference,
      result,
      status: 'completed',
      targetUid: representativeUid,
      transferId,
    });
    return { result };
  });

  if (operation.errorCode) {
    throw Object.assign(new Error(operation.message), {
      code: operation.errorCode,
      status: operation.status,
    });
  }
  return operation.result;
}

function reversalFailure(errorCode, status, message) {
  return { errorCode, message, status };
}

async function synchronizeRepresentativeBadge({ db, fieldValue, privilegeData, uid }) {
  const profileRef = db.doc(`publicProfiles/${uid}`);
  const profile = await profileRef.get();
  if (!profile.exists) return { active: false, status: 'missing-public-profile', uid };

  const active = privilegeData?.active === true;
  if (profile.data()?.representativeBadge?.active === active) {
    return { active, status: 'already-synchronized', uid };
  }

  const timestamp = fieldValue.serverTimestamp();
  await profileRef.update({
    representativeBadge: { active, updatedAt: timestamp },
    updatedAt: timestamp,
  });
  return { active, status: 'synchronized', uid };
}

async function reconcileRepresentativeBadges({ db, fieldValue, limit = 2000 }) {
  const [privileges, activeProfiles] = await Promise.all([
    db.collection('representativePrivileges').limit(limit).get(),
    db.collection('publicProfiles').where('representativeBadge.active', '==', true).limit(limit).get(),
  ]);
  const privilegeByUid = new Map(privileges.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  const uids = [...new Set([
    ...privilegeByUid.keys(),
    ...activeProfiles.docs.map((snapshot) => snapshot.id),
  ])];
  const results = [];

  for (let offset = 0; offset < uids.length; offset += 25) {
    const chunk = uids.slice(offset, offset + 25);
    results.push(...await Promise.all(chunk.map((uid) => synchronizeRepresentativeBadge({
      db,
      fieldValue,
      privilegeData: privilegeByUid.get(uid),
      uid,
    }))));
  }

  return {
    alreadySynchronized: results.filter((result) => result.status === 'already-synchronized').length,
    missingPublicProfiles: results.filter((result) => result.status === 'missing-public-profile').length,
    scanned: uids.length,
    synchronized: results.filter((result) => result.status === 'synchronized').length,
    truncated: privileges.size >= limit || activeProfiles.size >= limit,
  };
}

function createdAt(snapshot, fallback) { return snapshot.exists && isTimestampLike(snapshot.data()?.createdAt) ? snapshot.data().createdAt : fallback; }
async function readReservation(db, uid) { const profile = await db.doc(`publicProfiles/${uid}`).get(); return profile.data()?.publicId ? db.doc(`publicIds/${profile.data().publicId}`).get() : undefined; }
async function readReservationInTransaction(db, transaction, profile) { return profile?.publicId ? transaction.get(db.doc(`publicIds/${profile.publicId}`)) : undefined; }

function resolveRepresentativeTransferPolicy(policyData, privilegeData) {
  const globalPolicy = normalizeRepresentativeTransferPolicy(policyData?.limits);
  if (!globalPolicy.ok) return { configured: false, effective: undefined, overrideCurrencies: [] };
  const rawOverrides = privilegeData?.limits;
  if (rawOverrides === undefined) return { configured: true, effective: globalPolicy.value, overrideCurrencies: [] };
  const overrides = normalizeRepresentativeTransferPolicy(rawOverrides, { allowPartial: true });
  if (!overrides.ok) return { configured: false, effective: undefined, overrideCurrencies: [] };
  return {
    configured: true,
    effective: { ...globalPolicy.value, ...overrides.value },
    overrideCurrencies: Object.keys(overrides.value),
  };
}

function mapDailyAllowance(policy, counterData) {
  if (!policy.configured || !policy.effective) return { coins: undefined, diamonds: undefined };
  return {
    coins: Math.max(0, policy.effective.coins.maxPerDay - readNonNegativeInteger(counterData?.amounts?.coins)),
    diamonds: Math.max(0, policy.effective.diamonds.maxPerDay - readNonNegativeInteger(counterData?.amounts?.diamonds)),
  };
}

function mapRepresentativePinState(data, nowMillis) {
  if (!normalizeRepresentativePinHash(data)) {
    return { state: 'not-configured' };
  }
  if (data.resetRequired === true) return { state: 'reset-required' };
  const lockedUntilMillis = timestampMillis(data.lockedUntil);
  if (lockedUntilMillis > nowMillis) return { lockedUntil: new Date(lockedUntilMillis).toISOString(), state: 'locked' };
  return { state: 'ready' };
}

function readNonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function readCounterValue(value) { return readNonNegativeInteger(value); }
function systemClock() { return { nowMillis: () => Date.now(), timestampFromMillis: (value) => ({ toMillis: () => value }) }; }
function timestampMillis(value) { return value && typeof value.toMillis === 'function' ? value.toMillis() : 0; }
function utcDayBucket(nowMillis) { return new Date(nowMillis).toISOString().slice(0, 10); }
function utcHourBucket(nowMillis) { return new Date(nowMillis).toISOString().slice(0, 13); }
function sameRepresentativePinHash(left, right) {
  return left?.algorithm === right?.algorithm && left?.derivedKey === right?.derivedKey && left?.salt === right?.salt
    && left?.params?.cost === right?.params?.cost && left?.params?.blockSize === right?.params?.blockSize
    && left?.params?.parallelization === right?.params?.parallelization && left?.params?.keyBytes === right?.params?.keyBytes;
}
function isActivePortalSession(snapshot, portalOrigin, uid, nowMillis) {
  const origin = normalizeRepresentativePortalOrigin(portalOrigin);
  const data = snapshot.data();
  return origin.ok && snapshot.exists && data?.state === 'active' && data?.origin === origin.value
    && data?.representativeUid === uid && timestampMillis(data?.expiresAt) > nowMillis;
}
function mapCompletedRepresentativeCommand(command, expected) {
  const exact = command?.action === 'representative-transfer' && command?.amount === expected.amount
    && command?.currency === expected.currency && command?.proofId === expected.proofId;
  return exact && command?.result ? { result: command.result } : { errorCode: 'REQUEST_CONFLICT' };
}

module.exports = {
  executeAdminRepresentativeUpdate,
  getRepresentativeStatus,
  mapRepresentativePinState,
  reconcileRepresentativeBadges,
  reverseRepresentativeTransfer,
  resolveRepresentativeTransferPolicy,
  synchronizeRepresentativeBadge,
  transferRepresentativeFunds,
  utcDayBucket,
  utcHourBucket,
};
