'use strict';

const crypto = require('node:crypto');
const {
  buildCanonicalStoragePath,
  inspectCosmeticAssetBuffer,
} = require('./cosmeticsAssetValidationCore');
const {
  transitionCosmeticAssetSummary,
} = require('./adminCosmeticsAssetCore');

async function getAdminCosmeticsAssets({ db, input }) {
  if (input.assetId) {
    const assetRef = db.doc(`cosmeticAssets/${input.assetId}`);
    const [asset, versions, approvals] = await Promise.all([
      assetRef.get(),
      assetRef.collection('versions').orderBy('createdAt', 'desc').limit(25).get(),
      db.collection('cosmeticAssetApprovals')
        .where('assetId', '==', input.assetId)
        .limit(25)
        .get(),
    ]);
    return {
      asset: asset.exists ? mapDocument(asset.id, asset.data()) : null,
      approvals: approvals.docs.map((document) => mapDocument(document.id, document.data())),
      versions: versions.docs.map((document) => mapDocument(document.id, document.data())),
    };
  }

  const snapshot = await db.collection('cosmeticAssets').limit(100).get();
  const assets = snapshot.docs
    .map((document) => mapDocument(document.id, document.data()))
    .filter((asset) => !input.category || asset.category === input.category)
    .filter((asset) => !input.moderationStatus
      || asset.moderationStatus === input.moderationStatus)
    .filter((asset) => !input.publicationStatus
      || asset.publicationStatus === input.publicationStatus)
    .slice(0, input.limit);
  return {
    assets,
  };
}

async function getAdminPublishedCosmeticAssetOptions({ db, documentIdField = '__name__', input }) {
  let query = db.collection('cosmeticAssets')
    .where('category', '==', input.category)
    .orderBy(documentIdField);
  if (input.cursor) query = query.startAfter(input.cursor);
  const snapshot = await query.limit(250).get();
  const candidates = snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((asset) => asset.id > input.cursor)
    .filter((asset) => asset.category === input.category)
    .filter((asset) => asset.moderationStatus === 'approved'
      && asset.publicationStatus === 'published'
      && asset.renderingEnabled === true
      && typeof asset.publishedVersionId === 'string')
    .sort((left, right) => left.id.localeCompare(right.id));
  const records = candidates.length
    ? await getAllDocuments(db, candidates.flatMap((asset) => [
      db.doc(`cosmeticAssets/${asset.id}/versions/${asset.publishedVersionId}`),
      db.doc(`cosmeticAssetApprovals/${asset.id}__${asset.publishedVersionId}`),
    ]))
    : [];
  const preliminarilyCompatible = candidates.flatMap((asset, index) => {
    const version = records[index * 2];
    const approval = records[(index * 2) + 1];
    const data = version?.exists ? version.data() : undefined;
    const approvalData = approval?.exists ? approval.data() : undefined;
    if (!data
      || data.assetId !== asset.id
      || data.assetVersionId !== asset.publishedVersionId
      || data.category !== input.category
      || !input.formats.includes(data.format)
      || asset.approvedVersionId !== data.assetVersionId
      || asset.approvalId !== `${asset.id}__${data.assetVersionId}`
      || approval?.id !== asset.approvalId
      || approvalData?.assetId !== asset.id
      || approvalData?.assetVersionId !== data.assetVersionId
      || approvalData?.decision !== 'approved'
      || approvalData?.checksum !== data.sha256
      || (['nameplate', 'cosmetic-badge'].includes(data.category)
        && (approvalData?.authoritySeparationPassed !== true || approvalData?.readableIdentityPassed !== true))
      || !isPublishedOptionCompatible(data)) return [];
    return [{ data, id: asset.id }];
  });
  const dependencies = preliminarilyCompatible.length
    ? await getAllDocuments(db, preliminarilyCompatible.flatMap(({ data }) => dependencyReferences(db, data)))
    : [];
  let dependencyOffset = 0;
  const compatible = preliminarilyCompatible.flatMap(({ data, id }) => {
    const references = dependencyReferences(db, data);
    const snapshots = dependencies.slice(dependencyOffset, dependencyOffset + references.length);
    dependencyOffset += references.length;
    if (!approvedDependencies(data, snapshots) || !isPublishedBundleCompatible(data, snapshots)) return [];
    return [{ id, option: {
      assetId: id,
      assetVersionId: data.assetVersionId,
      audioAssetId: typeof data.audioAssetId === 'string' ? data.audioAssetId : '',
      audioAssetVersionId: typeof data.audioAssetVersionId === 'string' ? data.audioAssetVersionId : '',
      byteSize: Number(data.byteSize || 0),
      category: data.category,
      durationMs: Number(data.durationMs || 0),
      fallbackAssetId: typeof data.fallbackAssetId === 'string' ? data.fallbackAssetId : '',
      fallbackAssetVersionId: typeof data.fallbackAssetVersionId === 'string' ? data.fallbackAssetVersionId : '',
      format: data.format,
      frameRate: Number(data.frameRate || 0),
      height: Number(data.height || 0),
      loop: data.loop === true,
      performanceTier: typeof data.performanceTier === 'string' ? data.performanceTier : 'low',
      storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
      transparent: data.transparent === true,
      width: Number(data.width || 0),
    } }];
  });
  const optionWindow = compatible.slice(0, input.limit + 1);
  const page = optionWindow.slice(0, input.limit);
  const moreCompatible = optionWindow.length > input.limit;
  const scanMayContinue = snapshot.docs.length === 250;
  return {
    items: page.map((record) => record.option),
    pageInfo: {
      hasNextPage: moreCompatible || scanMayContinue,
      nextCursor: moreCompatible && page.length
        ? page[page.length - 1].id
        : scanMayContinue ? snapshot.docs[snapshot.docs.length - 1].id : '',
    },
  };
}

