'use strict';

const {
  buildCanonicalStoragePath,
  buildCustomEquipmentProjection,
  buildOwnerBoundAssetSummary,
  buildPublicCustomEquipmentProjection,
  cosmeticSubmissionQuarantinePath,
  createCosmeticSubmissionId,
  createCosmeticSubmissionVersionId,
  createCustomAssetId,
  customProjectionKey,
  CUSTOM_CATEGORY_SLOTS,
  CUSTOM_UPLOAD_TTL_MS,
  extensionForFormat,
  inspectApprovedCustomOwnership,
  inspectCustomEligibility,
  inspectCustomFeatureFlags,
  isCustomMp4Rejected,
  normalizeAttestCustomSubmissionInput,
  normalizeCreateCustomUploadInput,
  normalizeEquipCustomAssetInput,
  normalizeFinalizeCustomUploadInput,
  normalizeListCustomSubmissionsInput,
  normalizeUnequipCustomAssetInput,
  rateLimitDayKey,
  mapAdminCustomEligibility,
  mapAdminCustomSubmission,
} = require('./cosmeticCustomSubmissionCore');
const { inspectCosmeticAssetBuffer } = require('./cosmeticsAssetValidationCore');

const CUSTOM_PREVIEW_URL_TTL_MS = 5 * 60 * 1_000;
const OPEN_PENDING_STATUSES = new Set(['authorized', 'processed', 'pending']);

function decrementEligibilityPendingCount(transaction, eligibilityRef, eligibilitySnapshot, timestamp) {
  if (!eligibilityRef || !eligibilitySnapshot?.exists) return;
  const current = Number(eligibilitySnapshot.data()?.pendingCount || 0);
  transaction.set(eligibilityRef, {
    ...eligibilitySnapshot.data(),
    pendingCount: Math.max(0, current - 1),
    updatedAt: timestamp,
  }, { merge: true });
}

async function createCosmeticCustomUpload({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCreateCustomUploadInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const payload = validation.value;
  if (isCustomMp4Rejected(payload.format, payload.contentType)) return { errorCode: 'INVALID_REQUEST' };

  const submissionId = createCosmeticSubmissionId({ requestId, uid });
  const assetVersionId = createCosmeticSubmissionVersionId({ requestId, submissionId, uid });
  if (!submissionId || !assetVersionId) return { errorCode: 'INVALID_REQUEST' };

  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);

  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'create-cosmetic-custom-upload' && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }

    const refs = {
      authorization: db.doc(`cosmeticUploadAuthorizations/${uid}`),
      eligibility: db.doc(`cosmeticCustomEligibility/${uid}`),
      features: db.doc('appConfig/cosmeticsFeatures'),
      rate: db.doc(`cosmeticCustomRateLimits/${uid}`),
      submission: db.doc(`cosmeticSubmissions/${submissionId}`),
    };
    const [features, eligibility, authorization, submission, rate] = await Promise.all([
      transaction.get(refs.features),
      transaction.get(refs.eligibility),
      transaction.get(refs.authorization),
      transaction.get(refs.submission),
      transaction.get(refs.rate),
    ]);

    const flagGate = inspectCustomFeatureFlags(features.data());
    if (!flagGate.ok) return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: flagGate.code });

    const eligible = inspectCustomEligibility(eligibility.data(), {
      category: payload.category,
      nowMs,
      uid,
    });
    if (!eligible.ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: eligible.code });
    }

    if (submission.exists) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: 'REQUEST_CONFLICT' });
    }
    if (authorization.exists && authorization.data()?.active === true
      && timestampMillis(authorization.data()?.expiresAt) > nowMs) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: 'REQUEST_CONFLICT' });
    }

    const pendingCount = eligible.value.pendingCount;
    if (pendingCount >= eligible.value.maxPending) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: 'RATE_LIMITED' });
    }

    const dayKey = rateLimitDayKey(nowMs);
    const rateData = rate.exists ? rate.data() : undefined;
    const uploadsToday = rateData?.dayKey === dayKey ? Number(rateData.uploads || 0) : 0;
    if (uploadsToday >= eligible.value.dailyUploadLimit) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: 'RATE_LIMITED' });
    }

    if (payload.format === 'lottie-json') {
      const fallbackOk = await assertApprovedStaticFallback({
        category: payload.category,
        db,
        fallbackAssetId: payload.fallbackAssetId,
        fallbackAssetVersionId: payload.fallbackAssetVersionId,
        transaction,
      });
      if (!fallbackOk) {
        return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { errorCode: 'ITEM_UNAVAILABLE' });
      }
    }

    const sourcePath = cosmeticSubmissionQuarantinePath({
      assetName: payload.sourceName,
      assetVersionId,
      submissionId,
      uid,
    });
    const expiresAt = clock.timestampFromMillis(nowMs + CUSTOM_UPLOAD_TTL_MS);
    const authorizationDocument = {
      active: true,
      assetVersionId,
      category: payload.category,
      contentType: payload.contentType,
      createdAt: now,
      expiresAt,
      format: payload.format,
      maxBytes: payload.maxBytes,
      sizeBytes: payload.sizeBytes,
      sourcePath,
      submissionId,
      uid,
    };
    transaction.set(refs.authorization, authorizationDocument);
    transaction.create(refs.submission, {
      assetVersionId,
      category: payload.category,
      contentType: payload.contentType,
      createdAt: now,
      expiresAt,
      fallbackAssetId: payload.fallbackAssetId || '',
      fallbackAssetVersionId: payload.fallbackAssetVersionId || '',
      format: payload.format,
      loop: payload.loop,
      maxBytes: payload.maxBytes,
      ownerUid: uid,
      revision: 1,
      schemaVersion: 1,
      sizeBytes: payload.sizeBytes,
      sourcePath,
      status: 'authorized',
      submissionId,
      updatedAt: now,
      usage: payload.usage,
    });
    transaction.set(refs.rate, {
      dayKey,
      uid,
      updatedAt: now,
      uploads: uploadsToday + 1,
    });
    transaction.set(refs.eligibility, {
      ...eligibility.data(),
      pendingCount: pendingCount + 1,
      uid,
      updatedAt: now,
    }, { merge: true });
    const result = {
      assetVersionId,
      contentType: payload.contentType,
      expiresAt,
      maxBytes: payload.maxBytes,
      sizeBytes: payload.sizeBytes,
      sourcePath,
      submissionId,
    };
    return recordCommand(transaction, commandRef, now, uid, requestId, 'create-cosmetic-custom-upload', { result }, {
      submissionId,
    });
  });
}

