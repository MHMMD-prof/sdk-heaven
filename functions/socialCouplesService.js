const { filterVisibleDiscoveryProfiles, mapDiscoveryProfile } = require('./socialDiscoveryCore');
const {
  COUPLE_MUTATION_ACTIONS,
  createCoupleId,
  normalizeCoupleTargetInput,
  resolveCoupleRelationship,
} = require('./socialCouplesCore');
const { createRelationshipId } = require('./coupleEffectsCore');
const { applyDissolutionClear, prepareDissolutionClear } = require('./coupleEffectsService');
const { inspectPublicProfile } = require('./socialProfileCore');

const COUPLE_REQUEST_LIMIT = 20;
const COUPLE_MUTATION_WINDOW_LIMIT = 10;
const COUPLE_MUTATION_WINDOW_MS = 60_000;

async function getCoupleStatus({ db, input, uid }) {
  const validation = normalizeCoupleTargetInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };

  const targetUid = validation.value.targetUid;
  const pairId = createCoupleId(uid, targetUid);
  const [feature, requester, target, couple, request, requesterMembership, targetMembership, blockedByRequester, blockedByTarget] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`publicProfiles/${targetUid}`),
    db.doc(`couples/${pairId}`),
    db.doc(`coupleRequests/${pairId}`),
    db.doc(`coupleMemberships/${uid}`),
    db.doc(`coupleMemberships/${targetUid}`),
    db.doc(`blocks/${uid}/blocked/${targetUid}`),
    db.doc(`blocks/${targetUid}/blocked/${uid}`),
  );

  if (feature.data()?.couples !== true) return { errorCode: 'FEATURE_DISABLED' };
  const readiness = await validateProfilePair(db, requester, target, uid, targetUid);
  if (readiness.errorCode) return readiness;
  if (blockedByRequester.exists || blockedByTarget.exists) return { errorCode: 'PERMISSION_DENIED' };

  const status = resolveCoupleRelationship({
    couple: couple.exists ? couple.data() : undefined,
    request: request.exists ? request.data() : undefined,
    requestingUid: uid,
  });
  const unavailable = status === 'none' && (requesterMembership.exists || targetMembership.exists);
  return { result: { status, unavailable } };
}