function dependencyReferences(db, version) {
  const references = [];
  if (isAnimatedAssetFormat(version.format) && version.fallbackAssetId && version.fallbackAssetVersionId) {
    const fallback = referenceSet(db, version.fallbackAssetId, version.fallbackAssetVersionId);
    references.push(fallback.summary, fallback.version, fallback.approval);
  }
  if (version.audioAssetId && version.audioAssetVersionId) {
    const audio = referenceSet(db, version.audioAssetId, version.audioAssetVersionId);
    references.push(audio.summary, audio.version, audio.approval);
  }
  return references;
}

function approvedDependencies(version, snapshots) {
  if (isAnimatedAssetFormat(version.format)) {
    if (!version.fallbackAssetId || !version.fallbackAssetVersionId || snapshots.length < 3) return false;
    if (!isApprovedOptionDependency(snapshots.slice(0, 3), {
      assetId: version.fallbackAssetId,
      assetVersionId: version.fallbackAssetVersionId,
      category: version.category,
      formats: ['png', 'jpeg', 'legacy-webp'],
      safetyAttestationsRequired: ['nameplate', 'cosmetic-badge'].includes(version.category),
    })) return false;
    snapshots = snapshots.slice(3);
  }
  const hasAnyAudioReference = Boolean(version.audioAssetId || version.audioAssetVersionId);
  if (hasAnyAudioReference) {
    if (!version.audioAssetId || !version.audioAssetVersionId || snapshots.length < 3) return false;
    if (!isApprovedOptionDependency(snapshots.slice(0, 3), {
      assetId: version.audioAssetId,
      assetVersionId: version.audioAssetVersionId,
      category: 'effect-audio',
      formats: ['m4a-aac'],
    })) return false;
  }
  return true;
}

function isApprovedOptionDependency([summary, version, approval], expected) {
  const summaryData = summary?.exists ? summary.data() : undefined;
  const versionData = version?.exists ? version.data() : undefined;
  const approvalData = approval?.exists ? approval.data() : undefined;
  return summaryData?.moderationStatus === 'approved'
    && summaryData?.publicationStatus === 'published'
    && summaryData?.renderingEnabled === true
    && summaryData?.publishedVersionId === expected.assetVersionId
    && summaryData?.approvedVersionId === expected.assetVersionId
    && summaryData?.approvalId === `${expected.assetId}__${expected.assetVersionId}`
    && versionData?.assetId === expected.assetId
    && versionData?.assetVersionId === expected.assetVersionId
    && versionData?.category === expected.category
    && expected.formats.includes(versionData?.format)
    && approval?.id === summaryData.approvalId
    && approvalData?.assetId === expected.assetId
    && approvalData?.assetVersionId === expected.assetVersionId
    && approvalData?.decision === 'approved'
    && approvalData?.checksum === versionData?.sha256
    && (!expected.safetyAttestationsRequired
      || (approvalData?.authoritySeparationPassed === true && approvalData?.readableIdentityPassed === true));
}

