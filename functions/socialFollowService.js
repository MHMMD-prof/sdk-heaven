const { filterVisibleDiscoveryProfiles, mapDiscoveryProfile } = require('./socialDiscoveryCore');
const {
  FOLLOW_MUTATION_ACTIONS,
  normalizeFollowListInput,
  normalizeFollowTargetInput,
  readFollowCount,
  resolveFollowRelationship,
} = require('./socialFollowCore');
const { inspectPublicProfile } = require('./socialProfileCore');

const FOLLOW_LIST_LIMIT = 50;
const FOLLOW_MUTATION_WINDOW_LIMIT = 20;
const FOLLOW_MUTATION_WINDOW_MS = 60_000;
const BLOCKED_LIST_LIMIT = 50;

async function getFollowStatus({ db, input, uid }) {
  const validation = normalizeFollowTargetInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };

  const targetUid = validation.value.targetUid;
  const refs = [
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`publicProfiles/${targetUid}`),
    db.doc(`following/${uid}/items/${targetUid}`),
    db.doc(`followers/${uid}/items/${targetUid}`),
    db.doc(`blocks/${uid}/blocked/${targetUid}`),
    db.doc(`blocks/${targetUid}/blocked/${uid}`),
  ];
  const [feature, requester, target, followingEdge, followedByEdge, blockedByRequester, blockedByTarget] = await db.getAll(...refs);

  if (feature.data()?.following !== true) return { errorCode: 'FEATURE_DISABLED' };

  const readiness = await validateProfilePair(db, requester, target, uid, targetUid);
  if (readiness.errorCode) return readiness;

  if (blockedByRequester.exists || blockedByTarget.exists) {
    return { errorCode: 'PERMISSION_DENIED' };
  }

  return {
    result: resolveFollowRelationship({
      followedByEdge: followedByEdge.exists === true,
      followingEdge: followingEdge.exists === true,
    }),
  };
}

async function getFollowList({ db, input, kind, uid }) {
  const validation = normalizeFollowListInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };

  const subjectUid = validation.value.targetUid;
  const [feature, requester, subject] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
    db.doc(`publicProfiles/${subjectUid}`),
  );

  if (feature.data()?.following !== true) return { errorCode: 'FEATURE_DISABLED' };

  const readiness = await validateProfilePair(db, requester, subject, uid, subjectUid);
  if (readiness.errorCode) return readiness;

  if (subjectUid !== uid) {
    const [blockedByRequester, blockedBySubject] = await db.getAll(
      db.doc(`blocks/${uid}/blocked/${subjectUid}`),
      db.doc(`blocks/${subjectUid}/blocked/${uid}`),
    );
    if (blockedByRequester.exists || blockedBySubject.exists) {
      return { errorCode: 'PERMISSION_DENIED' };
    }
  }

  const collectionPath = kind === 'followers'
    ? `followers/${subjectUid}/items`
    : `following/${subjectUid}/items`;
  const snapshot = await db.collection(collectionPath)
    .orderBy('createdAt', 'desc')
    .limit(FOLLOW_LIST_LIMIT)
    .get();

  const rows = snapshot.docs.map((document) => {
    const data = document.data();
    const peerUid = kind === 'followers'
      ? (typeof data.followerUid === 'string' ? data.followerUid : document.id)
      : (typeof data.targetUid === 'string' ? data.targetUid : document.id);
    return { createdAt: data.createdAt, peerUid };
  }).filter((row) => typeof row.peerUid === 'string' && row.peerUid && row.peerUid !== subjectUid);

  if (rows.length === 0) {
    return { result: { items: [] } };
  }

  const peerUids = [...new Set(rows.map((row) => row.peerUid))];
  const profileSnapshots = await db.getAll(...peerUids.map((peerUid) => db.doc(`publicProfiles/${peerUid}`)));
  const profiles = new Map(profileSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data()]));
  const validPeerUids = peerUids.filter((peerUid) => profiles.get(peerUid)?.publicId);
  const relatedRefs = [];

  for (const peerUid of validPeerUids) {
    relatedRefs.push(db.doc(`publicIds/${profiles.get(peerUid).publicId}`));
    relatedRefs.push(db.doc(`blocks/${uid}/blocked/${peerUid}`));
    relatedRefs.push(db.doc(`blocks/${peerUid}/blocked/${uid}`));
  }

  const relatedSnapshots = relatedRefs.length ? await db.getAll(...relatedRefs) : [];
  const relatedByPath = new Map(relatedSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
  const blockedUids = new Set();
  const visibleProfiles = [];

  for (const peerUid of validPeerUids) {
    const profile = profiles.get(peerUid);
    const reservation = relatedByPath.get(`publicIds/${profile.publicId}`);
    const blocked = relatedByPath.get(`blocks/${uid}/blocked/${peerUid}`)?.exists === true
      || relatedByPath.get(`blocks/${peerUid}/blocked/${uid}`)?.exists === true;

    if (blocked) blockedUids.add(peerUid);

    if (
      profile.moderationStatus === 'active'
      && inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, peerUid).ok
    ) {
      visibleProfiles.push(mapDiscoveryProfile(profile));
    }
  }

  const visible = filterVisibleDiscoveryProfiles({
    blockedUids,
    limit: peerUids.length,
    profiles: visibleProfiles.filter(Boolean),
    requestingUid: uid,
  });
  const visibleByUid = new Map(visible.map((profile) => [profile.uid, profile]));
  const items = [];

  for (const row of rows) {
    const profile = visibleByUid.get(row.peerUid);
    if (profile) items.push({ createdAt: row.createdAt, profile });
  }

  return { result: { items } };
}