async function finalizeCosmeticCustomUpload({
  bucket,
  clock,
  db,
  fieldValue,
  input,
  requestId,
  safetyAdapter,
  uid,
}) {
  const validation = normalizeFinalizeCustomUploadInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  if (!bucket || typeof bucket.file !== 'function') return { errorCode: 'UPLOAD_INVALID' };

  const { submissionId } = validation.value;
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const existingCommand = await commandRef.get();
  if (existingCommand.exists) {
    const previous = existingCommand.data();
    return previous.action === 'finalize-cosmetic-custom-upload'
      && previous.submissionId === submissionId
      && previous.result
      ? { result: previous.result }
      : { errorCode: 'REQUEST_CONFLICT' };
  }

  const submissionRef = db.doc(`cosmeticSubmissions/${submissionId}`);
  const authorizationRef = db.doc(`cosmeticUploadAuthorizations/${uid}`);
  const [submissionSnapshot, authorizationSnapshot, featuresSnapshot, eligibilitySnapshot] = await Promise.all([
    submissionRef.get(),
    authorizationRef.get(),
    db.doc('appConfig/cosmeticsFeatures').get(),
    db.doc(`cosmeticCustomEligibility/${uid}`).get(),
  ]);

  const nowMs = clock.nowMillis();
  const flagGate = inspectCustomFeatureFlags(featuresSnapshot.data());
  if (!flagGate.ok) return { errorCode: flagGate.code };
  const eligible = inspectCustomEligibility(eligibilitySnapshot.data(), { nowMs, uid });
  if (!eligible.ok) return { errorCode: eligible.code };

  const submission = submissionSnapshot.exists ? submissionSnapshot.data() : undefined;
  const authorization = authorizationSnapshot.exists ? authorizationSnapshot.data() : undefined;
  if (
    !submission
    || submission.ownerUid !== uid
    || submission.submissionId !== submissionId
    || submission.status !== 'authorized'
    || !authorization
    || authorization.submissionId !== submissionId
    || authorization.uid !== uid
  ) return { errorCode: 'UPLOAD_INVALID' };

  const source = bucket.file(submission.sourcePath);
  let metadata;
  let sourceBuffer;
  try {
    [[metadata], [sourceBuffer]] = await Promise.all([source.getMetadata(), source.download()]);
  } catch {
    return rejectFinalize({
      authorizationRef,
      clock,
      commandRef,
      db,
      fieldValue,
      requestId,
      submissionRef,
      uid,
      submissionId,
      errorCode: 'UPLOAD_INVALID',
    });
  }

  const objectValidation = require('./cosmeticCustomSubmissionCore').validateUploadedCustomObject({
    authorization,
    metadata,
    nowMs,
    sourceByteLength: sourceBuffer.length,
  });
  if (!objectValidation.ok) {
    return rejectFinalize({
      authorizationRef,
      clock,
      commandRef,
      db,
      fieldValue,
      requestId,
      submissionRef,
      uid,
      submissionId,
      errorCode: objectValidation.code,
    });
  }

  if (isCustomMp4Rejected(submission.format, metadata.contentType)) {
    return rejectFinalize({
      authorizationRef,
      clock,
      commandRef,
      db,
      fieldValue,
      requestId,
      submissionRef,
      uid,
      submissionId,
      errorCode: 'INVALID_REQUEST',
    });
  }

  const inspection = await inspectCosmeticAssetBuffer({
    buffer: sourceBuffer,
    category: submission.category,
    contentType: String(metadata.contentType || ''),
    format: submission.format,
    loop: submission.loop === true,
    usage: submission.usage,
  });
  if (!inspection.ok) {
    return rejectFinalize({
      authorizationRef,
      clock,
      commandRef,
      db,
      fieldValue,
      requestId,
      submissionRef,
      uid,
      submissionId,
      errorCode: 'UPLOAD_INVALID',
      reason: inspection.reason,
    });
  }

  const safety = await safetyAdapter?.inspectImage?.({ buffer: sourceBuffer });
  if (submission.format !== 'lottie-json' && !safety?.ok) {
    return rejectFinalize({
      authorizationRef,
      clock,
      commandRef,
      db,
      fieldValue,
      requestId,
      submissionRef,
      uid,
      submissionId,
      errorCode: 'UPLOAD_INVALID',
      reason: safety?.reason || 'adapter-unavailable',
    });
  }
  if (submission.format === 'lottie-json') {
    const lottieSafety = await safetyAdapter?.inspectLottie?.({ buffer: sourceBuffer });
    if (lottieSafety && !lottieSafety.ok) {
      return rejectFinalize({
        authorizationRef,
        clock,
        commandRef,
        db,
        fieldValue,
        requestId,
        submissionRef,
        uid,
        submissionId,
        errorCode: 'UPLOAD_INVALID',
        reason: lottieSafety.reason || 'lottie-rejected',
      });
    }
  }

  const now = clock.timestampFromMillis(clock.nowMillis());
  const receiptId = `validation_${submissionId}_${submission.assetVersionId}`;
  const result = await db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'finalize-cosmetic-custom-upload'
        && previous.submissionId === submissionId
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const [latestSubmission, latestAuthorization, features, eligibility] = await Promise.all([
      transaction.get(submissionRef),
      transaction.get(authorizationRef),
      transaction.get(db.doc('appConfig/cosmeticsFeatures')),
      transaction.get(db.doc(`cosmeticCustomEligibility/${uid}`)),
    ]);
    if (!inspectCustomFeatureFlags(features.data()).ok) return { errorCode: 'FEATURE_DISABLED' };
    if (!inspectCustomEligibility(eligibility.data(), { nowMs: clock.nowMillis(), uid }).ok) {
      return { errorCode: 'PERMISSION_DENIED' };
    }
    if (
      !latestSubmission.exists
      || latestSubmission.data()?.status !== 'authorized'
      || latestSubmission.data()?.ownerUid !== uid
      || !latestAuthorization.exists
      || latestAuthorization.data()?.active !== true
      || latestAuthorization.data()?.submissionId !== submissionId
    ) return { errorCode: 'UPLOAD_INVALID' };

    const processed = {
      byteSize: inspection.value.byteSize,
      contentType: inspection.value.contentType,
      durationMs: inspection.value.metadata.durationMs,
      height: inspection.value.metadata.height,
      sha256: inspection.value.sha256,
      status: 'processed',
      storageGeneration: String(metadata.generation || ''),
      transparent: inspection.value.metadata.transparent === true,
      updatedAt: now,
      validationReceiptId: receiptId,
      width: inspection.value.metadata.width,
    };
    transaction.update(submissionRef, processed);
    transaction.set(authorizationRef, {
      ...latestAuthorization.data(),
      active: false,
      finalizedAt: now,
    });
    transaction.create(db.doc(`cosmeticAssetValidationReceipts/${receiptId}`), {
      assetId: '',
      assetVersionId: submission.assetVersionId,
      byteSize: processed.byteSize,
      contentType: processed.contentType,
      createdAt: now,
      id: receiptId,
      inspectorVersion: 1,
      ownerUid: uid,
      sha256: processed.sha256,
      status: 'passed',
      storageGeneration: processed.storageGeneration,
      storagePath: submission.sourcePath,
      submissionId,
      validatorUid: 'system-custom-submission',
    });
    return recordCommand(transaction, commandRef, now, uid, requestId, 'finalize-cosmetic-custom-upload', {
      result: {
        byteSize: processed.byteSize,
        sha256: processed.sha256,
        status: 'processed',
        submissionId,
      },
    }, { submissionId });
  });
  return result;
}

