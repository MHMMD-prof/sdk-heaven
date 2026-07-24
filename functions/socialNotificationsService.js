const { inspectPublicProfile } = require('./socialProfileCore');
const {
  buildArabicNotification,
  createNotificationDeliveryId,
  mapNotificationPreferences,
  normalizeNotificationPreferencesInput,
  normalizePushDeviceInput,
  normalizeUnregisterPushDeviceInput,
  notificationCategoryForKind,
} = require('./socialNotificationsCore');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_PUSH_DEVICES = 20;
const NOTIFICATION_MUTATION_WINDOW_LIMIT = 30;
const NOTIFICATION_MUTATION_WINDOW_MS = 600_000;

async function getNotificationSettings({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const readiness = await validateNotificationsAccess(db, uid);
  if (readiness.errorCode) return readiness;
  const [preferences, devices] = await Promise.all([
    db.doc(`notificationPreferences/${uid}`).get(),
    db.collection(`pushDevices/${uid}/tokens`).where('active', '==', true).limit(MAX_PUSH_DEVICES).get(),
  ]);
  return {
    result: {
      preferences: mapNotificationPreferences(preferences.exists ? preferences.data() : undefined),
      registeredDeviceCount: devices.size ?? devices.docs.length,
    },
  };
}

async function mutateNotificationSettings({ action, db, fieldValue, input, requestId, uid }) {
  const validation = action === 'register-push-device'
    ? normalizePushDeviceInput(input)
    : action === 'unregister-push-device'
      ? normalizeUnregisterPushDeviceInput(input)
      : action === 'update-notification-preferences'
        ? normalizeNotificationPreferencesInput(input)
        : { ok: false, code: 'INVALID_REQUEST' };
  if (!validation.ok) return { errorCode: validation.code };

  const readiness = await validateNotificationsAccess(db, uid, action !== 'unregister-push-device');
  if (readiness.errorCode) return readiness;
  if (action === 'register-push-device') {
    const activeDevices = await db.collection(`pushDevices/${uid}/tokens`).where('active', '==', true).limit(MAX_PUSH_DEVICES).get();
    if (activeDevices.docs.length >= MAX_PUSH_DEVICES && !activeDevices.docs.some((document) => document.id === validation.value.tokenId)) {
      return { errorCode: 'RATE_LIMITED' };
    }
  }

  return db.runTransaction(async (transaction) => {
    const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
    const preferencesRef = db.doc(`notificationPreferences/${uid}`);
    const tokenId = validation.value.tokenId;
    const tokenRef = tokenId ? db.doc(`pushDevices/${uid}/tokens/${tokenId}`) : undefined;
    const ownerRef = tokenId ? db.doc(`pushTokenOwners/${tokenId}`) : undefined;
    const rateRef = db.doc(`socialNotificationRateLimits/${uid}`);
    const [command, preferences, token, owner, rate] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(preferencesRef),
      tokenRef ? transaction.get(tokenRef) : undefined,
      ownerRef ? transaction.get(ownerRef) : undefined,
      transaction.get(rateRef),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === action && previous.result ? { result: previous.result } : { errorCode: 'CONFLICT' };
    }

    const nowMs = Date.now();
    const rateData = rate.exists ? rate.data() : {};
    const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
    const insideWindow = Number.isFinite(windowStartedAtMs) && nowMs - windowStartedAtMs < NOTIFICATION_MUTATION_WINDOW_MS;
    const mutationCount = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;
    if (mutationCount >= NOTIFICATION_MUTATION_WINDOW_LIMIT) return { errorCode: 'RATE_LIMITED' };

    const timestamp = fieldValue.serverTimestamp();
    const currentPreferences = mapNotificationPreferences(preferences.exists ? preferences.data() : undefined);
    let result;

    if (action === 'register-push-device') {
      const previousOwnerUid = owner.exists && typeof owner.data()?.uid === 'string' ? owner.data().uid : '';
      const previousOwnerTokenRef = previousOwnerUid && previousOwnerUid !== uid
        ? db.doc(`pushDevices/${previousOwnerUid}/tokens/${tokenId}`)
        : undefined;
      const previousOwnerToken = previousOwnerTokenRef ? await transaction.get(previousOwnerTokenRef) : undefined;
      if (previousOwnerToken?.exists) {
        transaction.update(previousOwnerTokenRef, { active: false, disabledReason: 'ownership-transferred', updatedAt: timestamp });
      }
      transaction.set(tokenRef, {
        active: true,
        createdAt: token.exists && token.data()?.createdAt ? token.data().createdAt : timestamp,
        deviceName: validation.value.deviceName,
        platform: validation.value.platform,
        token: validation.value.token,
        tokenId,
        uid,
        updatedAt: timestamp,
      });
      transaction.set(ownerRef, {
        createdAt: owner.exists && owner.data()?.createdAt ? owner.data().createdAt : timestamp,
        platform: validation.value.platform,
        tokenId,
        uid,
        updatedAt: timestamp,
      });
      if (!preferences.exists) transaction.set(preferencesRef, { ...currentPreferences, createdAt: timestamp, uid, updatedAt: timestamp });
      result = { preferences: currentPreferences, registered: true };
    } else if (action === 'unregister-push-device') {
      if (token?.exists) transaction.update(tokenRef, { active: false, updatedAt: timestamp });
      if (owner?.data()?.uid === uid) transaction.delete(ownerRef);
      result = { preferences: currentPreferences, registered: false };
    } else {
      const nextPreferences = validation.value;
      transaction.set(preferencesRef, {
        ...nextPreferences,
        createdAt: preferences.exists && preferences.data()?.createdAt ? preferences.data().createdAt : timestamp,
        uid,
        updatedAt: timestamp,
      });
      result = { preferences: nextPreferences };
    }

    transaction.create(commandRef, { action, createdAt: timestamp, requestId, result, uid });
    transaction.set(rateRef, {
      count: mutationCount + 1,
      lastMutationAt: timestamp,
      uid,
      windowStartedAt: insideWindow ? rateData.windowStartedAt : timestamp,
    });
    return { result };
  });
}

