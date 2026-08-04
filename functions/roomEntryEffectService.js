const { mapStoreCatalogItem } = require('./storeCore');
const {
  buildEntryEffectFingerprint,
  createEntryEffectEventId,
  EFFECT_RETENTION_MS,
  entryEffectError,
  normalizeRoomEntryEffectBody,
  resolveEntryEffectAnnouncement,
  timestampToMillis,
  validateRoomEntryEffectRequest,
} = require('./roomEntryEffectCore');
const {
  ROOM_ENTRY_EFFECT_RATE_LIMIT,
  ROOM_ENTRY_EFFECT_RATE_WINDOW_MS,
  resolveSlidingWindowRateLimit,
} = require('./voiceRoomRateLimitCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeRoomEntryEffectCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomEntryEffectRequest(normalizeRoomEntryEffectBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildEntryEffectFingerprint(decodedToken.uid, command);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('entryEffectRequests').doc(command.requestId);
    const claimRef = roomRef.collection('entryEffectClaims').doc(`${decodedToken.uid}_${command.sessionId}`);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const cosmeticsFeatureRef = db.doc('appConfig/cosmeticsFeatures');
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const presenceRef = roomRef.collection('presence').doc(decodedToken.uid);
    const publicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const equipmentRef = db.doc(`storeEquipment/${decodedToken.uid}`);
    const rateLimitRef = roomRef.collection('entryEffectRateLimits').doc(decodedToken.uid);

    const [
      requestSnapshot,
      claimSnapshot,
      featureSnapshot,
      cosmeticsFeatureSnapshot,
      roomSnapshot,
      memberSnapshot,
      presenceSnapshot,
      publicSnapshot,
      equipmentSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(claimRef),
      transaction.get(featureRef),
      transaction.get(cosmeticsFeatureRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(presenceRef),
      transaction.get(publicRef),
      transaction.get(equipmentRef),
      transaction.get(rateLimitRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return entryEffectError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    if (claimSnapshot.exists) {
      const previous = claimSnapshot.data();
      const response = {
        ok: true,
        result: {
          action: 'announce-entry-effect',
          announced: previous.announced === true,
          eventId: previous.eventId || null,
          reason: previous.reason || 'ALREADY_ANNOUNCED',
          requestId: command.requestId,
          roomId: command.roomId,
          sessionId: command.sessionId,
          skipped: previous.announced !== true,
        },
      };
      return { ...response, replayed: true };
    }

    const membership = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    const presence = presenceSnapshot.exists ? presenceSnapshot.data() : undefined;
    if (!membership || membership.uid !== decodedToken.uid || membership.status !== 'active') {
      return entryEffectError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
    }
    if (!presence || presence.uid !== decodedToken.uid || presence.sessionId !== command.sessionId) {
      return entryEffectError('SESSION_MISMATCH', 409, 'Entry effects require the current presence session.');
    }

    const nowMs = clock.nowMillis();
    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_ENTRY_EFFECT_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_ENTRY_EFFECT_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) return rateLimit;

    const equipment = equipmentSnapshot.exists ? equipmentSnapshot.data() : undefined;
    const equippedCarId = typeof equipment?.slots?.cars === 'string' ? equipment.slots.cars.trim() : '';
    let ownershipSnapshot;
    let catalogSnapshot;
    if (equippedCarId) {
      [ownershipSnapshot, catalogSnapshot] = await Promise.all([
        transaction.get(db.doc(`storeOwnerships/${decodedToken.uid}/items/${equippedCarId}`)),
        transaction.get(db.doc(`storeCatalog/${equippedCarId}`)),
      ]);
    }

    const catalogData = catalogSnapshot?.exists ? catalogSnapshot.data() : undefined;
    const catalogItem = catalogData ? mapStoreCatalogItem(catalogData, equippedCarId) : undefined;
    const presentationRecords = catalogItem?.entryPresentation?.animationEnabled
      ? await loadEntryPresentationRecords(transaction, db, catalogItem.entryPresentation)
      : undefined;
    const resolution = resolveEntryEffectAnnouncement({
      catalogData,
      catalogItem,
      command,
      cosmeticsFlags: cosmeticsFeatureSnapshot.exists ? cosmeticsFeatureSnapshot.data() : undefined,
      equipment,
      featureFlags: featureSnapshot.exists ? featureSnapshot.data() : undefined,
      nowMs,
      ownership: ownershipSnapshot?.exists ? ownershipSnapshot.data() : undefined,
      presentationRecords,
      publicProfile: publicSnapshot.exists ? publicSnapshot.data() : undefined,
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
      senderUid: decodedToken.uid,
    });
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + EFFECT_RETENTION_MS);
    const writeRateLimit = () => transaction.set(rateLimitRef, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      purgeAfter,
      uid: decodedToken.uid,
      updatedAt: timestamp,
      windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
    }, { merge: true });
    if (!resolution.ok) {
      writeRateLimit();
      return resolution;
    }

    if (resolution.value.skipped) {
      const response = {
        ok: true,
        result: {
          action: 'announce-entry-effect',
          announced: false,
          eventId: null,
          reason: resolution.value.reason,
          requestId: command.requestId,
          roomId: command.roomId,
          sessionId: command.sessionId,
          skipped: true,
        },
      };
      transaction.create(claimRef, {
        announced: false,
        createdAt: timestamp,
        reason: resolution.value.reason,
        purgeAfter,
        sessionId: command.sessionId,
        uid: decodedToken.uid,
      });
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId: command.sessionId,
      });
      writeRateLimit();
      return response;
    }

    const effect = resolution.value.effect;
    const eventRef = roomRef.collection('events').doc(effect.eventId);
    const response = {
      ok: true,
      result: {
        action: 'announce-entry-effect',
        announced: true,
        effect,
        eventId: effect.eventId,
        reason: 'ANNOUNCED',
        requestId: command.requestId,
        roomId: command.roomId,
        sessionId: command.sessionId,
        skipped: false,
      },
    };

    transaction.create(eventRef, {
      createdAt: timestamp,
      expiresAt: clock.timestampFromMillis(effect.expiresAtMs),
      kind: 'room-entry',
      payload: effect,
      priority: effect.priority,
      purgeAfter,
      roomId: command.roomId,
      sessionId: command.sessionId,
      status: 'ready',
      uid: decodedToken.uid,
    });
    transaction.create(claimRef, {
      announced: true,
      createdAt: timestamp,
      eventId: effect.eventId,
      itemId: effect.itemId,
      purgeAfter,
      sessionId: command.sessionId,
      uid: decodedToken.uid,
    });
    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      eventId: effect.eventId,
      fingerprint,
      purgeAfter,
      requestId: command.requestId,
      response,
      sessionId: command.sessionId,
    });
    writeRateLimit();
    return response;
  });
}

