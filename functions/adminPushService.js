const { createNotificationDeliveryId } = require('./socialNotificationsCore');
const {
  normalizeAdminPushEstimateInput,
  normalizeAdminPushSendInput,
  resolveAdminPushAudience,
} = require('./adminPushAudienceCore');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_PUSH_DEVICES = 20;
const ADMIN_PUSH_BATCH_SIZE = 50;
const ADMIN_PUSH_CAMPAIGN_LIST_LIMIT = 25;

async function estimateAdminPushAudience({ audience, auth, db, nowMillis }) {
  const resolved = await resolveAdminPushAudience({ audience, auth, db, nowMillis });
  return {
    breakdown: resolved.breakdown,
    recipientCount: resolved.recipientCount,
    truncated: resolved.truncated,
  };
}

async function createAdminPushCampaign({
  auth,
  db,
  decodedToken,
  fieldValue,
  input,
  nowMillis = Date.now(),
}) {
  const feature = await db.doc('appConfig/socialFeatures').get();
  if (feature.data()?.pushNotifications !== true) {
    const error = new Error('Push notifications are disabled by the platform feature flag.');
    error.status = 409;
    throw error;
  }

  const auditRef = db.doc(`adminAuditEvents/push_${input.requestId}`);
  const campaignRef = db.doc(`adminPushCampaigns/${input.requestId}`);

  const existing = await loadExistingCampaignResult({
    auditRef,
    campaignRef,
    decodedToken,
  });
  if (existing) return existing;

  const priorCampaign = await campaignRef.get();
  const resumingOrphan = priorCampaign.exists
    && priorCampaign.data()?.actorUid === decodedToken.uid
    && priorCampaign.data()?.requestId === input.requestId;

  const resolved = resumingOrphan
    ? {
      breakdown: priorCampaign.data()?.breakdown || {
        admins: 0,
        representatives: 0,
        'room-owners': 0,
        staff: 0,
        uids: Array.isArray(priorCampaign.data()?.recipientUids) ? priorCampaign.data().recipientUids.length : 0,
      },
      recipientUids: Array.isArray(priorCampaign.data()?.recipientUids) ? priorCampaign.data().recipientUids : [],
      truncated: priorCampaign.data()?.truncated === true,
    }
    : await resolveAdminPushAudience({
      audience: input.audience,
      auth,
      db,
      nowMillis,
    });
  if (resolved.recipientUids.length === 0) {
    const empty = new Error('No recipients matched the selected audience.');
    empty.status = 400;
    throw empty;
  }

  const timestamp = fieldValue.serverTimestamp();
  const campaign = {
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    audience: {
      roles: input.audience.roles,
      uidCount: input.audience.uids.length,
    },
    body: input.body,
    breakdown: resolved.breakdown,
    counts: {
      failed: 0,
      noDevices: 0,
      skipped: 0,
      submitted: 0,
      targeted: resolved.recipientUids.length,
    },
    createdAt: timestamp,
    cursor: 0,
    reason: input.reason,
    recipientUids: resolved.recipientUids,
    requestId: input.requestId,
    route: input.route,
    status: 'queued',
    title: input.title,
    truncated: resolved.truncated,
    updatedAt: timestamp,
  };
  const audit = {
    action: 'push-notification-send',
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    campaignId: campaignRef.id,
    createdAt: timestamp,
    kind: 'system',
    note: input.reason,
    recipientCount: resolved.recipientUids.length,
    source: 'admin-dashboard',
    status: 'queued',
    targetUid: campaignRef.id,
    title: input.title,
  };

  try {
    await db.runTransaction(async (transaction) => {
      const [auditSnapshot, campaignSnapshot] = await Promise.all([
        transaction.get(auditRef),
        transaction.get(campaignRef),
      ]);

      if (auditSnapshot.exists) {
        const previous = auditSnapshot.data() || {};
        if (previous.actorUid === decodedToken.uid && previous.action === 'push-notification-send') {
          return;
        }
        const conflict = new Error('This request identifier was already used.');
        conflict.status = 409;
        throw conflict;
      }

      if (campaignSnapshot.exists) {
        const previous = campaignSnapshot.data() || {};
        if (previous.actorUid === decodedToken.uid && previous.requestId === input.requestId) {
          transaction.create(auditRef, audit);
          return;
        }
        const conflict = new Error('This request identifier was already used.');
        conflict.status = 409;
        throw conflict;
      }

      transaction.create(campaignRef, campaign);
      transaction.create(auditRef, audit);
    });
  } catch (error) {
    if (error?.status === 409) throw error;
    const replay = await loadExistingCampaignResult({
      auditRef,
      campaignRef,
      decodedToken,
    });
    if (replay) return replay;
    throw error;
  }

  const fresh = await campaignRef.get();
  if (!fresh.exists) {
    const missing = new Error('Failed to create push campaign.');
    missing.status = 500;
    throw missing;
  }

  return {
    campaign: mapAdminPushCampaign(fresh.id, fresh.data()),
    campaignId: campaignRef.id,
    eventId: auditRef.id,
    replayed: resumingOrphan,
  };
}