async function attestCosmeticCustomSubmission({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeAttestCustomSubmissionInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { attestation, submissionId } = validation.value;
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const now = clock.timestampFromMillis(clock.nowMillis());

  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'attest-cosmetic-custom-submission'
        && previous.submissionId === submissionId
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const submissionRef = db.doc(`cosmeticSubmissions/${submissionId}`);
    const [features, eligibility, submissionSnapshot] = await Promise.all([
      transaction.get(db.doc('appConfig/cosmeticsFeatures')),
      transaction.get(db.doc(`cosmeticCustomEligibility/${uid}`)),
      transaction.get(submissionRef),
    ]);
    if (!inspectCustomFeatureFlags(features.data()).ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', { errorCode: 'FEATURE_DISABLED' }, { submissionId });
    }
    if (!inspectCustomEligibility(eligibility.data(), { nowMs: clock.nowMillis(), uid }).ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', { errorCode: 'PERMISSION_DENIED' }, { submissionId });
    }
    const submission = submissionSnapshot.exists ? submissionSnapshot.data() : undefined;
    if (!submission || submission.ownerUid !== uid) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', { errorCode: 'NOT_FOUND' }, { submissionId });
    }
    if (submission.status === 'pending' || submission.status === 'approved') {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', {
        result: { status: submission.status, submissionId },
      }, { submissionId });
    }
    if (submission.status !== 'processed') {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', { errorCode: 'ATTESTATION_REQUIRED' }, { submissionId });
    }
    if (!submission.sha256 || !submission.validationReceiptId) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', { errorCode: 'UPLOAD_INVALID' }, { submissionId });
    }
    transaction.update(submissionRef, {
      copyrightAttestation: attestation,
      copyrightAttestedAt: now,
      revision: Number(submission.revision || 0) + 1,
      status: 'pending',
      updatedAt: now,
    });
    return recordCommand(transaction, commandRef, now, uid, requestId, 'attest-cosmetic-custom-submission', {
      result: { status: 'pending', submissionId },
    }, { submissionId });
  });
}

async function listCosmeticCustomSubmissions({ db, input, uid }) {
  const validation = normalizeListCustomSubmissionsInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const features = await db.doc('appConfig/cosmeticsFeatures').get();
  if (!inspectCustomFeatureFlags(features.data()).ok) return { errorCode: 'FEATURE_DISABLED' };

  const snapshot = await db.collection('cosmeticSubmissions')
    .where('ownerUid', '==', uid)
    .limit(100)
    .get();
  const submissions = snapshot.docs
    .map((document) => mapSubmission(document.id, document.data()))
    .filter(Boolean)
    .sort((left, right) => (right.updatedAtMs || 0) - (left.updatedAtMs || 0))
    .slice(0, validation.value.limit)
    .map(({ updatedAtMs, ...rest }) => rest);
  return { result: { submissions } };
}

async function equipCosmeticCustomAsset({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeEquipCustomAssetInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { assetId } = validation.value;
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const now = clock.timestampFromMillis(clock.nowMillis());

  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'equip-cosmetic-custom-asset' && previous.assetId === assetId && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const [features, eligibility, ownershipSnapshot, summarySnapshot, profileSnapshot, equipmentSnapshot] = await Promise.all([
      transaction.get(db.doc('appConfig/cosmeticsFeatures')),
      transaction.get(db.doc(`cosmeticCustomEligibility/${uid}`)),
      transaction.get(db.doc(`cosmeticCustomOwnerships/${uid}/items/${assetId}`)),
      transaction.get(db.doc(`cosmeticAssets/${assetId}`)),
      transaction.get(db.doc(`publicProfiles/${uid}`)),
      transaction.get(db.doc(`storeEquipment/${uid}`)),
    ]);
    if (!inspectCustomFeatureFlags(features.data(), { rendering: true }).ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'equip-cosmetic-custom-asset', { errorCode: 'FEATURE_DISABLED' }, { assetId });
    }
    if (!inspectCustomEligibility(eligibility.data(), { nowMs: clock.nowMillis(), uid }).ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'equip-cosmetic-custom-asset', { errorCode: 'PERMISSION_DENIED' }, { assetId });
    }
    if (!profileSnapshot.exists || profileSnapshot.data()?.moderationStatus !== 'active') {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'equip-cosmetic-custom-asset', { errorCode: 'PERMISSION_DENIED' }, { assetId });
    }
    const ownership = ownershipSnapshot.exists ? ownershipSnapshot.data() : undefined;
    const summary = summarySnapshot.exists ? summarySnapshot.data() : undefined;
    const versionId = ownership?.assetVersionId || summary?.approvedVersionId || '';
    const [versionSnapshot, approvalSnapshot] = versionId
      ? await Promise.all([
        transaction.get(db.doc(`cosmeticAssets/${assetId}/versions/${versionId}`)),
        transaction.get(db.doc(`cosmeticAssetApprovals/${assetId}__${versionId}`)),
      ])
      : [undefined, undefined];
    const approved = inspectApprovedCustomOwnership({
      approval: approvalSnapshot?.exists ? approvalSnapshot.data() : undefined,
      ownership,
      summary,
      uid,
      version: versionSnapshot?.exists ? versionSnapshot.data() : undefined,
    });
    if (!approved.ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'equip-cosmetic-custom-asset', { errorCode: 'ITEM_UNAVAILABLE' }, { assetId });
    }

    const category = approved.value.category;
    const projectionKey = customProjectionKey(category);
    const projection = buildCustomEquipmentProjection(approved.value);
    const publicProjection = buildPublicCustomEquipmentProjection(approved.value);
    const equipment = equipmentSnapshot.exists ? { ...equipmentSnapshot.data() } : { uid };
    const customCosmetics = isRecord(equipment.customCosmetics) ? { ...equipment.customCosmetics } : {};
    const previousAssetId = customCosmetics[projectionKey]?.assetId;
    if (previousAssetId && previousAssetId !== assetId) {
      const previousOwnership = await transaction.get(db.doc(`cosmeticCustomOwnerships/${uid}/items/${previousAssetId}`));
      if (previousOwnership.exists) {
        transaction.update(previousOwnership.ref, { equipped: false, updatedAt: now });
      }
    }
    customCosmetics[projectionKey] = projection;
    transaction.set(db.doc(`storeEquipment/${uid}`), {
      ...equipment,
      customCosmetics,
      uid,
      updatedAt: now,
    });
    transaction.update(ownershipSnapshot.ref, { equipped: true, updatedAt: now });
    // Public profiles only carry minimal skin/frame projections (no source, never entryEffect).
    const profileUpdate = { updatedAt: now };
    if (publicProjection) {
      profileUpdate[`equippedCosmetics.${projectionKey}`] = publicProjection;
    }
    if (category === 'avatar-frame') {
      profileUpdate.equippedAvatarFrame = fieldValue.delete();
    }
    if (category === 'entry-effect' && profileSnapshot.data()?.equippedCosmetics?.entryEffect) {
      profileUpdate['equippedCosmetics.entryEffect'] = fieldValue.delete();
    }
    transaction.update(profileSnapshot.ref, profileUpdate);
    return recordCommand(transaction, commandRef, now, uid, requestId, 'equip-cosmetic-custom-asset', {
      result: { assetId, assetVersionId: approved.value.assetVersionId, category },
    }, { assetId });
  });
}

