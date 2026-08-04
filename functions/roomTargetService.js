const {
  allocateRoomTargetReturns,
  applyRoomTargetGiftProgress,
  buildRoomTargetSettlementInputs,
  createRoomTargetGoalEventId,
  createRoomTargetProjectionReceiptId,
  normalizeRoomTargetRosterInput,
  validateRoomTargetTemplateV1,
} = require('./roomTargetCore');
const { createRoomSupportPeriodKey } = require('./roomSupportProjectionCore');
const { readPublicAvatarFrameProjection } = require('./avatarFrameProjectionCore');
const {
  enqueueWeeklyIncentiveSettlement,
  processWeeklyIncentiveSettlementBatch,
} = require('./weeklyIncentiveService');
const { createWeeklyCycle, timestampToMillis } = require('./weeklyIncentiveCore');
const { createIntegrityDocumentId } = require('./weeklyIncentiveIntegrityCore');

const ROOM_TARGET_CYCLE_BATCH_LIMIT = 25;
const ROOM_TARGET_SETTLEMENT_GRACE_MS = 15 * 60 * 1000;

async function resolveEffectiveRoomTargetTemplate({ clock, cycleStartAtMillis, db }) {
  if (!Number.isSafeInteger(cycleStartAtMillis) || cycleStartAtMillis < 0) {
    return { errorCode: 'INVALID_CYCLE' };
  }
  const campaignRef = db.doc('roomTargetCampaign/current');
  const campaign = await campaignRef.get();
  if (!campaign.exists || campaign.data()?.emergencyDisabled === true) {
    return { skipped: true, reason: 'campaign-disabled' };
  }
  const versions = await campaignRef.collection('versions')
    .where('effectiveFromAt', '<=', clock.timestampFromMillis(cycleStartAtMillis))
    .orderBy('effectiveFromAt', 'desc')
    .limit(1)
    .get();
  const document = versions.docs[0];
  const template = document?.data()?.template
    ? validateRoomTargetTemplateV1(document.data().template, { publicationStatus: 'published' })
    : undefined;
  if (!template || template.enabled !== true) return { skipped: true, reason: 'no-effective-template' };
  return { revision: document.data().revision, riskSnapshot: document.data().riskSnapshot, template };
}

