const {
  applyRocketGiftProgress,
  buildRocketSettlementInputs,
  calculateRocketRewardLiability,
  createRocketGoalEventId,
  createRocketProjectionReceiptId,
  selectRocketPodium,
  validateRoomRocketTemplateV1,
} = require('./roomRocketCore');
const { createRoomSupportPeriodKey } = require('./roomSupportProjectionCore');
const {
  enqueueWeeklyIncentiveSettlement,
  processWeeklyIncentiveSettlementBatch,
} = require('./weeklyIncentiveService');
const { timestampToMillis } = require('./weeklyIncentiveCore');

const ROCKET_CYCLE_BATCH_LIMIT = 25;
const ROCKET_SETTLEMENT_GRACE_MS = 15 * 60 * 1000;
const ROCKET_CANDIDATE_SCAN_LIMIT = 100;

async function resolveEffectiveRoomRocketTemplate({ clock, db, cycleStartAtMillis }) {
  if (!Number.isSafeInteger(cycleStartAtMillis) || cycleStartAtMillis < 0) {
    return { errorCode: 'INVALID_CYCLE' };
  }
  const campaignRef = db.doc('roomRocketCampaign/current');
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
    ? validateRoomRocketTemplateV1(document.data().template, { publicationStatus: 'published' })
    : undefined;
  if (!template) return { skipped: true, reason: 'no-effective-template' };
  return {
    revision: document.data().revision,
    template,
  };
}

