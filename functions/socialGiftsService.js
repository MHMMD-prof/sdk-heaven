const { mapDiscoveryProfile } = require('./socialDiscoveryCore');
const {
  GIFT_CATALOG_LIMIT,
  GIFT_HISTORY_LIMIT,
  mapGiftCatalogItem,
  mapGiftEvent,
  normalizeGiftCenterInput,
  normalizeSendGiftInput,
} = require('./socialGiftsCore');
const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');

const GIFT_RATE_LIMIT = 30;
const GIFT_RATE_WINDOW_MS = 60_000;

async function getGiftCenter({ db, input, uid }) {
  const validation = normalizeGiftCenterInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };
  const { targetUid } = validation.value;
  const refs = [
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`walletSummaries/${uid}`),
  ];
  if (targetUid) {
    refs.push(db.doc(`publicProfiles/${targetUid}`));
    refs.push(db.doc(`blocks/${uid}/blocked/${targetUid}`));
    refs.push(db.doc(`blocks/${targetUid}/blocked/${uid}`));
  }
  const snapshots = await db.getAll(...refs);
  const [feature, senderSnapshot, walletSnapshot, recipientSnapshot, blockedBySender, blockedByRecipient] = snapshots;
  if (feature.data()?.gifts !== true) return { errorCode: 'FEATURE_DISABLED' };
  const sender = senderSnapshot.exists ? senderSnapshot.data() : undefined;
  const senderReadiness = await validateActiveProfile(db, sender, uid, 'PROFILE_INCOMPLETE');
  if (senderReadiness.errorCode) return senderReadiness;
  let recipient;
  if (targetUid) {
    recipient = recipientSnapshot?.exists ? recipientSnapshot.data() : undefined;
    const recipientReadiness = await validateActiveProfile(db, recipient, targetUid, 'NOT_FOUND');
    if (recipientReadiness.errorCode) return recipientReadiness;
    if (blockedBySender?.exists || blockedByRecipient?.exists) return { errorCode: 'PERMISSION_DENIED' };
  }
  const [catalog, sent, received] = await Promise.all([
    db.collection('giftCatalog').where('status', '==', 'available').orderBy('price').limit(GIFT_CATALOG_LIMIT).get(),
    db.collection('giftEvents').where('senderUid', '==', uid).orderBy('createdAt', 'desc').limit(GIFT_HISTORY_LIMIT).get(),
    db.collection('giftEvents').where('recipientUid', '==', uid).orderBy('createdAt', 'desc').limit(GIFT_HISTORY_LIMIT).get(),
  ]);
  return {
    result: {
      catalog: catalog.docs.map(mapGiftCatalogItemFromDocument).filter(Boolean),
      received: received.docs.map(mapGiftEvent).filter(Boolean),
      ...(recipient ? { recipient: mapDiscoveryProfile(recipient) } : {}),
      sent: sent.docs.map(mapGiftEvent).filter(Boolean),
      wallet: mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid),
    },
  };
}

