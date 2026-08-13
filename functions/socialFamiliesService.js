'use strict';

const {
  FAMILY_MEMBER_CAP,
  FAMILY_MUTATION_ACTIONS,
  canInviteOrKick,
  canKickTarget,
  createFamilyId,
  createFamilyInviteCode,
  createFamilyInviteId,
  mapFamilyBadge,
  mapFamilyMember,
  mapFamilySummary,
  normalizeCancelFamilyInviteInput,
  normalizeCreateFamilyInput,
  normalizeFamilyIdInput,
  normalizeFamilyTargetInput,
  normalizeJoinFamilyInput,
} = require('./socialFamiliesCore');
const { inspectPublicProfile } = require('./socialProfileCore');
const { mapDiscoveryProfile } = require('./socialDiscoveryCore');

const FAMILY_MUTATION_WINDOW_LIMIT = 20;
const FAMILY_MUTATION_WINDOW_MS = 60_000;
const FAMILY_INVITE_LIMIT = 30;

async function readGrowthFamiliesEnabled(db, transaction) {
  const snap = transaction
    ? await transaction.get(db.doc('appConfig/growthFeatures'))
    : await db.doc('appConfig/growthFeatures').get();
  return snap.exists && snap.data()?.families === true;
}

async function getMyFamily({ db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  if (!(await readGrowthFamiliesEnabled(db))) return { errorCode: 'FEATURE_DISABLED' };

  const [profileSnap, membershipSnap] = await db.getAll(
    db.doc(`publicProfiles/${uid}`),
    db.doc(`familyMemberships/${uid}`),
  );
  const profile = profileSnap.exists ? profileSnap.data() : undefined;
  const reservation = profile?.publicId
    ? await db.doc(`publicIds/${profile.publicId}`).get()
    : undefined;
  if (!inspectPublicProfile(profile, reservation?.exists ? reservation.data() : undefined, uid).ok) {
    return { errorCode: 'PROFILE_INCOMPLETE' };
  }
  if (profile.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };

  const incomingInvites = await db.collection('familyInvites')
    .where('targetUid', '==', uid)
    .where('status', '==', 'pending')
    .orderBy('updatedAt', 'desc')
    .limit(FAMILY_INVITE_LIMIT)
    .get();

  const inviteRows = [];
  for (const doc of incomingInvites.docs) {
    const data = doc.data();
    const familyId = typeof data.familyId === 'string' ? data.familyId : '';
    const senderUid = typeof data.senderUid === 'string' ? data.senderUid : '';
    if (!familyId || !senderUid) continue;
    inviteRows.push({ familyId, inviteId: doc.id, senderUid, updatedAt: data.updatedAt });
  }

  const membership = membershipSnap.exists ? membershipSnap.data() : undefined;
  const familyId = typeof membership?.familyId === 'string' ? membership.familyId : '';
  let family = null;
  let members = [];
  let role = null;

  if (familyId) {
    const familySnap = await db.doc(`families/${familyId}`).get();
    if (familySnap.exists) {
      family = mapFamilySummary({ familyId, ...familySnap.data() });
      role = typeof membership.role === 'string' ? membership.role : 'member';
      const memberSnaps = await db.collection('familyMemberships')
        .where('familyId', '==', familyId)
        .limit(FAMILY_MEMBER_CAP)
        .get();
      const memberUids = memberSnaps.docs.map((doc) => doc.id);
      const profiles = memberUids.length
        ? await db.getAll(...memberUids.map((memberUid) => db.doc(`publicProfiles/${memberUid}`)))
        : [];
      const profileByUid = new Map(
        profiles.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()]),
      );
      members = memberSnaps.docs
        .map((doc) => {
          const data = doc.data();
          const memberProfile = profileByUid.get(doc.id);
          return mapFamilyMember({
            displayName: memberProfile?.displayName,
            publicId: memberProfile?.publicId,
            role: data.role,
            uid: doc.id,
          });
        })
        .filter(Boolean)
        .sort((left, right) => roleRank(left.role) - roleRank(right.role)
          || left.displayName.localeCompare(right.displayName, 'ar'));
    }
  }

  const inviteFamilyIds = [...new Set(inviteRows.map((row) => row.familyId))];
  const inviteSenderUids = [...new Set(inviteRows.map((row) => row.senderUid))];
  const inviteFamilySnaps = inviteFamilyIds.length
    ? await db.getAll(...inviteFamilyIds.map((id) => db.doc(`families/${id}`)))
    : [];
  const inviteSenderSnaps = inviteSenderUids.length
    ? await db.getAll(...inviteSenderUids.map((id) => db.doc(`publicProfiles/${id}`)))
    : [];
  const familyById = new Map(
    inviteFamilySnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()]),
  );
  const senderByUid = new Map(
    inviteSenderSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()]),
  );

  const incoming = [];
  for (const row of inviteRows) {
    const familyData = familyById.get(row.familyId);
    const sender = senderByUid.get(row.senderUid);
    const summary = mapFamilySummary({ familyId: row.familyId, ...familyData });
    if (!summary || !sender) continue;
    incoming.push({
      createdAt: row.updatedAt,
      family: summary,
      profile: mapDiscoveryProfile(sender),
    });
  }

  return {
    result: {
      family,
      incoming,
      members,
      role,
    },
  };
}

