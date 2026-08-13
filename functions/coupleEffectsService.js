'use strict';

const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const { applyWalletMutation, buildWalletDocument, buildWalletTransaction, mapWalletSummary } = require('./socialWalletCore');
const { mapStoreCatalogItem } = require('./storeCore');
const { durationToMilliseconds } = require('./storePurchaseCore');
const {
  buildCoupleEffectProjection,
  inspectActiveCouple,
  inspectApprovedCoupleEffect,
  mapCoupleEffectOwnership,
  normalizeCoupleEffectEmptyInput,
  normalizeCoupleEffectEquipInput,
  normalizeCoupleEffectPurchaseInput,
  resolveRelationshipId,
} = require('./coupleEffectsCore');

const COUPLE_EFFECT_LIMIT = 200;

async function purchaseCoupleEffect({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCoupleEffectPurchaseInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { currency, itemId } = validation.value;
  return db.runTransaction(async (transaction) => {
    const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'purchase-couple-effect'
        && previous.currency === currency
        && previous.itemId === itemId
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }

    const featureSnapshot = await transaction.get(db.doc('appConfig/cosmeticsFeatures'));
    if (featureSnapshot.data()?.cosmetics_couple_effects !== true) return { errorCode: 'FEATURE_DISABLED' };
    const relationship = await readActiveCoupleTransaction({ db, transaction, uid });
    if (!relationship.ok) return { errorCode: relationship.code };
    const context = relationship.value;
    const refs = {
      catalog: db.doc(`storeCatalog/${itemId}`),
      equipment: db.doc(`coupleEffectEquipment/${context.relationshipId}`),
      ownership: db.doc(`coupleEffectOwnerships/${context.relationshipId}/items/${itemId}`),
      storeTransaction: db.doc(`coupleEffectTransactions/${context.relationshipId}_${requestId}`),
      wallet: db.doc(`walletSummaries/${uid}`),
      walletTransaction: db.doc(`walletTransactions/${uid}_${requestId}`),
    };
    const [catalogSnapshot, equipmentSnapshot, ownershipSnapshot, walletSnapshot] = await Promise.all([
      transaction.get(refs.catalog),
      transaction.get(refs.equipment),
      transaction.get(refs.ownership),
      transaction.get(refs.wallet),
    ]);
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    if (
      !item
      || item.category !== 'couple-effects'
      || item.availability !== 'available'
      || item.purchasingEnabled !== true
    ) return { errorCode: 'ITEM_UNAVAILABLE' };
    if (ownershipSnapshot.exists) return { errorCode: 'DUPLICATE_OWNERSHIP' };
    if (item.stock.kind === 'limited' && item.stock.remaining === 0) return { errorCode: 'OUT_OF_STOCK' };
    const approved = await readApprovedCoupleEffect({ db, item, transaction });
    if (!approved.ok) return { errorCode: 'ITEM_UNAVAILABLE' };
    const price = item.prices[currency];
    if (!Number.isSafeInteger(price)) return { errorCode: 'ITEM_UNAVAILABLE' };
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const debit = applyWalletMutation(wallet, { amount: price, currency, type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };

    const oldItemId = readString(equipmentSnapshot.data()?.itemId);
    const oldOwnership = oldItemId && oldItemId !== itemId
      ? await transaction.get(db.doc(`coupleEffectOwnerships/${context.relationshipId}/items/${oldItemId}`))
      : undefined;
    const timestamp = fieldValue.serverTimestamp();
    const durationMs = durationToMilliseconds(item.duration);
    const expiresAt = durationMs ? clock.timestampFromMillis(clock.nowMillis() + durationMs) : undefined;
    const projection = buildCoupleEffectProjection({
      coupleIdHash: context.coupleIdHash,
      descriptor: approved.descriptor,
      itemId,
      presentation: item.coupleEffectPresentation,
    });
    const { balanceAfter, wallet: walletAfter } = debit.value;
    const result = {
      balances: walletAfter.balances,
      coupleIdHash: context.coupleIdHash,
      currency,
      expiresAt: expiresAt || null,
      itemId,
      ownershipId: itemId,
    };

    transaction.set(refs.wallet, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt)
        ? walletSnapshot.data().createdAt
        : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: uid,
      amount: price,
      balanceAfter,
      createdAt: timestamp,
      currency,
      referenceId: `${context.relationshipId}:${itemId}`,
      source: 'couple-effect-store',
      type: 'purchase',
      uid,
    }));
    transaction.create(refs.storeTransaction, {
      amount: price,
      category: 'couple-effects',
      coupleId: context.coupleId,
      createdAt: timestamp,
      currency,
      itemId,
      kind: 'purchase',
      memberUids: context.memberUids,
      purchaserUid: uid,
      relationshipId: context.relationshipId,
      requestId,
    });
    if (oldOwnership?.exists) transaction.update(oldOwnership.ref, { equipped: false, updatedAt: timestamp });
    transaction.create(refs.ownership, {
      acquiredAt: timestamp,
      coupleId: context.coupleId,
      duration: item.duration,
      equipped: true,
      ...(expiresAt ? { expiresAt } : {}),
      itemId,
      kind: 'couple-effect-ownership',
      memberUids: context.memberUids,
      ownershipId: itemId,
      purchaserUid: uid,
      relationshipId: context.relationshipId,
      state: 'active',
      updatedAt: timestamp,
    });
    transaction.set(refs.equipment, buildEquipment(
      context,
      projection,
      timestamp,
      readRevision(equipmentSnapshot.data()) + 1,
    ));
    writeProjection(transaction, db, context.memberUids, projection, timestamp);
    if (item.stock.kind === 'limited') {
      transaction.update(refs.catalog, {
        stock: { kind: 'limited', remaining: item.stock.remaining - 1 },
        updatedAt: timestamp,
      });
    }
    transaction.create(commandRef, {
      action: 'purchase-couple-effect',
      createdAt: timestamp,
      currency,
      itemId,
      relationshipId: context.relationshipId,
      requestId,
      result,
      uid,
    });
    transaction.create(db.doc(`coupleEffectAuditEvents/purchase_${context.relationshipId}_${requestId}`), {
      action: 'purchase',
      actorUid: uid,
      coupleId: context.coupleId,
      createdAt: timestamp,
      itemId,
      memberUids: context.memberUids,
      relationshipId: context.relationshipId,
      requestId,
    });
    return { result };
  });
}