async function deliverNotificationForCommand({ db, fieldValue, requestId, uid, fetchImpl = fetch }) {
  const commandSnapshot = await db.doc(`socialCommandRequests/${uid}/requests/${requestId}`).get();
  const command = commandSnapshot.exists ? commandSnapshot.data() : undefined;
  const kind = command?.notificationKind;
  const recipientUid = command?.notificationRecipientUid;
  return deliverSocialNotification({ actorUid: uid, db, fieldValue, fetchImpl, kind, recipientUid, requestId });
}

async function deliverSocialNotification({ actorUid, db, fieldValue, kind, recipientUid, requestId, fetchImpl = fetch }) {
  const category = notificationCategoryForKind(kind);
  if (!category || typeof recipientUid !== 'string' || !recipientUid || recipientUid === actorUid) return { status: 'skipped' };

  const [feature, preferences, actorProfile, devices] = await Promise.all([
    db.doc('appConfig/socialFeatures').get(),
    db.doc(`notificationPreferences/${recipientUid}`).get(),
    db.doc(`publicProfiles/${actorUid}`).get(),
    db.collection(`pushDevices/${recipientUid}/tokens`).where('active', '==', true).limit(MAX_PUSH_DEVICES).get(),
  ]);
  if (feature.data()?.pushNotifications !== true) return { status: 'disabled' };
  if (mapNotificationPreferences(preferences.exists ? preferences.data() : undefined)[category] !== true) return { status: 'preference-disabled' };

  const content = buildArabicNotification(kind, actorProfile.data()?.displayName, actorUid);
  if (!content) return { status: 'skipped' };
  const deviceDocuments = devices.docs.filter((document) => typeof document.data()?.token === 'string');
  const deliveryId = createNotificationDeliveryId(actorUid, requestId);
  const deliveryRef = db.doc(`notificationDeliveries/${deliveryId}`);
  const timestamp = fieldValue.serverTimestamp();

  try {
    await deliveryRef.create({
      actorUid,
      category,
      createdAt: timestamp,
      deviceCount: deviceDocuments.length,
      kind,
      recipientUid,
      requestId,
      status: deviceDocuments.length ? 'sending' : 'no-devices',
      updatedAt: timestamp,
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) return { status: 'duplicate' };
    throw error;
  }

  if (deviceDocuments.length === 0) return { status: 'no-devices' };

  try {
    const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      body: JSON.stringify(deviceDocuments.map((document) => ({
        body: content.body,
        channelId: 'social',
        data: { actorUid, kind, route: content.route, targetUid: actorUid },
        sound: 'default',
        title: content.title,
        to: document.data().token,
      }))),
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`Expo push service returned HTTP ${response.status}.`);
    const payload = await response.json();
    const tickets = Array.isArray(payload?.data) ? payload.data : [];
    const invalidDeviceRefs = [];
    const ticketTargets = [];
    let acceptedCount = 0;

    tickets.forEach((ticket, index) => {
      if (ticket?.status === 'ok') {
        acceptedCount += 1;
        if (typeof ticket.id === 'string' && deviceDocuments[index]) {
          ticketTargets.push({ ticketId: ticket.id, tokenId: deviceDocuments[index].id });
        }
      }
      if (ticket?.details?.error === 'DeviceNotRegistered' && deviceDocuments[index]) invalidDeviceRefs.push(deviceDocuments[index].ref);
    });

    if (invalidDeviceRefs.length) {
      const batch = db.batch();
      invalidDeviceRefs.forEach((ref) => batch.update(ref, { active: false, disabledReason: 'DeviceNotRegistered', updatedAt: timestamp }));
      await batch.commit();
    }
    await deliveryRef.update({ acceptedCount, invalidDeviceCount: invalidDeviceRefs.length, status: 'submitted', ticketTargets, updatedAt: timestamp });
    return { acceptedCount, status: 'submitted' };
  } catch (error) {
    await deliveryRef.update({ errorMessage: error instanceof Error ? error.message.slice(0, 240) : 'Push delivery failed.', status: 'failed', updatedAt: timestamp });
    return { status: 'failed' };
  }
}

