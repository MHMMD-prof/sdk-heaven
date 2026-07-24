const {
  buildAdminUserSearchDocument,
  buildPublicProfileDocument,
  createPublicIdCandidate,
  inspectPublicProfile,
  isAdminUserSearchReady,
  isTimestampLike,
  isValidPublicId,
  isValidSpecialId,
  mapProfileBootstrapResult,
  normalizeSearchName,
  validatePrivateProfile,
} = require('./socialProfileCore');

const MAX_PUBLIC_ID_ATTEMPTS = 12;
const PROFILE_MUTATION_COOLDOWN_MS = 60_000;

async function getProfileReadiness(db, uid) {
  const publicSnapshot = await db.doc(`publicProfiles/${uid}`).get();
  const profile = publicSnapshot.exists ? publicSnapshot.data() : undefined;

  if (!profile || !isValidPublicId(profile.publicId)) {
    return mapProfileBootstrapResult(undefined);
  }

  const reservationSnapshot = await db.doc(`publicIds/${profile.publicId}`).get();
  const inspection = inspectPublicProfile(
    profile,
    reservationSnapshot.exists ? reservationSnapshot.data() : undefined,
    uid,
  );

  return mapProfileBootstrapResult(inspection.ok ? profile : undefined);
}

async function provisionPublicProfile({
  actorEmail = '',
  actorUid,
  auditAction = 'bootstrap-profile',
  bypassRateLimit = false,
  db,
  fieldValue,
  nowMs = Date.now(),
  randomInt,
  requestId,
  uid,
}) {
  for (let attempt = 0; attempt < MAX_PUBLIC_ID_ATTEMPTS; attempt += 1) {
    const candidate = createPublicIdCandidate(randomInt);
    const result = await db.runTransaction(async (transaction) => {
      const privateRef = db.doc(`users/${uid}`);
      const publicRef = db.doc(`publicProfiles/${uid}`);
      const searchRef = db.doc(`adminUserSearch/${uid}`);
      const rateRef = db.doc(`socialRateLimits/${uid}`);
      const [privateSnapshot, publicSnapshot, searchSnapshot, rateSnapshot] = await Promise.all([
        transaction.get(privateRef),
        transaction.get(publicRef),
        transaction.get(searchRef),
        transaction.get(rateRef),
      ]);

      const privateValidation = validatePrivateProfile(
        privateSnapshot.exists ? privateSnapshot.data() : undefined,
        uid,
      );

      if (!privateValidation.ok) {
        return { done: true, errorCode: privateValidation.code };
      }

      const existing = publicSnapshot.exists ? publicSnapshot.data() : {};
      if ('specialId' in existing && !isValidSpecialId(existing.specialId)) {
        return { done: true, errorCode: 'PROFILE_INCOMPLETE' };
      }
      const legacyPublicId = typeof existing.publicId === 'string' && existing.publicId && !isValidPublicId(existing.publicId)
        ? existing.publicId
        : '';
      const existingPublicId = isValidPublicId(existing.publicId) ? existing.publicId : '';
      let publicId = existingPublicId || candidate;
      let candidateState = await readIdCandidateState(db, transaction, publicId);
      const legacyPublicIdRef = legacyPublicId ? db.doc(`publicIds/${legacyPublicId}`) : undefined;
      const legacyPublicIdSnapshot = legacyPublicIdRef ? await transaction.get(legacyPublicIdRef) : undefined;

      if (idCandidateConflicts(candidateState, uid)) {
        if (existingPublicId) {
          publicId = candidate;
          candidateState = await readIdCandidateState(db, transaction, publicId);
        }

        if (idCandidateConflicts(candidateState, uid)) {
          return { collision: true };
        }
      }

      const { publicIdRef, publicIdSnapshot } = candidateState;
      const reservation = publicIdSnapshot.exists ? publicIdSnapshot.data() : undefined;
      const profileInspection = inspectPublicProfile(existing, reservation, uid);
      const profileMatchesPrivate = profileInspection.ok
        && existing.displayName === privateValidation.value.displayName
        && existing.normalizedName === normalizeSearchName(privateValidation.value.displayName);
      const searchReady = searchSnapshot.exists
        && isAdminUserSearchReady(searchSnapshot.data(), privateValidation.value);

      if (profileMatchesPrivate && searchReady) {
        return {
          done: true,
          result: mapProfileBootstrapResult(existing),
        };
      }

      const lastMutationAtMs = readTimestampMs(rateSnapshot.exists
        ? rateSnapshot.data()?.lastMutationAt
        : undefined);

      if (
        !bypassRateLimit
        && Number.isFinite(lastMutationAtMs)
        && nowMs - lastMutationAtMs < PROFILE_MUTATION_COOLDOWN_MS
      ) {
        return { done: true, errorCode: 'RATE_LIMITED' };
      }

      const timestamp = fieldValue.serverTimestamp();
      const profile = buildPublicProfileDocument({
        existing,
        privateProfile: privateValidation.value,
        publicId,
        timestamp,
      });
      const profileNeedsWrite = !profileMatchesPrivate;
      const searchNeedsWrite = !searchReady;
      const bootstrapResult = mapProfileBootstrapResult(profile, {
        created: !publicSnapshot.exists,
        repaired: publicSnapshot.exists && (!profileInspection.ok || existingPublicId !== publicId),
      });
      const auditRef = db.collection('adminAuditEvents').doc();

      if (!publicIdSnapshot.exists) {
        transaction.create(publicIdRef, {
          createdAt: timestamp,
          uid,
        });
      } else if (!isTimestampLike(publicIdSnapshot.data()?.createdAt)) {
        transaction.set(publicIdRef, {
          createdAt: timestamp,
          uid,
        });
      }

      if (legacyPublicIdRef && legacyPublicIdSnapshot?.exists && legacyPublicIdSnapshot.data()?.uid === uid) {
        transaction.delete(legacyPublicIdRef);
      }

      if (profileNeedsWrite) {
        transaction.set(publicRef, profile);
      }

      if (searchNeedsWrite) {
        transaction.set(searchRef, buildAdminUserSearchDocument({
          privateProfile: privateValidation.value,
          timestamp,
        }));
      }

      transaction.set(rateRef, {
        action: auditAction,
        lastMutationAt: timestamp,
        lastRequestId: requestId,
        uid,
      });
      transaction.create(auditRef, {
        action: auditAction,
        actorEmail,
        actorUid: actorUid || uid,
        createdAt: timestamp,
        kind: 'profile-provisioning',
        publicId,
        requestId,
        status: bootstrapResult.repaired
          ? 'repaired'
          : bootstrapResult.created
            ? 'created'
            : profileNeedsWrite
              ? 'refreshed'
              : 'indexed',
        targetUid: uid,
      });

      return { done: true, result: bootstrapResult };
    });

    if (result.collision) {
      continue;
    }

    return result;
  }

  return { done: true, errorCode: 'PUBLIC_ID_EXHAUSTED' };
}