async function equipCoupleEffect({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCoupleEffectEquipInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { itemId } = validation.value;
  return db.runTransaction(async (transaction) => {
    const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'equip-couple-effect' && previous.itemId === itemId && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const featureSnapshot = await transaction.get(db.doc('appConfig/cosmeticsFeatures'));
    if (featureSnapshot.data()?.cosmetics_couple_effects !== true) return { errorCode: 'FEATURE_DISABLED' };
    const relationship = await readActiveCoupleTransaction({ db, transaction, uid });
    if (!relationship.ok) return { errorCode: relationship.code };
    const context = relationship.value;
    const ownershipRef = db.doc(`coupleEffectOwnerships/${context.relationshipId}/items/${itemId}`);
    const catalogRef = db.doc(`storeCatalog/${itemId}`);
    const equipmentRef = db.doc(`coupleEffectEquipment/${context.relationshipId}`);
    const [ownershipSnapshot, catalogSnapshot, equipmentSnapshot] = await Promise.all([
      transaction.get(ownershipRef),
      transaction.get(catalogRef),
      transaction.get(equipmentRef),
    ]);
    const ownership = ownershipSnapshot.exists ? mapCoupleEffectOwnership(ownershipSnapshot.data(), itemId) : undefined;
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    if (
      !ownership
      || ownership.relationshipId !== context.relationshipId
      || ownership.state !== 'active'
      || (ownership.expiresAt?.toMillis?.() ?? Infinity) <= clock.nowMillis()
      || !item
      || item.category !== 'couple-effects'
      || item.availability === 'disabled'
    ) return { errorCode: 'ITEM_UNAVAILABLE' };
    const approved = await readApprovedCoupleEffect({ db, item, transaction });
    if (!approved.ok) return { errorCode: 'ITEM_UNAVAILABLE' };
    const oldItemId = readString(equipmentSnapshot.data()?.itemId);
    const oldOwnership = oldItemId && oldItemId !== itemId
      ? await transaction.get(db.doc(`coupleEffectOwnerships/${context.relationshipId}/items/${oldItemId}`))
      : undefined;
    const timestamp = fieldValue.serverTimestamp();
    const projection = buildCoupleEffectProjection({
      coupleIdHash: context.coupleIdHash,
      descriptor: approved.descriptor,
      itemId,
      presentation: item.coupleEffectPresentation,
    });
    if (oldOwnership?.exists) transaction.update(oldOwnership.ref, { equipped: false, updatedAt: timestamp });
    transaction.update(ownershipRef, { equipped: true, updatedAt: timestamp });
    transaction.set(equipmentRef, buildEquipment(
      context,
      projection,
      timestamp,
      readRevision(equipmentSnapshot.data()) + 1,
    ));
    writeProjection(transaction, db, context.memberUids, projection, timestamp);
    const result = { coupleIdHash: context.coupleIdHash, itemId, ownershipId: itemId };
    transaction.create(commandRef, {
      action: 'equip-couple-effect',
      createdAt: timestamp,
      itemId,
      relationshipId: context.relationshipId,
      requestId,
      result,
      uid,
    });
    transaction.create(db.doc(`coupleEffectAuditEvents/equip_${context.relationshipId}_${requestId}`), {
      action: 'equip',
      actorUid: uid,
      coupleId: context.coupleId,
      createdAt: timestamp,
      itemId,
      memberUids: context.memberUids,
      relationshipId: context.relationshipId,
      requestId,
    });
    return { result };
  });
}

async function unequipCoupleEffect({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCoupleEffectEmptyInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  return db.runTransaction(async (transaction) => {
    const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'unequip-couple-effect' && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const featureSnapshot = await transaction.get(db.doc('appConfig/cosmeticsFeatures'));
    if (featureSnapshot.data()?.cosmetics_couple_effects !== true) return { errorCode: 'FEATURE_DISABLED' };
    const relationship = await readActiveCoupleTransaction({ db, transaction, uid });
    if (!relationship.ok) return { errorCode: relationship.code };
    const context = relationship.value;
    const equipmentRef = db.doc(`coupleEffectEquipment/${context.relationshipId}`);
    const equipmentSnapshot = await transaction.get(equipmentRef);
    const itemId = readString(equipmentSnapshot.data()?.itemId);
    const ownershipSnapshot = itemId
      ? await transaction.get(db.doc(`coupleEffectOwnerships/${context.relationshipId}/items/${itemId}`))
      : undefined;
    const timestamp = fieldValue.serverTimestamp();
    if (ownershipSnapshot?.exists) transaction.update(ownershipSnapshot.ref, { equipped: false, updatedAt: timestamp });
    if (equipmentSnapshot.exists) {
      transaction.set(equipmentRef, {
        ...equipmentSnapshot.data(),
        itemId: '',
        projection: null,
        revision: readRevision(equipmentSnapshot.data()) + 1,
        state: 'unequipped',
        updatedAt: timestamp,
      });
    }
    clearProjection(transaction, db, context.memberUids, fieldValue, timestamp);
    const result = { coupleIdHash: context.coupleIdHash, itemId: null };
    transaction.create(commandRef, {
      action: 'unequip-couple-effect',
      createdAt: timestamp,
      relationshipId: context.relationshipId,
      requestId,
      result,
      uid,
    });
    transaction.create(db.doc(`coupleEffectAuditEvents/unequip_${context.relationshipId}_${requestId}`), {
      action: 'unequip',
      actorUid: uid,
      coupleId: context.coupleId,
      createdAt: timestamp,
      itemId,
      memberUids: context.memberUids,
      relationshipId: context.relationshipId,
      requestId,
    });
    return { result };
  });
}

async function getCoupleEffects({ db, input, uid }) {
  const validation = normalizeCoupleEffectEmptyInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const featureSnapshot = await db.doc('appConfig/cosmeticsFeatures').get();
  if (featureSnapshot.data()?.cosmetics_couple_effects !== true) return { errorCode: 'FEATURE_DISABLED' };
  const relationship = await readActiveCouple({ db, uid });
  if (!relationship.ok) return { errorCode: relationship.code };
  const context = relationship.value;
  const [equipmentSnapshot, ownerships] = await Promise.all([
    db.doc(`coupleEffectEquipment/${context.relationshipId}`).get(),
    db.collection(`coupleEffectOwnerships/${context.relationshipId}/items`).limit(COUPLE_EFFECT_LIMIT).get(),
  ]);
  const items = ownerships.docs
    .map((snapshot) => mapCoupleEffectOwnership(snapshot.data(), snapshot.id))
    .filter(Boolean)
    .map((ownership) => ({
      acquiredAt: ownership.acquiredAt,
      duration: ownership.duration,
      equipped: ownership.equipped === true,
      expiresAt: ownership.expiresAt || null,
      itemId: ownership.itemId,
      state: ownership.state,
    }));
  const equipment = equipmentSnapshot.exists
    && equipmentSnapshot.data()?.relationshipId === context.relationshipId
    && equipmentSnapshot.data()?.state === 'equipped'
    ? equipmentSnapshot.data().projection || null
    : null;
  return { result: { coupleIdHash: context.coupleIdHash, equipment, items } };
}

async function reconcileCoupleEffects({ clock, db, fieldValue, limit = COUPLE_EFFECT_LIMIT }) {
  const snapshot = await db.collection('coupleEffectEquipment').limit(limit).get();
  let cleared = 0;
  let retained = 0;
  for (const candidate of snapshot.docs) {
    const result = await reconcileOne({ candidate, clock, db, fieldValue });
    if (result === 'cleared') cleared += 1;
    if (result === 'retained') retained += 1;
  }
  return { cleared, retained, scanned: snapshot.size ?? snapshot.docs.length };
}

async function clearSuspendedCoupleEffects({ clock, db, fieldValue, uid }) {
  if (!readString(uid) || uid.includes('/')) return { cleared: 0 };
  const snapshot = await db.collection('coupleEffectEquipment')
    .where('memberUids', 'array-contains', uid)
    .limit(2)
    .get();
  let cleared = 0;
  for (const candidate of snapshot.docs) {
    if (await reconcileOne({ candidate, clock, db, fieldValue }) === 'cleared') cleared += 1;
  }
  return { cleared };
}

async function prepareDissolutionClear({ couple, coupleId, db, transaction }) {
  const relationshipId = resolveRelationshipId(couple, coupleId);
  if (!relationshipId) return { relationshipId: '', equipmentSnapshot: undefined, ownershipSnapshot: undefined };
  const equipmentRef = db.doc(`coupleEffectEquipment/${relationshipId}`);
  const equipmentSnapshot = await transaction.get(equipmentRef);
  const itemId = readString(equipmentSnapshot.data()?.itemId);
  const ownershipSnapshot = itemId
    ? await transaction.get(db.doc(`coupleEffectOwnerships/${relationshipId}/items/${itemId}`))
    : undefined;
  return { equipmentRef, equipmentSnapshot, itemId, ownershipSnapshot, relationshipId };
}

function applyDissolutionClear({
  auditActorUid,
  auditReason,
  clearState,
  coupleId,
  db,
  fieldValue,
  memberUids,
  transaction,
}) {
  if (!clearState.relationshipId) return;
  const timestamp = fieldValue.serverTimestamp();
  if (clearState.ownershipSnapshot?.exists) {
    transaction.update(clearState.ownershipSnapshot.ref, { equipped: false, updatedAt: timestamp });
  }
  if (clearState.equipmentSnapshot?.exists) {
    transaction.set(clearState.equipmentRef, {
      ...clearState.equipmentSnapshot.data(),
      itemId: '',
      projection: null,
      revision: readRevision(clearState.equipmentSnapshot.data()) + 1,
      state: 'dissolved',
      updatedAt: timestamp,
    });
  }
  clearProjection(transaction, db, memberUids, fieldValue, timestamp);
  transaction.create(db.doc(`coupleEffectAuditEvents/dissolve_${clearState.relationshipId}`), {
    action: 'dissolve',
    actorUid: auditActorUid,
    coupleId,
    createdAt: timestamp,
    itemId: clearState.itemId,
    memberUids,
    reason: readString(auditReason).slice(0, 300),
    relationshipId: clearState.relationshipId,
  });
}

async function reconcileOne({ candidate, clock, db, fieldValue }) {
  return db.runTransaction(async (transaction) => {
    const equipmentSnapshot = await transaction.get(candidate.ref);
    if (!equipmentSnapshot.exists || equipmentSnapshot.data()?.state !== 'equipped') return 'ignored';
    const equipment = equipmentSnapshot.data();
    const coupleId = readString(equipment.coupleId);
    const relationshipId = readString(equipment.relationshipId);
    const memberUids = Array.isArray(equipment.memberUids) ? [...equipment.memberUids].sort() : [];
    const itemId = readString(equipment.itemId);
    if (memberUids.length !== 2 || !coupleId || !relationshipId || !itemId) {
      return clearInvalidEquipment({ db, equipment, equipmentSnapshot, fieldValue, memberUids, transaction });
    }
    const refs = {
      couple: db.doc(`couples/${coupleId}`),
      firstMembership: db.doc(`coupleMemberships/${memberUids[0]}`),
      firstProfile: db.doc(`publicProfiles/${memberUids[0]}`),
      secondMembership: db.doc(`coupleMemberships/${memberUids[1]}`),
      secondProfile: db.doc(`publicProfiles/${memberUids[1]}`),
      ownership: db.doc(`coupleEffectOwnerships/${relationshipId}/items/${itemId}`),
      catalog: db.doc(`storeCatalog/${itemId}`),
      feature: db.doc('appConfig/cosmeticsFeatures'),
    };
    const [feature, couple, firstMembership, secondMembership, firstProfile, secondProfile, ownershipSnapshot, catalogSnapshot] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.couple),
      transaction.get(refs.firstMembership),
      transaction.get(refs.secondMembership),
      transaction.get(refs.firstProfile),
      transaction.get(refs.secondProfile),
      transaction.get(refs.ownership),
      transaction.get(refs.catalog),
    ]);
    const active = inspectActiveCouple({
      actorMembership: firstMembership.data(),
      actorProfile: firstProfile.data(),
      actorUid: memberUids[0],
      couple: couple.data(),
      coupleId,
      partnerMembership: secondMembership.data(),
      partnerProfile: secondProfile.data(),
    });
    const ownership = ownershipSnapshot.exists ? mapCoupleEffectOwnership(ownershipSnapshot.data(), itemId) : undefined;
    const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
    let valid = Boolean(
      feature.data()?.cosmetics_couple_effects === true
      && active.ok
      && active.value.relationshipId === relationshipId
      && ownership
      && ownership.relationshipId === relationshipId
      && ownership.state === 'active'
      && ownership.equipped === true
      && (ownership.expiresAt?.toMillis?.() ?? Infinity) > clock.nowMillis()
      && item
      && item.category === 'couple-effects'
      && item.availability !== 'disabled',
    );
    let approved;
    if (valid) {
      approved = await readApprovedCoupleEffect({ db, item, transaction });
      valid = approved.ok;
    }
    if (!valid) {
      const timestamp = fieldValue.serverTimestamp();
      if (ownershipSnapshot.exists) {
        transaction.update(ownershipSnapshot.ref, {
          equipped: false,
          ...((ownership?.expiresAt?.toMillis?.() ?? Infinity) <= clock.nowMillis() && ownership?.state === 'active'
            ? { state: 'expired' }
            : {}),
          updatedAt: timestamp,
        });
      }
      transaction.set(equipmentSnapshot.ref, {
        ...equipment,
        itemId: '',
        projection: null,
        revision: readRevision(equipment) + 1,
        state: 'reconciled',
        updatedAt: timestamp,
      });
      clearProjection(transaction, db, memberUids, fieldValue, timestamp);
      transaction.create(db.doc(`coupleEffectAuditEvents/reconcile_${relationshipId}_${itemId}_${readRevision(equipment)}`), {
        action: 'reconcile-clear',
        actorUid: 'system',
        coupleId,
        createdAt: timestamp,
        itemId,
        memberUids,
        relationshipId,
      });
      return 'cleared';
    }
    const projection = buildCoupleEffectProjection({
      coupleIdHash: active.value.coupleIdHash,
      descriptor: approved.descriptor,
      itemId,
      presentation: item.coupleEffectPresentation,
    });
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(equipmentSnapshot.ref, buildEquipment(
      active.value,
      projection,
      timestamp,
      Math.max(1, readRevision(equipment)),
    ));
    writeProjection(transaction, db, memberUids, projection, timestamp);
    return 'retained';
  });
}

