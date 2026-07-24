const crypto = require('node:crypto');

function stableFingerprint(item) {
  return crypto.createHash('sha256').update(JSON.stringify(sortValue(item))).digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

async function executeAdminStoreCatalogUpsert({ db, decodedToken, fieldValue, input }) {
  const { expectedUpdatedAt, featured, item, reason, requestId } = input;
  const catalogRef = db.collection('storeCatalog').doc(item.itemId);
  const auditRef = db.collection('adminAuditEvents').doc(`store_${requestId}`);
  const storefrontRef = db.collection('appConfig').doc('storefront');
  const fingerprint = stableFingerprint({ featured, item, reason });

  return db.runTransaction(async (transaction) => {
    const refs = [catalogRef, auditRef, storefrontRef];
    if (item.category === 'custom-ids') {
      refs.push(
        db.collection('publicIds').doc(item.customId),
        db.collection('specialIds').doc(item.customId),
        db.collection('specialIdCatalog').doc(item.customId),
        db.collection('storeCustomIds').doc(item.customId),
      );
    }
    const snapshots = await transaction.getAll(...refs);
    const [catalogSnapshot, auditSnapshot, storefrontSnapshot, ...collisionSnapshots] = snapshots;
    if (auditSnapshot.exists) {
      const audit = auditSnapshot.data() || {};
      if (audit.actorUid !== decodedToken.uid || audit.itemId !== item.itemId || audit.requestFingerprint !== fingerprint) {
        const error = new Error('requestId was already used for a different catalog change.');
        error.status = 409;
        throw error;
      }
      return { eventId: auditRef.id, itemId: item.itemId, replayed: true };
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

function readTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return '';
}

module.exports = { executeAdminStoreCatalogUpsert, stableFingerprint };