async function processPendingNotificationReceipts({ db, fieldValue, fetchImpl = fetch }) {
  const snapshot = await db.collection('notificationDeliveries')
    .where('status', '==', 'submitted')
    .orderBy('updatedAt', 'asc')
    .limit(50)
    .get();
  const deliveries = snapshot.docs.map((document) => ({ document, data: document.data() }));
  const ticketIds = deliveries.flatMap(({ data }) => Array.isArray(data.ticketTargets)
    ? data.ticketTargets.map((target) => target?.ticketId).filter((value) => typeof value === 'string')
    : []);
  if (deliveries.length === 0) return { checked: 0, invalidated: 0 };

  const timestamp = fieldValue.serverTimestamp();
  if (ticketIds.length === 0) {
    const batch = db.batch();
    deliveries.forEach(({ document }) => batch.update(document.ref, { receiptCheckedAt: timestamp, status: 'completed', updatedAt: timestamp }));
    await batch.commit();
    return { checked: deliveries.length, invalidated: 0 };
  }

  const response = await fetchImpl(EXPO_RECEIPTS_ENDPOINT, {
    body: JSON.stringify({ ids: ticketIds }),
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`Expo receipt service returned HTTP ${response.status}.`);
  const payload = await response.json();
  const receipts = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const batch = db.batch();
  let invalidated = 0;

  deliveries.forEach(({ document, data }) => {
    const targets = Array.isArray(data.ticketTargets) ? data.ticketTargets : [];
    let resolved = 0;
    targets.forEach((target) => {
      const receipt = receipts[target?.ticketId];
      if (!receipt) return;
      resolved += 1;
      if (receipt?.details?.error === 'DeviceNotRegistered' && typeof target.tokenId === 'string' && typeof data.recipientUid === 'string') {
        invalidated += 1;
        batch.update(db.doc(`pushDevices/${data.recipientUid}/tokens/${target.tokenId}`), {
          active: false,
          disabledReason: 'DeviceNotRegistered',
          updatedAt: timestamp,
        });
      }
    });
    const receiptAttemptCount = Number.isSafeInteger(data.receiptAttemptCount) ? data.receiptAttemptCount + 1 : 1;
    batch.update(document.ref, {
      receiptAttemptCount,
      receiptCheckedAt: timestamp,
      status: resolved === targets.length || receiptAttemptCount >= 8 ? 'completed' : 'submitted',
      updatedAt: timestamp,
    });
  });
  await batch.commit();
  return { checked: deliveries.length, invalidated };
}

async function validateNotificationsAccess(db, uid, requireFeature = true) {
  const [feature, profile] = await db.getAll(db.doc('appConfig/socialFeatures'), db.doc(`publicProfiles/${uid}`));
  if (requireFeature && feature.data()?.pushNotifications !== true) return { errorCode: 'FEATURE_DISABLED' };
  const data = profile.exists ? profile.data() : undefined;
  const reservation = data?.publicId ? await db.doc(`publicIds/${data.publicId}`).get() : undefined;
  if (!inspectPublicProfile(data, reservation?.exists ? reservation.data() : undefined, uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
  if (data.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
  return { profile: data };
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS';
}

function readTimestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

module.exports = {
  EXPO_PUSH_ENDPOINT,
  EXPO_RECEIPTS_ENDPOINT,
  MAX_PUSH_DEVICES,
  NOTIFICATION_MUTATION_WINDOW_LIMIT,
  deliverNotificationForCommand,
  deliverSocialNotification,
  getNotificationSettings,
  mutateNotificationSettings,
  processPendingNotificationReceipts,
};