async function clearInvalidEquipment({ db, equipment, equipmentSnapshot, fieldValue, memberUids, transaction }) {
  const timestamp = fieldValue.serverTimestamp();
  transaction.set(equipmentSnapshot.ref, {
    ...equipment,
    itemId: '',
    projection: null,
    revision: readRevision(equipment) + 1,
    state: 'reconciled',
    updatedAt: timestamp,
  });
  clearProjection(transaction, db, memberUids, fieldValue, timestamp);
  return 'cleared';
}

async function readActiveCoupleTransaction({ db, transaction, uid }) {
  const actorMembershipSnapshot = await transaction.get(db.doc(`coupleMemberships/${uid}`));
  const actorMembership = actorMembershipSnapshot.data();
  const coupleId = readString(actorMembership?.coupleId);
  const partnerUid = readString(actorMembership?.partnerUid);
  if (!coupleId || !partnerUid) return { ok: false, code: 'STALE_RELATIONSHIP' };
  const [couple, partnerMembership, actorProfile, partnerProfile] = await Promise.all([
    transaction.get(db.doc(`couples/${coupleId}`)),
    transaction.get(db.doc(`coupleMemberships/${partnerUid}`)),
    transaction.get(db.doc(`publicProfiles/${uid}`)),
    transaction.get(db.doc(`publicProfiles/${partnerUid}`)),
  ]);
  const profileInspection = await inspectProfilePairInTransaction({
    actorProfile,
    db,
    partnerProfile,
    partnerUid,
    transaction,
    uid,
  });
  if (!profileInspection.ok) return profileInspection;
  return inspectActiveCouple({
    actorMembership,
    actorProfile: actorProfile.data(),
    actorUid: uid,
    couple: couple.data(),
    coupleId,
    partnerMembership: partnerMembership.data(),
    partnerProfile: partnerProfile.data(),
  });
}

