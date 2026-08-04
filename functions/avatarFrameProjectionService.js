'use strict';

const { mapStoreCatalogItem } = require('./storeCore');
const { mapStoreOwnership } = require('./storePurchaseCore');
const {
  buildAvatarFrameProjection,
  buildCanonicalEquipmentFrame,
  inspectApprovedAvatarFrameReference,
} = require('./avatarFrameProjectionCore');

async function reconcileAvatarFrameProjections({ clock, db, fieldValue, limit = 200 }) {
  const snapshot = await db.collection('storeEquipment').limit(limit).get();
  let cleared = 0;
  let repaired = 0;
  for (const candidate of snapshot.docs) {
    const result = await reconcileOne({ candidate, clock, db, fieldValue });
    if (result === 'cleared') cleared += 1;
    if (result === 'repaired') repaired += 1;
  }
  return { cleared, repaired, scanned: snapshot.size };
}

async function clearSuspendedAvatarFrameProjection({ db, fieldValue, uid }) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) return { cleared: false };
  return db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`publicProfiles/${uid}`);
    const equipmentRef = db.doc(`storeEquipment/${uid}`);
    const [profileSnapshot, equipmentSnapshot] = await Promise.all([
      transaction.get(profileRef), transaction.get(equipmentRef),
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data()?.moderationStatus === 'active' || !equipmentSnapshot.exists) return { cleared: false };
    const equipment = equipmentSnapshot.data() || {};
    const itemId = typeof equipment.slots?.['avatar-frames'] === 'string' ? equipment.slots['avatar-frames'] : '';
    if (!itemId) return { cleared: false };
    const ownershipRef = db.doc(`storeOwnerships/${uid}/items/${itemId}`);
    const ownershipSnapshot = await transaction.get(ownershipRef);
    const slots = { ...(equipment.slots || {}) };
    delete slots['avatar-frames'];
    const cosmetics = { ...(equipment.cosmetics || {}) };
    delete cosmetics.avatarFrame;
    const nextEquipment = { ...equipment, slots, updatedAt: fieldValue.serverTimestamp() };
    if (Object.keys(cosmetics).length) nextEquipment.cosmetics = cosmetics;
    else delete nextEquipment.cosmetics;
    transaction.set(equipmentRef, nextEquipment);
    if (ownershipSnapshot.exists) transaction.update(ownershipRef, {
      equipped: false,
      updatedAt: fieldValue.serverTimestamp(),
    });
    transaction.update(profileRef, {
      equippedAvatarFrame: fieldValue.delete(),
      'equippedCosmetics.avatarFrame': fieldValue.delete(),
      updatedAt: fieldValue.serverTimestamp(),
    });
    return { cleared: true };
  });
}

async function reconcileOne({ candidate, clock, db, fieldValue }) {
  return db.runTransaction(async (transaction) => {
    const equipmentSnapshot = await transaction.get(candidate.ref);
    if (!equipmentSnapshot.exists) return 'unchanged';
    const equipment = equipmentSnapshot.data() || {};
    const itemId = typeof equipment.slots?.['avatar-frames'] === 'string'
      ? equipment.slots['avatar-frames']
      : '';
    const uid = typeof equipment.uid === 'string' ? equipment.uid : candidate.id;
    if (!itemId || !uid) return 'unchanged';

    const profileRef = db.doc(`publicProfiles/${uid}`);
    const ownershipRef = db.doc(`storeOwnerships/${uid}/items/${itemId}`);
    const catalogRef = db.doc(`storeCatalog/${itemId}`);
    const [profileSnapshot, ownershipSnapshot, catalogSnapshot] = await Promise.all([
      transaction.get(profileRef), transaction.get(ownershipRef), transaction.get(catalogRef),
    ]);
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    const ownership = ownershipSnapshot.exists ? mapStoreOwnership(ownershipSnapshot.data(), itemId) : undefined;
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    const expired = ownership?.expiresAt?.toMillis?.() <= clock.nowMillis();
    const baseValid = Boolean(
      profileSnapshot.exists
      && profile?.moderationStatus === 'active'
      && ownership
      && ownership.uid === uid
      && ownership.category === 'avatar-frames'
      && ownership.state === 'active'
      && ownership.equipped === true
      && !expired
      && item
      && item.category === 'avatar-frames'
      && item.availability !== 'disabled',
    );
    let approved = baseValid;
    if (baseValid && item.cosmeticAsset) {
      const { assetId, assetVersionId: versionId } = item.cosmeticAsset;
      const [summary, version, approval] = await Promise.all([
        transaction.get(db.doc(`cosmeticAssets/${assetId}`)),
        transaction.get(db.doc(`cosmeticAssets/${assetId}/versions/${versionId}`)),
        transaction.get(db.doc(`cosmeticAssetApprovals/${assetId}__${versionId}`)),
      ]);
      approved = inspectApprovedAvatarFrameReference({
        approval: approval.exists ? approval.data() : undefined,
        assetId,
        summary: summary.exists ? summary.data() : undefined,
        version: version.exists ? version.data() : undefined,
        versionId,
      }).ok;
    }
    const timestamp = fieldValue.serverTimestamp();
    if (!approved) {
      const slots = { ...(equipment.slots || {}) };
      delete slots['avatar-frames'];
      const cosmetics = { ...(equipment.cosmetics || {}) };
      delete cosmetics.avatarFrame;
      const nextEquipment = { ...equipment, slots, updatedAt: timestamp };
      if (Object.keys(cosmetics).length) nextEquipment.cosmetics = cosmetics;
      else delete nextEquipment.cosmetics;
      transaction.set(candidate.ref, nextEquipment);
      if (ownershipSnapshot.exists) transaction.update(ownershipRef, { equipped: false, updatedAt: timestamp });
      if (profileSnapshot.exists) transaction.update(profileRef, {
        equippedAvatarFrame: fieldValue.delete(),
        'equippedCosmetics.avatarFrame': fieldValue.delete(),
        updatedAt: timestamp,
      });
      return 'cleared';
    }

    const projection = buildAvatarFrameProjection(item);
    const canonical = buildCanonicalEquipmentFrame(item);
    const cosmetics = { ...(equipment.cosmetics || {}) };
    if (canonical) cosmetics.avatarFrame = canonical;
    else delete cosmetics.avatarFrame;
    const nextEquipment = { ...equipment, slots: { ...(equipment.slots || {}), 'avatar-frames': itemId }, updatedAt: timestamp };
    if (Object.keys(cosmetics).length) nextEquipment.cosmetics = cosmetics;
    else delete nextEquipment.cosmetics;
    transaction.set(candidate.ref, nextEquipment);
    transaction.update(ownershipRef, {
      ...(item.cosmeticAsset ? { cosmeticAsset: item.cosmeticAsset } : {}),
      equipped: true,
      updatedAt: timestamp,
    });
    transaction.update(profileRef, {
      equippedAvatarFrame: { assetUrl: projection.assetUrl, itemId },
      'equippedCosmetics.avatarFrame': canonical || fieldValue.delete(),
      updatedAt: timestamp,
    });
    return 'repaired';
  });
}

module.exports = { clearSuspendedAvatarFrameProjection, reconcileAvatarFrameProjections };