async function unequipCosmeticCustomAsset({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeUnequipCustomAssetInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { category } = validation.value;
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const now = clock.timestampFromMillis(clock.nowMillis());
  const projectionKey = customProjectionKey(category);

  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'unequip-cosmetic-custom-asset'
        && previous.category === category
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const features = await transaction.get(db.doc('appConfig/cosmeticsFeatures'));
    if (!inspectCustomFeatureFlags(features.data(), { rendering: true }).ok) {
      return recordCommand(transaction, commandRef, now, uid, requestId, 'unequip-cosmetic-custom-asset', { errorCode: 'FEATURE_DISABLED' }, { category });
    }
    const equipmentRef = db.doc(`storeEquipment/${uid}`);
    const profileRef = db.doc(`publicProfiles/${uid}`);
    const [equipmentSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(equipmentRef),
      transaction.get(profileRef),
    ]);
    const equipment = equipmentSnapshot.exists ? { ...equipmentSnapshot.data() } : { uid };
    const customCosmetics = isRecord(equipment.customCosmetics) ? { ...equipment.customCosmetics } : {};
    const assetId = customCosmetics[projectionKey]?.assetId;
    if (assetId) {
      const ownershipRef = db.doc(`cosmeticCustomOwnerships/${uid}/items/${assetId}`);
      const ownershipSnapshot = await transaction.get(ownershipRef);
      if (ownershipSnapshot.exists) transaction.update(ownershipRef, { equipped: false, updatedAt: now });
    }
    delete customCosmetics[projectionKey];
    transaction.set(equipmentRef, {
      ...equipment,
      customCosmetics,
      uid,
      updatedAt: now,
    });
    if (profileSnapshot.exists) {
      const profileUpdate = { updatedAt: now };
      if (projectionKey === 'avatarFrame' || projectionKey === 'profileSkin') {
        profileUpdate[`equippedCosmetics.${projectionKey}`] = fieldValue.delete();
      }
      if (profileSnapshot.data()?.equippedCosmetics?.entryEffect) {
        profileUpdate['equippedCosmetics.entryEffect'] = fieldValue.delete();
      }
      transaction.update(profileRef, profileUpdate);
    }
    return recordCommand(transaction, commandRef, now, uid, requestId, 'unequip-cosmetic-custom-asset', {
      result: { category, assetId: null },
    }, { category });
  });
}