async function loadEntryPresentationRecords(transaction, db, presentation) {
  const references = [
    ['visual', presentation.visualAsset],
    ['fallback', presentation.fallbackAsset],
    ...(presentation.audioAsset ? [['audio', presentation.audioAsset]] : []),
  ];
  const records = {};
  for (const [key, reference] of references) {
    const [summary, version, approval] = await Promise.all([
      transaction.get(db.doc(`cosmeticAssets/${reference.assetId}`)),
      transaction.get(db.doc(`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`)),
      transaction.get(db.doc(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`)),
    ]);
    records[key] = {
      approval: approval.exists ? approval.data() : undefined,
      summary: summary.exists ? summary.data() : undefined,
      version: version.exists ? version.data() : undefined,
    };
  }
  const receipt = await transaction.get(
    db.doc(`entryPresentationApprovalReceipts/${presentation.physicalApprovalReceiptId}`),
  );
  records.physicalReceipt = receipt.exists ? receipt.data() : undefined;
  return records;
}

async function cleanupExpiredRoomEntryEffectRecords({
  clock = systemClock,
  db,
  limit = 300,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const collectionGroups = ['entryEffectRequests', 'entryEffectClaims', 'entryEffectRateLimits', 'events'];
  const documents = [];
  for (const collectionGroup of collectionGroups) {
    const remaining = Math.max(0, limit - documents.length);
    if (!remaining) break;
    const snapshot = await db.collectionGroup(collectionGroup)
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(remaining)
      .get();
    documents.push(...snapshot.docs);
  }
  if (!documents.length) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  for (const document of documents) batch.delete(document.ref);
  await batch.commit();
  return { deleted: documents.length, scanned: documents.length };
}

module.exports = {
  cleanupExpiredRoomEntryEffectRecords,
  createEntryEffectEventId,
  executeRoomEntryEffectCommand,
  timestampToMillis,
};
