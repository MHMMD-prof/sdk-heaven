const crypto = require('node:crypto');
const { createWeeklyCycle } = require('./weeklyIncentiveCore');
const {
  calculateRocketRewardLiability,
  validateRoomRocketTemplateV1,
} = require('./roomRocketCore');

async function getAdminRoomRocketCampaign({ db }) {
  const campaignRef = db.doc('roomRocketCampaign/current');
  const [campaign, versions, operations] = await Promise.all([
    campaignRef.get(),
    campaignRef.collection('versions').orderBy('revision', 'desc').limit(20).get(),
    typeof db.collectionGroup === 'function'
      ? getAdminRoomRocketOperations({ db })
      : Promise.resolve(emptyRocketOperations()),
  ]);
  return {
    campaign: campaign.exists ? mapCampaign(campaign.data()) : null,
    operations,
    versions: versions.docs.map((document) => mapVersion(document.data())).filter(Boolean),
  };
}

async function getAdminRoomRocketOperations({ db }) {
  const [rooms, activeCycles, recentCycles, settlements] = await Promise.all([
    safeSnapshot(() => db.collection('rooms')
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .count()
      .get()),
    safeSnapshot(() => db.collectionGroup('rocketCycles')
      .where('state', 'in', ['active', 'unlocked'])
      .count()
      .get()),
    safeSnapshot(() => db.collectionGroup('rocketCycles')
      .orderBy('endAt', 'desc')
      .limit(12)
      .get()),
    safeSnapshot(() => db.collection('rewardSettlements')
      .where('feature', '==', 'rocket-rewards')
      .limit(500)
      .get()),
  ]);
  const settlementCounts = {};
  const settledRewards = { coins: 0, diamonds: 0, itemGrantCount: 0 };
  for (const document of settlements?.docs || []) {
    const value = document.data();
    const state = typeof value?.state === 'string' ? value.state : 'unknown';
    settlementCounts[state] = (settlementCounts[state] || 0) + 1;
    if (state === 'paid') {
      settledRewards.coins += Number(value.rewardBundle?.coins || 0);
      settledRewards.diamonds += Number(value.rewardBundle?.diamonds || 0);
      settledRewards.itemGrantCount += Array.isArray(value.rewardBundle?.items)
        ? value.rewardBundle.items.length
        : 0;
    }
  }
  return {
    activeCycleCount: readAggregateCount(activeCycles),
    activeCycles: (recentCycles?.docs || [])
      .map((document) => mapOperationalCycle(document.data()))
      .filter(Boolean),
    qualifyingRoomCount: readAggregateCount(rooms),
    settlementCounts,
    settledRewards,
    settlementSampleLimited: (settlements?.size || 0) >= 500,
  };
}