async function getFollowingOverview({ db, input, uid }) {
  return getFollowList({ db, input, kind: 'following', uid });
}

async function getFollowersOverview({ db, input, uid }) {
  return getFollowList({ db, input, kind: 'followers', uid });
}

async function mutateFollow({ action, db, fieldValue, input, requestId, uid }) {
  if (!FOLLOW_MUTATION_ACTIONS.includes(action)) return { errorCode: 'INVALID_REQUEST' };

  const validation = normalizeFollowTargetInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };

  const targetUid = validation.value.targetUid;

  return db.runTransaction(async (transaction) => {
    const refs = {
      actorProfile: db.doc(`publicProfiles/${uid}`),
      blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/socialFeatures'),
      followedByEdge: db.doc(`followers/${uid}/items/${targetUid}`),
      followingEdge: db.doc(`following/${uid}/items/${targetUid}`),
      followerMirror: db.doc(`followers/${targetUid}/items/${uid}`),
      rate: db.doc(`socialFollowRateLimits/${uid}`),
      targetProfile: db.doc(`publicProfiles/${targetUid}`),
    };

    const [
      feature,
      actorProfile,
      targetProfile,
      followingEdge,
      followerMirror,
      followedByEdge,
      blockedByActor,
      blockedByTarget,
      command,
      rate,
    ] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.followingEdge),
      transaction.get(refs.followerMirror),
      transaction.get(refs.followedByEdge),
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

    if (feature.data()?.following !== true) return { errorCode: 'FEATURE_DISABLED' };

    const nowMs = Date.now();
    const rateData = rate.exists ? rate.data() : {};
    const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
    const insideWindow = Number.isFinite(windowStartedAtMs)
      && nowMs - windowStartedAtMs < FOLLOW_MUTATION_WINDOW_MS;
    const mutationCount = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;

    if (mutationCount >= FOLLOW_MUTATION_WINDOW_LIMIT) return { errorCode: 'RATE_LIMITED' };

    const actor = actorProfile.exists ? actorProfile.data() : undefined;
    const target = targetProfile.exists ? targetProfile.data() : undefined;
    const actorReservationRef = actor?.publicId ? db.doc(`publicIds/${actor.publicId}`) : undefined;
    const targetReservationRef = target?.publicId ? db.doc(`publicIds/${target.publicId}`) : undefined;
    const [actorReservation, targetReservation] = await Promise.all([
      actorReservationRef ? transaction.get(actorReservationRef) : undefined,
      targetReservationRef ? transaction.get(targetReservationRef) : undefined,
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

    const timestamp = fieldValue.serverTimestamp();
    const hasFollowingEdge = followingEdge.exists === true;
    const hasFollowerMirror = followerMirror.exists === true;
    const followedBy = followedByEdge.exists === true;
    let result;
    let notification = {};

    if (action === 'follow-user') {
      if (hasFollowingEdge && hasFollowerMirror) {
        result = { followedBy, status: 'following' };
      } else {
        const creatingNewFollow = !hasFollowingEdge && !hasFollowerMirror;
        if (!hasFollowingEdge) {
          transaction.create(refs.followingEdge, {
            createdAt: timestamp,
            targetUid,
          });
        }
        if (!hasFollowerMirror) {
          transaction.create(refs.followerMirror, {
            createdAt: timestamp,
            followerUid: uid,
          });
        }
        if (creatingNewFollow) {
          transaction.update(refs.actorProfile, {
            followingCount: readFollowCount(actor.followingCount) + 1,
            updatedAt: timestamp,
          });
          transaction.update(refs.targetProfile, {
            followerCount: readFollowCount(target.followerCount) + 1,
            updatedAt: timestamp,
          });
          notification = { notificationKind: 'new-follower', notificationRecipientUid: targetUid };
        } else {
          // Heal path: repair undercounted orphans (mirror/edge without matching counts).
          const actorFollowingCount = readFollowCount(actor.followingCount);
          const targetFollowerCount = readFollowCount(target.followerCount);
          if (actorFollowingCount === 0 || targetFollowerCount === 0) {
            transaction.update(refs.actorProfile, {
              followingCount: actorFollowingCount === 0 ? 1 : actorFollowingCount,
              updatedAt: timestamp,
            });
            transaction.update(refs.targetProfile, {
              followerCount: targetFollowerCount === 0 ? 1 : targetFollowerCount,
              updatedAt: timestamp,
            });
          }
        }
        result = { followedBy, status: 'following' };
      }
    } else if (hasFollowingEdge || hasFollowerMirror) {
      if (hasFollowingEdge) transaction.delete(refs.followingEdge);
      if (hasFollowerMirror) transaction.delete(refs.followerMirror);
      transaction.update(refs.actorProfile, {
        followingCount: Math.max(0, readFollowCount(actor.followingCount) - 1),
        updatedAt: timestamp,
      });
      transaction.update(refs.targetProfile, {
        followerCount: Math.max(0, readFollowCount(target.followerCount) - 1),
        updatedAt: timestamp,
      });
      result = { followedBy, status: 'none' };
    } else {
      result = { followedBy, status: 'none' };
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

async function getBlockedUsers({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };

  const [feature, requester] = await db.getAll(
    db.doc('appConfig/socialFeatures'),
    db.doc(`publicProfiles/${uid}`),
  );

  // Blocks themselves are always available when either friends or following (or DMs) exist;
  // fail closed only when requester profile is incomplete.
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

  // Prefer following flag OR friends OR DMs — any social safety surface.
  const flags = feature.exists ? feature.data() : {};
  if (flags.following !== true && flags.friends !== true && flags.directMessages !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const snapshot = await db.collection(`blocks/${uid}/blocked`)
    .orderBy('createdAt', 'desc')
    .limit(BLOCKED_LIST_LIMIT)
    .get();

  if (snapshot.empty) return { result: { items: [] } };

  const rows = snapshot.docs.map((document) => ({
    createdAt: document.data().createdAt,
    peerUid: typeof document.data().blockedUid === 'string' ? document.data().blockedUid : document.id,
  })).filter((row) => typeof row.peerUid === 'string' && row.peerUid);

  const peerUids = [...new Set(rows.map((row) => row.peerUid))];
  const profileSnapshots = await db.getAll(...peerUids.map((peerUid) => db.doc(`publicProfiles/${peerUid}`)));
  const profiles = new Map(profileSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data()]));

  const items = [];
  for (const row of rows) {
    const profile = profiles.get(row.peerUid);
    if (!profile) continue;
    const mapped = mapDiscoveryProfile(profile);
    if (mapped) items.push({ createdAt: row.createdAt, profile: mapped });
  }

  return { result: { items } };
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
  BLOCKED_LIST_LIMIT,
  FOLLOW_LIST_LIMIT,
  FOLLOW_MUTATION_WINDOW_LIMIT,
  getBlockedUsers,
  getFollowStatus,
  getFollowersOverview,
  getFollowingOverview,
  mutateFollow,
};