async function approveCosmeticCustomSubmission({
  bucket,
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  const submissionRef = db.doc(`cosmeticSubmissions/${input.submissionId}`);
  const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_${input.requestId}`);
  const fingerprint = stableFingerprint(input);

  const submissionSnapshot = await submissionRef.get();
  if (!submissionSnapshot.exists) throw adminError(404, 'Submission was not found.');
  const submission = submissionSnapshot.data();
  if (Number(submission.revision || 0) !== input.expectedRevision) {
    throw adminError(409, 'Submission changed after it was opened. Refresh and try again.');
  }
  if (submission.status !== 'pending') throw adminError(409, 'Only pending attested submissions can be approved.');
  if (!submission.copyrightAttestedAt || !submission.copyrightAttestation) {
    throw adminError(409, 'Copyright attestation is required before approval.');
  }
  if (!submission.sha256 || !submission.sourcePath || !submission.validationReceiptId) {
    throw adminError(409, 'A server validation receipt is required.');
  }
  if (isCustomMp4Rejected(submission.format, submission.contentType)) {
    throw adminError(400, 'Custom MP4 submissions are disabled.');
  }

  const source = bucket.file(submission.sourcePath);
  let metadata;
  let sourceBuffer;
  try {
    [[metadata], [sourceBuffer]] = await Promise.all([source.getMetadata(), source.download()]);
  } catch {
    throw adminError(404, 'The quarantine source object was not found.');
  }
  const inspection = await inspectCosmeticAssetBuffer({
    buffer: sourceBuffer,
    category: submission.category,
    contentType: String(metadata.contentType || submission.contentType || ''),
    format: submission.format,
    loop: submission.loop === true,
    usage: submission.usage,
  });
  if (!inspection.ok) throw adminError(400, inspection.reason);
  if (inspection.value.sha256 !== submission.sha256) {
    throw adminError(409, 'Checksum does not match the server-processed submission.');
  }

  const assetId = createCustomAssetId({
    category: submission.category,
    submissionId: input.submissionId,
    uid: submission.ownerUid,
  });
  const assetVersionId = submission.assetVersionId;
  const storagePath = buildCanonicalStoragePath({
    assetId,
    assetVersionId,
    ownerType: 'user',
    ownerUid: submission.ownerUid,
  }, extensionForFormat(submission.format));
  const destination = bucket.file(storagePath);
  try {
    await destination.save(sourceBuffer, {
      metadata: {
        cacheControl: 'private,max-age=0',
        contentType: inspection.value.contentType,
        metadata: {
          assetId,
          assetVersionId,
          ownerUid: submission.ownerUid,
          submissionId: input.submissionId,
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
      resumable: false,
    });
  } catch (error) {
    if (Number(error?.code) !== 412) throw adminError(500, 'Failed to promote the approved derivative.');
  }
  const destinationMetadata = (await destination.getMetadata())[0];

  return db.runTransaction(async (transaction) => {
    const refs = {
      approval: db.doc(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`),
      asset: db.doc(`cosmeticAssets/${assetId}`),
      audit: auditRef,
      eligibility: db.doc(`cosmeticCustomEligibility/${submission.ownerUid}`),
      ownership: db.doc(`cosmeticCustomOwnerships/${submission.ownerUid}/items/${assetId}`),
      receipt: db.doc(`cosmeticAssetValidationReceipts/${submission.validationReceiptId}`),
      submission: submissionRef,
      version: db.doc(`cosmeticAssets/${assetId}/versions/${assetVersionId}`),
    };
    const [
      auditSnapshot,
      latestSubmission,
      assetSnapshot,
      versionSnapshot,
      approvalSnapshot,
      ownershipSnapshot,
      receiptSnapshot,
      eligibilitySnapshot,
    ] = await Promise.all([
      transaction.get(refs.audit),
      transaction.get(refs.submission),
      transaction.get(refs.asset),
      transaction.get(refs.version),
      transaction.get(refs.approval),
      transaction.get(refs.ownership),
      transaction.get(refs.receipt),
      transaction.get(refs.eligibility),
    ]);
    if (auditSnapshot.exists) {
      const existing = auditSnapshot.data();
      if (existing?.actorUid === decodedToken.uid && existing?.requestFingerprint === fingerprint) {
        return {
          approvalId: existing.approvalId,
          assetId: existing.assetId,
          assetVersionId: existing.assetVersionId,
          eventId: auditRef.id,
          replayed: true,
          revision: existing.revision,
        };
      }
      throw adminError(409, 'requestId was already used for another custom submission operation.');
    }
    if (
      !latestSubmission.exists
      || latestSubmission.data()?.status !== 'pending'
      || latestSubmission.data()?.sha256 !== submission.sha256
      || Number(latestSubmission.data()?.revision || 0) !== input.expectedRevision
    ) throw adminError(409, 'Submission changed after it was opened. Refresh and try again.');
    if (
      !receiptSnapshot.exists
      || receiptSnapshot.data()?.status !== 'passed'
      || receiptSnapshot.data()?.sha256 !== submission.sha256
    ) throw adminError(409, 'A matching successful validation receipt is required.');
    if (versionSnapshot.exists || approvalSnapshot.exists || ownershipSnapshot.exists) {
      throw adminError(409, 'This immutable approved custom version already exists.');
    }

    const timestamp = fieldValue.serverTimestamp();
    const approvalId = refs.approval.id;
    const version = {
      schemaVersion: 1,
      assetId,
      assetVersionId,
      ownerType: 'user',
      ownerUid: submission.ownerUid,
      category: submission.category,
      slot: CUSTOM_CATEGORY_SLOTS[submission.category],
      format: submission.format,
      usage: submission.usage,
      loop: submission.loop === true,
      performanceTier: 'standard',
      minimumClientVersion: '1.0.0',
      ...(submission.fallbackAssetId ? {
        fallbackAssetId: submission.fallbackAssetId,
        fallbackAssetVersionId: submission.fallbackAssetVersionId,
      } : {}),
      storagePath,
      storageGeneration: String(destinationMetadata.generation || ''),
      byteSize: inspection.value.byteSize,
      contentType: inspection.value.contentType,
      sha256: inspection.value.sha256,
      ...inspection.value.metadata,
      validationReceiptId: submission.validationReceiptId,
      submissionId: input.submissionId,
      visibility: 'owner-bound',
      createdAt: timestamp,
      createdByUid: decodedToken.uid,
    };
    const summary = buildOwnerBoundAssetSummary({
      approvalId,
      assetId,
      assetVersionId,
      category: submission.category,
      existing: assetSnapshot.exists ? assetSnapshot.data() : undefined,
      ownerUid: submission.ownerUid,
      slot: CUSTOM_CATEGORY_SLOTS[submission.category],
    });
    transaction.create(refs.version, version);
    transaction.set(refs.asset, {
      ...summary,
      createdAt: assetSnapshot.exists ? assetSnapshot.data().createdAt : timestamp,
      publishedAt: timestamp,
      updatedAt: timestamp,
      updatedByUid: decodedToken.uid,
    });
    transaction.create(refs.approval, {
      assetId,
      assetVersionId,
      byteSize: version.byteSize,
      checksum: version.sha256,
      createdAt: timestamp,
      decision: 'approved',
      id: approvalId,
      ownerUid: submission.ownerUid,
      reason: input.reason,
      reviewerEmail: decodedToken.email || '',
      reviewerUid: decodedToken.uid,
      storagePath,
      submissionId: input.submissionId,
      validationReceiptId: submission.validationReceiptId,
      visibility: 'owner-bound',
    });
    transaction.create(refs.ownership, {
      assetId,
      assetVersionId,
      category: submission.category,
      checksum: version.sha256,
      createdAt: timestamp,
      equipped: false,
      state: 'active',
      submissionId: input.submissionId,
      uid: submission.ownerUid,
      updatedAt: timestamp,
    });
    transaction.update(refs.submission, {
      approvalId,
      approvedAssetId: assetId,
      approvedVersionId: assetVersionId,
      revision: Number(latestSubmission.data().revision || 0) + 1,
      status: 'approved',
      updatedAt: timestamp,
    });
    decrementEligibilityPendingCount(transaction, refs.eligibility, eligibilitySnapshot, timestamp);
    transaction.create(refs.audit, {
      action: 'cosmetic-custom-approve',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      approvalId,
      assetId,
      assetVersionId,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'store-catalog',
      operation: input.operation,
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision: summary.revision,
      status: 'completed',
      submissionId: input.submissionId,
      targetUid: submission.ownerUid,
    });
    return {
      approvalId,
      assetId,
      assetVersionId,
      eventId: auditRef.id,
      replayed: false,
      revision: summary.revision,
    };
  });
}

async function rejectCosmeticCustomSubmission({ db, decodedToken, fieldValue, input }) {
  return mutateSubmissionDecision({
    db,
    decodedToken,
    fieldValue,
    input,
    nextStatus: 'rejected',
    operation: 'reject-custom-submission',
  });
}