async function readActiveCouple({ db, uid }) {
  const actorMembershipSnapshot = await db.doc(`coupleMemberships/${uid}`).get();
  const actorMembership = actorMembershipSnapshot.data();
  const coupleId = readString(actorMembership?.coupleId);
  const partnerUid = readString(actorMembership?.partnerUid);
  if (!coupleId || !partnerUid) return { ok: false, code: 'STALE_RELATIONSHIP' };
  const [couple, partnerMembership, actorProfile, partnerProfile] = await db.getAll(
    db.doc(`couples/${coupleId}`),
    db.doc(`coupleMemberships/${partnerUid}`),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`publicProfiles/${partnerUid}`),
  );
  const actor = actorProfile.data();
  const partner = partnerProfile.data();
  const [actorReservation, partnerReservation] = await db.getAll(
    db.doc(`publicIds/${actor?.publicId || '_missing'}`),
    db.doc(`publicIds/${partner?.publicId || '_missing'}`),
  );
  if (
    !inspectPublicProfile(actor, actorReservation.data(), uid).ok
    || !inspectPublicProfile(partner, partnerReservation.data(), partnerUid).ok
  ) return { ok: false, code: 'STALE_RELATIONSHIP' };
  return inspectActiveCouple({
    actorMembership,
    actorProfile: actor,
    actorUid: uid,
    couple: couple.data(),
    coupleId,
    partnerMembership: partnerMembership.data(),
    partnerProfile: partner,
  });
}

