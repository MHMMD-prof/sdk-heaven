const { mapStoreCatalogItem } = require('./storeCore');
const {
  buildEntryEffectFingerprint,
  createEntryEffectEventId,
  EFFECT_RETENTION_MS,
  entryEffectError,
  normalizeRoomEntryEffectBody,
  readCustomEntryProjection,
  resolveCoupleEntryEffect,
  resolveEntryEffectAnnouncement,
  timestampToMillis,
  validateRoomEntryEffectRequest,
} = require('./roomEntryEffectCore');
const {
  inspectActiveCouple,
  mapCoupleEffectOwnership,
  mapPublicCoupleEffectProjection,
} = require('./coupleEffectsCore');
const { readApprovedCoupleEffect } = require('./coupleEffectsService');
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
    const coupleMembershipRef = db.doc(`coupleMemberships/${decodedToken.uid}`);
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
      coupleMembershipSnapshot,
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
      transaction.get(coupleMembershipRef),
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
    const nowMs = clock.nowMillis();
    if (!membership || membership.uid !== decodedToken.uid || membership.status !== 'active') {
      return entryEffectError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
    }
    if (!isCurrentEntryPresence(presence, decodedToken.uid, command.sessionId, nowMs)) {
      return entryEffectError('SESSION_MISMATCH', 409, 'Entry effects require the current presence session.');
    }

    const pairCandidate = await readCoupleEntryCandidate({
      actorMembership: coupleMembershipSnapshot.data(),
      actorProfile: publicSnapshot.data(),
      actorUid: decodedToken.uid,
      command,
      cosmeticsFlags: cosmeticsFeatureSnapshot.data(),
      db,
      featureFlags: featureSnapshot.data(),
      nowMs,
      presence,
      room: roomSnapshot.data(),
      transaction,
    });
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + EFFECT_RETENTION_MS);
    if (pairCandidate?.eligible && pairCandidate.claimSnapshot.exists) {
      const previous = pairCandidate.claimSnapshot.data();
      if (
        previous.eventId === pairCandidate.effect.eventId
        && previous.relationshipId === pairCandidate.relationship.relationshipId
        && arraysEqual(previous.sessionIds, pairCandidate.sessionIds)
      ) {
        const response = buildPairResponse(command, pairCandidate.effect, 'COALESCED');
        transaction.create(claimRef, {
          announced: true,
          coalesced: true,
          createdAt: timestamp,
          eventId: pairCandidate.effect.eventId,
          itemId: pairCandidate.itemId,
          pairEntrance: true,
          purgeAfter,
          sessionId: command.sessionId,
          uid: decodedToken.uid,
        });
        transaction.create(requestRef, {
          action: command.action,
          actorUid: decodedToken.uid,
          createdAt: timestamp,
          eventId: pairCandidate.effect.eventId,
          fingerprint,
          pairEntrance: true,
          purgeAfter,
          requestId: command.requestId,
          response,
          sessionId: command.sessionId,
        });
        return { ...response, replayed: true };
      }
    }
    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_ENTRY_EFFECT_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_ENTRY_EFFECT_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) return rateLimit;

    const equipment = equipmentSnapshot.exists ? equipmentSnapshot.data() : undefined;
    const cosmeticsFlags = cosmeticsFeatureSnapshot.exists
      ? cosmeticsFeatureSnapshot.data()
      : undefined;
    const customProjection = readCustomEntryProjection(equipment);
    const customEntryRecords = customProjection && cosmeticsFlags?.cosmetics_custom_rendering === true
      ? await loadCustomEntryRecords(transaction, db, decodedToken.uid, customProjection)
      : undefined;
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
      cosmeticsFlags,
      customEntryRecords,
      equipment,
      featureFlags: featureSnapshot.exists ? featureSnapshot.data() : undefined,
      nowMs,
      ownership: ownershipSnapshot?.exists ? ownershipSnapshot.data() : undefined,
      presentationRecords,
      publicProfile: publicSnapshot.exists ? publicSnapshot.data() : undefined,
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
      senderUid: decodedToken.uid,
    });
    const writeRateLimit = () => transaction.set(rateLimitRef, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      purgeAfter,
      uid: decodedToken.uid,
      updatedAt: timestamp,
      windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
    }, { merge: true });
    if (
      !resolution.ok
      && (!pairCandidate?.eligible || pairCandidate.claimSnapshot.exists)
    ) {
      writeRateLimit();
      return resolution;
    }

    if (pairCandidate?.eligible && !pairCandidate.claimSnapshot.exists) {
      const effect = pairCandidate.effect;
      const eventRef = roomRef.collection('events').doc(effect.eventId);
      const response = buildPairResponse(command, effect, 'ANNOUNCED_PAIR');
      transaction.create(eventRef, {
        createdAt: timestamp,
        expiresAt: clock.timestampFromMillis(effect.expiresAtMs),
        kind: 'room-entry',
        payload: effect,
        priority: effect.priority,
        purgeAfter,
        roomId: command.roomId,
        status: 'ready',
      });
      transaction.create(pairCandidate.claimRef, {
        createdAt: timestamp,
        eventId: effect.eventId,
        memberUids: effect.memberUids,
        purgeAfter,
        relationshipId: pairCandidate.relationship.relationshipId,
        roomId: command.roomId,
        sessionIds: pairCandidate.sessionIds,
      });
      transaction.create(claimRef, {
        announced: true,
        createdAt: timestamp,
        eventId: effect.eventId,
        itemId: pairCandidate.itemId,
        pairEntrance: true,
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
        pairEntrance: true,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId: command.sessionId,
      });
      writeRateLimit();
      return response;
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

async function readCoupleEntryCandidate({
  actorMembership,
  actorProfile,
  actorUid,
  command,
  cosmeticsFlags,
  db,
  featureFlags,
  nowMs,
  presence,
  room,
  transaction,
}) {
  if (
    cosmeticsFlags?.cosmetics_couple_entrances !== true
    || cosmeticsFlags?.cosmetics_couple_effects !== true
  ) return undefined;
  const coupleId = readString(actorMembership?.coupleId);
  const partnerUid = readString(actorMembership?.partnerUid);
  if (!coupleId || !partnerUid || partnerUid === actorUid) return undefined;
  const [
    coupleSnapshot,
    partnerMembershipSnapshot,
    partnerProfileSnapshot,
    partnerMemberSnapshot,
    partnerPresenceSnapshot,
  ] = await Promise.all([
    transaction.get(db.doc(`couples/${coupleId}`)),
    transaction.get(db.doc(`coupleMemberships/${partnerUid}`)),
    transaction.get(db.doc(`publicProfiles/${partnerUid}`)),
    transaction.get(db.doc(`rooms/${command.roomId}/members/${partnerUid}`)),
    transaction.get(db.doc(`rooms/${command.roomId}/presence/${partnerUid}`)),
  ]);
  const relationship = inspectActiveCouple({
    actorMembership,
    actorProfile,
    actorUid,
    couple: coupleSnapshot.data(),
    coupleId,
    partnerMembership: partnerMembershipSnapshot.data(),
    partnerProfile: partnerProfileSnapshot.data(),
  });
  const partnerMember = partnerMemberSnapshot.data();
  const partnerPresence = partnerPresenceSnapshot.data();
  if (
    !relationship.ok
    || partnerMember?.uid !== partnerUid
    || partnerMember?.status !== 'active'
    || partnerPresence?.uid !== partnerUid
  ) return undefined;
  const equipmentRef = db.doc(`coupleEffectEquipment/${relationship.value.relationshipId}`);
  const equipmentSnapshot = await transaction.get(equipmentRef);
  const equipment = equipmentSnapshot.data();
  const itemId = readString(equipment?.itemId);
  if (!itemId) return undefined;
  const [ownershipSnapshot, catalogSnapshot] = await Promise.all([
    transaction.get(db.doc(`coupleEffectOwnerships/${relationship.value.relationshipId}/items/${itemId}`)),
    transaction.get(db.doc(`storeCatalog/${itemId}`)),
  ]);
  const ownership = ownershipSnapshot.exists
    ? mapCoupleEffectOwnership(ownershipSnapshot.data(), itemId)
    : undefined;
  const item = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
  if (
    !ownership
    || !item
    || item.category !== 'couple-effects'
    || item.availability === 'disabled'
  ) return undefined;
  const approved = await readApprovedCoupleEffect({ db, item, transaction });
  if (!approved.ok) return undefined;
  const actorProjection = mapPublicCoupleEffectProjection(actorProfile?.coupleEffect);
  const partnerProfile = partnerProfileSnapshot.data();
  const partnerProjection = mapPublicCoupleEffectProjection(partnerProfile?.coupleEffect);
  if (
    !actorProjection
    || !partnerProjection
    || !projectionsEqual(actorProjection, equipment?.projection)
    || !projectionsEqual(partnerProjection, equipment?.projection)
  ) return undefined;
  const resolution = resolveCoupleEntryEffect({
    approvedDescriptor: approved.descriptor,
    command,
    cosmeticsFlags,
    equipment,
    featureFlags,
    memberProfiles: [
      { ...actorProfile, coupleEffect: actorProjection },
      { ...partnerProfile, coupleEffect: partnerProjection },
    ],
    memberUids: relationship.value.memberUids,
    nowMs,
    ownership,
    partnerPresence,
    presence,
    relationship: relationship.value,
    room,
  });
  if (!resolution.eligible) return undefined;
  const claimRef = db.doc(`rooms/${command.roomId}/coupleEntryClaims/${resolution.effect.eventId}`);
  const claimSnapshot = await transaction.get(claimRef);
  return {
    ...resolution,
    claimRef,
    claimSnapshot,
    itemId,
    relationship: relationship.value,
  };
}

function buildPairResponse(command, effect, reason) {
  return {
    ok: true,
    result: {
      action: 'announce-entry-effect',
      announced: true,
      effect,
      eventId: effect.eventId,
      pairEntrance: true,
      reason,
      requestId: command.requestId,
      roomId: command.roomId,
      sessionId: command.sessionId,
      skipped: false,
    },
  };
}

function projectionsEqual(left, right) {
  if (!left || !right) return false;
  const keys = [
    'assetId', 'assetVersionId', 'borderMode', 'coupleIdHash', 'entranceMode',
    'fallbackAssetId', 'fallbackAssetVersionId', 'format', 'itemId', 'profileMode',
  ];
  return keys.every((key) => left[key] === right[key]);
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isCurrentEntryPresence(presence, uid, sessionId, nowMs) {
  const joinedAtMs = timestampToMillis(presence?.joinedAt);
  const leaseExpiresAtMs = timestampToMillis(presence?.leaseExpiresAt);
  return Boolean(
    presence
    && presence.uid === uid
    && presence.sessionId === sessionId
    && ['online', 'reconnecting'].includes(presence.status)
    && joinedAtMs > 0
    && joinedAtMs <= nowMs
    && leaseExpiresAtMs > nowMs
  );
}

async function loadCustomEntryRecords(transaction, db, uid, projection) {
  const [ownership, summary, version, approval] = await Promise.all([
    transaction.get(db.doc(`cosmeticCustomOwnerships/${uid}/items/${projection.assetId}`)),
    transaction.get(db.doc(`cosmeticAssets/${projection.assetId}`)),
    transaction.get(db.doc(`cosmeticAssets/${projection.assetId}/versions/${projection.assetVersionId}`)),
    transaction.get(db.doc(
      `cosmeticAssetApprovals/${projection.assetId}__${projection.assetVersionId}`,
    )),
  ]);
  const versionData = version.exists ? version.data() : undefined;
  const fallbackAssetId = typeof versionData?.fallbackAssetId === 'string'
    ? versionData.fallbackAssetId.trim()
    : '';
  const fallbackAssetVersionId = typeof versionData?.fallbackAssetVersionId === 'string'
    ? versionData.fallbackAssetVersionId.trim()
    : '';
  let fallback;
  if (
    /^[a-z0-9][a-z0-9_-]{2,79}$/.test(fallbackAssetId)
    && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(fallbackAssetVersionId)
  ) {
    const [fallbackSummary, fallbackVersion, fallbackApproval] = await Promise.all([
      transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}`)),
      transaction.get(db.doc(`cosmeticAssets/${fallbackAssetId}/versions/${fallbackAssetVersionId}`)),
      transaction.get(db.doc(`cosmeticAssetApprovals/${fallbackAssetId}__${fallbackAssetVersionId}`)),
    ]);
    fallback = {
      approval: fallbackApproval.exists ? fallbackApproval.data() : undefined,
      summary: fallbackSummary.exists ? fallbackSummary.data() : undefined,
      version: fallbackVersion.exists ? fallbackVersion.data() : undefined,
    };
  }
  return {
    approval: approval.exists ? approval.data() : undefined,
    fallback,
    ownership: ownership.exists ? ownership.data() : undefined,
    summary: summary.exists ? summary.data() : undefined,
    version: versionData,
  };
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
  const collectionGroups = [
    'entryEffectRequests',
    'entryEffectClaims',
    'coupleEntryClaims',
    'entryEffectRateLimits',
    'events',
  ];
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