function isAnimatedAssetFormat(format) {
  return format === 'lottie-json' || format === 'mp4';
}

function isPublishedOptionCompatible(version) {
  if (['png', 'jpeg', 'legacy-webp'].includes(version.format)) return version.usage === 'static' && version.loop === false;
  if (version.format === 'm4a-aac') return version.usage === 'one-shot' && version.loop === false;
  if (version.category === 'gift-effect') {
    return version.usage === 'one-shot'
      && version.width === 1280 && version.height === 720
      && version.durationMs >= 1500 && version.durationMs <= 6000;
  }
  if (version.category === 'entry-effect') {
    return version.usage === 'one-shot'
      && version.width === 1280 && version.height === 720
      && version.durationMs >= 3000 && version.durationMs <= 5000;
  }
  if (version.category === 'room-theme') {
    return version.usage === 'looping' && version.loop === true;
  }
  return version.format === 'lottie-json' ? version.usage === 'looping' && version.loop === true : true;
}

function isPublishedBundleCompatible(version, snapshots) {
  const fallback = isAnimatedAssetFormat(version.format) ? snapshots[1]?.data?.() : undefined;
  const audioOffset = isAnimatedAssetFormat(version.format) ? 3 : 0;
  const audio = version.audioAssetId ? snapshots[audioOffset + 1]?.data?.() : undefined;
  if (!['gift-effect', 'entry-effect'].includes(version.category)
    && (version.audioAssetId !== undefined || version.audioAssetVersionId !== undefined)) return false;
  if (version.category === 'gift-effect') {
    return validPrimaryEffectProfile(version, 1500, 6000)
      && validStaticEffectFallback(fallback, ['png', 'jpeg', 'legacy-webp'])
      && validEffectAudio(audio, version.durationMs);
  }
  if (version.category === 'entry-effect') {
    return validPrimaryEffectProfile(version, 3000, 5000)
      && validStaticEffectFallback(fallback, ['png', 'legacy-webp'])
      && validEffectAudio(audio, version.durationMs);
  }
  if (version.category === 'couple-effect' && version.format === 'lottie-json') {
    return fallback?.format === 'png' && fallback.usage === 'static' && fallback.loop === false;
  }
  if (version.category === 'room-theme' && isAnimatedAssetFormat(version.format)) {
    return version.audioCodec === ''
      && version.audioAssetId === undefined && version.audioAssetVersionId === undefined
      && validStaticEffectFallback(fallback, ['png', 'jpeg'], false);
  }
  if (version.format === 'lottie-json') {
    return validStaticEffectFallback(fallback, ['png', 'legacy-webp'], false);
  }
  return true;
}

function validPrimaryEffectProfile(version, minimumDurationMs, maximumDurationMs) {
  return version.width === 1280 && version.height === 720
    && version.durationMs >= minimumDurationMs && version.durationMs <= maximumDurationMs
    && version.frameRate > 0 && version.frameRate <= 30
    && version.usage === 'one-shot' && version.loop === false
    && (
      (version.format === 'lottie-json' && version.transparent === true && version.audioCodec === '' && version.videoCodec === '')
      || (version.format === 'mp4' && version.transparent === false && version.audioCodec === '' && version.videoCodec === 'h264')
    );
}

function validStaticEffectFallback(version, formats, requireCanvas = true) {
  return Boolean(version
    && formats.includes(version.format)
    && (!requireCanvas || (version.width === 1280 && version.height === 720))
    && version.durationMs === 0
    && version.usage === 'static'
    && version.loop === false
    && version.audioAssetId === undefined && version.audioAssetVersionId === undefined
    && version.fallbackAssetId === undefined && version.fallbackAssetVersionId === undefined);
}

function validEffectAudio(version, maximumDurationMs) {
  return !version || (version.format === 'm4a-aac'
    && version.durationMs >= 1 && version.durationMs <= maximumDurationMs
    && version.audioCodec === 'aac' && version.videoCodec === ''
    && version.usage === 'one-shot' && version.loop === false);
}