async function suspendCosmeticCustomSubmission({ db, decodedToken, fieldValue, input }) {
  const submissionRef = db.doc(`cosmeticSubmissions/${input.submissionId}`);
  const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_${input.requestId}`);
  const fingerprint = stableFingerprint(input);
  return db.runTransaction(async (transaction) => {
    const [auditSnapshot, submissionSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(submissionRef),
    ]);
    if (auditSnapshot.exists) {
      const existing = auditSnapshot.data();
      if (existing?.actorUid === decodedToken.uid && existing?.requestFingerprint === fingerprint) {
        return {
          eventId: auditRef.id,
          replayed: true,
          revision: existing.revision,
          submissionId: input.submissionId,
        };
      }
      throw adminError(409, 'requestId was already used for another custom submission operation.');
    }
    if (!submissionSnapshot.exists) throw adminError(404, 'Submission was not found.');
    const submission = submissionSnapshot.data();
    if (Number(submission.revision || 0) !== input.expectedRevision) {
      throw adminError(409, 'Submission changed after it was opened. Refresh and try again.');
    }
    if (!['pending', 'approved', 'processed'].includes(submission.status)) {
      throw adminError(409, 'Submission cannot be suspended from its current state.');
    }

    const ownerUid = submission.ownerUid;
    const assetId = submission.approvedAssetId || '';
    const equipmentRef = ownerUid ? db.doc(`storeEquipment/${ownerUid}`) : undefined;
    const profileRef = ownerUid ? db.doc(`publicProfiles/${ownerUid}`) : undefined;
    const assetRef = assetId ? db.doc(`cosmeticAssets/${assetId}`) : undefined;
    const ownershipRef = ownerUid && assetId
      ? db.doc(`cosmeticCustomOwnerships/${ownerUid}/items/${assetId}`)
      : undefined;
    const eligibilityRef = ownerUid ? db.doc(`cosmeticCustomEligibility/${ownerUid}`) : undefined;

    const [equipmentSnapshot, profileSnapshot, assetSnapshot, ownershipSnapshot, eligibilitySnapshot] = await Promise.all([
      equipmentRef ? transaction.get(equipmentRef) : Promise.resolve(undefined),
      profileRef ? transaction.get(profileRef) : Promise.resolve(undefined),
      assetRef ? transaction.get(assetRef) : Promise.resolve(undefined),
      ownershipRef ? transaction.get(ownershipRef) : Promise.resolve(undefined),
      eligibilityRef ? transaction.get(eligibilityRef) : Promise.resolve(undefined),
    ]);

    const timestamp = fieldValue.serverTimestamp();
    const revision = Number(submission.revision || 0) + 1;
    transaction.update(submissionRef, {
      decisionReason: input.reason,
      revision,
      status: 'suspended',
      suspendedAt: timestamp,
      suspendedByUid: decodedToken.uid,
      updatedAt: timestamp,
    });

    if (OPEN_PENDING_STATUSES.has(submission.status) && eligibilitySnapshot?.exists) {
      decrementEligibilityPendingCount(transaction, eligibilityRef, eligibilitySnapshot, timestamp);
    }

    if (assetSnapshot?.exists) {
      transaction.set(assetRef, {
        ...assetSnapshot.data(),
        moderationStatus: 'suspended',
        publicationStatus: 'disabled',
        renderingEnabled: false,
        suspendedAt: timestamp,
        updatedAt: timestamp,
        updatedByUid: decodedToken.uid,
      }, { merge: true });
    }
    if (ownershipSnapshot?.exists) {
      transaction.update(ownershipRef, {
        equipped: false,
        state: 'suspended',
        updatedAt: timestamp,
      });
    }
    if (equipmentSnapshot?.exists && assetId) {
      const equipment = { ...equipmentSnapshot.data() };
      const customCosmetics = isRecord(equipment.customCosmetics) ? { ...equipment.customCosmetics } : {};
      const profileUpdate = { updatedAt: timestamp };
      let cleared = false;
      for (const [key, value] of Object.entries(customCosmetics)) {
        if (value?.assetId === assetId) {
          delete customCosmetics[key];
          cleared = true;
          if (key === 'avatarFrame' || key === 'profileSkin' || key === 'entryEffect') {
            profileUpdate[`equippedCosmetics.${key}`] = fieldValue.delete();
          }
        }
      }
      if (cleared) {
        transaction.set(equipmentRef, {
          ...equipment,
          customCosmetics,
          uid: ownerUid,
          updatedAt: timestamp,
        });
        if (profileSnapshot?.exists) {
          transaction.update(profileRef, profileUpdate);
        }
      }
    }

    transaction.create(auditRef, {
      action: 'cosmetic-custom-suspended',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'store-catalog',
      operation: 'suspend-custom-submission',
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision,
      status: 'completed',
      submissionId: input.submissionId,
      targetUid: ownerUid || '',
    });
    return {
      eventId: auditRef.id,
      replayed: false,
      revision,
      submissionId: input.submissionId,
    };
  });
}

async function revokeCosmeticCustomEligibility({
  db,
  decodedToken,
  fieldValue,
  input,
  reason,
  uid,
  updatedByUid,
}) {
  const targetUid = input?.uid || uid;
  const revokeReason = String(input?.reason || reason || '').slice(0, 300);
  const actorUid = decodedToken?.uid || updatedByUid || 'system';
  const requestId = input?.requestId;
  if (!targetUid) throw adminError(400, 'A valid eligibility uid is required.');

  if (requestId) {
    const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_elig_${requestId}`);
    const existing = await auditRef.get();
    if (existing.exists) {
      const data = existing.data();
      if (data?.actorUid === actorUid && data?.operation === 'revoke-custom-eligibility' && data?.targetUid === targetUid) {
        return { cleared: data.cleared || 0, eventId: auditRef.id, replayed: true, uid: targetUid };
      }
      throw adminError(409, 'requestId was already used for another custom eligibility operation.');
    }
    const cleared = await clearAllCustomEquips({ db, fieldValue, uid: targetUid });
    const timestamp = fieldValue.serverTimestamp();
    await db.doc(`cosmeticCustomEligibility/${targetUid}`).set({
      active: false,
      revokeReason,
      revokedAt: timestamp,
      uid: targetUid,
      updatedAt: timestamp,
      updatedByUid: actorUid,
    }, { merge: true });
    await auditRef.set({
      action: 'cosmetic-custom-eligibility-revoke',
      actorEmail: decodedToken?.email || '',
      actorUid,
      cleared: cleared.cleared || 0,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'store-catalog',
      operation: 'revoke-custom-eligibility',
      reason: revokeReason,
      status: 'completed',
      targetUid,
    });
    return { cleared: cleared.cleared || 0, eventId: auditRef.id, replayed: false, uid: targetUid };
  }

  const eligibilityRef = db.doc(`cosmeticCustomEligibility/${targetUid}`);
  const timestamp = fieldValue.serverTimestamp();
  await eligibilityRef.set({
    active: false,
    revokeReason,
    revokedAt: timestamp,
    uid: targetUid,
    updatedAt: timestamp,
    updatedByUid: actorUid,
  }, { merge: true });
  const cleared = await clearAllCustomEquips({ db, fieldValue, uid: targetUid });
  return { cleared, uid: targetUid };
}