async function loadExistingCampaignResult({ auditRef, campaignRef, decodedToken }) {
  const [auditSnapshot, campaignSnapshot] = await Promise.all([
    auditRef.get(),
    campaignRef.get(),
  ]);

  if (!auditSnapshot.exists) return null;

  const previous = auditSnapshot.data() || {};
  if (previous.actorUid !== decodedToken.uid || previous.action !== 'push-notification-send') {
    const conflict = new Error('This request identifier was already used.');
    conflict.status = 409;
    throw conflict;
  }
  const campaignId = typeof previous.campaignId === 'string' ? previous.campaignId : campaignRef.id;
  const campaign = campaignSnapshot.exists && campaignSnapshot.id === campaignId
    ? campaignSnapshot
    : await campaignRef.get();
  if (!campaign.exists) {
    const missing = new Error('Push campaign audit exists without a campaign document.');
    missing.status = 500;
    throw missing;
  }
  return {
    campaign: mapAdminPushCampaign(campaign.id, campaign.data()),
    campaignId: campaign.id,
    eventId: auditRef.id,
    replayed: true,
  };
}

async function listAdminPushCampaigns({ db, limit = ADMIN_PUSH_CAMPAIGN_LIST_LIMIT }) {
  const snapshot = await db.collection('adminPushCampaigns')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), ADMIN_PUSH_CAMPAIGN_LIST_LIMIT))
    .get();
  return snapshot.docs.map((document) => mapAdminPushCampaign(document.id, document.data()));
}

async function processAdminPushCampaigns({
  campaignId,
  db,
  fieldValue,
  fetchImpl = fetch,
  limit = ADMIN_PUSH_BATCH_SIZE,
}) {
  const batchLimit = Math.min(Math.max(limit, 1), 100);
  const documents = [];

  if (campaignId) {
    const direct = await db.doc(`adminPushCampaigns/${campaignId}`).get();
    if (direct.exists && ['queued', 'sending'].includes(direct.data()?.status)) {
      documents.push(direct);
    }
  } else {
    const [queued, sending] = await Promise.all([
      db.collection('adminPushCampaigns').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(5).get(),
      db.collection('adminPushCampaigns').where('status', '==', 'sending').orderBy('createdAt', 'asc').limit(5).get(),
    ]);
    const seen = new Set();
    for (const document of [...queued.docs, ...sending.docs]) {
      if (seen.has(document.id)) continue;
      seen.add(document.id);
      documents.push(document);
    }
  }

  const results = [];
  for (const document of documents) {
    results.push(await processOneAdminPushCampaign({
      batchLimit,
      db,
      document,
      fieldValue,
      fetchImpl,
    }));
  }
  return { processed: results.length, results };
}

