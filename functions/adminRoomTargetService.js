const crypto = require('node:crypto');
const { createWeeklyCycle, timestampToMillis } = require('./weeklyIncentiveCore');
const {
  calculateRoomTargetRisk,
  validateRoomTargetTemplateV1,
} = require('./roomTargetCore');
const { mapCommissionPolicy } = require('./roomGiftCore');

async function getAdminRoomTargetCampaign({ db }) {
  const campaignRef = db.doc('roomTargetCampaign/current');
  const [campaign, versions, rooms, activeCycles, cycles, settlements, activeHolds] = await Promise.all([
    campaignRef.get(),
    campaignRef.collection('versions').orderBy('revision', 'desc').limit(20).get(),
    safeSnapshot(() => db.collection('rooms')
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .count()
      .get()),
    safeSnapshot(() => db.collectionGroup('targetCycles')
      .where('state', 'in', ['active', 'unlocked'])
      .count()
      .get()),
    safeSnapshot(() => db.collectionGroup('targetCycles').orderBy('endAt', 'desc').limit(20).get()),
    safeSnapshot(() => db.collection('rewardSettlements').where('feature', '==', 'owner-targets').limit(500).get()),
    safeSnapshot(() => db.collectionGroup('holds').where('active', '==', true).count().get()),
  ]);
  const settlementCounts = {};
  const settledReturns = { coins: 0, diamonds: 0 };
  for (const document of settlements?.docs || []) {
    const value = document.data();
    const state = value?.state || 'unknown';
    settlementCounts[state] = (settlementCounts[state] || 0) + 1;
    if (state === 'paid') {
      settledReturns.coins += Number(value.rewardBundle?.coins || 0);
      settledReturns.diamonds += Number(value.rewardBundle?.diamonds || 0);
    }
  }
  return {
    campaign: campaign.exists ? mapCampaign(campaign.data()) : null,
    operations: {
      activeCycleCount: readAggregateCount(activeCycles),
      activeHoldCount: readAggregateCount(activeHolds),
      activeCycles: (cycles?.docs || []).map((document) => mapCycle(document.data())).filter(Boolean),
      qualifyingRoomCount: readAggregateCount(rooms),
      settlementCounts,
      settledReturns,
      settlementSampleLimited: (settlements?.size || 0) >= 500,
    },
    versions: versions.docs.map((document) => mapVersion(document.data())).filter(Boolean),
  };
}