async function readIdCandidateState(db, transaction, publicId) {
  const publicIdRef = db.doc(`publicIds/${publicId}`);
  const specialIdRef = db.doc(`specialIds/${publicId}`);
  const specialIdCatalogRef = db.doc(`specialIdCatalog/${publicId}`);
  const [publicIdSnapshot, specialIdSnapshot, specialIdCatalogSnapshot] = await Promise.all([
    transaction.get(publicIdRef),
    transaction.get(specialIdRef),
    transaction.get(specialIdCatalogRef),
  ]);
  return {
    publicIdRef,
    publicIdSnapshot,
    specialIdCatalogSnapshot,
    specialIdSnapshot,
  };
}

function idCandidateConflicts(candidateState, uid) {
  return (
    (candidateState.publicIdSnapshot.exists && candidateState.publicIdSnapshot.data()?.uid !== uid)
    || candidateState.specialIdSnapshot.exists
    || candidateState.specialIdCatalogSnapshot.exists
  );
}

function readTimestampMs(value) {
  if (value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  return Number.NaN;
}

module.exports = {
  MAX_PUBLIC_ID_ATTEMPTS,
  PROFILE_MUTATION_COOLDOWN_MS,
  getProfileReadiness,
  idCandidateConflicts,
  provisionPublicProfile,
  readIdCandidateState,
};
