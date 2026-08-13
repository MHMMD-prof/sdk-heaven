const sharp = require('sharp');
const crypto = require('node:crypto');
const {
  AVATAR_UPLOAD_TTL_MS,
  avatarPublishedPath,
  avatarQuarantinePath,
  createAvatarUploadId,
  normalizeAvatarUploadInput,
  normalizeProfilePresentation,
  normalizeSearchName,
} = require('./profileProductionCore');

async function updateProfilePresentation({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeProfilePresentation(input);
  if (!validation.ok) return { errorCode: validation.code };
  const requestRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const result = await db.runTransaction(async (transaction) => {
    const privateRef = db.doc(`users/${uid}`);
    const publicRef = db.doc(`publicProfiles/${uid}`);
    const searchRef = db.doc(`adminUserSearch/${uid}`);
    const [previous, privateSnapshot, publicSnapshot] = await Promise.all([
      transaction.get(requestRef), transaction.get(privateRef), transaction.get(publicRef),
    ]);
    if (previous.exists) {
      return previous.data()?.action === 'update-profile-presentation'
        ? { result: previous.data().result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    if (!privateSnapshot.exists || !publicSnapshot.exists) return { errorCode: 'PROFILE_INCOMPLETE' };
    const value = validation.value;
    const now = fieldValue.serverTimestamp();
    transaction.update(privateRef, {
      avatarLabel: value.avatarLabel,
      displayName: value.displayName,
      updatedAt: now,
    });
    transaction.update(publicRef, {
      bio: value.bio,
      countryCode: value.countryCode,
      displayName: value.displayName,
      gender: value.gender ?? fieldValue.delete(),
      normalizedName: normalizeSearchName(value.displayName),
      updatedAt: now,
    });
    transaction.set(searchRef, {
      displayName: value.displayName,
      normalizedName: normalizeSearchName(value.displayName),
      uid,
      updatedAt: now,
    }, { merge: true });
    const response = { bio: value.bio, countryCode: value.countryCode, displayName: value.displayName, gender: value.gender || '', uid };
    transaction.create(requestRef, { action: 'update-profile-presentation', createdAt: now, requestId, result: response, status: 'applied', uid });
    return { result: response };
  });
  return result;
}

async function createAvatarUpload({ clock, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeAvatarUploadInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const uploadId = createAvatarUploadId(uid, requestId);
  if (!uploadId) return { errorCode: 'INVALID_REQUEST' };
  const submissionRef = db.doc(`avatarSubmissions/${uploadId}`);
  const authorizationRef = db.doc(`avatarUploadAuthorizations/${uid}`);
  const rateLimitRef = db.doc(`avatarUploadRateLimits/${uid}`);
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const result = await db.runTransaction(async (transaction) => {
    const [flags, profile, command, authorization, rateLimit] = await Promise.all([
      transaction.get(db.doc('appConfig/socialFeatures')),
      transaction.get(db.doc(`publicProfiles/${uid}`)),
      transaction.get(commandRef),
      transaction.get(authorizationRef),
      transaction.get(rateLimitRef),
    ]);
    if (command.exists) return command.data()?.action === 'create-avatar-upload' ? { result: command.data().result } : { errorCode: 'REQUEST_CONFLICT' };
    if (flags.data()?.avatarUploads !== true) return { errorCode: 'FEATURE_DISABLED' };
    if (!profile.exists || profile.data()?.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (authorization.exists && authorization.data()?.active === true && authorization.data()?.expiresAt?.toMillis?.() > clock.nowMillis()) {
      return { errorCode: 'REQUEST_CONFLICT' };
    }
    const rateData = rateLimit.data() || {};
    const inWindow = rateData.windowStartedAt?.toMillis?.() > clock.nowMillis() - 60 * 60 * 1000;
    const uploadCount = inWindow ? Number(rateData.uploadCount || 0) : 0;
    if (uploadCount >= 5) return { errorCode: 'RATE_LIMITED' };
    const now = fieldValue.serverTimestamp();
    const expiresAt = clock.timestampFromMillis(clock.nowMillis() + AVATAR_UPLOAD_TTL_MS);
    const sourcePath = avatarQuarantinePath(uid, uploadId, validation.value.extension);
    const auth = { active: true, contentType: validation.value.contentType, expiresAt, sha256: validation.value.sha256, sizeBytes: validation.value.sizeBytes, sourcePath, uid, uploadId };
    transaction.set(authorizationRef, auth);
    transaction.set(rateLimitRef, {
      uploadCount: uploadCount + 1,
      uid,
      windowStartedAt: inWindow ? rateData.windowStartedAt : now,
    });
    transaction.create(submissionRef, { ...auth, createdAt: now, status: 'authorized', updatedAt: now });
    const response = { contentType: auth.contentType, expiresAtMillis: clock.nowMillis() + AVATAR_UPLOAD_TTL_MS, sha256: auth.sha256, sizeBytes: auth.sizeBytes, sourcePath, uploadId };
    transaction.create(commandRef, { action: 'create-avatar-upload', createdAt: now, requestId, result: response, status: 'applied', uid });
    return { result: response };
  });
  return result;
}

async function finalizeAvatarUpload({ bucket, clock, db, fieldValue, input, requestId, safetyAdapter, uid }) {
  const uploadId = typeof input?.uploadId === 'string' ? input.uploadId.trim() : '';
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const submissionRef = db.doc(`avatarSubmissions/${uploadId}`);
  const authorizationRef = db.doc(`avatarUploadAuthorizations/${uid}`);
  const [commandSnapshot, submissionSnapshot, authorizationSnapshot] = await Promise.all([commandRef.get(), submissionRef.get(), authorizationRef.get()]);
  if (commandSnapshot.exists) return commandSnapshot.data()?.action === 'finalize-avatar-upload'
    ? { result: commandSnapshot.data().result }
    : { errorCode: 'REQUEST_CONFLICT' };
  const submission = submissionSnapshot.data();
  const authorization = authorizationSnapshot.data();
  if (!submission || submission.uid !== uid || submission.status !== 'authorized' || !authorization || authorization.uploadId !== uploadId || authorization.active !== true || authorization.expiresAt?.toMillis?.() <= clock.nowMillis()) {
    return { errorCode: 'UPLOAD_INVALID' };
  }
  const source = bucket.file(submission.sourcePath);
  const [exists] = await source.exists();
  if (!exists) return { errorCode: 'UPLOAD_INVALID' };
  const [metadata] = await source.getMetadata();
  if (metadata.contentType !== submission.contentType || Number(metadata.size) !== submission.sizeBytes || metadata.metadata?.uploaderUid !== uid || metadata.metadata?.uploadId !== uploadId || metadata.metadata?.sha256 !== submission.sha256) {
    return { errorCode: 'UPLOAD_INVALID' };
  }
  const [sourceBytes] = await source.download();
  const actualSha256 = require('node:crypto').createHash('sha256').update(sourceBytes).digest('hex');
  if (actualSha256 !== submission.sha256) return { errorCode: 'UPLOAD_INVALID' };
  let canonical;
  try {
    canonical = await sharp(sourceBytes).rotate().resize(512, 512, { fit: 'cover', position: 'attention' }).webp({ quality: 86 }).toBuffer();
  } catch {
    return { errorCode: 'UPLOAD_INVALID' };
  }
  await submissionRef.set({ status: 'scanning', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
  const scan = await safetyAdapter.inspectImage({ buffer: sourceBytes, contentType: submission.contentType });
  if (!scan.ok && scan.reason === 'unsafe-image') {
    const response = { status: 'rejected', uploadId };
    await submissionRef.set({ moderationReason: scan.reason, status: 'rejected', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    await commandRef.create({ action: 'finalize-avatar-upload', createdAt: fieldValue.serverTimestamp(), requestId, result: response, status: 'applied', uid });
    await authorizationRef.delete();
    await source.delete({ ignoreNotFound: true });
    return { result: response };
  }
  if (!scan.ok) {
    const response = { status: 'pending', uploadId };
    await submissionRef.set({ moderationReason: scan.reason || 'review-required', status: 'pending', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    await commandRef.create({ action: 'finalize-avatar-upload', createdAt: fieldValue.serverTimestamp(), requestId, result: response, status: 'applied', uid });
    await authorizationRef.delete();
    return { result: response };
  }
  const publicPath = avatarPublishedPath(uid, uploadId);
  const destination = bucket.file(publicPath);
  const downloadToken = crypto.randomUUID();
  await destination.save(canonical, { contentType: 'image/webp', metadata: { cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: downloadToken, ownerUid: uid, uploadId } }, resumable: false });
  const avatarUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(publicPath)}?alt=media&token=${downloadToken}`;
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(submissionRef);
    if (!latest.exists || latest.data()?.status !== 'scanning') return;
    const now = fieldValue.serverTimestamp();
    transaction.update(db.doc(`publicProfiles/${uid}`), { avatarModerationStatus: 'clear', avatarUrl, updatedAt: now });
    const response = { avatarUrl, status: 'approved', uploadId };
    transaction.update(submissionRef, { avatarUrl, publishedPath: publicPath, scanner: scan.provider || 'safe-search', status: 'approved', updatedAt: now });
    transaction.create(commandRef, { action: 'finalize-avatar-upload', createdAt: now, requestId, result: response, status: 'applied', uid });
  });
  await authorizationRef.delete();
  await source.delete({ ignoreNotFound: true });
  return { result: { avatarUrl, status: 'approved', uploadId } };
}

async function removeAvatar({ bucket, db, fieldValue, requestId, uid }) {
  const commandRef = db.doc(`socialCommandRequests/${uid}/requests/${requestId}`);
  const profileRef = db.doc(`publicProfiles/${uid}`);
  const result = await db.runTransaction(async (transaction) => {
    const [command, profile] = await Promise.all([transaction.get(commandRef), transaction.get(profileRef)]);
    if (command.exists) return command.data()?.action === 'remove-avatar' ? { result: command.data().result } : { errorCode: 'REQUEST_CONFLICT' };
    if (!profile.exists) return { errorCode: 'PROFILE_INCOMPLETE' };
    const previousUrl = typeof profile.data()?.avatarUrl === 'string' ? profile.data().avatarUrl : '';
    const response = { status: 'removed' };
    transaction.update(profileRef, { avatarModerationStatus: 'removed', avatarUrl: '', updatedAt: fieldValue.serverTimestamp() });
    transaction.create(commandRef, { action: 'remove-avatar', createdAt: fieldValue.serverTimestamp(), requestId, result: response, status: 'applied', uid });
    return { previousUrl, result: response };
  });
  if (result.previousUrl) {
    const marker = `https://storage.googleapis.com/${bucket.name}/`;
    if (result.previousUrl.startsWith(marker)) await bucket.file(result.previousUrl.slice(marker.length)).delete({ ignoreNotFound: true }).catch(() => undefined);
    const firebaseMarker = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;
    if (result.previousUrl.startsWith(firebaseMarker)) {
      const encodedPath = result.previousUrl.slice(firebaseMarker.length).split('?')[0];
      await bucket.file(decodeURIComponent(encodedPath)).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
  }
  return result;
}

async function expireAvatarUploads({ bucket, clock, db, fieldValue, limit = 100 }) {
  const snapshot = await db.collection('avatarSubmissions')
    .where('status', '==', 'authorized')
    .where('expiresAt', '<=', clock.timestampFromMillis(clock.nowMillis()))
    .limit(limit)
    .get();
  for (const document of snapshot.docs) {
    const data = document.data();
    await document.ref.set({ status: 'expired', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    if (data.sourcePath) await bucket.file(data.sourcePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    const authorization = db.doc(`avatarUploadAuthorizations/${data.uid}`);
    const current = await authorization.get();
    if (current.data()?.uploadId === document.id) await authorization.delete();
  }
  return { expired: snapshot.size };
}

module.exports = { createAvatarUpload, expireAvatarUploads, finalizeAvatarUpload, removeAvatar, updateProfilePresentation };