async function ensureRoomTargetCycle({ clock, db, fieldValue, roomId }) {
  const tentative = createWeeklyCycle({ nowMillis: clock.nowMillis() });
  if (!tentative.ok) return { errorCode: tentative.code };
  let resolved = await resolveEffectiveRoomTargetTemplate({
    clock,
    cycleStartAtMillis: tentative.value.startAtMillis,
    db,
  });
  if (!resolved.template) return resolved;
  const cycle = createWeeklyCycle({
    nowMillis: clock.nowMillis(),
    timeZone: resolved.template.timeZone,
  });
  if (!cycle.ok) return { errorCode: cycle.code };
  if (cycle.value.startAtMillis !== tentative.value.startAtMillis) {
    resolved = await resolveEffectiveRoomTargetTemplate({
      clock,
      cycleStartAtMillis: cycle.value.startAtMillis,
      db,
    });
    if (!resolved.template) return resolved;
  }
  const context = await resolveCycleRosterContext({
    clock,
    cycleId: cycle.value.cycleId,
    cycleStartAtMillis: cycle.value.startAtMillis,
    db,
    roomId,
  });
  if (context.errorCode || context.skipped) return context;
  const roomRef = db.doc(`rooms/${roomId}`);
  const cycleRef = roomRef.collection('targetCycles').doc(cycle.value.cycleId);
  return db.runTransaction(async (transaction) => {
    const [room, existing, flags, campaign] = await transaction.getAll(
      roomRef,
      cycleRef,
      db.doc('appConfig/voiceRoomFeatures'),
      db.doc('roomTargetCampaign/current'),
    );
    if (existing.exists) return { cycleId: cycle.value.cycleId, replayed: true };
    if (flags.data()?.voice_room_owner_targets !== true) return { skipped: true, reason: 'feature-disabled' };
    if (!room.exists || !['active', 'closed'].includes(room.data()?.status || 'active')) {
      return { skipped: true, reason: 'room-ineligible' };
    }
    if (!campaign.exists || campaign.data()?.emergencyDisabled === true) {
      return { skipped: true, reason: 'campaign-disabled' };
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(cycleRef, {
      ...buildTargetRuleSnapshot(resolved.template),
      createdAt: timestamp,
      cycleId: cycle.value.cycleId,
      eligibleSpendCoins: 0,
      endAt: clock.timestampFromMillis(cycle.value.endAtMillis),
      giftCount: 0,
      ownerUidAtCycleStart: context.ownerUid,
      riskSnapshot: resolved.riskSnapshot || {},
      roomId,
      roster: context.roster,
      rosterLocked: true,
      startAt: clock.timestampFromMillis(cycle.value.startAtMillis),
      state: 'active',
      supportPoints: 0,
      templateRevision: resolved.revision,
      updatedAt: timestamp,
    });
    for (const member of context.roster) {
      transaction.create(cycleRef.collection('members').doc(member.uid), {
        createdAt: timestamp,
        eligibleSpendCoins: 0,
        giftCount: 0,
        role: member.role,
        supportPoints: 0,
        uid: member.uid,
        updatedAt: timestamp,
      });
    }
    return { cycleId: cycle.value.cycleId, replayed: false };
  });
}

async function processRoomTargetCycleStarts({ clock, db, fieldValue, limit = 100 }) {
  const flags = await db.doc('appConfig/voiceRoomFeatures').get();
  if (flags.data()?.voice_room_owner_targets !== true) {
    return { processed: 0, reason: 'feature-disabled', scanned: 0 };
  }
  const cursorRef = db.doc('appRuntime/roomTargetCycleStarter');
  const cursorSnapshot = await cursorRef.get();
  const cursorPath = typeof cursorSnapshot.data()?.cursorPath === 'string'
    ? cursorSnapshot.data().cursorPath
    : '';
  let query = db.collection('rooms')
    .where('status', '==', 'active')
    .where('visibility', '==', 'public');
  if (cursorPath) {
    const cursorDocument = await db.doc(cursorPath).get();
    if (cursorDocument.exists) query = query.startAfter(cursorDocument);
  }
  const pageLimit = Math.min(Math.max(limit, 1), 200);
  const rooms = await query.limit(pageLimit).get();
  const results = [];
  for (const room of rooms.docs) {
    const result = await ensureRoomTargetCycle({ clock, db, fieldValue, roomId: room.id });
    if (!result.errorCode && !result.skipped) {
      await materializeRoomTargetPublicCycle({ clock, db, fieldValue, cycleId: result.cycleId, roomId: room.id });
    }
    results.push({ roomId: room.id, ...result });
  }
  const nextCursorPath = rooms.size === pageLimit ? rooms.docs.at(-1).ref.path : '';
  await cursorRef.set({
    cursorPath: nextCursorPath,
    lastRunAt: fieldValue.serverTimestamp(),
    processed: results.filter((entry) => entry.replayed === false).length,
    scanned: rooms.size,
  }, { merge: true });
  return {
    nextCursorPath,
    processed: results.filter((entry) => entry.replayed === false).length,
    results,
    scanned: rooms.size,
  };
}

async function prepareNextRoomTargetRoster({ clock, db, decodedToken, fieldValue, input }) {
  const validation = normalizeRoomTargetRosterInput(input);
  if (!validation.ok) return commandError(validation.code);
  const value = validation.value;
  let currentCycle = createWeeklyCycle({ nowMillis: clock.nowMillis() });
  if (!currentCycle.ok) return commandError(currentCycle.code);
  let nextCycle = createWeeklyCycle({ nowMillis: currentCycle.value.endAtMillis + 1000 });
  if (!nextCycle.ok) return commandError(nextCycle.code);
  let resolved = await resolveEffectiveRoomTargetTemplate({
    clock,
    cycleStartAtMillis: nextCycle.value.startAtMillis,
    db,
  });
  if (!resolved.template) return commandError('TARGET_NOT_CONFIGURED', 409);
  if (resolved.template.timeZone !== nextCycle.value.timeZone) {
    currentCycle = createWeeklyCycle({
      nowMillis: clock.nowMillis(),
      timeZone: resolved.template.timeZone,
    });
    if (!currentCycle.ok) return commandError(currentCycle.code);
    nextCycle = createWeeklyCycle({
      nowMillis: currentCycle.value.endAtMillis + 1000,
      timeZone: resolved.template.timeZone,
    });
    if (!nextCycle.ok) return commandError(nextCycle.code);
    resolved = await resolveEffectiveRoomTargetTemplate({
      clock,
      cycleStartAtMillis: nextCycle.value.startAtMillis,
      db,
    });
    if (!resolved.template) return commandError('TARGET_NOT_CONFIGURED', 409);
  }
  if (value.selectedUids.length > resolved.template.maxSelectedUsers) {
    return commandError('ROSTER_LIMIT_EXCEEDED');
  }
  const roomRef = db.doc(`rooms/${value.roomId}`);
  const commandRef = db.doc(`roomTargetCommandRequests/${decodedToken.uid}/requests/${value.requestId}`);
  const draftRef = roomRef.collection('targetRosterDrafts').doc(nextCycle.value.cycleId);
  const featureRef = db.doc('appConfig/voiceRoomFeatures');
  const profileRefs = [decodedToken.uid, ...value.selectedUids]
    .map((uid) => db.doc(`publicProfiles/${uid}`));
  const holdRefs = [decodedToken.uid, ...value.selectedUids]
    .map((uid) => db.doc(`weeklyIncentiveHolds/${uid}`));
  return db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(
      roomRef,
      commandRef,
      featureRef,
      draftRef,
      ...profileRefs,
      ...holdRefs,
    );
    const room = snapshots[0];
    const command = snapshots[1];
    const feature = snapshots[2];
    const previousDraft = snapshots[3];
    if (command.exists) {
      const previous = command.data();
      return previous.roomId === value.roomId && previous.cycleId === nextCycle.value.cycleId
        ? { ok: true, replayed: true, result: previous.result }
        : commandError('REQUEST_ID_CONFLICT', 409);
    }
    if (feature.data()?.voice_room_owner_targets !== true) return commandError('FEATURE_DISABLED', 403);
    if (!room.exists || !['active', 'closed'].includes(room.data()?.status || 'active')) {
      return commandError('ROOM_NOT_FOUND', 404);
    }
    const ownerUid = room.data()?.ownerUid || room.data()?.hostId || '';
    if (ownerUid !== decodedToken.uid) return commandError('OWNER_REQUIRED', 403);
    if (value.selectedUids.includes(ownerUid)) return commandError('OWNER_ALREADY_INCLUDED');
    const profiles = snapshots.slice(4, 4 + profileRefs.length);
    const holds = snapshots.slice(4 + profileRefs.length);
    for (let index = 0; index < profiles.length; index += 1) {
      const uid = [decodedToken.uid, ...value.selectedUids][index];
      const profile = profiles[index].exists ? profiles[index].data() : undefined;
      const hold = holds[index].exists ? holds[index].data() : undefined;
      if (
        !profile
        || profile.uid !== uid
        || profile.moderationStatus !== 'active'
        || profile.incentiveParticipationRestricted === true
        || hold?.active === true
        || hold?.state === 'active'
      ) return commandError('ROSTER_USER_INELIGIBLE', 409, { uid });
    }
    const timestamp = fieldValue.serverTimestamp();
    const roster = [
      { role: 'owner', uid: ownerUid },
      ...value.selectedUids.map((uid) => ({ role: 'selected', uid })),
    ];
    const result = {
      cycleId: nextCycle.value.cycleId,
      endAtMillis: nextCycle.value.endAtMillis,
      maxSelectedUsers: resolved.template.maxSelectedUsers,
      roomId: value.roomId,
      roster,
      startAtMillis: nextCycle.value.startAtMillis,
      templateRevision: resolved.revision,
    };
    transaction.set(draftRef, {
      createdAt: timestamp,
      cycleId: nextCycle.value.cycleId,
      endAt: clock.timestampFromMillis(nextCycle.value.endAtMillis),
      ownerUidAtPreparation: ownerUid,
      roomId: value.roomId,
      roster,
      selectedUids: value.selectedUids,
      startAt: clock.timestampFromMillis(nextCycle.value.startAtMillis),
      templatePreview: buildTargetRuleSnapshot(resolved.template),
      templateRevision: resolved.revision,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    transaction.set(roomRef.collection('targetRosterPreviews').doc(nextCycle.value.cycleId), {
      cycleId: nextCycle.value.cycleId,
      endAt: clock.timestampFromMillis(nextCycle.value.endAtMillis),
      ownerUid,
      roomId: value.roomId,
      roster: roster.map((entry, index) => {
        const profile = profiles[index]?.data() || {};
        return {
          avatarLabel: typeof profile.avatarLabel === 'string' ? profile.avatarLabel.slice(0, 3) : '',
          ...(readPublicAvatarFrameProjection(profile) ? { avatarFrame: readPublicAvatarFrameProjection(profile) } : {}),
          avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 2048) : '',
          displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 60) : 'User',
          role: entry.role,
          uid: entry.uid,
        };
      }),
      rules: {
        conversion: resolved.template.conversion,
        maxSelectedUsers: resolved.template.maxSelectedUsers,
        perRoomReturnCap: resolved.template.perRoomReturnCap,
        perUserReturnCap: resolved.template.perUserReturnCap,
        returnBps: resolved.template.returnBps,
        targetSupportPoints: resolved.template.targetSupportPoints,
      },
      schemaVersion: 1,
      startAt: clock.timestampFromMillis(nextCycle.value.startAtMillis),
      templateRevision: resolved.revision,
      updatedAt: timestamp,
    });
    const selectedSet = new Set(value.selectedUids);
    const previousSelectedUids = previousDraft.exists && Array.isArray(previousDraft.data()?.selectedUids)
      ? previousDraft.data().selectedUids
      : [];
    const previousSelectedSet = new Set(previousSelectedUids);
    const rosterChangeCount = [
      ...previousSelectedUids.filter((uid) => !selectedSet.has(uid)),
      ...value.selectedUids.filter((uid) => !previousSelectedSet.has(uid)),
    ].length;
    if (rosterChangeCount > 0) {
      const churnId = createIntegrityDocumentId('rtc', [value.roomId, nextCycle.value.cycleId]);
      transaction.set(db.doc(`roomTargetRosterChurn/${churnId}`), {
        changeCount: fieldValue.increment(rosterChangeCount),
        cycleId: nextCycle.value.cycleId,
        lastChangedAt: timestamp,
        lastChangedBy: decodedToken.uid,
        roomId: value.roomId,
        schemaVersion: 1,
      }, { merge: true });
    }
    for (const previousUid of previousSelectedUids) {
      if (selectedSet.has(previousUid)) continue;
      const notificationRef = db.doc(`roomTargetRosterNotifications/${value.roomId}_${nextCycle.value.cycleId}_${previousUid}`);
      transaction.set(notificationRef, {
        cancelledAt: timestamp,
        state: 'cancelled',
        updatedAt: timestamp,
      }, { merge: true });
    }
    for (const uid of value.selectedUids) {
      const notificationRef = db.doc(`roomTargetRosterNotifications/${value.roomId}_${nextCycle.value.cycleId}_${uid}`);
      transaction.set(notificationRef, {
        actorUid: ownerUid,
        createdAt: timestamp,
        cycleId: nextCycle.value.cycleId,
        endAt: clock.timestampFromMillis(nextCycle.value.endAtMillis),
        recipientUid: uid,
        requestId: `room_target_roster_${value.roomId}_${nextCycle.value.cycleId}_${uid}`.slice(0, 180),
        roomId: value.roomId,
        rules: buildTargetRuleSnapshot(resolved.template),
        startAt: clock.timestampFromMillis(nextCycle.value.startAtMillis),
        state: 'queued',
        updatedAt: timestamp,
      });
    }
    transaction.create(commandRef, {
      action: 'prepare-next-roster',
      createdAt: timestamp,
      cycleId: nextCycle.value.cycleId,
      requestId: value.requestId,
      result,
      roomId: value.roomId,
      uid: decodedToken.uid,
    });
    return { ok: true, replayed: false, result };
  });
}

