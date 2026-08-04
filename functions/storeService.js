const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const { applyWalletMutation, buildWalletDocument, buildWalletTransaction, mapWalletSummary } = require('./socialWalletCore');
const { mapStoreCatalogItem } = require('./storeCore');
const {
  buildAvatarFrameProjection,
  buildCanonicalEquipmentFrame,
} = require('./avatarFrameProjectionCore');
const {
  buildEquipmentCosmeticProfileUpdate,
  getEquipmentCosmeticConfig,
  inspectApprovedEquipmentCosmeticReference,
  removeEquipmentCosmeticProjection,
  setEquipmentCosmeticProjection,
} = require('./equipmentCosmeticsCore');
const {
  STORE_CATALOG_LIMIT,
  buildStoreOwnership,
  durationToMilliseconds,
  mapCustomerCatalogItem,
  mapStoreOwnership,
  normalizeStoreEquipInput,
  normalizeStoreGiftInput,
  normalizeStorePurchaseInput,
} = require('./storePurchaseCore');

async function getStoreCatalog({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const [feature, profileSnapshot, walletSnapshot, storefrontSnapshot] = await db.getAll(
    db.doc('appConfig/socialFeatures'), db.doc(`publicProfiles/${uid}`), db.doc(`walletSummaries/${uid}`), db.doc('appConfig/storefront'),
  );
  if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
  const readiness = await validateActiveProfile(db, profileSnapshot, uid);
  if (readiness.errorCode) return readiness;
  const catalog = await db.collection('storeCatalog').limit(STORE_CATALOG_LIMIT).get();
  const items = catalog.docs
    .map((document) => mapCustomerCatalogItem(document.data(), document.id))
    .filter(Boolean)
    .sort((left, right) => left.category.localeCompare(right.category) || left.order - right.order || left.itemId.localeCompare(right.itemId));
  const configuredFeaturedItemId = typeof storefrontSnapshot.data()?.featuredItemId === 'string'
    ? storefrontSnapshot.data().featuredItemId.trim()
    : '';
  const featuredItemId = items.some((item) => item.itemId === configuredFeaturedItemId)
    ? configuredFeaturedItemId
    : '';
  return { result: { featuredItemId, items, wallet: mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid) } };
}