async function grantCosmeticCustomEligibility({
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  const uid = input.uid;
  const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_elig_${input.requestId}`);
  const existing = await auditRef.get();
  if (existing.exists) {
    const data = existing.data();
    if (data?.actorUid === decodedToken.uid && data?.operation === 'grant-custom-eligibility' && data?.targetUid === uid) {
      return { eventId: auditRef.id, replayed: true, uid };
    }
    throw adminError(409, 'requestId was already used for another custom eligibility operation.');
  }
  const timestamp = fieldValue.serverTimestamp();
  await db.doc(`cosmeticCustomEligibility/${uid}`).set({
    active: true,
    categories: input.categories,
    dailyUploadLimit: input.dailyUploadLimit,
    grantReason: input.reason,
    grantedAt: timestamp,
    grantedByUid: decodedToken.uid,
    maxPending: input.maxPending,
    pendingCount: 0,
    revokeReason: '',
    revokedAt: null,
    uid,
    updatedAt: timestamp,
    updatedByUid: decodedToken.uid,
  }, { merge: true });
  await auditRef.set({
    action: 'cosmetic-custom-eligibility-grant',
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    categories: input.categories,
    createdAt: timestamp,
    id: auditRef.id,
    kind: 'store-catalog',
    operation: 'grant-custom-eligibility',
    reason: input.reason,
    status: 'completed',
    targetUid: uid,
  });
  return { eventId: auditRef.id, replayed: false, uid };
}

async function listAdminCosmeticCustomSubmissions({ db, input }) {
  let query = db.collection('cosmeticSubmissions').where('status', '==', input.status);
  if (input.ownerUid) query = query.where('ownerUid', '==', input.ownerUid);
  const snapshot = await query.limit(Math.min(100, input.limit * 2)).get();
  const submissions = snapshot.docs
    .map((document) => mapAdminCustomSubmission(document.id, document.data()))
    .filter(Boolean)
    .sort((left, right) => (right.updatedAtMs || 0) - (left.updatedAtMs || 0))
    .slice(0, input.limit);
  return { submissions };
}

async function getAdminCosmeticCustomEligibility({ db, input }) {
  const snapshot = await db.doc(`cosmeticCustomEligibility/${input.uid}`).get();
  return {
    eligibility: mapAdminCustomEligibility(input.uid, snapshot.exists ? snapshot.data() : undefined),
  };
}

async function previewAdminCosmeticCustomSubmission({
  bucket,
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_preview_${input.requestId}`);
  const existing = await auditRef.get();
  if (existing.exists) {
    const data = existing.data();
    if (data?.actorUid === decodedToken.uid && data?.submissionId === input.submissionId) {
      return {
        eventId: auditRef.id,
        expiresAtMs: data.expiresAtMs || 0,
        previewUrl: '',
        replayed: true,
        submissionId: input.submissionId,
      };
    }
    throw adminError(409, 'requestId was already used for another custom submission preview.');
  }

  const submissionSnapshot = await db.doc(`cosmeticSubmissions/${input.submissionId}`).get();
  if (!submissionSnapshot.exists) throw adminError(404, 'Submission was not found.');
  const submission = submissionSnapshot.data();
  const sourcePath = typeof submission.sourcePath === 'string' ? submission.sourcePath : '';
  if (!sourcePath || !sourcePath.startsWith('cosmetic-submissions/')) {
    throw adminError(404, 'Quarantine source is unavailable for preview.');
  }
  if (!['pending', 'processed', 'approved', 'rejected', 'suspended', 'authorized'].includes(submission.status)) {
    throw adminError(409, 'Submission cannot be previewed from its current state.');
  }

  const nowMs = Date.now();
  const expiresAtMs = nowMs + CUSTOM_PREVIEW_URL_TTL_MS;
  let previewUrl = '';
  try {
    const [url] = await bucket.file(sourcePath).getSignedUrl({
      action: 'read',
      expires: expiresAtMs,
      version: 'v4',
    });
    previewUrl = typeof url === 'string' ? url : '';
  } catch {
    throw adminError(404, 'Quarantine source object was not found.');
  }
  if (!previewUrl) throw adminError(404, 'Quarantine source object was not found.');

  const timestamp = fieldValue.serverTimestamp();
  await auditRef.set({
    action: 'cosmetic-custom-preview',
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    createdAt: timestamp,
    expiresAtMs,
    id: auditRef.id,
    kind: 'store-catalog',
    operation: 'preview-custom-submission',
    reason: input.reason,
    status: 'completed',
    submissionId: input.submissionId,
    targetUid: submission.ownerUid || '',
  });

  return {
    eventId: auditRef.id,
    expiresAtMs,
    previewUrl,
    replayed: false,
    submission: mapAdminCustomSubmission(submissionSnapshot.id, submission),
    submissionId: input.submissionId,
  };
}

async function clearAllCustomEquips({ db, fieldValue, uid }) {
  return db.runTransaction(async (transaction) => {
    const equipmentRef = db.doc(`storeEquipment/${uid}`);
    const profileRef = db.doc(`publicProfiles/${uid}`);
    const [equipmentSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(equipmentRef),
      transaction.get(profileRef),
    ]);
    if (!equipmentSnapshot.exists) return { cleared: 0 };
    const equipment = equipmentSnapshot.data() || {};
    const customCosmetics = isRecord(equipment.customCosmetics) ? { ...equipment.customCosmetics } : {};
    const assetIds = Object.values(customCosmetics)
      .map((entry) => (isRecord(entry) ? entry.assetId : ''))
      .filter(Boolean);
    const ownershipSnapshots = await Promise.all(assetIds.map((assetId) => (
      transaction.get(db.doc(`cosmeticCustomOwnerships/${uid}/items/${assetId}`))
    )));
    const now = fieldValue.serverTimestamp();
    ownershipSnapshots.forEach((snapshot) => {
      if (snapshot.exists) transaction.update(snapshot.ref, { equipped: false, updatedAt: now });
    });
    transaction.set(equipmentRef, {
      ...equipment,
      customCosmetics: {},
      uid,
      updatedAt: now,
    });
    if (profileSnapshot.exists) {
      const profileUpdate = { updatedAt: now };
      // Only skin/frame belong on public profiles; also clear any stale entryEffect write.
      for (const key of Object.keys(customCosmetics)) {
        if (key === 'avatarFrame' || key === 'profileSkin' || key === 'entryEffect') {
          profileUpdate[`equippedCosmetics.${key}`] = fieldValue.delete();
        }
      }
      if (profileSnapshot.data()?.equippedCosmetics?.entryEffect) {
        profileUpdate['equippedCosmetics.entryEffect'] = fieldValue.delete();
      }
      transaction.update(profileRef, profileUpdate);
    }
    return { cleared: assetIds.length };
  });
}

async function clearCustomEquipForAsset({ assetId, db, fieldValue, uid }) {
  return db.runTransaction(async (transaction) => {
    const equipmentRef = db.doc(`storeEquipment/${uid}`);
    const profileRef = db.doc(`publicProfiles/${uid}`);
    const [equipmentSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(equipmentRef),
      transaction.get(profileRef),
    ]);
    if (!equipmentSnapshot.exists) return { cleared: 0 };
    const equipment = { ...equipmentSnapshot.data() };
    const customCosmetics = isRecord(equipment.customCosmetics) ? { ...equipment.customCosmetics } : {};
    let cleared = 0;
    const now = fieldValue.serverTimestamp();
    for (const [key, value] of Object.entries(customCosmetics)) {
      if (value?.assetId === assetId) {
        delete customCosmetics[key];
        cleared += 1;
        if (profileSnapshot.exists && (key === 'avatarFrame' || key === 'profileSkin' || key === 'entryEffect')) {
          transaction.update(profileRef, {
            updatedAt: now,
            [`equippedCosmetics.${key}`]: fieldValue.delete(),
          });
        }
      }
    }
    if (!cleared) return { cleared: 0 };
    transaction.set(equipmentRef, { ...equipment, customCosmetics, uid, updatedAt: now });
    return { cleared };
  });
}