async function inspectProfilePairInTransaction({ actorProfile, db, partnerProfile, partnerUid, transaction, uid }) {
  const actor = actorProfile.data();
  const partner = partnerProfile.data();
  const [actorReservation, partnerReservation] = await Promise.all([
    transaction.get(db.doc(`publicIds/${actor?.publicId || '_missing'}`)),
    transaction.get(db.doc(`publicIds/${partner?.publicId || '_missing'}`)),
  ]);
  return inspectPublicProfile(actor, actorReservation.data(), uid).ok
    && inspectPublicProfile(partner, partnerReservation.data(), partnerUid).ok
    ? { ok: true }
    : { ok: false, code: 'STALE_RELATIONSHIP' };
}

async function readApprovedCoupleEffect({ db, item, transaction }) {
  if (!item.cosmeticAsset || !item.coupleEffectPresentation) return { ok: false };
  const { assetId, assetVersionId } = item.cosmeticAsset;
  const [summary, version, approval] = await Promise.all([
    transaction.get(db.doc(`cosmeticAssets/${assetId}`)),
    transaction.get(db.doc(`cosmeticAssets/${assetId}/versions/${assetVersionId}`)),
    transaction.get(db.doc(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`)),
  ]);
  let fallback;
  if (version.data()?.format === 'lottie-json') {
    const fallbackAssetId = readString(version.data()?.fallbackAssetId);
    const fallbackAssetVersionId = readString(version.data()?.fallbackAssetVersionId);
    const [fallbackSummary, fallbackVersion, fallbackApproval] = await Promise.all([
      transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId || '_missing'}`)),
      transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId || '_missing'}/versions/${fallbackAssetVersionId || '_missing'}`)),
      transaction.get(db.doc(`cosmeticAssetApprovals/${fallbackAssetId || '_missing'}__${fallbackAssetVersionId || '_missing'}`)),
    ]);
    fallback = {
      approval: fallbackApproval.data(),
      summary: fallbackSummary.data(),
      version: fallbackVersion.data(),
    };
  }
  return inspectApprovedCoupleEffect({
    approval: approval.data(),
    fallback,
    reference: item.cosmeticAsset,
    summary: summary.data(),
    version: version.data(),
  });
}

function buildEquipment(context, projection, updatedAt, revision) {
  return {
    coupleId: context.coupleId,
    itemId: projection.itemId,
    memberUids: context.memberUids,
    projection,
    relationshipId: context.relationshipId,
    revision,
    state: 'equipped',
    updatedAt,
  };
}

function writeProjection(transaction, db, memberUids, projection, updatedAt) {
  for (const memberUid of memberUids) {
    transaction.update(db.doc(`publicProfiles/${memberUid}`), { coupleEffect: projection, updatedAt });
  }
}

function clearProjection(transaction, db, memberUids, fieldValue, updatedAt) {
  for (const memberUid of memberUids) {
    transaction.update(db.doc(`publicProfiles/${memberUid}`), {
      coupleEffect: fieldValue.delete(),
      updatedAt,
    });
  }
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readRevision(value) {
  return Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0;
}

module.exports = {
  applyDissolutionClear,
  clearSuspendedCoupleEffects,
  equipCoupleEffect,
  getCoupleEffects,
  prepareDissolutionClear,
  purchaseCoupleEffect,
  readApprovedCoupleEffect,
  reconcileCoupleEffects,
  unequipCoupleEffect,
};
