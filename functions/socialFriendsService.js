const { filterVisibleDiscoveryProfiles, mapDiscoveryProfile } = require('./socialDiscoveryCore');
const {
  FRIEND_MUTATION_ACTIONS,
  createFriendshipId,
  normalizeFriendTargetInput,
  otherMemberUid,
  resolveFriendRelationship,
} = require('./socialFriendsCore');
const { inspectPublicProfile } = require('./socialProfileCore');

const FRIEND_LIST_LIMIT = 50;
const FRIEND_MUTATION_WINDOW_LIMIT = 20;
const FRIEND_MUTATION_WINDOW_MS = 60_000;

async function getFriendshipStatus({ db, input, uid }) {
  const validation = normalizeFriendTargetInput(input, uid);

  if (!validation.ok) {
    return { errorCode: validation.code };
  }

  const targetUid = validation.value.targetUid;
  const pairId = createFriendshipId(uid, targetUid);
  const refs = [
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`publicProfiles/${targetUid}`),
    db.doc(`friendships/${pairId}`),
    db.doc(`friendRequests/${pairId}`),
    db.doc(`blocks/${uid}/blocked/${targetUid}`),
    db.doc(`blocks/${targetUid}/blocked/${uid}`),
  ];
  const [feature, requester, target, friendship, request, blockedByRequester, blockedByTarget] = await db.getAll(...refs);

  if (feature.data()?.friends !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const readiness = await validateProfilePair(db, requester, target, uid, targetUid);

  if (readiness.errorCode) {
    return readiness;
  }

  if (blockedByRequester.exists || blockedByTarget.exists) {
    return { errorCode: 'PERMISSION_DENIED' };
  }

  return {
    result: {
      status: resolveFriendRelationship({
        friendship: friendship.exists ? friendship.data() : undefined,
        request: request.exists ? request.data() : undefined,
        requestingUid: uid,
      }),
    },
  };
}

async function getFriendsOverview({ db, input, uid }) {
  if (input !== undefined) {
    return { errorCode: 'INVALID_REQUEST' };
  }

  const [feature, requester] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
  );

  if (feature.data()?.friends !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const requesterProfile = requester.exists ? requester.data() : undefined;
  const requesterReservation = requesterProfile?.publicId
    ? await db.doc(`publicIds/${requesterProfile.publicId}`).get()
    : undefined;

  if (!inspectPublicProfile(
    requesterProfile,
    requesterReservation?.exists ? requesterReservation.data() : undefined,
    uid,
  ).ok) {
    return { errorCode: 'PROFILE_INCOMPLETE' };
  }

  if (requesterProfile.moderationStatus !== 'active') {
    return { errorCode: 'PERMISSION_DENIED' };
  }

  const [friendships, incomingRequests, outgoingRequests] = await Promise.all([
    db.collection('friendships')
      .where('memberUids', 'array-contains', uid)
      .orderBy('updatedAt', 'desc')
      .limit(FRIEND_LIST_LIMIT)
      .get(),
    db.collection('friendRequests')
      .where('recipientUid', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('updatedAt', 'desc')
      .limit(FRIEND_LIST_LIMIT)
      .get(),
    db.collection('friendRequests')
      .where('senderUid', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('updatedAt', 'desc')
      .limit(FRIEND_LIST_LIMIT)
      .get(),
  ]);

  const rows = [
    ...friendships.docs.map((document) => ({
      createdAt: document.data().createdAt,
      kind: 'friends',
      targetUid: otherMemberUid(document.data().memberUids, uid),
    })),
    ...incomingRequests.docs.map((document) => ({
      createdAt: document.data().createdAt,
      kind: 'incoming',
      targetUid: document.data().senderUid,
    })),
    ...outgoingRequests.docs.map((document) => ({
      createdAt: document.data().createdAt,
      kind: 'outgoing',
      targetUid: document.data().recipientUid,
    })),
  ].filter((row) => typeof row.targetUid === 'string' && row.targetUid !== uid);

  if (rows.length === 0) {
    return { result: { friends: [], incoming: [], outgoing: [] } };
  }

  const targetUids = [...new Set(rows.map((row) => row.targetUid))];
  const profileSnapshots = await db.getAll(...targetUids.map((targetUid) => db.doc(`publicProfiles/${targetUid}`)));
  const profiles = new Map(profileSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data()]));
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

    if (blocked) {
      blockedUids.add(targetUid);
    }

    if (
      profile.moderationStatus === 'active'
      && inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, targetUid).ok
    ) {
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
  const result = { friends: [], incoming: [], outgoing: [] };

  for (const row of rows) {
    const profile = visibleByUid.get(row.targetUid);

    if (profile) {
      result[row.kind].push({ createdAt: row.createdAt, profile });
    }
  }

  return { result };
}