async function sendGift({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeSendGiftInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };
  const { giftId, message, targetUid } = validation.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      blockedByRecipient: db.doc(`blocks/${targetUid}/blocked/${uid}`),
      blockedBySender: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      catalog: db.doc(`giftCatalog/${giftId}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      event: db.doc(`giftEvents/${uid}_${requestId}`),
      feature: db.doc('appConfig/socialFeatures'),
      rate: db.doc(`socialGiftRateLimits/${uid}`),
      recipient: db.doc(`publicProfiles/${targetUid}`),
      sender: db.doc(`publicProfiles/${uid}`),
      wallet: db.doc(`walletSummaries/${uid}`),
      walletTransaction: db.doc(`walletTransactions/gift_${uid}_${requestId}`),
    };
    const [feature, senderSnapshot, recipientSnapshot, walletSnapshot, catalogSnapshot, blockedBySender, blockedByRecipient, commandSnapshot, rateSnapshot] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.sender),
      transaction.get(refs.recipient),
      transaction.get(refs.wallet),
      transaction.get(refs.catalog),
      transaction.get(refs.blockedBySender),
      transaction.get(refs.blockedByRecipient),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === 'send-gift' && previous.giftId === giftId && previous.targetUid === targetUid && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.gifts !== true) return { errorCode: 'FEATURE_DISABLED' };
    if (blockedBySender.exists || blockedByRecipient.exists) return { errorCode: 'PERMISSION_DENIED' };
    const sender = senderSnapshot.exists ? senderSnapshot.data() : undefined;
    const recipient = recipientSnapshot.exists ? recipientSnapshot.data() : undefined;
    const [senderReservation, recipientReservation] = await Promise.all([
      sender?.publicId ? transaction.get(db.doc(`publicIds/${sender.publicId}`)) : undefined,
      recipient?.publicId ? transaction.get(db.doc(`publicIds/${recipient.publicId}`)) : undefined,
    ]);
    if (!inspectPublicProfile(sender, senderReservation?.exists ? senderReservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (!inspectPublicProfile(recipient, recipientReservation?.exists ? recipientReservation.data() : undefined, targetUid).ok) return { errorCode: 'NOT_FOUND' };
    if (sender.moderationStatus !== 'active' || recipient.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    const item = catalogSnapshot.exists ? mapGiftCatalogItem(catalogSnapshot.data()) : undefined;
    if (!item || item.status !== 'available') return { errorCode: 'NOT_FOUND' };
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const debit = applyWalletMutation(wallet, { amount: item.price, currency: 'coins', type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };
    const rateData = rateSnapshot.exists ? rateSnapshot.data() : {};
    const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
    const insideWindow = Number.isFinite(windowStartedAtMs) && Date.now() - windowStartedAtMs < GIFT_RATE_WINDOW_MS;
    const count = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;
    if (count >= GIFT_RATE_LIMIT) return { errorCode: 'RATE_LIMITED' };
    const giftScore = recipient.giftScore + item.scoreValue;
    if (!Number.isSafeInteger(giftScore) || giftScore > 1_000_000_000) return { errorCode: 'CONFLICT' };
    const { balanceAfter, wallet: walletAfter } = debit.value;
    const timestamp = fieldValue.serverTimestamp();
    const result = { balances: walletAfter.balances, eventId: refs.event.path.split('/').at(-1), giftScore };
    transaction.set(refs.wallet, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt) ? walletSnapshot.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.update(refs.recipient, { giftScore, updatedAt: timestamp });
    transaction.create(refs.event, {
      createdAt: timestamp,
      giftId,
      iconKey: item.iconKey,
      message,
      nameAr: item.nameAr,
      price: item.price,
      recipientDisplayName: recipient.displayName,
      recipientUid: targetUid,
      scoreValue: item.scoreValue,
      senderDisplayName: sender.displayName,
      senderUid: uid,
    });
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: uid,
      amount: item.price,
      balanceAfter,
      createdAt: timestamp,
      currency: 'coins',
      referenceId: refs.event.path.split('/').at(-1),
      source: 'gift',
      type: 'purchase',
      uid,
    }));
    transaction.create(refs.command, {
      action: 'send-gift',
      createdAt: timestamp,
      giftId,
      notificationKind: 'gift-received',
      notificationRecipientUid: targetUid,
      requestId,
      result,
      targetUid,
      uid,
    });
    transaction.set(refs.rate, {
      count: count + 1,
      lastGiftAt: timestamp,
      uid,
      windowStartedAt: insideWindow ? rateData.windowStartedAt : timestamp,
    });
    return { result };
  });
}

function mapGiftCatalogItemFromDocument(document) {
  return mapGiftCatalogItem(document.data());
}

async function validateActiveProfile(db, profile, uid, missingCode) {
  const reservation = profile?.publicId ? await db.doc(`publicIds/${profile.publicId}`).get() : undefined;
  if (!inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, uid).ok) return { errorCode: missingCode };
  if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
  return { profile };
}

function readTimestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

module.exports = { GIFT_RATE_LIMIT, getGiftCenter, sendGift };