async function purchaseStoreItem({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeStorePurchaseInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { currency, itemId } = validation.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      catalog: db.doc(`storeCatalog/${itemId}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      equipment: db.doc(`storeEquipment/${uid}`),
      feature: db.doc('appConfig/socialFeatures'),
      ownership: db.doc(`storeOwnerships/${uid}/items/${itemId}`),
      profile: db.doc(`publicProfiles/${uid}`),
      storeTransaction: db.doc(`storeTransactions/${uid}_${requestId}`),
      wallet: db.doc(`walletSummaries/${uid}`),
      walletTransaction: db.doc(`walletTransactions/${uid}_${requestId}`),
    };
    const [feature, profileSnapshot, walletSnapshot, catalogSnapshot, ownershipSnapshot, equipmentSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.profile), transaction.get(refs.wallet), transaction.get(refs.catalog),
      transaction.get(refs.ownership), transaction.get(refs.equipment), transaction.get(refs.command),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'purchase-store-item' && previous.itemId === itemId && previous.currency === currency && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    const publicReservation = profile?.publicId ? await transaction.get(db.doc(`publicIds/${profile.publicId}`)) : undefined;
    if (!inspectPublicProfile(profile, publicReservation?.exists ? publicReservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    if (!item || item.availability !== 'available' || !item.purchasingEnabled) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (!(await isApprovedCanonicalCosmetic({ db, item, transaction }))) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (item.category === 'chat-themes') return { errorCode: 'ROOM_SELECTION_REQUIRED' };
    if (item.stock.kind === 'limited' && item.stock.remaining === 0) return { errorCode: 'OUT_OF_STOCK' };
    if (ownershipSnapshot.exists) return { errorCode: 'DUPLICATE_OWNERSHIP' };
    const price = item.prices[currency];
    if (!Number.isSafeInteger(price)) return { errorCode: 'ITEM_UNAVAILABLE' };

    let customReservation;
    let customSale;
    if (item.category === 'custom-ids') {
      customReservation = await transaction.get(db.doc(`storeCustomIds/${item.customId}`));
      customSale = await transaction.get(db.doc(`specialIds/${item.customId}`));
      const publicCollision = await transaction.get(db.doc(`publicIds/${item.customId}`));
      if (!customReservation.exists || customReservation.data()?.itemId !== itemId || customSale.exists || publicCollision.exists) {
        return { errorCode: 'OUT_OF_STOCK' };
      }
    }

    const slots = equipmentSnapshot.exists && equipmentSnapshot.data()?.slots && typeof equipmentSnapshot.data().slots === 'object'
      ? { ...equipmentSnapshot.data().slots }
      : {};
    const oldItemId = typeof slots[item.category] === 'string' ? slots[item.category] : '';
    const oldOwnership = oldItemId && oldItemId !== itemId
      ? await transaction.get(db.doc(`storeOwnerships/${uid}/items/${oldItemId}`))
      : undefined;
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const debit = applyWalletMutation(wallet, { amount: price, currency, type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };

    const timestamp = fieldValue.serverTimestamp();
    const nowMillis = clock.nowMillis();
    const durationMs = durationToMilliseconds(item.duration);
    const expiresAt = durationMs ? clock.timestampFromMillis(nowMillis + durationMs) : undefined;
    const { balanceAfter, wallet: walletAfter } = debit.value;
    const result = { balances: walletAfter.balances, currency, expiresAt: expiresAt || null, itemId, ownershipId: itemId };
    transaction.set(refs.wallet, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt) ? walletSnapshot.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: uid, amount: price, balanceAfter, createdAt: timestamp, currency, referenceId: itemId, source: 'store', type: 'purchase', uid,
    }));
    transaction.create(refs.storeTransaction, {
      amount: price, category: item.category, createdAt: timestamp, currency, itemId, kind: 'purchase', ownershipId: itemId, requestId, uid,
    });
    if (oldOwnership?.exists) transaction.update(oldOwnership.ref, { equipped: false, updatedAt: timestamp });
    slots[item.category] = itemId;
    transaction.set(refs.equipment, buildEquipmentDocument(equipmentSnapshot.data(), slots, uid, timestamp, item));
    transaction.create(refs.ownership, buildStoreOwnership({ acquiredAt: timestamp, expiresAt, item, ownershipId: itemId, uid }));
    if (item.category === 'avatar-frames') {
      transaction.update(refs.profile, buildAvatarFrameProfileUpdate(item, fieldValue, timestamp));
    } else if (getEquipmentCosmeticConfig(item.category)) {
      transaction.update(refs.profile, buildEquipmentCosmeticProfileUpdate(item, fieldValue, timestamp));
    }
    if (item.stock.kind === 'limited') transaction.update(refs.catalog, { stock: { kind: 'limited', remaining: item.stock.remaining - 1 }, updatedAt: timestamp });
    if (item.category === 'custom-ids') {
      transaction.create(db.doc(`specialIds/${item.customId}`), { purchasedAt: timestamp, transactionId: refs.storeTransaction.path.split('/').at(-1), uid });
      transaction.update(refs.profile, { specialId: item.customId, updatedAt: timestamp });
    }
    transaction.create(refs.command, { action: 'purchase-store-item', createdAt: timestamp, currency, itemId, requestId, result, uid });
    return { result };
  });
}

async function getMyStoreItems({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const [feature, profileSnapshot] = await db.getAll(db.doc('appConfig/socialFeatures'), db.doc(`publicProfiles/${uid}`));
  if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
  const readiness = await validateActiveProfile(db, profileSnapshot, uid);
  if (readiness.errorCode) return readiness;
  const snapshot = await db.collection(`storeOwnerships/${uid}/items`).limit(STORE_CATALOG_LIMIT).get();
  const ownerships = snapshot.docs.map((document) => mapStoreOwnership(document.data(), document.id)).filter(Boolean);
  const catalogs = ownerships.length ? await db.getAll(...ownerships.map((ownership) => db.doc(`storeCatalog/${ownership.itemId}`))) : [];
  const catalogById = new Map(catalogs.map((document) => [document.id, document.exists ? mapStoreCatalogItem(document.data(), document.id) : undefined]));
  return {
    result: {
      items: ownerships.map((ownership) => ({ catalog: catalogById.get(ownership.itemId) || null, ownership })),
    },
  };
}

async function equipStoreItem({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeStoreEquipInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { itemId } = validation.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      catalog: db.doc(`storeCatalog/${itemId}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`), equipment: db.doc(`storeEquipment/${uid}`),
      feature: db.doc('appConfig/socialFeatures'), ownership: db.doc(`storeOwnerships/${uid}/items/${itemId}`), profile: db.doc(`publicProfiles/${uid}`),
    };
    const [feature, profileSnapshot, ownershipSnapshot, equipmentSnapshot, commandSnapshot, catalogSnapshot] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.profile), transaction.get(refs.ownership), transaction.get(refs.equipment), transaction.get(refs.command),
      transaction.get(refs.catalog),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'equip-store-item' && previous.itemId === itemId && previous.result ? { result: previous.result } : { errorCode: 'REQUEST_CONFLICT' };
    }
    if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    const publicReservation = profile?.publicId ? await transaction.get(db.doc(`publicIds/${profile.publicId}`)) : undefined;
    if (!inspectPublicProfile(profile, publicReservation?.exists ? publicReservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    const ownership = ownershipSnapshot.exists ? mapStoreOwnership(ownershipSnapshot.data(), itemId) : undefined;
    if (!ownership) return { errorCode: 'NOT_FOUND' };
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    if (!item || item.category !== ownership.category) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (!(await isApprovedCanonicalCosmetic({ db, item, transaction }))) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (item.category === 'chat-themes') return { errorCode: 'ROOM_SELECTION_REQUIRED' };
    if (ownership.state !== 'active' || (ownership.expiresAt?.toMillis?.() ?? Infinity) <= clock.nowMillis()) return { errorCode: 'ITEM_UNAVAILABLE' };
    const slots = equipmentSnapshot.exists && equipmentSnapshot.data()?.slots && typeof equipmentSnapshot.data().slots === 'object' ? { ...equipmentSnapshot.data().slots } : {};
    const oldItemId = typeof slots[ownership.category] === 'string' ? slots[ownership.category] : '';
    const oldOwnership = oldItemId && oldItemId !== itemId ? await transaction.get(db.doc(`storeOwnerships/${uid}/items/${oldItemId}`)) : undefined;
    let customId = '';
    if (ownership.category === 'custom-ids') {
      const catalog = await transaction.get(db.doc(`storeCatalog/${itemId}`));
      const item = catalog.exists ? mapStoreCatalogItem(catalog.data(), itemId) : undefined;
      if (!item?.customId) return { errorCode: 'ITEM_UNAVAILABLE' };
      customId = item.customId;
    }
    const timestamp = fieldValue.serverTimestamp();
    if (oldOwnership?.exists) transaction.update(oldOwnership.ref, { equipped: false, updatedAt: timestamp });
    slots[ownership.category] = itemId;
    transaction.set(refs.equipment, buildEquipmentDocument(equipmentSnapshot.data(), slots, uid, timestamp, item));
    transaction.update(refs.ownership, { equipped: true, updatedAt: timestamp });
    if (ownership.category === 'avatar-frames') {
      transaction.update(refs.profile, buildAvatarFrameProfileUpdate(item, fieldValue, timestamp));
    } else if (getEquipmentCosmeticConfig(ownership.category)) {
      transaction.update(refs.profile, buildEquipmentCosmeticProfileUpdate(item, fieldValue, timestamp));
    }
    if (customId) transaction.update(refs.profile, { specialId: customId, updatedAt: timestamp });
    const result = { itemId, ownershipId: itemId };
    transaction.create(refs.command, { action: 'equip-store-item', createdAt: timestamp, itemId, requestId, result, uid });
    return { result };
  });
}

async function giftStoreItem({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeStoreGiftInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { currency, itemId, recipientPublicId } = validation.value;
  const recipientIdentity = await db.doc(`publicIds/${recipientPublicId}`).get();
  const recipientUid = recipientIdentity.exists && typeof recipientIdentity.data()?.uid === 'string' ? recipientIdentity.data().uid : '';
  if (!recipientUid || recipientUid === uid) return { errorCode: 'INVALID_RECIPIENT' };

  return db.runTransaction(async (transaction) => {
    const refs = {
      catalog: db.doc(`storeCatalog/${itemId}`), command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/socialFeatures'),
      recipientEquipment: db.doc(`storeEquipment/${recipientUid}`), recipientIdentity: db.doc(`publicIds/${recipientPublicId}`),
      recipientOwnership: db.doc(`storeOwnerships/${recipientUid}/items/${itemId}`), recipientProfile: db.doc(`publicProfiles/${recipientUid}`),
      senderProfile: db.doc(`publicProfiles/${uid}`), storeTransaction: db.doc(`storeTransactions/${uid}_${requestId}`),
      wallet: db.doc(`walletSummaries/${uid}`), walletTransaction: db.doc(`walletTransactions/${uid}_${requestId}`),
    };
    const [feature, senderProfile, recipientProfile, identity, walletSnapshot, catalogSnapshot, ownershipSnapshot, equipmentSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.senderProfile), transaction.get(refs.recipientProfile), transaction.get(refs.recipientIdentity), transaction.get(refs.wallet),
      transaction.get(refs.catalog), transaction.get(refs.recipientOwnership), transaction.get(refs.recipientEquipment), transaction.get(refs.command),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'gift-store-item' && previous.itemId === itemId && previous.currency === currency && previous.recipientPublicId === recipientPublicId && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
    if (!identity.exists || identity.data()?.uid !== recipientUid) return { errorCode: 'INVALID_RECIPIENT' };
    const sender = senderProfile.exists ? senderProfile.data() : undefined;
    const senderReservation = sender?.publicId ? await transaction.get(db.doc(`publicIds/${sender.publicId}`)) : undefined;
    if (!inspectPublicProfile(sender, senderReservation?.exists ? senderReservation.data() : undefined, uid).ok || sender.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    const recipient = recipientProfile.exists ? recipientProfile.data() : undefined;
    if (!inspectPublicProfile(recipient, identity.data(), recipientUid).ok || recipient.moderationStatus !== 'active') return { errorCode: 'INVALID_RECIPIENT' };
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    if (!item || item.availability !== 'available' || !item.purchasingEnabled) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (!(await isApprovedCanonicalCosmetic({ db, item, transaction }))) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (item.category === 'chat-themes') return { errorCode: 'GIFT_UNSUPPORTED' };
    if (item.stock.kind === 'limited' && item.stock.remaining === 0) return { errorCode: 'OUT_OF_STOCK' };
    if (ownershipSnapshot.exists) return { errorCode: 'DUPLICATE_OWNERSHIP' };
    const price = item.prices[currency];
    if (!Number.isSafeInteger(price)) return { errorCode: 'ITEM_UNAVAILABLE' };

    if (item.category === 'custom-ids') {
      const [customReservation, customSale, publicCollision] = await Promise.all([
        transaction.get(db.doc(`storeCustomIds/${item.customId}`)), transaction.get(db.doc(`specialIds/${item.customId}`)), transaction.get(db.doc(`publicIds/${item.customId}`)),
      ]);
      if (!customReservation.exists || customReservation.data()?.itemId !== itemId || customSale.exists || publicCollision.exists) return { errorCode: 'OUT_OF_STOCK' };
    }
    const slots = equipmentSnapshot.exists && equipmentSnapshot.data()?.slots && typeof equipmentSnapshot.data().slots === 'object' ? { ...equipmentSnapshot.data().slots } : {};
    const oldItemId = typeof slots[item.category] === 'string' ? slots[item.category] : '';
    const oldOwnership = oldItemId ? await transaction.get(db.doc(`storeOwnerships/${recipientUid}/items/${oldItemId}`)) : undefined;
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const debit = applyWalletMutation(wallet, { amount: price, currency, type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };

    const timestamp = fieldValue.serverTimestamp();
    const durationMs = durationToMilliseconds(item.duration);
    const expiresAt = durationMs ? clock.timestampFromMillis(clock.nowMillis() + durationMs) : undefined;
    const { balanceAfter, wallet: walletAfter } = debit.value;
    const result = { balances: walletAfter.balances, currency, itemId, recipientPublicId, recipientUid };
    transaction.set(refs.wallet, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt) ? walletSnapshot.data().createdAt : timestamp, updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({ actorUid: uid, amount: price, balanceAfter, createdAt: timestamp, currency, referenceId: itemId, source: 'store-gift', type: 'purchase', uid }));
    transaction.create(refs.storeTransaction, { amount: price, category: item.category, createdAt: timestamp, currency, itemId, kind: 'gift', recipientUid, requestId, senderUid: uid });
    if (oldOwnership?.exists) transaction.update(oldOwnership.ref, { equipped: false, updatedAt: timestamp });
    slots[item.category] = itemId;
    transaction.set(refs.recipientEquipment, buildEquipmentDocument(equipmentSnapshot.data(), slots, recipientUid, timestamp, item));
    transaction.create(refs.recipientOwnership, buildStoreOwnership({ acquiredAt: timestamp, expiresAt, item, ownershipId: itemId, uid: recipientUid }));
    if (item.category === 'avatar-frames') {
      transaction.update(refs.recipientProfile, buildAvatarFrameProfileUpdate(item, fieldValue, timestamp));
    } else if (getEquipmentCosmeticConfig(item.category)) {
      transaction.update(refs.recipientProfile, buildEquipmentCosmeticProfileUpdate(item, fieldValue, timestamp));
    }
    if (item.stock.kind === 'limited') transaction.update(refs.catalog, { stock: { kind: 'limited', remaining: item.stock.remaining - 1 }, updatedAt: timestamp });
    if (item.category === 'custom-ids') {
      transaction.create(db.doc(`specialIds/${item.customId}`), { purchasedAt: timestamp, transactionId: refs.storeTransaction.path.split('/').at(-1), uid: recipientUid });
      transaction.update(refs.recipientProfile, { specialId: item.customId, updatedAt: timestamp });
    }
    transaction.create(db.doc(`storeGiftEvents/${uid}_${requestId}`), { createdAt: timestamp, currency, itemId, price, recipientPublicId, recipientUid, senderUid: uid });
    transaction.create(refs.command, { action: 'gift-store-item', createdAt: timestamp, currency, itemId, recipientPublicId, requestId, result, uid });
    return { result };
  });
}

async function expireStoreOwnerships({ clock, db, fieldValue, limit = 200 }) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collectionGroup('items').where('expiresAt', '<=', now).limit(limit).get();
  let expired = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const ownership = await transaction.get(candidate.ref);
      const data = ownership.exists ? ownership.data() : undefined;
      if (!data || data.kind !== 'store-ownership' || data.state !== 'active' || !data.expiresAt || data.expiresAt.toMillis() > clock.nowMillis()) return false;
      const equipmentRef = db.doc(`storeEquipment/${data.uid}`);
      const equipment = await transaction.get(equipmentRef);
      const slots = equipment.exists && equipment.data()?.slots && typeof equipment.data().slots === 'object' ? { ...equipment.data().slots } : {};
      const wasEquipped = slots[data.category] === data.itemId;
      if (wasEquipped) delete slots[data.category];
      const timestamp = fieldValue.serverTimestamp();
      transaction.update(candidate.ref, { equipped: false, state: 'expired', updatedAt: timestamp });
      if (equipment.exists) {
        let nextEquipment = { ...equipment.data(), slots, updatedAt: timestamp };
        if (wasEquipped && getEquipmentCosmeticConfig(data.category)) {
          nextEquipment = removeEquipmentCosmeticProjection(nextEquipment, data.category);
        }
        transaction.set(equipmentRef, nextEquipment);
      }
      if (wasEquipped && data.category === 'avatar-frames') {
        transaction.update(db.doc(`publicProfiles/${data.uid}`), {
          equippedAvatarFrame: fieldValue.delete(),
          'equippedCosmetics.avatarFrame': fieldValue.delete(),
          updatedAt: timestamp,
        });
      } else if (wasEquipped && getEquipmentCosmeticConfig(data.category)) {
        transaction.update(db.doc(`publicProfiles/${data.uid}`), {
          [`equippedCosmetics.${getEquipmentCosmeticConfig(data.category).projectionKey}`]: fieldValue.delete(),
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.docs.length };
}

function buildEquipmentDocument(existing, slots, uid, updatedAt, item) {
  const document = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const projected = getEquipmentCosmeticConfig(item.category)
    ? setEquipmentCosmeticProjection(document, item)
    : document;
  return {
    ...projected,
    slots,
    uid,
    updatedAt,
  };
}

function buildAvatarFrameProfileUpdate(item, fieldValue, updatedAt) {
  const projection = buildAvatarFrameProjection(item);
  const canonical = buildCanonicalEquipmentFrame(item);
  return {
    equippedAvatarFrame: projection ? { assetUrl: projection.assetUrl, itemId: projection.itemId } : fieldValue.delete(),
    'equippedCosmetics.avatarFrame': canonical || fieldValue.delete(),
    updatedAt,
  };
}

async function isApprovedCanonicalCosmetic({ db, item, transaction }) {
  if (!getEquipmentCosmeticConfig(item.category)) return true;
  if (!item.cosmeticAsset) return false;
  const { assetId, assetVersionId: versionId } = item.cosmeticAsset;
  const [summary, version, approval] = await Promise.all([
    transaction.get(db.doc(`cosmeticAssets/${assetId}`)),
    transaction.get(db.doc(`cosmeticAssets/${assetId}/versions/${versionId}`)),
    transaction.get(db.doc(`cosmeticAssetApprovals/${assetId}__${versionId}`)),
  ]);
  return inspectApprovedEquipmentCosmeticReference({
    approval: approval.exists ? approval.data() : undefined,
    assetId,
    category: item.category,
    summary: summary.exists ? summary.data() : undefined,
    version: version.exists ? version.data() : undefined,
    versionId,
  }).ok;
}

async function validateActiveProfile(db, profileSnapshot, uid) {
  const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
  const reservation = profile?.publicId ? await db.doc(`publicIds/${profile.publicId}`).get() : undefined;
  if (!inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
  if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
  return { profile };
}

module.exports = { equipStoreItem, expireStoreOwnerships, getMyStoreItems, getStoreCatalog, giftStoreItem, purchaseStoreItem };