async function processOneAdminPushCampaign({ batchLimit, db, document, fieldValue, fetchImpl }) {
  const data = document.data() || {};
  const recipientUids = Array.isArray(data.recipientUids) ? data.recipientUids : [];
  let cursor = Number.isSafeInteger(data.cursor) ? data.cursor : 0;
  const counts = {
    failed: Number.isSafeInteger(data.counts?.failed) ? data.counts.failed : 0,
    noDevices: Number.isSafeInteger(data.counts?.noDevices) ? data.counts.noDevices : 0,
    skipped: Number.isSafeInteger(data.counts?.skipped) ? data.counts.skipped : 0,
    submitted: Number.isSafeInteger(data.counts?.submitted) ? data.counts.submitted : 0,
    targeted: Number.isSafeInteger(data.counts?.targeted) ? data.counts.targeted : recipientUids.length,
  };

  await document.ref.set({
    status: 'sending',
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });

  let processed = 0;
  while (cursor < recipientUids.length && processed < batchLimit) {
    const recipientUid = recipientUids[cursor];
    cursor += 1;
    processed += 1;
    const delivery = await deliverAdminPushNotification({
      actorUid: data.actorUid || 'admin',
      body: data.body || '',
      db,
      fieldValue,
      fetchImpl,
      recipientUid,
      requestId: `${data.requestId || document.id}_${recipientUid}`,
      route: data.route || '',
      title: data.title || '',
    });
    if (delivery.status === 'submitted') counts.submitted += 1;
    else if (delivery.status === 'no-devices') counts.noDevices += 1;
    else if (delivery.status === 'disabled' || delivery.status === 'skipped' || delivery.status === 'duplicate') counts.skipped += 1;
    else counts.failed += 1;
  }

  const done = cursor >= recipientUids.length;
  await document.ref.set({
    counts,
    cursor,
    status: done ? 'completed' : 'sending',
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });

  if (done && typeof data.requestId === 'string' && data.requestId) {
    await db.doc(`adminAuditEvents/push_${data.requestId}`).set({
      status: 'completed',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    campaignId: document.id,
    cursor,
    processed,
    status: done ? 'completed' : 'sending',
  };
}

async function deliverAdminPushNotification({
  actorUid,
  body,
  db,
  fieldValue,
  fetchImpl = fetch,
  recipientUid,
  requestId,
  route = '',
  title,
}) {
  if (typeof recipientUid !== 'string' || !recipientUid) return { status: 'skipped' };
  if (typeof title !== 'string' || title.length < 2 || typeof body !== 'string' || body.length < 2) {
    return { status: 'skipped' };
  }

  const [feature, devices] = await Promise.all([
    db.doc('appConfig/socialFeatures').get(),
    db.collection(`pushDevices/${recipientUid}/tokens`).where('active', '==', true).limit(MAX_PUSH_DEVICES).get(),
  ]);
  if (feature.data()?.pushNotifications !== true) return { status: 'disabled' };

  const deviceDocuments = devices.docs.filter((document) => typeof document.data()?.token === 'string');
  const deliveryId = createNotificationDeliveryId(actorUid, requestId);
  const deliveryRef = db.doc(`notificationDeliveries/${deliveryId}`);
  const timestamp = fieldValue.serverTimestamp();
  const content = {
    actorUid,
    body,
    kind: 'admin-announcement',
    route: route || undefined,
    title,
  };

  try {
    await deliveryRef.create({
      actorUid,
      category: 'admin',
      createdAt: timestamp,
      deviceCount: deviceDocuments.length,
      kind: 'admin-announcement',
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
        data: {
          actorUid: content.actorUid,
          kind: content.kind,
          ...(content.route ? { route: content.route } : {}),
          targetUid: content.actorUid,
        },
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
      if (ticket?.details?.error === 'DeviceNotRegistered' && deviceDocuments[index]) {
        invalidDeviceRefs.push(deviceDocuments[index].ref);
      }
    });

    if (invalidDeviceRefs.length) {
      const batch = db.batch();
      invalidDeviceRefs.forEach((ref) => batch.update(ref, {
        active: false,
        disabledReason: 'DeviceNotRegistered',
        updatedAt: timestamp,
      }));
      await batch.commit();
    }

    await deliveryRef.update({
      acceptedCount,
      invalidDeviceCount: invalidDeviceRefs.length,
      status: 'submitted',
      ticketTargets,
      updatedAt: timestamp,
    });
    return { acceptedCount, status: 'submitted' };
  } catch (error) {
    await deliveryRef.update({
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : 'Push delivery failed.',
      status: 'failed',
      updatedAt: timestamp,
    });
    return { status: 'failed' };
  }
}

function mapAdminPushCampaign(id, data = {}) {
  return {
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    audience: {
      roles: Array.isArray(data.audience?.roles) ? data.audience.roles.filter((role) => typeof role === 'string') : [],
      uidCount: Number.isSafeInteger(data.audience?.uidCount) ? data.audience.uidCount : 0,
    },
    body: typeof data.body === 'string' ? data.body : '',
    breakdown: {
      admins: Number.isSafeInteger(data.breakdown?.admins) ? data.breakdown.admins : 0,
      representatives: Number.isSafeInteger(data.breakdown?.representatives) ? data.breakdown.representatives : 0,
      'room-owners': Number.isSafeInteger(data.breakdown?.['room-owners']) ? data.breakdown['room-owners'] : 0,
      staff: Number.isSafeInteger(data.breakdown?.staff) ? data.breakdown.staff : 0,
      uids: Number.isSafeInteger(data.breakdown?.uids) ? data.breakdown.uids : 0,
    },
    campaignId: id,
    counts: {
      failed: Number.isSafeInteger(data.counts?.failed) ? data.counts.failed : 0,
      noDevices: Number.isSafeInteger(data.counts?.noDevices) ? data.counts.noDevices : 0,
      skipped: Number.isSafeInteger(data.counts?.skipped) ? data.counts.skipped : 0,
      submitted: Number.isSafeInteger(data.counts?.submitted) ? data.counts.submitted : 0,
      targeted: Number.isSafeInteger(data.counts?.targeted) ? data.counts.targeted : 0,
    },
    createdAt: readTimestampIso(data.createdAt),
    cursor: Number.isSafeInteger(data.cursor) ? data.cursor : 0,
    reason: typeof data.reason === 'string' ? data.reason : '',
    requestId: typeof data.requestId === 'string' ? data.requestId : id,
    route: typeof data.route === 'string' ? data.route : '',
    status: typeof data.status === 'string' ? data.status : 'queued',
    title: typeof data.title === 'string' ? data.title : '',
    truncated: data.truncated === true,
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS';
}

function readTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString();
  }
  return '';
}

module.exports = {
  ADMIN_PUSH_BATCH_SIZE,
  ADMIN_PUSH_CAMPAIGN_LIST_LIMIT,
  EXPO_PUSH_ENDPOINT,
  createAdminPushCampaign,
  deliverAdminPushNotification,
  estimateAdminPushAudience,
  listAdminPushCampaigns,
  mapAdminPushCampaign,
  normalizeAdminPushEstimateInput,
  normalizeAdminPushSendInput,
  processAdminPushCampaigns,
};