function mapOperationalCycle(value) {
  if (!value?.roomId || !value?.cycleId) return undefined;
  return {
    cycleId: value.cycleId,
    endAtMillis: timestampToMillis(value.endAt),
    roomId: value.roomId,
    state: value.state || '',
    supportPoints: Number.isSafeInteger(value.supportPoints) ? value.supportPoints : 0,
    targetSupportPoints: Number.isSafeInteger(value.targetSupportPoints) ? value.targetSupportPoints : 0,
  };
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

function emptyRocketOperations() {
  return {
    activeCycleCount: 0,
    activeCycles: [],
    qualifyingRoomCount: 0,
    settlementCounts: {},
    settledRewards: { coins: 0, diamonds: 0, itemGrantCount: 0 },
    settlementSampleLimited: false,
  };
}

async function mutateAdminRoomRocketCampaign({ clock, db, decodedToken, fieldValue, input }) {
  const campaignRef = db.doc('roomRocketCampaign/current');
  const publicConfigRef = db.doc('appConfig/roomRocketPublic');
  const auditRef = db.doc(`adminAuditEvents/room_rocket_${input.requestId}`);
  const rollbackRef = input.operation === 'rollback'
    ? campaignRef.collection('versions').doc(`v${input.rollbackRevision}`)
    : null;
  return db.runTransaction(async (transaction) => {
    const refs = [campaignRef, auditRef, ...(rollbackRef ? [rollbackRef] : [])];
    const [campaignSnapshot, auditSnapshot, rollbackSnapshot] = await transaction.getAll(...refs);
    const fingerprint = stableFingerprint(input);
    if (auditSnapshot.exists) {
      const audit = auditSnapshot.data();
      if (audit.actorUid !== decodedToken.uid || audit.requestFingerprint !== fingerprint) {
        throw adminError(409, 'requestId was already used for another Rocket campaign change.');
      }
      return { eventId: auditRef.id, replayed: true, revision: audit.revision };
    }
    const current = campaignSnapshot.exists ? campaignSnapshot.data() : {};
    const currentRevision = Number.isSafeInteger(current.revision) ? current.revision : 0;
    if (currentRevision !== input.expectedRevision) {
      throw adminError(409, 'Rocket campaign changed after it was opened. Refresh and try again.');
    }
    const revision = currentRevision + 1;
    const timestamp = fieldValue.serverTimestamp();
    let template;
    let effectiveCycle;
    let emergencyDisabled = current.emergencyDisabled === true;
    if (input.operation === 'emergency-disable') {
      if (!current.lastPublishedRevision) throw adminError(404, 'No published Rocket campaign exists.');
      emergencyDisabled = true;
    } else if (input.operation === 'rollback') {
      const rollback = rollbackSnapshot?.exists ? mapVersion(rollbackSnapshot.data()) : undefined;
      if (!rollback?.template) throw adminError(404, 'Rollback version was not found.');
      template = { ...rollback.template, publicationStatus: 'published' };
      effectiveCycle = createNextEffectiveCycle(clock.nowMillis(), template.timeZone);
      emergencyDisabled = false;
    } else {
      template = input.template;
      if (input.operation === 'publish') {
        effectiveCycle = createNextEffectiveCycle(clock.nowMillis(), template.timeZone);
        emergencyDisabled = false;
      }
    }
    if (input.operation === 'publish' || input.operation === 'rollback') {
      if (!effectiveCycle) throw adminError(400, 'Unable to calculate the next Rocket cycle.');
      transaction.create(campaignRef.collection('versions').doc(`v${revision}`), {
        createdAt: timestamp,
        editorUid: decodedToken.uid,
        effectiveFromAt: clock.timestampFromMillis(effectiveCycle.startAtMillis),
        effectiveFromCycleId: effectiveCycle.cycleId,
        operation: input.operation,
        rewardLiability: calculateRocketRewardLiability(template.rewards, template.enabledRankCount),
        revision,
        template,
      });
      transaction.create(db.doc(`roomRocketPublicVersions/v${revision}`), {
        effectiveFromAt: clock.timestampFromMillis(effectiveCycle.startAtMillis),
        effectiveFromCycleId: effectiveCycle.cycleId,
        revision,
        schemaVersion: 1,
        template: buildPublicRocketTemplate(template),
      });
    }
    transaction.set(campaignRef, {
      createdAt: campaignSnapshot.exists ? current.createdAt || timestamp : timestamp,
      ...(template ? { draft: template } : {}),
      emergencyDisabled,
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      ...(input.operation === 'publish' || input.operation === 'rollback'
        ? {
            lastPublishedRevision: revision,
            nextEffectiveCycleId: effectiveCycle.cycleId,
            nextEffectiveFromAt: clock.timestampFromMillis(effectiveCycle.startAtMillis),
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
    } else if (input.operation === 'publish' || input.operation === 'rollback') {
      transaction.set(publicConfigRef, {
        effectiveFromAt: clock.timestampFromMillis(effectiveCycle.startAtMillis),
        effectiveFromCycleId: effectiveCycle.cycleId,
        minimumClientVersion: template.minimumClientVersion,
        renderingEnabled: true,
        revision,
        schemaVersion: 1,
        updatedAt: timestamp,
      }, { merge: true });
    }
    transaction.create(auditRef, {
      action: `room-rocket-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'system',
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision,
      status: 'completed',
    });
    return {
      ...(effectiveCycle ? { effectiveFromCycleId: effectiveCycle.cycleId } : {}),
      eventId: auditRef.id,
      replayed: false,
      revision,
    };
  });
}

function buildPublicRocketTemplate(template) {
  const mapAsset = (asset) => asset ? {
    ...(asset.durationMs ? { durationMs: asset.durationMs } : {}),
    format: asset.format,
    ...(asset.height ? { height: asset.height } : {}),
    uri: asset.uri,
    ...(asset.width ? { width: asset.width } : {}),
  } : undefined;
  return {
    appearance: {
      ...(template.appearance.animationAsset
        ? { animationAsset: mapAsset(template.appearance.animationAsset) }
        : {}),
      name: template.appearance.name,
      ...(template.appearance.soundAsset
        ? { soundAsset: mapAsset(template.appearance.soundAsset) }
        : {}),
      ...(template.appearance.staticAsset
        ? { staticAsset: mapAsset(template.appearance.staticAsset) }
        : {}),
    },
    enabledRankCount: template.enabledRankCount,
    minimumClientVersion: template.minimumClientVersion,
    rewards: template.rewards,
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
  const draft = value.draft ? validateRoomRocketTemplateV1(value.draft) : undefined;
  return {
    ...(draft ? { draft } : {}),
    emergencyDisabled: value.emergencyDisabled === true,
    lastPublishedRevision: Number.isSafeInteger(value.lastPublishedRevision) ? value.lastPublishedRevision : 0,
    nextEffectiveCycleId: value.nextEffectiveCycleId || '',
    revision: value.revision,
  };
}

function mapVersion(value) {
  const template = value?.template ? validateRoomRocketTemplateV1(value.template) : undefined;
  const effectiveFromAtMillis = timestampToMillis(value?.effectiveFromAt);
  if (!template || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(effectiveFromAtMillis) || effectiveFromAtMillis < 0) {
    return undefined;
  }
  return {
    effectiveFromAtMillis,
    effectiveFromCycleId: value.effectiveFromCycleId,
    revision: value.revision,
    rewardLiability: value.rewardLiability || calculateRocketRewardLiability(template.rewards, template.enabledRankCount),
    template,
  };
}

function timestampToMillis(value) {
  if (Number.isSafeInteger(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return NaN;
}

function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
}

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  buildPublicRocketTemplate,
  getAdminRoomRocketCampaign,
  getAdminRoomRocketOperations,
  mutateAdminRoomRocketCampaign,
};