async function getCoupleOverview({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };

  const [feature, requester, membership] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`coupleMemberships/${uid}`),
  );

  if (feature.data()?.couples !== true) return { errorCode: 'FEATURE_DISABLED' };
  const requesterProfile = requester.exists ? requester.data() : undefined;
  const requesterReservation = requesterProfile?.publicId
    ? await db.doc(`publicIds/${requesterProfile.publicId}`).get()
    : undefined;

  if (!inspectPublicProfile(requesterProfile, requesterReservation?.exists ? requesterReservation.data() : undefined, uid).ok) {
    return { errorCode: 'PROFILE_INCOMPLETE' };
  }
  if (requesterProfile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };

  const [incomingRequests, outgoingRequests] = await Promise.all([
    db.collection('coupleRequests')
      .where('recipientUid', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('updatedAt', 'desc')
      .limit(COUPLE_REQUEST_LIMIT)
      .get(),
    db.collection('coupleRequests')
      .where('senderUid', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('updatedAt', 'desc')
      .limit(COUPLE_REQUEST_LIMIT)
      .get(),
  ]);

  const rows = [
    ...incomingRequests.docs.map((document) => ({ createdAt: document.data().createdAt, kind: 'incoming', targetUid: document.data().senderUid })),
    ...outgoingRequests.docs.map((document) => ({ createdAt: document.data().createdAt, kind: 'outgoing', targetUid: document.data().recipientUid })),
  ];

  const membershipData = membership.exists ? membership.data() : undefined;
  if (typeof membershipData?.partnerUid === 'string' && membershipData.partnerUid !== uid) {
    rows.unshift({ createdAt: membershipData.createdAt, kind: 'current', targetUid: membershipData.partnerUid });
  }

  const filteredRows = rows.filter((row) => typeof row.targetUid === 'string' && row.targetUid !== uid);
  if (filteredRows.length === 0) return { result: { incoming: [], outgoing: [] } };

  const targetUids = [...new Set(filteredRows.map((row) => row.targetUid))];
  const profileSnapshots = await db.getAll(...targetUids.map((targetUid) => db.doc(`publicProfiles/${targetUid}`)));
  const profiles = new Map(profileSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  const validTargetUids = targetUids.filter((targetUid) => profiles.get(targetUid)?.publicId);
  const relatedRefs = [];

  for (const targetUid of validTargetUids) {
    relatedRefs.push(db.doc(`publicIds/${profiles.get(targetUid).publicId}`));
    relatedRefs.push(db.doc(`blocks/${uid}/blocked/${targetUid}`));
    relatedRefs.push(db.doc(`blocks/${targetUid}/blocked/${uid}`));
  }

  const relatedSnapshots = relatedRefs.length ? await db.getAll(...relatedRefs) : [];
  const relatedByPath = new Map(relatedSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
  const blockedUids = new Set();
  const visibleProfiles = [];

  for (const targetUid of validTargetUids) {
    const profile = profiles.get(targetUid);
    const reservation = relatedByPath.get(`publicIds/${profile.publicId}`);
    const blocked = relatedByPath.get(`blocks/${uid}/blocked/${targetUid}`)?.exists === true
      || relatedByPath.get(`blocks/${targetUid}/blocked/${uid}`)?.exists === true;
    if (blocked) blockedUids.add(targetUid);
    if (profile.moderationStatus === 'active' && inspectPublicProfile(profile, reservation?.data(), targetUid).ok) {
      visibleProfiles.push(mapDiscoveryProfile(profile));
    }
  }

  const visible = filterVisibleDiscoveryProfiles({
    blockedUids,
    limit: targetUids.length,
    profiles: visibleProfiles.filter(Boolean),
    requestingUid: uid,
  });
  const visibleByUid = new Map(visible.map((profile) => [profile.uid, profile]));
  const result = { incoming: [], outgoing: [] };

  for (const row of filteredRows) {
    const profile = visibleByUid.get(row.targetUid);
    if (!profile) continue;
    const summary = { createdAt: row.createdAt, profile };
    if (row.kind === 'current') result.current = summary;
    else result[row.kind].push(summary);
  }

  return { result };
}

async function mutateCouple({ action, db, fieldValue, input, requestId, uid }) {
  if (!COUPLE_MUTATION_ACTIONS.includes(action)) return { errorCode: 'INVALID_REQUEST' };
  const validation = normalizeCoupleTargetInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };

  const targetUid = validation.value.targetUid;
  const pairId = createCoupleId(uid, targetUid);

  return db.runTransaction(async (transaction) => {
    const refs = {
      actorProfile: db.doc(`publicProfiles/${uid}`),
      actorMembership: db.doc(`coupleMemberships/${uid}`),
      blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      couple: db.doc(`couples/${pairId}`),
      feature: db.doc('appConfig/socialFeatures'),
      rate: db.doc(`socialCoupleRateLimits/${uid}`),
      request: db.doc(`coupleRequests/${pairId}`),
      targetMembership: db.doc(`coupleMemberships/${targetUid}`),
      targetProfile: db.doc(`publicProfiles/${targetUid}`),
    };
    const [feature, actorProfile, targetProfile, couple, request, actorMembership, targetMembership, blockedByActor, blockedByTarget, command, rate] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.actorProfile), transaction.get(refs.targetProfile),
      transaction.get(refs.couple), transaction.get(refs.request), transaction.get(refs.actorMembership),
      transaction.get(refs.targetMembership), transaction.get(refs.blockedByActor), transaction.get(refs.blockedByTarget),
      transaction.get(refs.command), transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === action && previous.targetUid === targetUid && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.couples !== true) return { errorCode: 'FEATURE_DISABLED' };

    const nowMs = Date.now();
    const rateData = rate.exists ? rate.data() : {};
    const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
    const insideWindow = Number.isFinite(windowStartedAtMs) && nowMs - windowStartedAtMs < COUPLE_MUTATION_WINDOW_MS;
    const mutationCount = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;
    if (mutationCount >= COUPLE_MUTATION_WINDOW_LIMIT) return { errorCode: 'RATE_LIMITED' };

    const actor = actorProfile.exists ? actorProfile.data() : undefined;
    const target = targetProfile.exists ? targetProfile.data() : undefined;
    const [actorReservation, targetReservation] = await Promise.all([
      actor?.publicId ? transaction.get(db.doc(`publicIds/${actor.publicId}`)) : undefined,
      target?.publicId ? transaction.get(db.doc(`publicIds/${target.publicId}`)) : undefined,
    ]);
    if (!inspectPublicProfile(actor, actorReservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (!inspectPublicProfile(target, targetReservation?.data(), targetUid).ok) return { errorCode: 'NOT_FOUND' };
    if (actor.moderationStatus !== 'active' || target.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (blockedByActor.exists || blockedByTarget.exists) return { errorCode: 'PERMISSION_DENIED' };

    const currentStatus = resolveCoupleRelationship({
      couple: couple.exists ? couple.data() : undefined,
      request: request.exists ? request.data() : undefined,
      requestingUid: uid,
    });
    const timestamp = fieldValue.serverTimestamp();
    let result;
    let notification = {};

    if (action === 'send-couple-request') {
      if (currentStatus === 'coupled') result = { status: 'coupled' };
      else if (actorMembership.exists || targetMembership.exists) return { errorCode: 'CONFLICT' };
      else if (currentStatus === 'outgoing') result = { status: 'outgoing' };
      else if (currentStatus === 'incoming') return { errorCode: 'CONFLICT' };
      else {
        transaction.create(refs.request, {
          createdAt: timestamp,
          memberUids: [uid, targetUid].sort(),
          recipientUid: targetUid,
          senderUid: uid,
          status: 'pending',
          updatedAt: timestamp,
        });
        notification = { notificationKind: 'couple-request', notificationRecipientUid: targetUid };
        result = { status: 'outgoing' };
      }
    } else if (action === 'accept-couple-request') {
      if (currentStatus === 'coupled') result = { status: 'coupled' };
      else if (currentStatus !== 'incoming') return { errorCode: 'NOT_FOUND' };
      else if (actorMembership.exists || targetMembership.exists) return { errorCode: 'CONFLICT' };
      else {
        const memberUids = [uid, targetUid].sort();
        const relationshipId = createRelationshipId(pairId, requestId);
        transaction.create(refs.couple, { createdAt: timestamp, level: 1, memberUids, relationshipId, updatedAt: timestamp });
        transaction.create(refs.actorMembership, { coupleId: pairId, createdAt: timestamp, partnerUid: targetUid, relationshipId, uid, updatedAt: timestamp });
        transaction.create(refs.targetMembership, { coupleId: pairId, createdAt: timestamp, partnerUid: uid, relationshipId, uid: targetUid, updatedAt: timestamp });
        transaction.delete(refs.request);
        transaction.update(refs.actorProfile, { coupleLevel: 1, updatedAt: timestamp });
        transaction.update(refs.targetProfile, { coupleLevel: 1, updatedAt: timestamp });
        notification = { notificationKind: 'couple-accepted', notificationRecipientUid: targetUid };
        result = { status: 'coupled' };
      }
    } else if (action === 'decline-couple-request') {
      if (currentStatus === 'incoming') transaction.delete(refs.request);
      result = { status: 'none' };
    } else if (action === 'cancel-couple-request') {
      if (currentStatus === 'outgoing') transaction.delete(refs.request);
      result = { status: 'none' };
    } else {
      const membershipsMatch = actorMembership.data()?.coupleId === pairId && targetMembership.data()?.coupleId === pairId;
      if (currentStatus === 'coupled' && membershipsMatch) {
        const clearState = await prepareDissolutionClear({
          couple: couple.data(),
          coupleId: pairId,
          db,
          transaction,
        });
        applyDissolutionClear({
          auditActorUid: uid,
          auditReason: 'user-dissolution',
          clearState,
          coupleId: pairId,
          db,
          fieldValue,
          memberUids: [uid, targetUid].sort(),
          transaction,
        });
        transaction.delete(refs.couple);
        transaction.delete(refs.actorMembership);
        transaction.delete(refs.targetMembership);
        transaction.update(refs.actorProfile, { coupleLevel: 0, updatedAt: timestamp });
        transaction.update(refs.targetProfile, { coupleLevel: 0, updatedAt: timestamp });
      } else if (currentStatus === 'coupled') {
        return { errorCode: 'CONFLICT' };
      }
      result = { status: 'none' };
    }

    transaction.create(refs.command, { action, createdAt: timestamp, requestId, result, targetUid, uid, ...notification });
    transaction.set(refs.rate, {
      count: mutationCount + 1,
      lastMutationAt: timestamp,
      uid,
      windowStartedAt: insideWindow ? rateData.windowStartedAt : timestamp,
    });
    return { result };
  });
}

function readTimestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

async function validateProfilePair(db, requesterSnapshot, targetSnapshot, requesterUid, targetUid) {
  const requester = requesterSnapshot.exists ? requesterSnapshot.data() : undefined;
  const target = targetSnapshot.exists ? targetSnapshot.data() : undefined;
  const reservationRefs = [requester, target].map((profile) => profile?.publicId).filter(Boolean).map((publicId) => db.doc(`publicIds/${publicId}`));
  const reservations = reservationRefs.length ? await db.getAll(...reservationRefs) : [];
  const byPath = new Map(reservations.map((snapshot) => [snapshot.ref.path, snapshot]));
  if (!inspectPublicProfile(requester, byPath.get(`publicIds/${requester?.publicId}`)?.data(), requesterUid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
  if (!inspectPublicProfile(target, byPath.get(`publicIds/${target?.publicId}`)?.data(), targetUid).ok) return { errorCode: 'NOT_FOUND' };
  if (requester.moderationStatus !== 'active' || target.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
  return { requester, target };
}

module.exports = {
  COUPLE_MUTATION_WINDOW_LIMIT,
  COUPLE_REQUEST_LIMIT,
  getCoupleOverview,
  getCoupleStatus,
  mutateCouple,
};