async function mutateAdminRoomTargetCampaign({ clock, db, decodedToken, fieldValue, input }) {
  const campaignRef = db.doc('roomTargetCampaign/current');
  const publicConfigRef = db.doc('appConfig/roomTargetPublic');
  const auditRef = db.doc(`adminAuditEvents/room_target_${input.requestId}`);
  const rollbackRef = input.operation === 'rollback'
    ? campaignRef.collection('versions').doc(`v${input.rollbackRevision}`)
    : null;
  let templateForRisk = input.template;
  let effectiveCycle;
  if (input.operation === 'publish') {
    effectiveCycle = createNextEffectiveCycle(clock.nowMillis(), input.template.timeZone);
  } else if (input.operation === 'rollback') {
    const rollback = await rollbackRef.get();
    templateForRisk = rollback.exists ? mapVersion(rollback.data())?.template : undefined;
    if (templateForRisk) effectiveCycle = createNextEffectiveCycle(clock.nowMillis(), templateForRisk.timeZone);
  }
  const riskSnapshot = templateForRisk && ['publish', 'rollback'].includes(input.operation)
    ? await resolvePublicationRisk({ clock, db, effectiveCycle, template: templateForRisk })
    : undefined;
  if (riskSnapshot?.errorCode) throw adminError(409, riskSnapshot.errorCode);
  if (riskSnapshot && riskSnapshot.viable !== true) {
    throw adminError(409, 'STACKED_REWARDS_EXCEED_COMMISSION');
  }
  return db.runTransaction(async (transaction) => {
    const refs = [campaignRef, auditRef, ...(rollbackRef ? [rollbackRef] : [])];
    const [campaignSnapshot, auditSnapshot, rollbackSnapshot] = await transaction.getAll(...refs);
    const fingerprint = stableFingerprint(input);
    if (auditSnapshot.exists) {
      const audit = auditSnapshot.data();
      if (audit.actorUid !== decodedToken.uid || audit.requestFingerprint !== fingerprint) {
        throw adminError(409, 'requestId was already used for another Room Target change.');
      }
      return { eventId: auditRef.id, replayed: true, revision: audit.revision };
    }
    const current = campaignSnapshot.exists ? campaignSnapshot.data() : {};
    const currentRevision = Number.isSafeInteger(current.revision) ? current.revision : 0;
    if (currentRevision !== input.expectedRevision) {
      throw adminError(409, 'Room Target campaign changed after it was opened. Refresh and try again.');
    }
    const revision = currentRevision + 1;
    const timestamp = fieldValue.serverTimestamp();
    let template;
    let cycle = effectiveCycle;
    let emergencyDisabled = current.emergencyDisabled === true;
    if (input.operation === 'emergency-disable') {
      if (!current.lastPublishedRevision) throw adminError(404, 'No published Room Target campaign exists.');
      emergencyDisabled = true;
    } else if (input.operation === 'rollback') {
      const rollback = rollbackSnapshot?.exists ? mapVersion(rollbackSnapshot.data()) : undefined;
      if (!rollback?.template) throw adminError(404, 'Rollback version was not found.');
      template = { ...rollback.template, publicationStatus: 'published' };
      cycle = createNextEffectiveCycle(clock.nowMillis(), template.timeZone);
      emergencyDisabled = false;
    } else {
      template = input.template;
      if (input.operation === 'publish') emergencyDisabled = false;
    }
    if (['publish', 'rollback'].includes(input.operation)) {
      if (!cycle || !riskSnapshot) throw adminError(400, 'Unable to calculate the next Room Target cycle.');
      transaction.create(campaignRef.collection('versions').doc(`v${revision}`), {
        createdAt: timestamp,
        editorUid: decodedToken.uid,
        effectiveFromAt: clock.timestampFromMillis(cycle.startAtMillis),
        effectiveFromCycleId: cycle.cycleId,
        operation: input.operation,
        revision,
        riskSnapshot,
        template,
      });
      transaction.create(db.doc(`roomTargetPublicVersions/v${revision}`), {
        effectiveFromAt: clock.timestampFromMillis(cycle.startAtMillis),
        effectiveFromCycleId: cycle.cycleId,
        revision,
        schemaVersion: 1,
        template: buildPublicTargetTemplate(template),
      });
    }
    transaction.set(campaignRef, {
      createdAt: campaignSnapshot.exists ? current.createdAt || timestamp : timestamp,
      ...(template ? { draft: template } : {}),
      emergencyDisabled,
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      ...(['publish', 'rollback'].includes(input.operation)
        ? {
            lastPublishedRevision: revision,
            nextEffectiveCycleId: cycle.cycleId,
            nextEffectiveFromAt: clock.timestampFromMillis(cycle.startAtMillis),
          }
        : {}),
      revision,
      schemaVersion: 1,
      updatedAt: timestamp,
    }, { merge: true });
    if (input.operation === 'emergency-disable') {
      transaction.set(publicConfigRef, {
        renderingEnabled: false,
        revision,
        schemaVersion: 1,
        updatedAt: timestamp,
      }, { merge: true });
    } else if (['publish', 'rollback'].includes(input.operation)) {
      transaction.set(publicConfigRef, {
        effectiveFromAt: clock.timestampFromMillis(cycle.startAtMillis),
        effectiveFromCycleId: cycle.cycleId,
        renderingEnabled: true,
        revision,
        schemaVersion: 1,
        updatedAt: timestamp,
      }, { merge: true });
    }
    transaction.create(auditRef, {
      action: `room-target-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'system',
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision,
      ...(riskSnapshot ? { riskSnapshot } : {}),
      status: 'completed',
    });
    return {
      ...(cycle ? { effectiveFromCycleId: cycle.cycleId } : {}),
      eventId: auditRef.id,
      replayed: false,
      revision,
      ...(riskSnapshot ? { riskSnapshot } : {}),
    };
  });
}

async function mutateAdminRoomTargetMemberHold({ db, decodedToken, fieldValue, input }) {
  const cycleRef = db.doc(`rooms/${input.roomId}/targetCycles/${input.cycleId}`);
  const memberRef = cycleRef.collection('members').doc(input.targetUid);
  const holdRef = cycleRef.collection('holds').doc(input.targetUid);
  const auditRef = db.doc(`adminAuditEvents/room_target_hold_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [cycle, member, existingHold, audit] = await transaction.getAll(
      cycleRef,
      memberRef,
      holdRef,
      auditRef,
    );
    const fingerprint = stableFingerprint(input);
    if (audit.exists) {
      const previous = audit.data();
      if (previous.actorUid !== decodedToken.uid || previous.requestFingerprint !== fingerprint) {
        throw adminError(409, 'requestId was already used for another Room Target hold.');
      }
      return { eventId: auditRef.id, replayed: true };
    }
    if (!cycle.exists || !['active', 'unlocked'].includes(cycle.data()?.state)) {
      throw adminError(409, 'Room Target cycle is not open for member holds.');
    }
    if (!member.exists || member.data()?.uid !== input.targetUid) {
      throw adminError(404, 'The user is not in this locked Room Target roster.');
    }
    if (input.operation === 'release' && existingHold.data()?.active !== true) {
      throw adminError(409, 'The Room Target member hold is not active.');
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(holdRef, {
      active: input.operation === 'apply',
      createdAt: existingHold.exists ? existingHold.data()?.createdAt || timestamp : timestamp,
      cycleId: input.cycleId,
      lastActorUid: decodedToken.uid,
      reason: input.reason,
      roomId: input.roomId,
      targetUid: input.targetUid,
      updatedAt: timestamp,
    }, { merge: true });
    transaction.create(auditRef, {
      action: `room-target-member-hold-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      cycleId: input.cycleId,
      id: auditRef.id,
      kind: 'system',
      reason: input.reason,
      requestFingerprint: fingerprint,
      roomId: input.roomId,
      status: 'completed',
      targetUid: input.targetUid,
    });
    return { eventId: auditRef.id, replayed: false };
  });
}

async function resolvePublicationRisk({ clock, db, effectiveCycle, template }) {
  if (!effectiveCycle) return { errorCode: 'INVALID_EFFECTIVE_CYCLE' };
  const [policy, rocketCampaign] = await Promise.all([
    db.doc('appConfig/roomGiftCommissionPolicy').get(),
    db.doc('roomRocketCampaign/current').get(),
  ]);
  const commission = policy.exists ? mapCommissionPolicy(policy.data()) : undefined;
  if (!commission) return { errorCode: 'GIFT_COMMISSION_POLICY_REQUIRED' };
  let rocketRewardLiability = { coins: 0, diamonds: 0, items: [] };
  let rocketRevision = 0;
  if (rocketCampaign.exists && rocketCampaign.data()?.emergencyDisabled !== true) {
    const versions = await rocketCampaign.ref.collection('versions')
      .where('effectiveFromAt', '<=', clock.timestampFromMillis(effectiveCycle.startAtMillis))
      .orderBy('effectiveFromAt', 'desc')
      .limit(1)
      .get();
    const version = versions.docs[0]?.data();
    if (version?.template?.rewards) {
      rocketRevision = Number.isSafeInteger(version.revision) ? version.revision : 0;
      rocketRewardLiability = flattenRocketRewards(version.template.rewards);
    }
  }
  const risk = calculateRoomTargetRisk({
    commissionBps: commission.commissionBps,
    rocketRewardLiability,
    template,
  });
  if (!risk.ok) return { errorCode: risk.code };
  return {
    ...risk.value,
    commissionPolicyVersion: commission.version,
    evaluatedAtMillis: clock.nowMillis(),
    rocketRevision,
  };
}

function flattenRocketRewards(rewards) {
  const result = { coins: 0, diamonds: 0, items: [] };
  for (const reward of Object.values(rewards || {})) {
    result.coins += Number.isSafeInteger(reward?.coins) ? reward.coins : 0;
    result.diamonds += Number.isSafeInteger(reward?.diamonds) ? reward.diamonds : 0;
    for (const item of reward?.items || []) {
      if (typeof item?.itemId === 'string') result.items.push(item.itemId);
    }
  }
  return result;
}

function buildPublicTargetTemplate(template) {
  return {
    conversion: template.conversion,
    eligibleGiftRules: template.eligibleGiftRules,
    enabled: template.enabled,
    maxSelectedUsers: template.maxSelectedUsers,
    perRoomReturnCap: template.perRoomReturnCap,
    perUserReturnCap: template.perUserReturnCap,
    returnBps: template.returnBps,
    targetSupportPoints: template.targetSupportPoints,
    timeZone: template.timeZone,
  };
}

function createNextEffectiveCycle(nowMillis, timeZone) {
  const current = createWeeklyCycle({ nowMillis, timeZone });
  if (!current.ok) return undefined;
  const next = createWeeklyCycle({ nowMillis: current.value.endAtMillis + 1000, timeZone });
  return next.ok ? next.value : undefined;
}

function mapCampaign(value) {
  if (!value || !Number.isSafeInteger(value.revision)) return null;
  const draft = value.draft ? validateRoomTargetTemplateV1(value.draft) : undefined;
  return {
    ...(draft ? { draft } : {}),
    emergencyDisabled: value.emergencyDisabled === true,
    lastPublishedRevision: Number.isSafeInteger(value.lastPublishedRevision) ? value.lastPublishedRevision : 0,
    nextEffectiveCycleId: value.nextEffectiveCycleId || '',
    revision: value.revision,
  };
}

function mapVersion(value) {
  const template = value?.template ? validateRoomTargetTemplateV1(value.template) : undefined;
  const effectiveFromAtMillis = timestampToMillis(value?.effectiveFromAt);
  if (!template || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(effectiveFromAtMillis)) return undefined;
  return {
    effectiveFromAtMillis,
    effectiveFromCycleId: value.effectiveFromCycleId || '',
    operation: value.operation || '',
    revision: value.revision,
    riskSnapshot: value.riskSnapshot || {},
    template,
  };
}

function mapCycle(value) {
  if (!value?.roomId || !value?.cycleId) return undefined;
  return {
    cycleId: value.cycleId,
    eligibleSpendCoins: Number.isSafeInteger(value.eligibleSpendCoins) ? value.eligibleSpendCoins : 0,
    endAtMillis: timestampToMillis(value.endAt),
    roomId: value.roomId,
    rosterSize: Array.isArray(value.roster) ? value.roster.length : 0,
    state: value.state || '',
    supportPoints: Number.isSafeInteger(value.supportPoints) ? value.supportPoints : 0,
    targetSupportPoints: Number.isSafeInteger(value.targetSupportPoints) ? value.targetSupportPoints : 0,
  };
}

function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

async function safeSnapshot(factory) {
  try {
    return await factory();
  } catch {
    return undefined;
  }
}

function readAggregateCount(snapshot) {
  const value = snapshot?.data?.()?.count;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function adminError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = {
  buildPublicTargetTemplate,
  flattenRocketRewards,
  getAdminRoomTargetCampaign,
  mutateAdminRoomTargetCampaign,
  mutateAdminRoomTargetMemberHold,
  resolvePublicationRisk,
};
