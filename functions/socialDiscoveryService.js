const { inspectPublicProfile } = require('./socialProfileCore');
const {
  filterVisibleDiscoveryProfiles,
  mapDiscoveryProfile,
  normalizeUserDiscoveryInput,
} = require('./socialDiscoveryCore');

async function discoverUsers({ db, input, uid }) {
  const validation = normalizeUserDiscoveryInput(input);

  if (!validation.ok) {
    return { errorCode: validation.code };
  }

  const featureSnapshot = await db.doc('appConfig/socialFeatures').get();

  if (!featureSnapshot.exists || featureSnapshot.data()?.usersDiscovery !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const requesterSnapshot = await db.doc(`publicProfiles/${uid}`).get();
  const requesterProfile = requesterSnapshot.exists ? requesterSnapshot.data() : undefined;
  const requesterReservationSnapshot = requesterProfile?.publicId
    ? await db.doc(`publicIds/${requesterProfile.publicId}`).get()
    : undefined;

  if (!inspectPublicProfile(
    requesterProfile,
    requesterReservationSnapshot?.exists ? requesterReservationSnapshot.data() : undefined,
    uid,
  ).ok) {
    return { errorCode: 'PROFILE_INCOMPLETE' };
  }

  if (requesterProfile.moderationStatus !== 'active') {
    return { errorCode: 'PERMISSION_DENIED' };
  }

  const request = validation.value;
  const readLimit = Math.min(request.limit + 8, 32);
  let query = db.collection('publicProfiles').where('moderationStatus', '==', 'active');

  if (request.mode === 'public-id') {
    query = query.where('publicId', '==', request.query).limit(1);
  } else if (request.mode === 'name') {
    if (request.countryCode) {
      query = query.where('countryCode', '==', request.countryCode);
    }
    query = query
      .orderBy('normalizedName')
      .startAt(request.normalizedQuery)
      .endAt(`${request.normalizedQuery}\uf8ff`)
      .limit(readLimit);
  } else {
    if (request.countryCode) {
      query = query.where('countryCode', '==', request.countryCode);
    }
    query = query.orderBy('giftScore', 'desc').limit(readLimit);
  }

  const snapshot = await query.get();
  const candidates = snapshot.docs
    .map((document) => ({ id: document.id, profile: document.data() }))
    .filter(({ profile }) => profile?.uid && profile.uid !== uid);

  if (candidates.length === 0) {
    return { result: { users: [] } };
  }

  const relatedRefs = [];

  for (const { profile } of candidates) {
    relatedRefs.push(db.doc(`publicIds/${profile.publicId}`));
    relatedRefs.push(db.doc(`blocks/${uid}/blocked/${profile.uid}`));
    relatedRefs.push(db.doc(`blocks/${profile.uid}/blocked/${uid}`));
  }

  const relatedSnapshots = await db.getAll(...relatedRefs);
  const relatedByPath = new Map(relatedSnapshots.map((document) => [document.ref.path, document]));
  const blockedUids = new Set();
  const validProfiles = [];

  for (const { profile } of candidates) {
    const reservationSnapshot = relatedByPath.get(`publicIds/${profile.publicId}`);
    const blockedByRequester = relatedByPath.get(`blocks/${uid}/blocked/${profile.uid}`)?.exists === true;
    const blockedByCandidate = relatedByPath.get(`blocks/${profile.uid}/blocked/${uid}`)?.exists === true;

    if (blockedByRequester || blockedByCandidate) {
      blockedUids.add(profile.uid);
    }

    if (inspectPublicProfile(
      profile,
      reservationSnapshot?.exists ? reservationSnapshot.data() : undefined,
      profile.uid,
    ).ok) {
      validProfiles.push(mapDiscoveryProfile(profile));
    }
  }

  return {
    result: {
      users: filterVisibleDiscoveryProfiles({
        blockedUids,
        countryCode: request.countryCode,
        limit: request.limit,
        profiles: validProfiles.filter(Boolean),
        requestingUid: uid,
      }),
    },
  };
}

module.exports = { discoverUsers };
