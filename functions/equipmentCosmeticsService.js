'use strict';

const { mapStoreCatalogItem } = require('./storeCore');
const { mapStoreOwnership } = require('./storePurchaseCore');
const {
  WAVE6_COSMETIC_CATEGORIES,
  buildCanonicalEquipmentCosmetic,
  getEquipmentCosmeticConfig,
  inspectApprovedEquipmentCosmeticReference,
  removeEquipmentCosmeticProjection,
  setEquipmentCosmeticProjection,
} = require('./equipmentCosmeticsCore');

async function reconcileEquipmentCosmeticProjections({ clock, db, fieldValue, limit = 200 }) {
  const snapshot = await db.collection('storeEquipment').limit(limit).get();
  let cleared = 0;
  let repaired = 0;
  for (const candidate of snapshot.docs) {
    const result = await reconcileOne({ candidate, clock, db, fieldValue });
    cleared += result.cleared;
    repaired += result.repaired;
  }
  return { cleared, repaired, scanned: snapshot.size };
}

async function clearSuspendedEquipmentCosmetics({ db, fieldValue, uid }) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) return { cleared: 0 };
  return db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`publicProfiles/${uid}`);
    const equipmentRef = db.doc(`storeEquipment/${uid}`);
    const [profileSnapshot, equipmentSnapshot] = await Promise.all([
      transaction.get(profileRef), transaction.get(equipmentRef),
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data()?.moderationStatus === 'active' || !equipmentSnapshot.exists) return { cleared: 0 };
    const equipment = equipmentSnapshot.data() || {};
    const slots = { ...(equipment.slots || {}) };
    const ownershipReads = WAVE6_COSMETIC_CATEGORIES
      .map((category) => ({ category, itemId: typeof slots[category] === 'string' ? slots[category] : '' }))
      .filter((entry) => entry.itemId);
    const ownershipSnapshots = await Promise.all(ownershipReads.map((entry) => (
      transaction.get(db.doc(`storeOwnerships/${uid}/items/${entry.itemId}`))
    )));
    let nextEquipment = { ...equipment, slots, updatedAt: fieldValue.serverTimestamp() };
    const profileUpdate = { updatedAt: fieldValue.serverTimestamp() };
    ownershipReads.forEach((entry, index) => {
      delete slots[entry.category];
      nextEquipment = removeEquipmentCosmeticProjection(nextEquipment, entry.category);
      profileUpdate[`equippedCosmetics.${getEquipmentCosmeticConfig(entry.category).projectionKey}`] = fieldValue.delete();
      if (ownershipSnapshots[index].exists) transaction.update(ownershipSnapshots[index].ref, {
        equipped: false,
        updatedAt: fieldValue.serverTimestamp(),
      });
    });
    if (!ownershipReads.length) return { cleared: 0 };
    nextEquipment.slots = slots;
    transaction.set(equipmentRef, nextEquipment);
    transaction.update(profileRef, profileUpdate);
    return { cleared: ownershipReads.length };
  });
}

async function reconcileOne({ candidate, clock, db, fieldValue }) {
  return db.runTransaction(async (transaction) => {
    const equipmentSnapshot = await transaction.get(candidate.ref);
    if (!equipmentSnapshot.exists) return { cleared: 0, repaired: 0 };
    const equipment = equipmentSnapshot.data() || {};
    const uid = typeof equipment.uid === 'string' ? equipment.uid : candidate.id;
    const activeSlots = WAVE6_COSMETIC_CATEGORIES
      .map((category) => ({ category, itemId: typeof equipment.slots?.[category] === 'string' ? equipment.slots[category] : '' }))
      .filter((entry) => entry.itemId);
    if (!uid || !activeSlots.length) return { cleared: 0, repaired: 0 };

    const profileRef = db.doc(`publicProfiles/${uid}`);
    const profileSnapshot = await transaction.get(profileRef);
    const records = await Promise.all(activeSlots.map(async (entry) => {
      const ownershipRef = db.doc(`storeOwnerships/${uid}/items/${entry.itemId}`);
      const catalogRef = db.doc(`storeCatalog/${entry.itemId}`);
      const [ownershipSnapshot, catalogSnapshot] = await Promise.all([
        transaction.get(ownershipRef), transaction.get(catalogRef),
      ]);
      const ownership = ownershipSnapshot.exists ? mapStoreOwnership(ownershipSnapshot.data(), entry.itemId) : undefined;
      const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), entry.itemId) : undefined;
      let approved = Boolean(
        profileSnapshot.exists
        && profileSnapshot.data()?.moderationStatus === 'active'
        && ownership
        && ownership.uid === uid
        && ownership.category === entry.category
        && ownership.state === 'active'
        && ownership.equipped === true
        && (ownership.expiresAt?.toMillis?.() ?? Infinity) > clock.nowMillis()
        && item
        && item.category === entry.category
        && item.availability !== 'disabled'
        && item.cosmeticAsset,
      );
      if (approved) {
        const { assetId, assetVersionId: versionId } = item.cosmeticAsset;
        const [summary, version, approval] = await Promise.all([
          transaction.get(db.doc(`cosmeticAssets/${assetId}`)),
          transaction.get(db.doc(`cosmeticAssets/${assetId}/versions/${versionId}`)),
          transaction.get(db.doc(`cosmeticAssetApprovals/${assetId}__${versionId}`)),
        ]);
        approved = inspectApprovedEquipmentCosmeticReference({
          approval: approval.exists ? approval.data() : undefined,
          assetId,
          category: entry.category,
          summary: summary.exists ? summary.data() : undefined,
          version: version.exists ? version.data() : undefined,
          versionId,
        }).ok;
      }
      return { ...entry, approved, item, ownershipSnapshot };
    }));

    const timestamp = fieldValue.serverTimestamp();
    const slots = { ...(equipment.slots || {}) };
    const profileUpdate = { updatedAt: timestamp };
    let nextEquipment = { ...equipment, slots, updatedAt: timestamp };
    let cleared = 0;
    let repaired = 0;
    for (const record of records) {
      const config = getEquipmentCosmeticConfig(record.category);
      if (!record.approved) {
        delete slots[record.category];
        nextEquipment = removeEquipmentCosmeticProjection(nextEquipment, record.category);
        profileUpdate[`equippedCosmetics.${config.projectionKey}`] = fieldValue.delete();
        if (record.ownershipSnapshot.exists) transaction.update(record.ownershipSnapshot.ref, { equipped: false, updatedAt: timestamp });
        cleared += 1;
      } else {
        const canonical = buildCanonicalEquipmentCosmetic(record.item);
        nextEquipment = setEquipmentCosmeticProjection(nextEquipment, record.item);
        profileUpdate[`equippedCosmetics.${config.projectionKey}`] = canonical;
        transaction.update(record.ownershipSnapshot.ref, {
          cosmeticAsset: record.item.cosmeticAsset,
          equipped: true,
          updatedAt: timestamp,
        });
        repaired += 1;
      }
    }
    nextEquipment.slots = slots;
    transaction.set(candidate.ref, nextEquipment);
    if (profileSnapshot.exists) transaction.update(profileRef, profileUpdate);
    return { cleared, repaired };
  });
}

module.exports = { clearSuspendedEquipmentCosmetics, reconcileEquipmentCosmeticProjections };