async function getAllDocuments(db, references) {
  const chunks = [];
  for (let index = 0; index < references.length; index += 250) {
    chunks.push(references.slice(index, index + 250));
  }
  const snapshots = await Promise.all(chunks.map((chunk) => db.getAll(...chunk)));
  return snapshots.flat();
}

async function mutateAdminCosmeticsAsset({
  bucket,
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  if (input.operation === 'validate-version') {
    return validateAndRegisterVersion({
      bucket,
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  if (input.operation === 'approve-custom-submission') {
    const {
      approveCosmeticCustomSubmission,
    } = require('./cosmeticCustomSubmissionService');
    return approveCosmeticCustomSubmission({
      bucket,
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  if (input.operation === 'reject-custom-submission') {
    const {
      rejectCosmeticCustomSubmission,
    } = require('./cosmeticCustomSubmissionService');
    return rejectCosmeticCustomSubmission({
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  if (input.operation === 'suspend-custom-submission') {
    const {
      suspendCosmeticCustomSubmission,
    } = require('./cosmeticCustomSubmissionService');
    return suspendCosmeticCustomSubmission({
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  if (input.operation === 'grant-custom-eligibility') {
    const {
      grantCosmeticCustomEligibility,
    } = require('./cosmeticCustomSubmissionService');
    return grantCosmeticCustomEligibility({
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  if (input.operation === 'revoke-custom-eligibility') {
    const {
      revokeCosmeticCustomEligibility,
    } = require('./cosmeticCustomSubmissionService');
    return revokeCosmeticCustomEligibility({
      db,
      decodedToken,
      fieldValue,
      input,
    });
  }
  return mutateRegisteredAsset({ db, decodedToken, fieldValue, input });
}

async function validateAndRegisterVersion({
  bucket,
  db,
  decodedToken,
  fieldValue,
  input,
}) {
  const storagePath = buildCanonicalStoragePath(
    input.asset,
    input.asset.sourceExtension,
  );
  const file = bucket.file(storagePath);
  let buffer;
  let storageMetadata;
  try {
    [[storageMetadata], [buffer]] = await Promise.all([
      file.getMetadata(),
      file.download(),
    ]);
  } catch {
    throw adminError(404, 'The immutable source object was not found.');
  }
  const inspection = await inspectCosmeticAssetBuffer({
    buffer,
    category: input.asset.category,
    contentType: String(storageMetadata.contentType || ''),
    format: input.asset.format,
    loop: input.asset.loop,
    usage: input.asset.usage,
  });
  if (!inspection.ok) throw adminError(400, inspection.reason);
  if (Number(storageMetadata.size || 0) !== inspection.value.byteSize) {
    throw adminError(409, 'Storage metadata size does not match downloaded bytes.');
  }

  const assetRef = db.doc(`cosmeticAssets/${input.asset.assetId}`);
  const versionRef = assetRef.collection('versions').doc(input.asset.assetVersionId);
  const receiptRef = db.doc(
    `cosmeticAssetValidationReceipts/validation_${input.asset.assetId}_${input.asset.assetVersionId}`,
  );
  const auditRef = db.doc(`adminAuditEvents/cosmetic_asset_${input.requestId}`);
  const fallbackRefs = input.asset.fallbackAssetId
    ? referenceSet(db, input.asset.fallbackAssetId, input.asset.fallbackAssetVersionId)
    : null;
  const audioRefs = input.asset.audioAssetId
    ? referenceSet(db, input.asset.audioAssetId, input.asset.audioAssetVersionId)
    : null;
  const fingerprint = stableFingerprint(input);

  return db.runTransaction(async (transaction) => {
    const refs = [
      assetRef,
      versionRef,
      receiptRef,
      auditRef,
      ...(fallbackRefs ? Object.values(fallbackRefs) : []),
      ...(audioRefs ? Object.values(audioRefs) : []),
    ];
    const snapshots = await transaction.getAll(...refs);
    const [assetSnapshot, versionSnapshot, receiptSnapshot, auditSnapshot] = snapshots;
    if (auditSnapshot.exists) {
      return assertReplay(auditSnapshot.data(), decodedToken.uid, fingerprint, auditRef.id);
    }
    const existing = assetSnapshot.exists ? assetSnapshot.data() : undefined;
    if (Number(existing?.revision || 0) !== input.expectedRevision) {
      throw adminError(409, 'Asset changed after it was opened. Refresh and try again.');
    }
    if (versionSnapshot.exists || receiptSnapshot.exists) {
      throw adminError(409, 'This immutable asset version is already registered.');
    }

    let offset = 4;
    if (fallbackRefs) {
      assertApprovedReference(
        snapshots[offset],
        snapshots[offset + 1],
        snapshots[offset + 2],
        {
          category: input.asset.category,
          kind: 'fallback',
          staticOnly: true,
        },
      );
      offset += 3;
    }
    if (audioRefs) {
      assertApprovedReference(
        snapshots[offset],
        snapshots[offset + 1],
        snapshots[offset + 2],
        {
          category: 'effect-audio',
          kind: 'audio',
          staticOnly: false,
        },
      );
    }

    const timestamp = fieldValue.serverTimestamp();
    const version = {
      schemaVersion: 1,
      assetId: input.asset.assetId,
      assetVersionId: input.asset.assetVersionId,
      ownerType: input.asset.ownerType,
      ...(input.asset.ownerUid ? { ownerUid: input.asset.ownerUid } : {}),
      category: input.asset.category,
      ...(input.asset.slot ? { slot: input.asset.slot } : {}),
      format: input.asset.format,
      usage: input.asset.usage,
      loop: input.asset.loop,
      performanceTier: input.asset.performanceTier,
      minimumClientVersion: input.asset.minimumClientVersion,
      ...(input.asset.fallbackAssetId ? {
        fallbackAssetId: input.asset.fallbackAssetId,
        fallbackAssetVersionId: input.asset.fallbackAssetVersionId,
      } : {}),
      ...(input.asset.audioAssetId ? {
        audioAssetId: input.asset.audioAssetId,
        audioAssetVersionId: input.asset.audioAssetVersionId,
      } : {}),
      storagePath,
      storageGeneration: String(storageMetadata.generation || ''),
      ...inspection.value,
      ...inspection.value.metadata,
      validationReceiptId: receiptRef.id,
      createdAt: timestamp,
      createdByUid: decodedToken.uid,
    };
    const summary = transitionCosmeticAssetSummary({
      existing,
      operation: input.operation,
      version,
    });
    transaction.create(versionRef, version);
    transaction.create(receiptRef, {
      assetId: version.assetId,
      assetVersionId: version.assetVersionId,
      byteSize: version.byteSize,
      contentType: version.contentType,
      createdAt: timestamp,
      id: receiptRef.id,
      inspectorVersion: 1,
      sha256: version.sha256,
      status: 'passed',
      storageGeneration: version.storageGeneration,
      storagePath,
      validatorUid: decodedToken.uid,
    });
    transaction.set(assetRef, {
      ...summary,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      updatedByUid: decodedToken.uid,
    });
    writeAudit(transaction, auditRef, decodedToken, input, fingerprint, timestamp, {
      assetId: version.assetId,
      assetVersionId: version.assetVersionId,
      revision: summary.revision,
      sha256: version.sha256,
    });
    return {
      assetId: version.assetId,
      assetVersionId: version.assetVersionId,
      eventId: auditRef.id,
      replayed: false,
      revision: summary.revision,
      validationReceiptId: receiptRef.id,
    };
  });
}

async function mutateRegisteredAsset({ db, decodedToken, fieldValue, input }) {
  const assetRef = db.doc(`cosmeticAssets/${input.assetId}`);
  const auditRef = db.doc(`adminAuditEvents/cosmetic_asset_${input.requestId}`);
  const versionRef = input.assetVersionId
    ? assetRef.collection('versions').doc(input.assetVersionId)
    : null;
  const decisionRef = versionRef
    ? db.doc(`cosmeticAssetApprovals/${input.assetId}__${input.assetVersionId}`)
    : null;
  const fingerprint = stableFingerprint(input);

  return db.runTransaction(async (transaction) => {
    const [assetSnapshot, auditSnapshot, versionSnapshot, decisionSnapshot] =
      await transaction.getAll(
        assetRef,
        auditRef,
        ...(versionRef ? [versionRef, decisionRef] : []),
      );
    if (auditSnapshot.exists) {
      return assertReplay(auditSnapshot.data(), decodedToken.uid, fingerprint, auditRef.id);
    }
    if (!assetSnapshot.exists) throw adminError(404, 'Asset was not found.');
    const existing = assetSnapshot.data();
    if (Number(existing.revision || 0) !== input.expectedRevision) {
      throw adminError(409, 'Asset changed after it was opened. Refresh and try again.');
    }
    const version = versionSnapshot?.exists ? versionSnapshot.data() : undefined;
    if (versionRef && !version) throw adminError(404, 'Asset version was not found.');
    if (version && version.assetId !== input.assetId) {
      throw adminError(409, 'Asset version identity is invalid.');
    }

    const timestamp = fieldValue.serverTimestamp();
    let approvalId = '';
    if (input.operation === 'approve-version' || input.operation === 'reject-version') {
      if (decisionSnapshot.exists) {
        throw adminError(409, 'This immutable version already has a moderation decision.');
      }
      const receiptSnapshot = await transaction.get(
        db.doc(`cosmeticAssetValidationReceipts/${version.validationReceiptId}`),
      );
      if (
        !receiptSnapshot.exists
        || receiptSnapshot.data()?.status !== 'passed'
        || receiptSnapshot.data()?.sha256 !== version.sha256
      ) {
        throw adminError(409, 'A matching successful validation receipt is required.');
      }
      if (
        input.operation === 'approve-version'
        && ['nameplate', 'cosmetic-badge'].includes(version.category)
        && (input.authoritySeparationPassed !== true || input.readableIdentityPassed !== true)
      ) {
        throw adminError(409, 'Nameplates and cosmetic badges require readability and authority-separation attestations.');
      }
      approvalId = decisionRef.id;
      transaction.create(decisionRef, {
        assetId: input.assetId,
        assetVersionId: input.assetVersionId,
        byteSize: version.byteSize,
        checksum: version.sha256,
        createdAt: timestamp,
        decision: input.operation === 'approve-version' ? 'approved' : 'rejected',
        id: decisionRef.id,
        reason: input.reason,
        reviewerEmail: decodedToken.email || '',
        reviewerUid: decodedToken.uid,
        storagePath: version.storagePath,
        validationReceiptId: version.validationReceiptId,
        ...(input.operation === 'approve-version' && ['nameplate', 'cosmetic-badge'].includes(version.category) ? {
          authoritySeparationPassed: true,
          readableIdentityPassed: true,
        } : {}),
      });
    } else if (input.operation === 'publish-version' || input.operation === 'rollback-version') {
      if (
        !decisionSnapshot.exists
        || decisionSnapshot.data()?.decision !== 'approved'
        || decisionSnapshot.data()?.checksum !== version.sha256
        || decisionSnapshot.data()?.storagePath !== version.storagePath
      ) {
        throw adminError(409, 'The exact version must be approved before publication.');
      }
      approvalId = decisionRef.id;
    }

    const summary = transitionCosmeticAssetSummary({
      approvalId,
      existing,
      operation: input.operation,
      version,
    });
    transaction.set(assetRef, {
      ...summary,
      updatedAt: timestamp,
      updatedByUid: decodedToken.uid,
      ...(input.operation === 'publish-version' || input.operation === 'rollback-version'
        ? { publishedAt: timestamp }
        : {}),
      ...(input.operation === 'suspend' ? { suspendedAt: timestamp } : {}),
    });
    writeAudit(transaction, auditRef, decodedToken, input, fingerprint, timestamp, {
      approvalId,
      assetId: input.assetId,
      assetVersionId: input.assetVersionId || '',
      revision: summary.revision,
    });
    return {
      approvalId,
      assetId: input.assetId,
      eventId: auditRef.id,
      replayed: false,
      revision: summary.revision,
    };
  });
}

async function reconcileCosmeticAssetRegistryBatch({
  apply = false,
  db,
  fieldValue,
  limit = 100,
}) {
  const snapshot = await db.collection('cosmeticAssets')
    .where('renderingEnabled', '==', true)
    .limit(Math.min(250, Math.max(1, limit)))
    .get();
  const report = [];
  const batch = apply ? db.batch() : null;
  for (const document of snapshot.docs) {
    const summary = document.data();
    const versionId = String(summary.publishedVersionId || '');
    const [version, approval] = versionId
      ? await Promise.all([
          document.ref.collection('versions').doc(versionId).get(),
          db.doc(`cosmeticAssetApprovals/${document.id}__${versionId}`).get(),
        ])
      : [];
    const valid = Boolean(
      version?.exists
      && approval?.exists
      && approval.data()?.decision === 'approved'
      && approval.data()?.checksum === version.data()?.sha256
      && approval.data()?.storagePath === version.data()?.storagePath,
    );
    report.push({ assetId: document.id, valid, versionId });
    if (apply && !valid) {
      batch.update(document.ref, {
        publicationStatus: 'disabled',
        reconciliationDisabledAt: fieldValue.serverTimestamp(),
        renderingEnabled: false,
        revision: Number(summary.revision || 0) + 1,
      });
    }
  }
  if (batch) await batch.commit();
  return {
    applied: apply,
    invalid: report.filter((item) => !item.valid).length,
    items: report,
    scanned: report.length,
  };
}

async function cleanupExpiredCosmeticSubmissions({
  bucket,
  cutoff,
  db,
  fieldValue,
  limit = 100,
}) {
  const results = [];
  for (const status of ['rejected', 'abandoned']) {
    const snapshot = await db.collection('cosmeticSubmissions')
      .where('status', '==', status)
      .where('updatedAt', '<=', cutoff)
      .limit(limit)
      .get();
    for (const document of snapshot.docs) {
      const data = document.data();
      if (typeof data.sourcePath === 'string' && data.sourcePath) {
        await bucket.file(data.sourcePath).delete({ ignoreNotFound: true });
      }
      await document.ref.update({
        sourcePath: '',
        sourcePurgedAt: fieldValue.serverTimestamp(),
      });
      results.push(document.id);
    }
  }
  return results;
}

function referenceSet(db, assetId, versionId) {
  return {
    summary: db.doc(`cosmeticAssets/${assetId}`),
    version: db.doc(`cosmeticAssets/${assetId}/versions/${versionId}`),
    approval: db.doc(`cosmeticAssetApprovals/${assetId}__${versionId}`),
  };
}

function assertApprovedReference(summary, version, approval, options) {
  if (
    !summary.exists
    || !version.exists
    || !approval.exists
    || summary.data()?.moderationStatus !== 'approved'
    || summary.data()?.publicationStatus !== 'published'
    || summary.data()?.renderingEnabled !== true
    || summary.data()?.publishedVersionId !== version.id
    || summary.data()?.approvedVersionId !== version.id
    || summary.data()?.approvalId !== approval.id
    || approval.data()?.decision !== 'approved'
    || approval.data()?.checksum !== version.data()?.sha256
    || summary.id !== version.data()?.assetId
    || summary.id !== approval.data()?.assetId
    || version.id !== approval.data()?.assetVersionId
    || version.data()?.category !== options.category
    || (
      options.staticOnly
      && !['png', 'jpeg', 'legacy-webp'].includes(version.data()?.format)
    )
  ) {
    throw adminError(409, `A compatible approved ${options.kind} version is required.`);
  }
}

function assertReplay(audit, actorUid, fingerprint, eventId) {
  if (audit.actorUid !== actorUid || audit.requestFingerprint !== fingerprint) {
    throw adminError(409, 'requestId was already used for another asset operation.');
  }
  return {
    approvalId: audit.approvalId || '',
    assetId: audit.assetId,
    assetVersionId: audit.assetVersionId || '',
    eventId,
    replayed: true,
    revision: audit.revision,
    validationReceiptId: audit.validationReceiptId || '',
  };
}

function writeAudit(
  transaction,
  auditRef,
  decodedToken,
  input,
  fingerprint,
  timestamp,
  result,
) {
  transaction.create(auditRef, {
    action: `cosmetic-asset-${input.operation}`,
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    createdAt: timestamp,
    id: auditRef.id,
    kind: 'store-catalog',
    operation: input.operation,
    reason: input.reason,
    requestFingerprint: fingerprint,
    status: 'completed',
    ...result,
  });
}

function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
}

function mapDocument(id, data = {}) {
  return {
    id,
    ...data,
    createdAt: timestampIso(data.createdAt),
    publishedAt: timestampIso(data.publishedAt),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function timestampIso(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return '';
}

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  cleanupExpiredCosmeticSubmissions,
  getAdminCosmeticsAssets,
  getAdminPublishedCosmeticAssetOptions,
  mutateAdminCosmeticsAsset,
  reconcileCosmeticAssetRegistryBatch,
};
