const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const {
  STORE_LIMIT,
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapSpecialIdCatalogItem,
  mapWalletSummary,
  normalizeSpecialIdPurchaseInput,
} = require('./socialWalletCore');
const { mapWalletRechargeReceipt } = require('./representativeCore');

async function getWalletStore({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const [feature, profileSnapshot, walletSnapshot] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`walletSummaries/${uid}`),
  );
  if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
  const readiness = await validateActiveProfile(db, profileSnapshot, uid);
  if (readiness.errorCode) return readiness;
  const [catalog, rechargeReceipts] = await Promise.all([
    db.collection('specialIdCatalog').where('status', '==', 'available').orderBy('price').limit(STORE_LIMIT).get(),
    db.collection(`walletRechargeReceipts/${uid}/items`).orderBy('createdAt', 'desc').limit(20).get(),
  ]);
  return {
    result: {
      items: catalog.docs.map((document) => mapSpecialIdCatalogItem(document.data())).filter(Boolean),
      ownedSpecialId: readiness.profile.specialId || '',
      recentRecharges: rechargeReceipts.docs.map((document) => mapWalletRechargeReceipt(document.data(), document.id)).filter(Boolean),
      wallet: mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid),
    },
  };
}

async function purchaseSpecialId({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeSpecialIdPurchaseInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { specialId } = validation.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      catalog: db.doc(`specialIdCatalog/${specialId}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/socialFeatures'),
      profile: db.doc(`publicProfiles/${uid}`),
      publicId: db.doc(`publicIds/${specialId}`),
      reservation: db.doc(`specialIds/${specialId}`),
      wallet: db.doc(`walletSummaries/${uid}`),
      walletTransaction: db.doc(`walletTransactions/${uid}_${requestId}`),
    };
    const [feature, profileSnapshot, walletSnapshot, catalogSnapshot, publicIdSnapshot, reservationSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.profile),
      transaction.get(refs.wallet),
      transaction.get(refs.catalog),
      transaction.get(refs.publicId),
      transaction.get(refs.reservation),
      transaction.get(refs.command),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'purchase-special-id' && previous.specialId === specialId && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.wallet !== true) return { errorCode: 'FEATURE_DISABLED' };
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    const publicReservation = profile?.publicId ? await transaction.get(db.doc(`publicIds/${profile.publicId}`)) : undefined;
    if (!inspectPublicProfile(profile, publicReservation?.exists ? publicReservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (profile.specialId) return { errorCode: 'CONFLICT' };
    const item = catalogSnapshot.exists ? mapSpecialIdCatalogItem(catalogSnapshot.data()) : undefined;
    if (!item || item.status !== 'available' || publicIdSnapshot.exists || reservationSnapshot.exists) return { errorCode: 'NOT_FOUND' };
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const debit = applyWalletMutation(wallet, { amount: item.price, currency: 'coins', type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };
    const timestamp = fieldValue.serverTimestamp();
    const { balanceAfter, wallet: walletAfter } = debit.value;
    const result = { balances: walletAfter.balances, specialId };
    transaction.set(refs.wallet, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt)
        ? walletSnapshot.data().createdAt
        : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: uid,
      amount: item.price,
      balanceAfter,
      createdAt: timestamp,
      currency: 'coins',
      referenceId: specialId,
      source: 'special-id-store',
      type: 'purchase',
      uid,
    }));
    transaction.create(refs.reservation, { purchasedAt: timestamp, transactionId: refs.walletTransaction.path.split('/').at(-1), uid });
    transaction.update(refs.catalog, { ownerUid: uid, soldAt: timestamp, status: 'sold', updatedAt: timestamp });
    transaction.update(refs.profile, { specialId, updatedAt: timestamp });
    transaction.create(refs.command, { action: 'purchase-special-id', createdAt: timestamp, requestId, result, specialId, uid });
    return { result };
  });
}

async function validateActiveProfile(db, profileSnapshot, uid) {
  const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
  const reservation = profile?.publicId ? await db.doc(`publicIds/${profile.publicId}`).get() : undefined;
  if (!inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
  if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
  return { profile };
}

module.exports = { getWalletStore, purchaseSpecialId };