function roleRank(role) {
  if (role === 'owner') return 0;
  if (role === 'elder') return 1;
  return 2;
}

async function mutateFamily({ action, db, fieldValue, input, requestId, uid }) {
  if (!FAMILY_MUTATION_ACTIONS.includes(action)) return { errorCode: 'INVALID_REQUEST' };

  if (action === 'create-family') {
    return mutateCreateFamily({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'invite-to-family') {
    return mutateInviteToFamily({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'accept-family-invite' || action === 'decline-family-invite') {
    return mutateRespondFamilyInvite({ action, db, fieldValue, input, requestId, uid });
  }
  if (action === 'cancel-family-invite') {
    return mutateCancelFamilyInvite({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'join-family') {
    return mutateJoinFamily({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'leave-family') {
    return mutateLeaveFamily({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'kick-family-member') {
    return mutateKickFamilyMember({ db, fieldValue, input, requestId, uid });
  }
  if (action === 'dissolve-family') {
    return mutateDissolveFamily({ db, fieldValue, input, requestId, uid });
  }
  return { errorCode: 'INVALID_REQUEST' };
}

async function mutateCreateFamily({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCreateFamilyInput(input);
  if (!validation.ok) return { errorCode: validation.code };

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      membership: db.doc(`familyMemberships/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, profile, membership, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.profile),
      transaction.get(refs.membership),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'create-family' && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };

    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };

    const actor = profile.exists ? profile.data() : undefined;
    const reservation = actor?.publicId
      ? await transaction.get(db.doc(`publicIds/${actor.publicId}`))
      : undefined;
    if (!inspectPublicProfile(actor, reservation?.data(), uid).ok) {
      return { errorCode: 'PROFILE_INCOMPLETE' };
    }
    if (actor.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (membership.exists) return { errorCode: 'CONFLICT' };

    const familyId = createFamilyId();
    const inviteCode = createFamilyInviteCode();
    const timestamp = fieldValue.serverTimestamp();
    const { nameAr, badgeColor, homeRoomId } = validation.value;
    const familyRef = db.doc(`families/${familyId}`);
    const familyDoc = {
      badgeColor,
      createdAt: timestamp,
      familyId,
      inviteCode,
      memberCount: 1,
      memberUids: [uid],
      nameAr,
      ownerUid: uid,
      updatedAt: timestamp,
      ...(homeRoomId ? { homeRoomId } : {}),
    };
    const badge = mapFamilyBadge({
      badgeColor,
      familyId,
      nameAr,
      role: 'owner',
    });

    transaction.set(familyRef, familyDoc);
    transaction.set(db.doc(`familyInviteCodes/${inviteCode}`), {
      createdAt: timestamp,
      familyId,
      inviteCode,
    });
    transaction.set(refs.membership, {
      familyId,
      joinedAt: timestamp,
      role: 'owner',
      uid,
      updatedAt: timestamp,
    });
    transaction.set(refs.profile, { family: badge, updatedAt: timestamp }, { merge: true });
    writeCommandReplay(transaction, refs.command, {
      action: 'create-family',
      result: { family: mapFamilySummary(familyDoc), role: 'owner', status: 'joined' },
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return {
      result: { family: mapFamilySummary(familyDoc), role: 'owner', status: 'joined' },
    };
  });
}

async function mutateInviteToFamily({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeFamilyTargetInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const targetUid = validation.value.targetUid;
  if (targetUid === uid) return { errorCode: 'INVALID_REQUEST' };

  return db.runTransaction(async (transaction) => {
    const refs = {
      actorMembership: db.doc(`familyMemberships/${uid}`),
      actorProfile: db.doc(`publicProfiles/${uid}`),
      blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
      blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
      targetMembership: db.doc(`familyMemberships/${targetUid}`),
      targetProfile: db.doc(`publicProfiles/${targetUid}`),
    };
    const [
      feature,
      actorProfile,
      targetProfile,
      actorMembership,
      targetMembership,
      blockedByActor,
      blockedByTarget,
      command,
      rate,
    ] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.actorMembership),
      transaction.get(refs.targetMembership),
      transaction.get(refs.blockedByActor),
      transaction.get(refs.blockedByTarget),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'invite-to-family'
        && previous.targetUid === targetUid
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };

    const actor = actorProfile.exists ? actorProfile.data() : undefined;
    const target = targetProfile.exists ? targetProfile.data() : undefined;
    const [actorReservation, targetReservation] = await Promise.all([
      actor?.publicId ? transaction.get(db.doc(`publicIds/${actor.publicId}`)) : undefined,
      target?.publicId ? transaction.get(db.doc(`publicIds/${target.publicId}`)) : undefined,
    ]);
    if (!inspectPublicProfile(actor, actorReservation?.data(), uid).ok) {
      return { errorCode: 'PROFILE_INCOMPLETE' };
    }
    if (!inspectPublicProfile(target, targetReservation?.data(), targetUid).ok) {
      return { errorCode: 'NOT_FOUND' };
    }
    if (actor.moderationStatus !== 'active' || target.moderationStatus !== 'active') {
      return { errorCode: 'PERMISSION_DENIED' };
    }
    if (blockedByActor.exists || blockedByTarget.exists) return { errorCode: 'PERMISSION_DENIED' };
    if (!actorMembership.exists) return { errorCode: 'NOT_FOUND' };
    if (targetMembership.exists) return { errorCode: 'CONFLICT' };

    const membership = actorMembership.data();
    const familyId = typeof membership.familyId === 'string' ? membership.familyId : '';
    const role = typeof membership.role === 'string' ? membership.role : '';
    if (!familyId || !canInviteOrKick(role)) return { errorCode: 'PERMISSION_DENIED' };

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await transaction.get(familyRef);
    if (!familySnap.exists) return { errorCode: 'NOT_FOUND' };
    const family = familySnap.data();
    const memberCount = Number(family.memberCount);
    if (!Number.isSafeInteger(memberCount) || memberCount >= FAMILY_MEMBER_CAP) {
      return { errorCode: 'CONFLICT' };
    }

    const inviteId = createFamilyInviteId(familyId, targetUid);
    const inviteRef = db.doc(`familyInvites/${inviteId}`);
    const inviteSnap = await transaction.get(inviteRef);
    if (inviteSnap.exists && inviteSnap.data()?.status === 'pending') {
      return { errorCode: 'CONFLICT' };
    }

    const timestamp = fieldValue.serverTimestamp();
    transaction.set(inviteRef, {
      createdAt: inviteSnap.exists ? inviteSnap.data().createdAt : timestamp,
      familyId,
      senderUid: uid,
      status: 'pending',
      targetUid,
      updatedAt: timestamp,
    });
    writeCommandReplay(transaction, refs.command, {
      action: 'invite-to-family',
      result: { status: 'outgoing' },
      targetUid,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result: { status: 'outgoing' } };
  });
}

async function mutateRespondFamilyInvite({ action, db, fieldValue, input, requestId, uid }) {
  const validation = normalizeFamilyIdInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { familyId } = validation.value;
  const inviteId = createFamilyInviteId(familyId, uid);

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      family: db.doc(`families/${familyId}`),
      feature: db.doc('appConfig/growthFeatures'),
      invite: db.doc(`familyInvites/${inviteId}`),
      membership: db.doc(`familyMemberships/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, profile, membership, invite, family, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.profile),
      transaction.get(refs.membership),
      transaction.get(refs.invite),
      transaction.get(refs.family),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === action && previous.familyId === familyId && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };

    const actor = profile.exists ? profile.data() : undefined;
    const reservation = actor?.publicId
      ? await transaction.get(db.doc(`publicIds/${actor.publicId}`))
      : undefined;
    if (!inspectPublicProfile(actor, reservation?.data(), uid).ok) {
      return { errorCode: 'PROFILE_INCOMPLETE' };
    }
    if (actor.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (!invite.exists || invite.data()?.status !== 'pending' || invite.data()?.targetUid !== uid) {
      return { errorCode: 'NOT_FOUND' };
    }

    const timestamp = fieldValue.serverTimestamp();
    if (action === 'decline-family-invite') {
      transaction.set(refs.invite, { status: 'declined', updatedAt: timestamp }, { merge: true });
      const result = { status: 'none' };
      writeCommandReplay(transaction, refs.command, {
        action,
        familyId,
        result,
        timestamp,
        uid,
      });
      writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
      return { result };
    }

    if (membership.exists) return { errorCode: 'CONFLICT' };
    if (!family.exists) return { errorCode: 'NOT_FOUND' };
    const familyData = family.data();
    const memberCount = Number(familyData.memberCount);
    if (!Number.isSafeInteger(memberCount) || memberCount >= FAMILY_MEMBER_CAP) {
      return { errorCode: 'CONFLICT' };
    }

    const senderUid = typeof invite.data().senderUid === 'string' ? invite.data().senderUid : '';
    if (senderUid) {
      const [blockedByActor, blockedBySender] = await Promise.all([
        transaction.get(db.doc(`blocks/${uid}/blocked/${senderUid}`)),
        transaction.get(db.doc(`blocks/${senderUid}/blocked/${uid}`)),
      ]);
      if (blockedByActor.exists || blockedBySender.exists) return { errorCode: 'PERMISSION_DENIED' };
    }

    const memberUids = Array.isArray(familyData.memberUids) ? familyData.memberUids.slice() : [];
    if (!memberUids.includes(uid)) memberUids.push(uid);

    const badge = mapFamilyBadge({
      badgeColor: familyData.badgeColor,
      familyId,
      nameAr: familyData.nameAr,
      role: 'member',
    });

    transaction.set(refs.invite, { status: 'accepted', updatedAt: timestamp }, { merge: true });
    transaction.set(refs.membership, {
      familyId,
      joinedAt: timestamp,
      role: 'member',
      uid,
      updatedAt: timestamp,
    });
    transaction.set(refs.family, {
      memberCount: memberCount + 1,
      memberUids,
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set(refs.profile, { family: badge, updatedAt: timestamp }, { merge: true });

    const result = {
      family: mapFamilySummary({ familyId, ...familyData, memberCount: memberCount + 1, memberUids }),
      role: 'member',
      status: 'joined',
    };
    writeCommandReplay(transaction, refs.command, {
      action,
      familyId,
      result,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result };
  });
}

async function mutateCancelFamilyInvite({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeCancelFamilyInviteInput(input, uid);
  if (!validation.ok) return { errorCode: validation.code };
  const { familyId, targetUid } = validation.value;
  const inviteId = createFamilyInviteId(familyId, targetUid);

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      invite: db.doc(`familyInvites/${inviteId}`),
      membership: db.doc(`familyMemberships/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, membership, invite, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.membership),
      transaction.get(refs.invite),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'cancel-family-invite'
        && previous.familyId === familyId
        && previous.targetUid === targetUid
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };
    if (!membership.exists || membership.data()?.familyId !== familyId) {
      return { errorCode: 'PERMISSION_DENIED' };
    }
    if (!canInviteOrKick(membership.data()?.role)) return { errorCode: 'PERMISSION_DENIED' };
    if (!invite.exists || invite.data()?.status !== 'pending') return { errorCode: 'NOT_FOUND' };

    const timestamp = fieldValue.serverTimestamp();
    transaction.set(refs.invite, { status: 'cancelled', updatedAt: timestamp }, { merge: true });
    const result = { status: 'none' };
    writeCommandReplay(transaction, refs.command, {
      action: 'cancel-family-invite',
      familyId,
      result,
      targetUid,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result };
  });
}

async function mutateJoinFamily({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeJoinFamilyInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { inviteCode } = validation.value;

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      membership: db.doc(`familyMemberships/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, profile, membership, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.profile),
      transaction.get(refs.membership),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'join-family'
        && previous.inviteCode === inviteCode
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };

    const actor = profile.exists ? profile.data() : undefined;
    const reservation = actor?.publicId
      ? await transaction.get(db.doc(`publicIds/${actor.publicId}`))
      : undefined;
    if (!inspectPublicProfile(actor, reservation?.data(), uid).ok) {
      return { errorCode: 'PROFILE_INCOMPLETE' };
    }
    if (actor.moderationStatus !== 'active') return { errorCode: 'PERMISSION_DENIED' };
    if (membership.exists) return { errorCode: 'CONFLICT' };

    // Invite-code lookup outside indexed query in-transaction: scan is not available.
    // Resolve by reading a side index doc `familyInviteCodes/{inviteCode}`.
    const codeRef = db.doc(`familyInviteCodes/${inviteCode}`);
    const codeSnap = await transaction.get(codeRef);
    if (!codeSnap.exists) return { errorCode: 'NOT_FOUND' };
    const familyId = typeof codeSnap.data()?.familyId === 'string' ? codeSnap.data().familyId : '';
    if (!familyId) return { errorCode: 'NOT_FOUND' };

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await transaction.get(familyRef);
    if (!familySnap.exists || familySnap.data()?.inviteCode !== inviteCode) {
      return { errorCode: 'NOT_FOUND' };
    }
    const familyData = familySnap.data();
    const memberCount = Number(familyData.memberCount);
    if (!Number.isSafeInteger(memberCount) || memberCount >= FAMILY_MEMBER_CAP) {
      return { errorCode: 'CONFLICT' };
    }

    const memberUids = Array.isArray(familyData.memberUids) ? familyData.memberUids.slice() : [];
    if (!memberUids.includes(uid)) memberUids.push(uid);
    const timestamp = fieldValue.serverTimestamp();
    const badge = mapFamilyBadge({
      badgeColor: familyData.badgeColor,
      familyId,
      nameAr: familyData.nameAr,
      role: 'member',
    });

    transaction.set(refs.membership, {
      familyId,
      joinedAt: timestamp,
      role: 'member',
      uid,
      updatedAt: timestamp,
    });
    transaction.set(familyRef, {
      memberCount: memberCount + 1,
      memberUids,
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set(refs.profile, { family: badge, updatedAt: timestamp }, { merge: true });

    const result = {
      family: mapFamilySummary({ familyId, ...familyData, memberCount: memberCount + 1, memberUids }),
      role: 'member',
      status: 'joined',
    };
    writeCommandReplay(transaction, refs.command, {
      action: 'join-family',
      inviteCode,
      result,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result };
  });
}

async function mutateLeaveFamily({ db, fieldValue, input, requestId, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      membership: db.doc(`familyMemberships/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, membership, profile, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.membership),
      transaction.get(refs.profile),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'leave-family' && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };
    if (!membership.exists) return { errorCode: 'NOT_FOUND' };

    const membershipData = membership.data();
    const familyId = typeof membershipData.familyId === 'string' ? membershipData.familyId : '';
    const role = typeof membershipData.role === 'string' ? membershipData.role : '';
    if (!familyId) return { errorCode: 'NOT_FOUND' };
    if (role === 'owner') return { errorCode: 'CONFLICT' };

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await transaction.get(familyRef);
    if (!familySnap.exists) return { errorCode: 'NOT_FOUND' };
    const familyData = familySnap.data();
    const memberCount = Number(familyData.memberCount);
    const memberUids = Array.isArray(familyData.memberUids)
      ? familyData.memberUids.filter((memberUid) => memberUid !== uid)
      : [];
    const timestamp = fieldValue.serverTimestamp();

    transaction.delete(refs.membership);
    transaction.set(familyRef, {
      memberCount: Number.isSafeInteger(memberCount) && memberCount > 0 ? memberCount - 1 : memberUids.length,
      memberUids,
      updatedAt: timestamp,
    }, { merge: true });
    if (profile.exists) {
      transaction.set(refs.profile, {
        family: fieldValue.delete(),
        updatedAt: timestamp,
      }, { merge: true });
    }

    const result = { status: 'none' };
    writeCommandReplay(transaction, refs.command, {
      action: 'leave-family',
      result,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result };
  });
}

async function mutateKickFamilyMember({ db, fieldValue, input, requestId, uid }) {
  const validation = normalizeFamilyTargetInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const targetUid = validation.value.targetUid;
  if (targetUid === uid) return { errorCode: 'INVALID_REQUEST' };

  return db.runTransaction(async (transaction) => {
    const refs = {
      actorMembership: db.doc(`familyMemberships/${uid}`),
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
      targetMembership: db.doc(`familyMemberships/${targetUid}`),
      targetProfile: db.doc(`publicProfiles/${targetUid}`),
    };
    const [feature, actorMembership, targetMembership, targetProfile, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.actorMembership),
      transaction.get(refs.targetMembership),
      transaction.get(refs.targetProfile),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'kick-family-member'
        && previous.targetUid === targetUid
        && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };
    if (!actorMembership.exists || !targetMembership.exists) return { errorCode: 'NOT_FOUND' };

    const actorData = actorMembership.data();
    const targetData = targetMembership.data();
    const familyId = typeof actorData.familyId === 'string' ? actorData.familyId : '';
    if (!familyId || targetData.familyId !== familyId) return { errorCode: 'NOT_FOUND' };
    if (!canKickTarget(actorData.role, targetData.role)) return { errorCode: 'PERMISSION_DENIED' };

    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await transaction.get(familyRef);
    if (!familySnap.exists) return { errorCode: 'NOT_FOUND' };
    const familyData = familySnap.data();
    const memberCount = Number(familyData.memberCount);
    const memberUids = Array.isArray(familyData.memberUids)
      ? familyData.memberUids.filter((memberUid) => memberUid !== targetUid)
      : [];
    const timestamp = fieldValue.serverTimestamp();

    transaction.delete(refs.targetMembership);
    transaction.set(familyRef, {
      memberCount: Number.isSafeInteger(memberCount) && memberCount > 0 ? memberCount - 1 : memberUids.length,
      memberUids,
      updatedAt: timestamp,
    }, { merge: true });
    if (targetProfile.exists) {
      transaction.set(refs.targetProfile, {
        family: fieldValue.delete(),
        updatedAt: timestamp,
      }, { merge: true });
    }

    const result = { status: 'kicked', targetUid };
    writeCommandReplay(transaction, refs.command, {
      action: 'kick-family-member',
      result,
      targetUid,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    return { result };
  });
}

async function mutateDissolveFamily({ db, fieldValue, input, requestId, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };

  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`socialCommandRequests/${uid}/requests/${requestId}`),
      feature: db.doc('appConfig/growthFeatures'),
      membership: db.doc(`familyMemberships/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      rate: db.doc(`socialFamilyRateLimits/${uid}`),
    };
    const [feature, membership, profile, command, rate] = await Promise.all([
      transaction.get(refs.feature),
      transaction.get(refs.membership),
      transaction.get(refs.profile),
      transaction.get(refs.command),
      transaction.get(refs.rate),
    ]);

    if (command.exists) {
      const previous = command.data();
      return previous.action === 'dissolve-family' && previous.result
        ? { result: previous.result }
        : { errorCode: 'CONFLICT' };
    }
    if (feature.data()?.families !== true) return { errorCode: 'FEATURE_DISABLED' };
    const rateCheck = checkFamilyRateLimit(rate.exists ? rate.data() : {});
    if (!rateCheck.ok) return { errorCode: rateCheck.code };
    if (!membership.exists || membership.data()?.role !== 'owner') {
      return { errorCode: 'PERMISSION_DENIED' };
    }

    const familyId = membership.data().familyId;
    const familyRef = db.doc(`families/${familyId}`);
    const familySnap = await transaction.get(familyRef);
    if (!familySnap.exists) return { errorCode: 'NOT_FOUND' };
    const familyData = familySnap.data();
    const memberUids = Array.isArray(familyData.memberUids) ? familyData.memberUids : [uid];
    const inviteCode = typeof familyData.inviteCode === 'string' ? familyData.inviteCode : '';

    const memberMembershipRefs = memberUids.map((memberUid) => db.doc(`familyMemberships/${memberUid}`));
    const memberProfileRefs = memberUids.map((memberUid) => db.doc(`publicProfiles/${memberUid}`));
    const memberReads = await Promise.all([
      ...memberMembershipRefs.map((ref) => transaction.get(ref)),
      ...memberProfileRefs.map((ref) => transaction.get(ref)),
    ]);

    const timestamp = fieldValue.serverTimestamp();
    for (let index = 0; index < memberUids.length; index += 1) {
      const membershipSnap = memberReads[index];
      const profileSnap = memberReads[memberUids.length + index];
      if (membershipSnap.exists && membershipSnap.data()?.familyId === familyId) {
        transaction.delete(memberMembershipRefs[index]);
      }
      if (profileSnap.exists) {
        transaction.set(memberProfileRefs[index], {
          family: fieldValue.delete(),
          updatedAt: timestamp,
        }, { merge: true });
      }
    }

    transaction.set(familyRef, {
      dissolvedAt: timestamp,
      memberCount: 0,
      memberUids: [],
      status: 'dissolved',
      updatedAt: timestamp,
    }, { merge: true });
    if (inviteCode) {
      transaction.delete(db.doc(`familyInviteCodes/${inviteCode}`));
    }

    const result = { status: 'none' };
    writeCommandReplay(transaction, refs.command, {
      action: 'dissolve-family',
      result,
      timestamp,
      uid,
    });
    writeRateLimit(transaction, refs.rate, rateCheck, timestamp);
    void profile;
    return { result };
  });
}

function checkFamilyRateLimit(rateData = {}) {
  const nowMs = Date.now();
  const windowStartedAtMs = readTimestampMs(rateData.windowStartedAt);
  const insideWindow = Number.isFinite(windowStartedAtMs)
    && nowMs - windowStartedAtMs < FAMILY_MUTATION_WINDOW_MS;
  const mutationCount = insideWindow && Number.isSafeInteger(rateData.count) ? rateData.count : 0;
  if (mutationCount >= FAMILY_MUTATION_WINDOW_LIMIT) {
    return { ok: false, code: 'RATE_LIMITED' };
  }
  return {
    ok: true,
    count: mutationCount,
    insideWindow,
    nowMs,
    windowStartedAtMs,
  };
}

function writeRateLimit(transaction, rateRef, rateCheck, timestamp) {
  transaction.set(rateRef, {
    count: rateCheck.insideWindow ? rateCheck.count + 1 : 1,
    updatedAt: timestamp,
    windowStartedAt: rateCheck.insideWindow && Number.isFinite(rateCheck.windowStartedAtMs)
      ? { toMillis: () => rateCheck.windowStartedAtMs }
      : timestamp,
  }, { merge: true });
}

function writeCommandReplay(transaction, commandRef, {
  action,
  familyId,
  inviteCode,
  result,
  targetUid,
  timestamp,
  uid,
}) {
  transaction.create(commandRef, {
    action,
    createdAt: timestamp,
    result,
    uid,
    ...(familyId ? { familyId } : {}),
    ...(inviteCode ? { inviteCode } : {}),
    ...(targetUid ? { targetUid } : {}),
  });
}

function readTimestampMs(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isSafeInteger(millis) && millis >= 0 ? millis : NaN;
  }
  if (value && Number.isSafeInteger(value._seconds)) return value._seconds * 1000;
  if (value && Number.isSafeInteger(value.seconds)) return value.seconds * 1000;
  return NaN;
}

module.exports = {
  getMyFamily,
  mutateFamily,
};