async function searchRoomTargetRosterUsers({ db, decodedToken, discoverUsers, input }) {
  const roomId = typeof input?.roomId === 'string' ? input.roomId.trim() : '';
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!roomId || roomId.length > 128 || roomId.includes('/') || query.length > 64) {
    return commandError('INVALID_REQUEST');
  }
  const [room, flags, requester] = await Promise.all([
    db.doc(`rooms/${roomId}`).get(),
    db.doc('appConfig/voiceRoomFeatures').get(),
    db.doc(`publicProfiles/${decodedToken.uid}`).get(),
  ]);
  if (flags.data()?.voice_room_owner_targets !== true) return commandError('FEATURE_DISABLED', 403);
  if (!room.exists || !['active', 'closed'].includes(room.data()?.status || 'active')) return commandError('ROOM_NOT_FOUND', 404);
  const ownerUid = room.data()?.ownerUid || room.data()?.hostId || '';
  if (ownerUid !== decodedToken.uid) return commandError('OWNER_REQUIRED', 403);
  if (!requester.exists || requester.data()?.moderationStatus !== 'active') return commandError('PROFILE_INCOMPLETE', 403);
  const discovery = await discoverUsers({
    db,
    input: { limit: 12, query },
    skipFeatureGate: true,
    uid: decodedToken.uid,
  });
  return discovery.errorCode
    ? commandError(discovery.errorCode)
    : { ok: true, result: discovery.result };
}