async function mutateSubmissionDecision({
  db,
  decodedToken,
  fieldValue,
  input,
  nextStatus,
  operation,
}) {
  const submissionRef = db.doc(`cosmeticSubmissions/${input.submissionId}`);
  const auditRef = db.doc(`adminAuditEvents/cosmetic_custom_${input.requestId}`);
  const fingerprint = stableFingerprint(input);
  return db.runTransaction(async (transaction) => {
    const [auditSnapshot, submissionSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(submissionRef),
    ]);
    if (auditSnapshot.exists) {
      const existing = auditSnapshot.data();
      if (existing?.actorUid === decodedToken.uid && existing?.requestFingerprint === fingerprint) {
        return {
          eventId: auditRef.id,
          replayed: true,
          revision: existing.revision,
          submissionId: input.submissionId,
        };
      }
      throw adminError(409, 'requestId was already used for another custom submission operation.');
    }
    if (!submissionSnapshot.exists) throw adminError(404, 'Submission was not found.');
    const submission = submissionSnapshot.data();
    if (Number(submission.revision || 0) !== input.expectedRevision) {
      throw adminError(409, 'Submission changed after it was opened. Refresh and try again.');
    }
    if (operation === 'reject-custom-submission' && submission.status !== 'pending') {
      throw adminError(409, 'Only pending submissions can be rejected.');
    }
    if (operation === 'suspend-custom-submission' && !['pending', 'approved', 'processed'].includes(submission.status)) {
      throw adminError(409, 'Submission cannot be suspended from its current state.');
    }
    const eligibilityRef = submission.ownerUid
      ? db.doc(`cosmeticCustomEligibility/${submission.ownerUid}`)
      : undefined;
    const eligibilitySnapshot = eligibilityRef
      ? await transaction.get(eligibilityRef)
      : undefined;
    const timestamp = fieldValue.serverTimestamp();
    const revision = Number(submission.revision || 0) + 1;
    transaction.update(submissionRef, {
      decisionReason: input.reason,
      revision,
      status: nextStatus,
      updatedAt: timestamp,
      ...(operation === 'reject-custom-submission' ? {
        rejectedAt: timestamp,
        rejectedByUid: decodedToken.uid,
      } : {
        suspendedAt: timestamp,
        suspendedByUid: decodedToken.uid,
      }),
    });
    if (OPEN_PENDING_STATUSES.has(submission.status)) {
      decrementEligibilityPendingCount(transaction, eligibilityRef, eligibilitySnapshot, timestamp);
    }
    transaction.create(auditRef, {
      action: `cosmetic-custom-${nextStatus}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'store-catalog',
      operation,
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision,
      status: 'completed',
      submissionId: input.submissionId,
      targetUid: submission.ownerUid,
    });
    return {
      eventId: auditRef.id,
      replayed: false,
      revision,
      submissionId: input.submissionId,
    };
  });
}

async function rejectFinalize({
  authorizationRef,
  clock,
  commandRef,
  db,
  fieldValue,
  requestId,
  submissionRef,
  submissionId,
  uid,
  errorCode,
  reason,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'finalize-cosmetic-custom-upload' && previous.result
        ? { result: previous.result }
        : previous.action === 'finalize-cosmetic-custom-upload' && previous.errorCode
          ? { errorCode: previous.errorCode }
          : { errorCode: 'REQUEST_CONFLICT' };
    }
    const submissionSnapshot = await transaction.get(submissionRef);
    const eligibilityRef = db.doc(`cosmeticCustomEligibility/${uid}`);
    const eligibilitySnapshot = await transaction.get(eligibilityRef);
    if (submissionSnapshot.exists && OPEN_PENDING_STATUSES.has(submissionSnapshot.data()?.status)) {
      transaction.update(submissionRef, {
        rejectionReason: reason || errorCode,
        status: 'rejected',
        updatedAt: now,
      });
      decrementEligibilityPendingCount(transaction, eligibilityRef, eligibilitySnapshot, now);
    }
    const authorizationSnapshot = await transaction.get(authorizationRef);
    if (authorizationSnapshot.exists) {
      transaction.set(authorizationRef, {
        ...authorizationSnapshot.data(),
        active: false,
        finalizedAt: now,
      });
    }
    return recordCommand(transaction, commandRef, now, uid, requestId, 'finalize-cosmetic-custom-upload', { errorCode }, {
      submissionId,
    });
  });
}

async function assertApprovedStaticFallback({
  category,
  db,
  fallbackAssetId,
  fallbackAssetVersionId,
  transaction,
}) {
  const [summary, version, approval] = await Promise.all([
    transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}`)),
    transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}/versions/${fallbackAssetVersionId}`)),
    transaction.get(db.doc(`cosmeticAssetApprovals/${fallbackAssetId}__${fallbackAssetVersionId}`)),
  ]);
  return Boolean(
    summary.exists
    && version.exists
    && approval.exists
    && summary.data()?.moderationStatus === 'approved'
    && summary.data()?.publicationStatus === 'published'
    && summary.data()?.renderingEnabled === true
    && summary.data()?.publishedVersionId === fallbackAssetVersionId
    && summary.data()?.approvedVersionId === fallbackAssetVersionId
    && version.data()?.category === category
    && ['png', 'jpeg', 'legacy-webp'].includes(version.data()?.format)
    && approval.data()?.decision === 'approved'
    && approval.data()?.checksum === version.data()?.sha256,
  );
}

function recordCommand(transaction, commandRef, now, uid, requestId, action, response, extra = {}) {
  transaction.create(commandRef, {
    action,
    createdAt: now,
    requestId,
    uid,
    ...extra,
    ...response,
  });
  return response;
}

function mapSubmission(id, data) {
  if (!isRecord(data) || data.submissionId !== id) return null;
  return {
    assetVersionId: data.assetVersionId || '',
    category: data.category || '',
    format: data.format || '',
    revision: Number(data.revision || 0),
    status: data.status || '',
    submissionId: id,
    updatedAt: data.updatedAt || null,
    updatedAtMs: timestampMillis(data.updatedAt) || 0,
    approvedAssetId: data.approvedAssetId || '',
    // Never expose quarantine path or raw checksum forging surface to list clients beyond status.
  };
}

function stableFingerprint(input) {
  return JSON.stringify({
    expectedRevision: input.expectedRevision,
    operation: input.operation,
    reason: input.reason,
    submissionId: input.submissionId,
  });
}

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function timestampMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return Number.NaN;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  approveCosmeticCustomSubmission,
  attestCosmeticCustomSubmission,
  clearAllCustomEquips,
  createCosmeticCustomUpload,
  equipCosmeticCustomAsset,
  finalizeCosmeticCustomUpload,
  getAdminCosmeticCustomEligibility,
  grantCosmeticCustomEligibility,
  listAdminCosmeticCustomSubmissions,
  listCosmeticCustomSubmissions,
  previewAdminCosmeticCustomSubmission,
  rejectCosmeticCustomSubmission,
  revokeCosmeticCustomEligibility,
  suspendCosmeticCustomSubmission,
  unequipCosmeticCustomAsset,
};