async function projectRoomRocketGiftFact({ clock, db, fact, fieldValue }) {
  if (
    !fact?.eventId
    || !fact.roomId
    || !fact.weekId
    || !Number.isSafeInteger(fact.weekStartAtMillis)
    || !Number.isSafeInteger(fact.weekEndAtMillis)
  ) return { errorCode: 'INVALID_GIFT_FACT' };
  const resolved = await resolveEffectiveRoomRocketTemplate({
    clock,
    cycleStartAtMillis: fact.weekStartAtMillis,
    db,
  });
  if (!resolved.template) return resolved;
  const template = resolved.template;
  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${fact.roomId}`);
    const cycleRef = db.doc(`rooms/${fact.roomId}/rocketCycles/${fact.weekId}`);
    const receiptId = createRocketProjectionReceiptId(fact.eventId);
    const receiptRef = db.doc(`roomRocketProjectionReceipts/${receiptId}`);
    const goalEventId = createRocketGoalEventId(fact.roomId, fact.weekId);
    const eventRef = db.doc(`rooms/${fact.roomId}/events/${goalEventId}`);
    const campaignRef = db.doc('roomRocketCampaign/current');
    const [room, cycle, receipt, campaign] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(cycleRef),
      transaction.get(receiptRef),
      transaction.get(campaignRef),
    ]);
    if (receipt.exists) {
      return receipt.data()?.eventId === fact.eventId && receipt.data()?.roomId === fact.roomId
        ? { replayed: true }
        : { errorCode: 'ROCKET_PROJECTION_CONFLICT' };
    }
    if (!room.exists || !['active', 'closed'].includes(room.data()?.status || 'active')) {
      return { skipped: true, reason: 'room-ineligible' };
    }
    if (!campaign.exists || campaign.data()?.emergencyDisabled === true) {
      return { skipped: true, reason: 'campaign-disabled' };
    }
    const initial = cycle.exists ? cycle.data() : {
      appearance: template.appearance,
      cycleId: fact.weekId,
      enabledRankCount: template.enabledRankCount,
      endAt: clock.timestampFromMillis(fact.weekEndAtMillis),
      giftCount: 0,
      minimumClientVersion: template.minimumClientVersion,
      rewards: template.rewards,
      rewardLiability: calculateRocketRewardLiability(template.rewards, template.enabledRankCount),
      roomId: fact.roomId,
      schemaVersion: 1,
      startAt: clock.timestampFromMillis(fact.weekStartAtMillis),
      state: 'active',
      supportPoints: 0,
      targetSupportPoints: template.targetSupportPoints,
      templateRevision: resolved.revision,
      timeZone: template.timeZone,
    };
    if (
      initial.cycleId !== fact.weekId
      || initial.roomId !== fact.roomId
      || initial.templateRevision !== resolved.revision
    ) return { errorCode: 'ROCKET_CYCLE_CONFLICT' };
    const progress = applyRocketGiftProgress(initial, fact);
    if (!progress.ok) return { errorCode: progress.code };
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(cycleRef, {
      ...initial,
      ...progress.value,
      ...(progress.value.crossedGoal ? { goalCrossedAt: timestamp } : {}),
      createdAt: cycle.exists ? initial.createdAt || timestamp : timestamp,
      updatedAt: timestamp,
    });
    transaction.create(receiptRef, {
      cycleId: fact.weekId,
      eventId: fact.eventId,
      projectedAt: timestamp,
      receiptId,
      roomId: fact.roomId,
      supportPoints: fact.supportPoints,
    });
    if (progress.value.crossedGoal) {
      transaction.create(eventRef, {
        appearance: template.appearance,
        createdAt: timestamp,
        cycleId: fact.weekId,
        eventId: goalEventId,
        occurredAt: timestamp,
        roomId: fact.roomId,
        supportPoints: progress.value.supportPoints,
        targetSupportPoints: template.targetSupportPoints,
        type: 'rocket-goal-crossed',
      });
    }
    return {
      crossedGoal: progress.value.crossedGoal,
      replayed: false,
      state: progress.value.state,
      supportPoints: progress.value.supportPoints,
    };
  });
}

async function finalizeRoomRocketCycle({ clock, db, fieldValue, roomId, cycleId }) {
  const cycleRef = db.doc(`rooms/${roomId}/rocketCycles/${cycleId}`);
  const cycleSnapshot = await cycleRef.get();
  if (!cycleSnapshot.exists) return { errorCode: 'CYCLE_NOT_FOUND' };
  const cycle = cycleSnapshot.data();
  const endAtMillis = timestampToMillis(cycle.endAt);
  if (!Number.isSafeInteger(endAtMillis) || clock.nowMillis() < endAtMillis + ROCKET_SETTLEMENT_GRACE_MS) {
    return { skipped: true, reason: 'cycle-not-ready' };
  }
  if (cycle.state === 'active') {
    await cycleRef.set({
      closedAt: fieldValue.serverTimestamp(),
      state: 'missed',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'missed' };
  }
  if (['missed', 'settled', 'held'].includes(cycle.state)) return { state: cycle.state };
  const expectedLiability = calculateRocketRewardLiability(cycle.rewards, cycle.enabledRankCount);
  if (
    !expectedLiability
    || !cycle.rewardLiability
    || ['coins', 'diamonds', 'itemGrantCount', 'rankCount'].some(
      (field) => cycle.rewardLiability[field] !== expectedLiability[field],
    )
  ) {
    await cycleRef.set({
      holdReason: 'REWARD_LIABILITY_MISMATCH',
      state: 'held',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'held' };
  }
  const [roomSnapshot, campaignSnapshot] = await Promise.all([
    db.doc(`rooms/${roomId}`).get(),
    db.doc('roomRocketCampaign/current').get(),
  ]);
  if (
    !roomSnapshot.exists
    || !['active', 'closed'].includes(roomSnapshot.data()?.status || 'active')
    || roomSnapshot.data()?.incentiveSettlementHold === true
    || campaignSnapshot.data()?.emergencyDisabled === true
  ) {
    await cycleRef.set({
      holdReason: campaignSnapshot.data()?.emergencyDisabled === true
        ? 'CAMPAIGN_EMERGENCY_DISABLED'
        : 'ROOM_NOT_ELIGIBLE',
      state: 'held',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { state: 'held' };
  }
  if (cycle.state === 'unlocked') {
    const periodKey = createRoomSupportPeriodKey(roomId, cycleId);
    const period = await db.doc(`roomSupportPeriods/${periodKey}`).get();
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
    ) {
      return { skipped: true, reason: 'awaiting-reconciliation' };
    }
    const candidatesSnapshot = await db.collection(`rooms/${roomId}/supportPeriods/${cycleId}/supporters`)
      .orderBy('eligibleSpendCoins', 'desc')
      .orderBy('firstContributionAt', 'asc')
      .orderBy('uid', 'asc')
      .limit(ROCKET_CANDIDATE_SCAN_LIMIT)
      .get();
    const profiles = candidatesSnapshot.docs.length
      ? await db.getAll(...candidatesSnapshot.docs.map((document) => db.doc(`publicProfiles/${document.id}`)))
      : [];
    const holds = candidatesSnapshot.docs.length
      ? await db.getAll(...candidatesSnapshot.docs.map((document) => db.doc(`weeklyIncentiveHolds/${document.id}`)))
      : [];
    const status = new Map(candidatesSnapshot.docs.map((document, index) => {
      const profile = profiles[index]?.exists ? profiles[index].data() : undefined;
      const hold = holds[index]?.exists ? holds[index].data() : undefined;
      return [document.id, {
        eligible: Boolean(profile && profile.uid === document.id && profile.moderationStatus === 'active'
          && hold?.active !== true && hold?.state !== 'active'),
        reason: !profile
          ? 'PROFILE_MISSING'
          : profile.moderationStatus !== 'active'
            ? 'PROFILE_NOT_ACTIVE'
            : hold?.active === true || hold?.state === 'active'
              ? 'PAYOUT_HOLD'
              : '',
      }];
    }));
    const podium = selectRocketPodium(
      candidatesSnapshot.docs.map((document) => ({ ...document.data(), uid: document.id })),
      { enabledRankCount: cycle.enabledRankCount, isEligible: ({ uid }) => status.get(uid) },
    );
    if (!podium.ok) return { errorCode: podium.code };
    const settlements = buildRocketSettlementInputs({
      cycle,
      roomId,
      winners: podium.value.winners,
    });
    if (!settlements.ok) return { errorCode: settlements.code };
    const featureFlags = await db.doc('appConfig/voiceRoomFeatures').get();
    const payoutEnabled = featureFlags.data()?.voice_room_rocket_rewards === true;
    const noEligibleWinners = settlements.value.length === 0;
    await cycleRef.set({
      closedAt: fieldValue.serverTimestamp(),
      disqualified: podium.value.disqualified,
      finalPodium: podium.value.winners.map((winner) => ({
        ...winner,
        rewardBundle: cycle.rewards[String(winner.rank)],
        settlementId: settlements.value.find((entry) => entry.uid === winner.uid)?.settlementId,
      })),
      payoutEnabledAtClose: payoutEnabled,
      settlementIds: settlements.value.map((entry) => entry.settlementId),
      ...(noEligibleWinners ? { holdReason: 'NO_ELIGIBLE_WINNERS' } : {}),
      state: noEligibleWinners ? 'held' : 'ready',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    if (noEligibleWinners) return { payoutEnabled, state: 'held', winners: [] };
    if (!payoutEnabled) return { payoutEnabled: false, state: 'ready', winners: podium.value.winners };
    for (const input of settlements.value) {
      const queued = await enqueueWeeklyIncentiveSettlement({ db, fieldValue, input });
      if (queued.errorCode) return { errorCode: queued.errorCode };
    }
    await cycleRef.set({ state: 'settling', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
    return { payoutEnabled: true, state: 'settling', winners: podium.value.winners };
  }
  if (cycle.state === 'ready') {
    const featureFlags = await db.doc('appConfig/voiceRoomFeatures').get();
    if (featureFlags.data()?.voice_room_rocket_rewards !== true) {
      return { payoutEnabled: false, state: 'ready' };
    }
    for (const podium of cycle.finalPodium || []) {
      const input = buildRocketSettlementInputs({ cycle, roomId, winners: [podium] });
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
      await cycleRef.set({ state: 'held', updatedAt: fieldValue.serverTimestamp() }, { merge: true });
      return { state: 'held' };
    }
    if (!settlements.length || settlements.some((snapshot) => !snapshot.exists || snapshot.data()?.state !== 'paid')) {
      return { skipped: true, reason: 'settlements-pending' };
    }
    const batch = db.batch();
    for (const podium of cycle.finalPodium || []) {
      const notificationRef = db.doc(`roomRocketRewardNotifications/${podium.settlementId}`);
      batch.set(notificationRef, {
        createdAt: fieldValue.serverTimestamp(),
        cycleId,
        rank: podium.rank,
        recipientUid: podium.uid,
        requestId: podium.settlementId,
        roomId,
        settlementId: podium.settlementId,
        state: 'queued',
        updatedAt: fieldValue.serverTimestamp(),
      });
    }
    batch.set(cycleRef, {
      settledAt: fieldValue.serverTimestamp(),
      state: 'settled',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return { state: 'settled' };
  }
  return { errorCode: 'INVALID_CYCLE_STATE' };
}

async function processRoomRocketCycles({ clock, db, fieldValue, limit = ROCKET_CYCLE_BATCH_LIMIT }) {
  const candidates = [];
  for (const state of ['active', 'unlocked', 'ready', 'settling']) {
    const snapshot = await db.collectionGroup('rocketCycles')
      .where('state', '==', state)
      .where('endAt', '<=', clock.timestampFromMillis(clock.nowMillis() - ROCKET_SETTLEMENT_GRACE_MS))
      .orderBy('endAt', 'asc')
      .limit(Math.min(limit, ROCKET_CYCLE_BATCH_LIMIT))
      .get();
    candidates.push(...snapshot.docs);
    if (candidates.length >= limit) break;
  }
  const unique = [...new Map(candidates.map((document) => [document.ref.path, document])).values()].slice(0, limit);
  const results = [];
  for (const document of unique) {
    const roomId = document.ref.parent.parent?.id || document.data()?.roomId;
    results.push({
      cycleId: document.id,
      roomId,
      ...await finalizeRoomRocketCycle({ clock, db, fieldValue, roomId, cycleId: document.id }),
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
      workerId: 'room-rocket-worker',
    },
  });
  return { processed: results.length, results };
}

async function processRoomRocketRewardNotifications({
  db,
  deliver,
  fieldValue,
  limit = 50,
}) {
  const snapshot = await db.collection('roomRocketRewardNotifications')
    .where('state', '==', 'queued')
    .orderBy('createdAt')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  const results = [];
  for (const document of snapshot.docs) {
    try {
      const job = document.data();
      const delivery = await deliver({
        actorUid: 'platform',
        kind: 'rocket-reward-paid',
        recipientUid: job.recipientUid,
        requestId: job.requestId,
      });
      if (delivery?.errorCode || delivery?.status === 'failed') {
        throw new Error(delivery?.errorCode || 'push-delivery-failed');
      }
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

module.exports = {
  ROCKET_CANDIDATE_SCAN_LIMIT,
  ROCKET_CYCLE_BATCH_LIMIT,
  ROCKET_SETTLEMENT_GRACE_MS,
  finalizeRoomRocketCycle,
  processRoomRocketCycles,
  processRoomRocketRewardNotifications,
  projectRoomRocketGiftFact,
  resolveEffectiveRoomRocketTemplate,
};