async function projectRoomTargetGiftFact({ clock, db, fact, fieldValue }) {
  if (
    !fact?.eventId
    || !fact.roomId
    || !fact.weekId
    || !Number.isSafeInteger(fact.weekStartAtMillis)
    || !Number.isSafeInteger(fact.weekEndAtMillis)
  ) return { errorCode: 'INVALID_GIFT_FACT' };
  const flags = await db.doc('appConfig/voiceRoomFeatures').get();
  if (flags.data()?.voice_room_owner_targets !== true) return { skipped: true, reason: 'feature-disabled' };
  const resolved = await resolveEffectiveRoomTargetTemplate({
    clock,
    cycleStartAtMillis: fact.weekStartAtMillis,
    db,
  });
  if (!resolved.template) return resolved;
  const context = await resolveCycleRosterContext({
    clock,
    cycleId: fact.weekId,
    cycleStartAtMillis: fact.weekStartAtMillis,
    db,
    roomId: fact.roomId,
  });
  if (context.errorCode || context.skipped) return context;
  const result = await db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${fact.roomId}`);
    const cycleRef = roomRef.collection('targetCycles').doc(fact.weekId);
    const memberRef = cycleRef.collection('members').doc(fact.senderUid);
    const receiptId = createRoomTargetProjectionReceiptId(fact.eventId);
    const receiptRef = db.doc(`roomTargetProjectionReceipts/${receiptId}`);
    const eventRef = roomRef.collection('events').doc(createRoomTargetGoalEventId(fact.roomId, fact.weekId));
    const campaignRef = db.doc('roomTargetCampaign/current');
    const [room, cycle, member, receipt, campaign] = await transaction.getAll(
      roomRef,
      cycleRef,
      memberRef,
      receiptRef,
      campaignRef,
    );
    if (receipt.exists) {
      return receipt.data()?.eventId === fact.eventId && receipt.data()?.roomId === fact.roomId
        ? { excluded: receipt.data()?.excluded === true, replayed: true }
        : { errorCode: 'TARGET_PROJECTION_CONFLICT' };
    }
    if (!room.exists || !['active', 'closed'].includes(room.data()?.status || 'active')) {
      return { skipped: true, reason: 'room-ineligible' };
    }
    if (!campaign.exists || campaign.data()?.emergencyDisabled === true) {
      return { skipped: true, reason: 'campaign-disabled' };
    }
    const roster = cycle.exists ? cycle.data()?.roster : context.roster;
    const rosterMember = Array.isArray(roster)
      ? roster.find((entry) => entry?.uid === fact.senderUid)
      : undefined;
    const timestamp = fieldValue.serverTimestamp();
    if (!rosterMember) {
      transaction.create(receiptRef, {
        cycleId: fact.weekId,
        eventId: fact.eventId,
        excluded: true,
        exclusionReason: 'SENDER_NOT_IN_LOCKED_ROSTER',
        projectedAt: timestamp,
        receiptId,
        roomId: fact.roomId,
        senderUid: fact.senderUid,
      });
      return { excluded: true, replayed: false };
    }
    const initialCycle = cycle.exists ? cycle.data() : {
      ...buildTargetRuleSnapshot(resolved.template),
      cycleId: fact.weekId,
      eligibleSpendCoins: 0,
      endAt: clock.timestampFromMillis(fact.weekEndAtMillis),
      giftCount: 0,
      ownerUidAtCycleStart: context.ownerUid,
      riskSnapshot: resolved.riskSnapshot || {},
      roomId: fact.roomId,
      roster: context.roster,
      rosterLocked: true,
      schemaVersion: 1,
      startAt: clock.timestampFromMillis(fact.weekStartAtMillis),
      state: 'active',
      supportPoints: 0,
      templateRevision: resolved.revision,
    };
    if (
      initialCycle.cycleId !== fact.weekId
      || initialCycle.roomId !== fact.roomId
      || initialCycle.templateRevision !== resolved.revision
      || !Array.isArray(initialCycle.roster)
    ) return { errorCode: 'TARGET_CYCLE_CONFLICT' };
    const initialMember = member.exists ? member.data() : {
      eligibleSpendCoins: 0,
      giftCount: 0,
      role: rosterMember.role,
      supportPoints: 0,
      uid: fact.senderUid,
    };
    const progress = applyRoomTargetGiftProgress(initialCycle, initialMember, fact);
    if (!progress.ok) {
      transaction.create(receiptRef, {
        cycleId: fact.weekId,
        eventId: fact.eventId,
        excluded: true,
        exclusionReason: progress.code,
        projectedAt: timestamp,
        receiptId,
        roomId: fact.roomId,
        senderUid: fact.senderUid,
      });
      return { excluded: true, reason: progress.code, replayed: false };
    }
    transaction.set(cycleRef, {
      ...initialCycle,
      ...progress.value.cycle,
      ...(progress.value.crossedGoal ? { goalCrossedAt: timestamp } : {}),
      createdAt: cycle.exists ? initialCycle.createdAt || timestamp : timestamp,
      updatedAt: timestamp,
    });
    transaction.set(memberRef, {
      ...initialMember,
      ...progress.value.member,
      firstContributionAt: member.exists ? initialMember.firstContributionAt || timestamp : timestamp,
      lastContributionAt: timestamp,
      updatedAt: timestamp,
    });
    if (!cycle.exists) {
      for (const rosterEntry of context.roster) {
        if (rosterEntry.uid === fact.senderUid) continue;
        transaction.create(cycleRef.collection('members').doc(rosterEntry.uid), {
          createdAt: timestamp,
          eligibleSpendCoins: 0,
          giftCount: 0,
          role: rosterEntry.role,
          supportPoints: 0,
          uid: rosterEntry.uid,
          updatedAt: timestamp,
        });
      }
    }
    transaction.create(receiptRef, {
      cycleId: fact.weekId,
      debitedCoins: fact.debitedCoins,
      eventId: fact.eventId,
      excluded: false,
      projectedAt: timestamp,
      receiptId,
      roomId: fact.roomId,
      senderUid: fact.senderUid,
      supportPoints: fact.supportPoints,
    });
    if (progress.value.crossedGoal) {
      transaction.create(eventRef, {
        createdAt: timestamp,
        cycleId: fact.weekId,
        eventId: eventRef.id,
        occurredAt: timestamp,
        roomId: fact.roomId,
        supportPoints: progress.value.cycle.supportPoints,
        targetSupportPoints: initialCycle.targetSupportPoints,
        type: 'room-target-goal-crossed',
      });
    }
    return {
      crossedGoal: progress.value.crossedGoal,
      excluded: false,
      replayed: false,
      state: progress.value.cycle.state,
    };
  });
  if (!result.errorCode && !result.skipped) {
    await materializeRoomTargetPublicCycle({
      clock,
      cycleId: fact.weekId,
      db,
      fieldValue,
      roomId: fact.roomId,
    });
  }
  return result;
}

async function resolveCycleRosterContext({ clock, cycleId, cycleStartAtMillis, db, roomId }) {
  const roomRef = db.doc(`rooms/${roomId}`);
  const [room, draft] = await Promise.all([
    roomRef.get(),
    roomRef.collection('targetRosterDrafts').doc(cycleId).get(),
  ]);
  if (!room.exists) return { skipped: true, reason: 'room-ineligible' };
  let ownerUid = room.data()?.ownerUid || room.data()?.hostId || '';
  const transferredAtMillis = timestampToMillis(room.data()?.lastOwnershipTransferredAt);
  const transferId = room.data()?.lastOwnershipTransferId;
  if (transferId && transferredAtMillis > cycleStartAtMillis) {
    const transfer = await roomRef.collection('ownershipTransfers').doc(transferId).get();
    if (transfer.exists && transfer.data()?.status === 'accepted' && transfer.data()?.fromUid) {
      ownerUid = transfer.data().fromUid;
    }
  }
  if (!ownerUid) return { errorCode: 'ROOM_OWNER_MISSING' };
  const selectedUids = draft.exists && Array.isArray(draft.data()?.selectedUids)
    ? draft.data().selectedUids.filter((uid) => typeof uid === 'string' && uid !== ownerUid)
    : [];
  return {
    ownerUid,
    roster: [
      { role: 'owner', uid: ownerUid },
      ...selectedUids.map((uid) => ({ role: 'selected', uid })),
    ],
  };
}

async function finalizeRoomTargetCycle({ clock, cycleId, db, fieldValue, roomId }) {
  const cycleRef = db.doc(`rooms/${roomId}/targetCycles/${cycleId}`);
  const cycleSnapshot = await cycleRef.get();
  if (!cycleSnapshot.exists) return { errorCode: 'CYCLE_NOT_FOUND' };
  const cycle = cycleSnapshot.data();
  const endAtMillis = timestampToMillis(cycle.endAt);
  if (!Number.isSafeInteger(endAtMillis) || clock.nowMillis() < endAtMillis + ROOM_TARGET_SETTLEMENT_GRACE_MS) {
    return { skipped: true, reason: 'cycle-not-ready' };
  }
  if (cycle.state === 'active') {
    await cycleRef.set({
      closedAt: fieldValue.serverTimestamp(),
      outcome: 'target-missed',
      state: 'missed',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'missed' };
  }
  if (['missed', 'settled', 'held'].includes(cycle.state)) return { state: cycle.state };
  const [room, campaign] = await Promise.all([
    db.doc(`rooms/${roomId}`).get(),
    db.doc('roomTargetCampaign/current').get(),
  ]);
  if (
    !room.exists
    || !['active', 'closed'].includes(room.data()?.status || 'active')
    || room.data()?.incentiveSettlementHold === true
    || campaign.data()?.emergencyDisabled === true
  ) {
    await cycleRef.set({
      holdReason: campaign.data()?.emergencyDisabled === true ? 'CAMPAIGN_EMERGENCY_DISABLED' : 'ROOM_NOT_ELIGIBLE',
      state: 'held',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'held' };
  }
  if (cycle.state === 'unlocked') {
    const period = await db.doc(`roomSupportPeriods/${createRoomSupportPeriodKey(roomId, cycleId)}`).get();
    const lastReconciledAtMillis = timestampToMillis(period.data()?.lastReconciledAt);
    const latestFacts = await db.collection('canonicalRoomGiftFacts')
      .where('roomId', '==', roomId)
      .where('periodIds', 'array-contains', cycleId)
      .orderBy('projectedAt', 'desc')
      .limit(1)
      .get();
    const latestProjectedAtMillis = timestampToMillis(latestFacts.docs[0]?.data()?.projectedAt);
    if (
      !period.exists
      || lastReconciledAtMillis < endAtMillis
      || (latestFacts.size > 0 && lastReconciledAtMillis < latestProjectedAtMillis)
    ) return { skipped: true, reason: 'awaiting-reconciliation' };
    const members = await cycleRef.collection('members').get();
    const memberUids = members.docs.map((document) => document.id);
    const profiles = memberUids.length
      ? await db.getAll(...memberUids.map((uid) => db.doc(`publicProfiles/${uid}`)))
      : [];
    const globalHolds = memberUids.length
      ? await db.getAll(...memberUids.map((uid) => db.doc(`weeklyIncentiveHolds/${uid}`)))
      : [];
    const cycleHolds = memberUids.length
      ? await db.getAll(...memberUids.map((uid) => cycleRef.collection('holds').doc(uid)))
      : [];
    const outcomes = members.docs.map((document, index) => {
      const profile = profiles[index]?.exists ? profiles[index].data() : undefined;
      const globalHold = globalHolds[index]?.exists ? globalHolds[index].data() : undefined;
      const cycleHold = cycleHolds[index]?.exists ? cycleHolds[index].data() : undefined;
      const eligible = Boolean(
        profile
        && profile.uid === document.id
        && profile.moderationStatus === 'active'
        && profile.incentiveParticipationRestricted !== true
        && globalHold?.active !== true
        && globalHold?.state !== 'active'
        && cycleHold?.active !== true
      );
      return {
        ...document.data(),
        eligibilityReason: eligible
          ? ''
          : !profile
            ? 'PROFILE_MISSING'
            : profile.moderationStatus !== 'active'
              ? 'PROFILE_NOT_ACTIVE'
              : cycleHold?.active === true
                ? 'CYCLE_DISQUALIFIED'
                : 'PAYOUT_HOLD',
        eligible,
        uid: document.id,
      };
    });
    const allocation = allocateRoomTargetReturns(outcomes, mapCycleTemplate(cycle));
    if (!allocation.ok) return { errorCode: allocation.code };
    const settlements = buildRoomTargetSettlementInputs({
      allocations: allocation.value.allocations,
      cycle,
      roomId,
    });
    if (!settlements.ok) return { errorCode: settlements.code };
    const flags = await db.doc('appConfig/voiceRoomFeatures').get();
    const payoutEnabled = flags.data()?.voice_room_owner_target_payouts === true;
    const noEligibleReturns = settlements.value.length === 0;
    const finalReturns = outcomes.map((outcome) => {
      const payout = allocation.value.allocations.find((entry) => entry.uid === outcome.uid);
      const settlement = settlements.value.find((entry) => entry.uid === outcome.uid);
      return {
        amount: payout?.amount || 0,
        cappedByRoom: payout?.cappedByRoom === true,
        currency: cycle.conversion.payoutCurrency,
        eligible: outcome.eligible,
        eligibleSpendCoins: outcome.eligibleSpendCoins,
        eligibilityReason: outcome.eligibilityReason,
        ...(settlement ? { settlementId: settlement.settlementId } : {}),
        uid: outcome.uid,
      };
    });
    await cycleRef.set({
      closedAt: fieldValue.serverTimestamp(),
      finalReturns,
      payoutEnabledAtClose: payoutEnabled,
      requestedReturnTotal: allocation.value.requestedTotal,
      returnTotal: allocation.value.total,
      settlementIds: settlements.value.map((entry) => entry.settlementId),
      ...(noEligibleReturns ? { holdReason: 'NO_ELIGIBLE_RETURNS' } : {}),
      state: noEligibleReturns ? 'held' : payoutEnabled ? 'settling' : 'ready',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    if (payoutEnabled && !noEligibleReturns) {
      for (const input of settlements.value) {
        const queued = await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input });
        if (queued.errorCode) return { errorCode: queued.errorCode };
      }
    }
    return {
      payoutEnabled,
      state: noEligibleReturns ? 'held' : payoutEnabled ? 'settling' : 'ready',
    };
  }
  if (cycle.state === 'ready') {
    const flags = await db.doc('appConfig/voiceRoomFeatures').get();
    if (flags.data()?.voice_room_owner_target_payouts !== true) {
      return { payoutEnabled: false, state: 'ready' };
    }
    for (const targetReturn of cycle.finalReturns || []) {
      if (!targetReturn.settlementId || targetReturn.amount < 1) continue;
      const input = buildRoomTargetSettlementInputs({
        allocations: [targetReturn],
        cycle,
        roomId,
      });
      if (!input.ok) return { errorCode: input.code };
      const queued = await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input: input.value[0] });
      if (queued.errorCode) return { errorCode: queued.errorCode };
    }
    await cycleRef.set({ state: 'settling', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    return { payoutEnabled: true, state: 'settling' };
  }
  if (cycle.state === 'settling') {
    const settlements = await Promise.all((cycle.settlementIds || []).map(
      (settlementId) => db.doc(`rewardSettlements/${settlementId}`).get(),
    ));
    if (settlements.some((snapshot) => snapshot.exists && snapshot.data()?.state === 'held')) {
      await cycleRef.set({ holdReason: 'SETTLEMENT_HELD', state: 'held', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      return { state: 'held' };
    }
    if (!settlements.length || settlements.some((snapshot) => !snapshot.exists || snapshot.data()?.state !== 'paid')) {
      return { skipped: true, reason: 'settlements-pending' };
    }
    await cycleRef.set({
      settledAt: fieldValue.serverTimestamp(),
      state: 'settled',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'settled' };
  }
  return { errorCode: 'INVALID_CYCLE_STATE' };
}

async function processRoomTargetCycles({ clock, db, fieldValue, limit = ROOM_TARGET_CYCLE_BATCH_LIMIT }) {
  const candidates = [];
  for (const state of ['active', 'unlocked', 'ready', 'settling']) {
    const snapshot = await db.collectionGroup('targetCycles')
      .where('state', '==', state)
      .where('endAt', '<=', clock.timestampFromMillis(clock.nowMillis() - ROOM_TARGET_SETTLEMENT_GRACE_MS))
      .orderBy('endAt', 'asc')
      .limit(Math.min(limit, ROOM_TARGET_CYCLE_BATCH_LIMIT))
      .get();
    candidates.push(...snapshot.docs);
    if (candidates.length >= limit) break;
  }
  const unique = [...new Map(candidates.map((document) => [document.ref.path, document])).values()].slice(0, limit);
  const results = [];
  for (const document of unique) {
    const roomId = document.ref.parent.parent?.id || document.data()?.roomId;
    const result = await finalizeRoomTargetCycle({ clock, cycleId: document.id, db, fieldValue, roomId });
    if (!result.errorCode) {
      await materializeRoomTargetPublicCycle({ clock, cycleId: document.id, db, fieldValue, roomId });
    }
    results.push({
      cycleId: document.id,
      roomId,
      ...result,
    });
  }
  await processWeeklyIncentiveSettlementBatch({
    clock,
    db,
    fieldValue,
    options: {
      dryRun: false,
      leaseMillis: 60_000,
      limit: Math.min(100, limit * 3),
      workerId: 'room-target-worker',
    },
  });
  return { processed: results.length, results };
}

async function materializeRoomTargetPublicCycle({ clock, cycleId, db, fieldValue, roomId }) {
  const cycleRef = db.doc(`rooms/${roomId}/targetCycles/${cycleId}`);
  const publicRef = db.doc(`rooms/${roomId}/targetPublicCycles/${cycleId}`);
  const [cycle, members] = await Promise.all([
    cycleRef.get(),
    cycleRef.collection('members').get(),
  ]);
  if (!cycle.exists) return { skipped: true, reason: 'cycle-not-found' };
  const value = cycle.data();
  const profiles = members.docs.length
    ? await db.getAll(...members.docs.map((document) => db.doc(`publicProfiles/${document.id}`)))
    : [];
  const candidates = members.docs.map((document) => ({
    ...document.data(),
    eligible: true,
    uid: document.id,
  }));
  const estimated = allocateRoomTargetReturns(candidates, mapCycleTemplate(value));
  if (!estimated.ok) return { errorCode: estimated.code };
  const finalByUid = new Map(
    (Array.isArray(value.finalReturns) ? value.finalReturns : [])
      .filter((entry) => entry && typeof entry.uid === 'string')
      .map((entry) => [entry.uid, entry]),
  );
  const roster = members.docs.map((document, index) => {
    const member = document.data();
    const profile = profiles[index]?.exists ? profiles[index].data() : {};
    const estimate = estimated.value.allocations.find((entry) => entry.uid === document.id);
    const finalReturn = finalByUid.get(document.id);
    return {
      avatarLabel: typeof profile.avatarLabel === 'string' ? profile.avatarLabel.slice(0, 3) : '',
      ...(readPublicAvatarFrameProjection(profile) ? { avatarFrame: readPublicAvatarFrameProjection(profile) } : {}),
      avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 2048) : '',
      displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 60) : 'User',
      eligibleSpendCoins: Number.isSafeInteger(member.eligibleSpendCoins) ? member.eligibleSpendCoins : 0,
      estimatedReturn: estimate?.amount || 0,
      ...(finalReturn ? {
        finalEligible: finalReturn.eligible === true,
        finalReturn: Number.isSafeInteger(finalReturn.amount) ? finalReturn.amount : 0,
      } : {}),
      role: member.role === 'owner' ? 'owner' : 'selected',
      supportPoints: Number.isSafeInteger(member.supportPoints) ? member.supportPoints : 0,
      uid: document.id,
    };
  });
  await publicRef.set({
    conversion: value.conversion,
    cycleId,
    endAt: value.endAt,
    generatedAt: fieldValue.serverTimestamp(),
    perRoomReturnCap: value.perRoomReturnCap,
    perUserReturnCap: value.perUserReturnCap,
    returnBps: value.returnBps,
    roomId,
    roster,
    schemaVersion: 1,
    startAt: value.startAt,
    state: value.state,
    supportPoints: value.supportPoints,
    targetSupportPoints: value.targetSupportPoints,
    templateRevision: value.templateRevision,
    updatedAt: fieldValue.serverTimestamp(),
  });
  return { generatedAtMillis: clock.nowMillis(), rosterSize: roster.length };
}

async function processRoomTargetRosterNotifications({ db, deliver, fieldValue, limit = 50 }) {
  const snapshot = await db.collection('roomTargetRosterNotifications')
    .where('state', '==', 'queued')
    .orderBy('createdAt')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  const results = [];
  for (const document of snapshot.docs) {
    try {
      const job = document.data();
      const delivery = await deliver({
        actorUid: job.actorUid,
        kind: 'room-target-selected',
        recipientUid: job.recipientUid,
        requestId: job.requestId,
      });
      if (delivery?.errorCode || delivery?.status === 'failed') throw new Error(delivery?.errorCode || 'delivery-failed');
      await document.ref.set({
        deliveredAt: fieldValue.serverTimestamp(),
        state: 'delivered',
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({ notificationId: document.id, state: 'delivered' });
    } catch (error) {
      await document.ref.set({
        attempts: fieldValue.increment(1),
        lastFailure: String(error?.message || 'delivery-failed').slice(0, 200),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({ notificationId: document.id, state: 'queued' });
    }
  }
  return { processed: results.length, results };
}

function buildTargetRuleSnapshot(template) {
  return {
    conversion: template.conversion,
    eligibleGiftRules: template.eligibleGiftRules,
    maxSelectedUsers: template.maxSelectedUsers,
    perRoomReturnCap: template.perRoomReturnCap,
    perUserReturnCap: template.perUserReturnCap,
    returnBps: template.returnBps,
    riskValuation: template.riskValuation,
    schemaVersion: 1,
    targetSupportPoints: template.targetSupportPoints,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    timeZone: template.timeZone,
  };
}

function mapCycleTemplate(cycle) {
  return {
    conversion: cycle.conversion,
    eligibleGiftRules: cycle.eligibleGiftRules,
    enabled: true,
    maxSelectedUsers: cycle.maxSelectedUsers,
    perRoomReturnCap: cycle.perRoomReturnCap,
    perUserReturnCap: cycle.perUserReturnCap,
    publicationStatus: 'published',
    returnBps: cycle.returnBps,
    riskValuation: cycle.riskValuation,
    schemaVersion: 1,
    targetSupportPoints: cycle.targetSupportPoints,
    templateId: 'global-room-target',
    templateVersion: 1,
    timeZone: cycle.timeZone,
  };
}

function commandError(code, status = 400, details) {
  return {
    code,
    ...(details ? { details } : {}),
    error: code,
    ok: false,
    status,
  };
}

module.exports = {
  ROOM_TARGET_CYCLE_BATCH_LIMIT,
  ROOM_TARGET_SETTLEMENT_GRACE_MS,
  finalizeRoomTargetCycle,
  materializeRoomTargetPublicCycle,
  prepareNextRoomTargetRoster,
  processRoomTargetCycles,
  processRoomTargetCycleStarts,
  processRoomTargetRosterNotifications,
  projectRoomTargetGiftFact,
  ensureRoomTargetCycle,
  resolveCycleRosterContext,
  resolveEffectiveRoomTargetTemplate,
  searchRoomTargetRosterUsers,
};
