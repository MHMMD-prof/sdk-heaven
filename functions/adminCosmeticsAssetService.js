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
  mutateAdminCosmeticsAsset,
  reconcileCosmeticAssetRegistryBatch,
};
