const crypto = require('node:crypto');
const { inspectApprovedCoupleEffect } = require('./coupleEffectsCore');
const { getEquipmentCosmeticConfig, inspectApprovedEquipmentCosmeticReference } = require('./equipmentCosmeticsCore');
const {
  createEntryPhysicalApprovalReceiptId,
  inspectApprovedEntryPresentation,
} = require('./roomEntryPresentationCore');
const {
  ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  resolveRoomEffectSurface,
} = require('./roomEffectPresentationCore');

function stableFingerprint(item) {
  return crypto.createHash('sha256').update(JSON.stringify(sortValue(item))).digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function approvedStickerReference(reference, summarySnapshot, versionSnapshot, approvalSnapshot) {
  if (!summarySnapshot?.exists || !versionSnapshot?.exists || !approvalSnapshot?.exists) return false;
  const summary = summarySnapshot.data() || {};
  const version = versionSnapshot.data() || {};
  const approval = approvalSnapshot.data() || {};
  return summary.publishedVersionId === reference.assetVersionId
    && summary.approvedVersionId === reference.assetVersionId
    && summary.approvalId === `${reference.assetId}__${reference.assetVersionId}`
    && summary.moderationStatus === 'approved'
    && summary.publicationStatus === 'published'
    && summary.renderingEnabled === true
    && version.assetId === reference.assetId
    && version.assetVersionId === reference.assetVersionId
    && version.category === 'room-reaction'
    && ['png', 'lottie-json', 'legacy-webp'].includes(version.format)
    && approval.decision === 'approved'
    && approval.assetId === reference.assetId
    && approval.assetVersionId === reference.assetVersionId
    && approval.checksum === version.sha256;
}

async function executeAdminStoreCatalogUpsert({ db, decodedToken, fieldValue, input }) {
  const { entryPhysicalApproval, expectedUpdatedAt, featured, reason, requestId } = input;
  let { item } = input;
  if (getEquipmentCosmeticConfig(item.category) && !item.cosmeticAsset) {
    const matchingAsset = await db.doc(`cosmeticAssets/${item.itemId}`).get();
    const summary = matchingAsset.exists ? matchingAsset.data() : undefined;
    const versionId = typeof summary?.publishedVersionId === 'string' ? summary.publishedVersionId : '';
    if (
      summary?.moderationStatus === 'approved'
      && summary?.publicationStatus === 'published'
      && summary?.renderingEnabled === true
      && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(versionId)
    ) item = { ...item, cosmeticAsset: { assetId: item.itemId, assetVersionId: versionId } };
  }
  const catalogRef = db.collection('storeCatalog').doc(item.itemId);
  const auditRef = db.collection('adminAuditEvents').doc(`store_${requestId}`);
  const storefrontRef = db.collection('appConfig').doc('storefront');
  const fingerprint = stableFingerprint({ entryPhysicalApproval, featured, item: input.item, reason });

  return db.runTransaction(async (transaction) => {
    const refs = [catalogRef, auditRef, storefrontRef];
    if (item.cosmeticAsset) {
      const { assetId, assetVersionId } = item.cosmeticAsset;
      refs.push(
        db.doc(`cosmeticAssets/${assetId}`),
        db.doc(`cosmeticAssets/${assetId}/versions/${assetVersionId}`),
        db.doc(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`),
      );
    }
    if (item.stickerAsset) {
      const { assetId, assetVersionId } = item.stickerAsset;
      refs.push(
        db.doc(`cosmeticAssets/${assetId}`),
        db.doc(`cosmeticAssets/${assetId}/versions/${assetVersionId}`),
        db.doc(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`),
      );
    }
    let entryReceiptRef;
    if (item.entryPresentation?.animationEnabled) {
      const presentation = item.entryPresentation;
      const references = [
        presentation.visualAsset,
        presentation.fallbackAsset,
        ...(presentation.audioAsset ? [presentation.audioAsset] : []),
      ];
      for (const reference of references) {
        refs.push(
          db.doc(`cosmeticAssets/${reference.assetId}`),
          db.doc(`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`),
          db.doc(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`),
        );
      }
      entryReceiptRef = db.doc(`entryPresentationApprovalReceipts/${presentation.physicalApprovalReceiptId}`);
      refs.push(entryReceiptRef);
    }
    if (item.category === 'custom-ids') {
      refs.push(
        db.collection('publicIds').doc(item.customId),
        db.collection('specialIds').doc(item.customId),
        db.collection('specialIdCatalog').doc(item.customId),
        db.collection('storeCustomIds').doc(item.customId),
      );
    }
    const snapshots = await transaction.getAll(...refs);
    const [catalogSnapshot, auditSnapshot, storefrontSnapshot, ...additionalSnapshots] = snapshots;
    if (auditSnapshot.exists) {
      const audit = auditSnapshot.data() || {};
      if (audit.actorUid !== decodedToken.uid || audit.itemId !== item.itemId || audit.requestFingerprint !== fingerprint) {
        const error = new Error('requestId was already used for a different catalog change.');
        error.status = 409;
        throw error;
      }
      return { eventId: auditRef.id, itemId: item.itemId, replayed: true };
    }
    let collisionSnapshots = additionalSnapshots;
    if (item.cosmeticAsset) {
      const [summary, version, approval, ...remaining] = additionalSnapshots;
      const { assetId, assetVersionId: versionId } = item.cosmeticAsset;
      let approved = inspectApprovedEquipmentCosmeticReference({
        approval: approval.exists ? approval.data() : undefined,
        assetId,
        category: item.category,
        summary: summary.exists ? summary.data() : undefined,
        version: version.exists ? version.data() : undefined,
        versionId,
      }).ok;
      if (approved && item.category === 'couple-effects') {
        let fallback;
        if (version.data()?.format === 'lottie-json') {
          const fallbackAssetId = version.data()?.fallbackAssetId || '_missing';
          const fallbackVersionId = version.data()?.fallbackAssetVersionId || '_missing';
          const [fallbackSummary, fallbackVersion, fallbackApproval] = await Promise.all([
            transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}`)),
            transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}/versions/${fallbackVersionId}`)),
            transaction.get(db.doc(`cosmeticAssetApprovals/${fallbackAssetId}__${fallbackVersionId}`)),
          ]);
          fallback = {
            approval: fallbackApproval.data(),
            summary: fallbackSummary.data(),
            version: fallbackVersion.data(),
          };
        }
        approved = inspectApprovedCoupleEffect({
          approval: approval.data(),
          fallback,
          reference: item.cosmeticAsset,
          summary: summary.data(),
          version: version.data(),
        }).ok;
      }
      if (!approved) {
        const error = new Error('The exact cosmetic version must match this category and be approved and published before assignment.');
        error.status = 409;
        throw error;
      }
      collisionSnapshots = remaining;
    }
    if (item.stickerAsset) {
      const [summary, version, approval, ...remaining] = collisionSnapshots;
      if (!approvedStickerReference(item.stickerAsset, summary, version, approval)) {
        const error = new Error('The sticker must reference an approved and published room-reaction asset version.');
        error.status = 409;
        throw error;
      }
      collisionSnapshots = remaining;
    }
    if (item.entryPresentation?.animationEnabled) {
      const presentation = item.entryPresentation;
      const referenceKeys = [
        ['visual', presentation.visualAsset],
        ['fallback', presentation.fallbackAsset],
        ...(presentation.audioAsset ? [['audio', presentation.audioAsset]] : []),
      ];
      const records = {};
      let offset = 0;
      for (const [key] of referenceKeys) {
        const [summary, version, approval] = collisionSnapshots.slice(offset, offset + 3);
        records[key] = {
          approval: approval.exists ? approval.data() : undefined,
          summary: summary.exists ? summary.data() : undefined,
          version: version.exists ? version.data() : undefined,
        };
        offset += 3;
      }
      const receiptSnapshot = collisionSnapshots[offset];
      collisionSnapshots = collisionSnapshots.slice(offset + 1);
      const expectedReceiptId = createEntryPhysicalApprovalReceiptId(
        item.itemId,
        presentation.visualAsset.assetVersionId,
      );
      if (presentation.physicalApprovalReceiptId !== expectedReceiptId) {
        const error = new Error('Entry-effect approval receipt ID does not match the exact car and visual version.');
        error.status = 409;
        throw error;
      }
      const receipt = receiptSnapshot.exists
        ? receiptSnapshot.data()
        : buildEntryPhysicalApprovalReceipt({
          approval: entryPhysicalApproval,
          actor: decodedToken,
          fieldValue,
          itemId: item.itemId,
          presentation,
          records,
          receiptId: expectedReceiptId,
        });
      const inspection = inspectApprovedEntryPresentation({
        presentation,
        records: { ...records, physicalReceipt: receipt },
      });
      if (!inspection.ok) {
        const error = new Error('The exact entry-effect assets and physical-device approval must be approved before assignment.');
        error.status = 409;
        throw error;
      }
      item = { ...item, entryPresentation: inspection.presentation };
      if (!receiptSnapshot.exists) transaction.create(entryReceiptRef, receipt);
    }
    const existing = catalogSnapshot.exists ? catalogSnapshot.data() : null;
    const existingUpdatedAt = readTimestampIso(existing?.updatedAt);
    if (catalogSnapshot.exists && expectedUpdatedAt && existingUpdatedAt !== expectedUpdatedAt) {
      const error = new Error('Catalog item changed after it was opened. Refresh before saving.');
      error.status = 409;
      throw error;
    }
    if (existing && (existing.category !== item.category || (existing.customId || '') !== (item.customId || ''))) {
      const error = new Error('Item category and custom ID cannot be changed after creation.');
      error.status = 409;
      throw error;
    }
    if (existing && item.purchasingEnabled && Object.keys(existing.prices || {}).some((currency) => item.prices[currency] === undefined)) {
      const error = new Error('Disable purchasing before removing an active price currency.');
      error.status = 409;
      throw error;
    }
    if (item.category === 'custom-ids') {
      const [publicId, specialId, legacyCatalog, reservation] = collisionSnapshots;
      const reservationItemId = reservation.exists ? reservation.data()?.itemId : '';
      if (publicId.exists || specialId.exists || legacyCatalog.exists || (reservation.exists && reservationItemId !== item.itemId)) {
        const error = new Error('Custom ID is already used or reserved.');
        error.status = 409;
        throw error;
      }
      transaction.set(reservation.ref, {
        itemId: item.itemId,
        createdAt: reservation.exists ? reservation.data()?.createdAt || fieldValue.serverTimestamp() : fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      });
    }
    transaction.set(catalogRef, {
      ...item,
      createdAt: existing?.createdAt || fieldValue.serverTimestamp(),
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      updatedAt: fieldValue.serverTimestamp(),
    });
    const currentFeaturedItemId = typeof storefrontSnapshot.data()?.featuredItemId === 'string'
      ? storefrontSnapshot.data().featuredItemId
      : '';
    if (featured || currentFeaturedItemId === item.itemId) {
      transaction.set(storefrontRef, {
        featuredItemId: featured ? item.itemId : '',
        updatedAt: fieldValue.serverTimestamp(),
      });
    }
    transaction.create(auditRef, {
      action: 'store-catalog-upsert',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      availability: item.availability,
      category: item.category,
      createdAt: fieldValue.serverTimestamp(),
      featured,
      id: auditRef.id,
      itemId: item.itemId,
      kind: 'store-catalog',
      purchasingEnabled: item.purchasingEnabled,
      reason,
      requestFingerprint: fingerprint,
      status: 'completed',
    });
    return { eventId: auditRef.id, itemId: item.itemId, replayed: false };
  });
}

function buildEntryPhysicalApprovalReceipt({
  approval,
  actor,
  fieldValue,
  itemId,
  presentation,
  records,
  receiptId,
}) {
  if (!approval) return undefined;
  const receipt = {
    ...approval,
    audioAssetId: presentation.audioAsset?.assetId || '',
    audioAssetVersionId: presentation.audioAsset?.assetVersionId || '',
    audioChecksum: records.audio?.version?.sha256 || '',
    createdAt: fieldValue.serverTimestamp(),
    copyTemplateVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
    durationMs: presentation.durationMs,
    fallbackAssetId: presentation.fallbackAsset.assetId,
    fallbackAssetVersionId: presentation.fallbackAsset.assetVersionId,
    fallbackChecksum: records.fallback?.version?.sha256 || '',
    id: receiptId,
    itemId,
    minimumClientVersion: presentation.minimumClientVersion,
    performanceTier: presentation.performanceTier,
    presentationSurface: resolveRoomEffectSurface('room-entry'),
    reviewerEmail: actor.email || '',
    reviewerUid: actor.uid,
    soundPolicy: presentation.soundPolicy,
    status: 'passed',
    visualAssetId: presentation.visualAsset.assetId,
    visualAssetVersionId: presentation.visualAsset.assetVersionId,
    visualChecksum: records.visual?.version?.sha256 || '',
  };
  return receipt;
}

function readTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return '';
}

module.exports = { executeAdminStoreCatalogUpsert, stableFingerprint };