async function mutateFriendship({ action, db, fieldValue, input, requestId, uid }) {
  if (!FRIEND_MUTATION_ACTIONS.includes(action)) {
    return { errorCode: 'INVALID_REQUEST' };
  }

  const validation = normalizeFriendTargetInput(input, uid);

  if (!validation.ok) {
    return { errorCode: validation.code };
  }

  const targetUid = validation.value.targetUid;
  const pairId = createFriendshipId(uid, targetUid);

  return db.runTransaction(async (transaction) => {
    const refs = {
      actorProfile: db.doc(`publicProfiles/${uid}`),
      actorReservation: undefined,
      blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/socialFeatures'),
      friendship: db.doc(`friendships/${pairId}`),
      request: db.doc(`friendRequests/${pairId}`),
      rate: db.doc(`socialFriendRateLimits/${uid}`),
      targetProfile: db.doc(`publicProfiles/${targetUid}`),
      targetReservation: undefined,
    };
    const [feature, actorProfile, targetProfile, friendship, request, blockedByActor, blockedByTarget, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.friendship),
      transaction.get(refs.request),
      transaction.get(refs.blockedByActor),
      transaction.get(refs.blockedByTarget),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === action && previous.targetUid === targetUid && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }

    if (feature.data()?.friends !== true) {
      return { errorCode: 'FEATURE_DISABLED' };
    }

    const nowMs = Date.now();
    const rateData = rate.exists ? rate.data() : {};
    const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
    const insideWindow = Number.isFinite(windowStartedAtMs)
      && nowMs - windowStartedAtMs < FRIEND_MUTATION_WINDOW_MS;
    const mutationCount = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;

    if (mutationCount >= FRIEND_MUTATION_WINDOW_LIMIT) {
      return { errorCode: 'RATE_LIMITED' };
    }

    const actor = actorProfile.exists ? actorProfile.data() : undefined;
    const target = targetProfile.exists ? targetProfile.data() : undefined;
    refs.actorReservation = actor?.publicId ? db.doc(`publicIds/${actor.publicId}`) : undefined;
    refs.targetReservation = target?.publicId ? db.doc(`publicIds/${target.publicId}`) : undefined;
    const [actorReservation, targetReservation] = await Promise.all([
      refs.actorReservation ? transaction.get(refs.actorReservation) : undefined,
      refs.targetReservation ? transaction.get(refs.targetReservation) : undefined,
    ]);

    if (!inspectPublicProfile(actor, actorReservation?.exists ? actorReservation.data() : undefined, uid).ok) {
      return { errorCode: 'PROFILE_INCOMPLETE' };
    }

    if (!inspectPublicProfile(target, targetReservation?.exists ? targetReservation.data() : undefined, targetUid).ok) {
      return { errorCode: 'NOT_FOUND' };
    }

    if (actor.moderationStatus !== 'active' || target.moderationStatus !== 'active') {
      return { errorCode: 'PERMISSION_DENIED' };
    }

    if (blockedByActor.exists || blockedByTarget.exists) {
      return { errorCode: 'PERMISSION_DENIED' };
    }

    const friendshipData = friendship.exists ? friendship.data() : undefined;
    const requestData = request.exists ? request.data() : undefined;
    const currentStatus = resolveFriendRelationship({ friendship: friendshipData, request: requestData, requestingUid: uid });
    const timestamp = fieldValue.serverTimestamp();
    let result;
    let notification = {};

    if (action === 'send-friend-request') {
      if (currentStatus === 'friends') {
        result = { status: 'friends' };
      } else if (currentStatus === 'outgoing') {
        result = { status: 'outgoing' };
      } else if (currentStatus === 'incoming') {
        return { errorCode: 'CONFLICT' };
      } else {
        transaction.create(refs.request, {
          createdAt: timestamp,
          memberUids: [uid, targetUid].sort(),
          recipientUid: targetUid,
          senderUid: uid,
          status: 'pending',
          updatedAt: timestamp,
        });
        notification = { notificationKind: 'friend-request', notificationRecipientUid: targetUid };
        result = { status: 'outgoing' };
      }
    } else if (action === 'accept-friend-request') {
      if (currentStatus === 'friends') {
        result = { status: 'friends' };
      } else if (currentStatus !== 'incoming') {
        return { errorCode: 'NOT_FOUND' };
      } else {
        transaction.create(refs.friendship, {
          createdAt: timestamp,
          memberUids: [uid, targetUid].sort(),
          updatedAt: timestamp,
        });
        transaction.delete(refs.request);
        transaction.update(refs.actorProfile, {
          friendCount: actor.friendCount + 1,
          updatedAt: timestamp,
        });
        transaction.update(refs.targetProfile, {
          friendCount: target.friendCount + 1,
          updatedAt: timestamp,
        });
        notification = { notificationKind: 'friend-accepted', notificationRecipientUid: targetUid };
        result = { status: 'friends' };
      }
    } else if (action === 'decline-friend-request') {
      if (currentStatus === 'incoming') {
        transaction.delete(refs.request);
      }
      result = { status: 'none' };
    } else if (action === 'cancel-friend-request') {
      if (currentStatus === 'outgoing') {
        transaction.delete(refs.request);
      }
      result = { status: 'none' };
    } else {
      if (currentStatus === 'friends') {
        transaction.delete(refs.friendship);
        transaction.update(refs.actorProfile, {
          friendCount: Math.max(0, actor.friendCount - 1),
          updatedAt: timestamp,
        });
        transaction.update(refs.targetProfile, {
          friendCount: Math.max(0, target.friendCount - 1),
          updatedAt: timestamp,
        });
      }
      result = { status: 'none' };
    }

    transaction.create(refs.command, {
      action,
      createdAt: timestamp,
      requestId,
      result,
      targetUid,
      uid,
      ...notification,
    });
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
  const reservationRefs = [requester, target]
    .map((profile) => profile?.publicId)
    .filter(Boolean)
    .map((publicId) => db.doc(`publicIds/${publicId}`));
  const reservations = reservationRefs.length ? await db.getAll(...reservationRefs) : [];
  const byPath = new Map(reservations.map((snapshot) => [snapshot.ref.path, snapshot]));
  const requesterReservation = requester?.publicId ? byPath.get(`publicIds/${requester.publicId}`) : undefined;
  const targetReservation = target?.publicId ? byPath.get(`publicIds/${target.publicId}`) : undefined;

  if (!inspectPublicProfile(
    requester,
    requesterReservation?.exists ? requesterReservation.data() : undefined,
    requesterUid,
  ).ok) {
    return { errorCode: 'PROFILE_INCOMPLETE' };
  }

  if (!inspectPublicProfile(
    target,
    targetReservation?.exists ? targetReservation.data() : undefined,
    targetUid,
  ).ok) {
    return { errorCode: 'NOT_FOUND' };
  }

  if (requester.moderationStatus !== 'active' || target.moderationStatus !== 'active') {
    return { errorCode: 'PERMISSION_DENIED' };
  }

  return { requester, target };
}

module.exports = {
  FRIEND_LIST_LIMIT,
  FRIEND_MUTATION_WINDOW_LIMIT,
  getFriendsOverview,
  getFriendshipStatus,
  mutateFriendship,
};
