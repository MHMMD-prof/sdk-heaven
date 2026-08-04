const {
  calculateDailyLoginLiability,
  normalizeAdminDailyLoginMutation,
  normalizeDailyLoginTemplate,
} = require('./adminDailyLoginCore');
const {
  createDailyLoginDay,
  mapDailyLoginCampaignPointer,
  mapDailyLoginCampaignVersion,
  resolveDailyLoginCampaignRevision,
  timestampToMillis,
} = (() => {
  const core = require('./dailyLoginCore');
  const weekly = require('./weeklyIncentiveCore');
  return { ...core, timestampToMillis: weekly.timestampToMillis };
})();

async function getAdminDailyLoginCampaign({ clock, db }) {
  const currentRef = db.doc('dailyLoginCampaign/current');
  const [currentSnapshot, draftSnapshot, featuresSnapshot, versionsSnapshot] = await Promise.all([
    currentRef.get(),
    db.doc('dailyLoginCampaign/draft').get(),
    db.doc('appConfig/dailyLoginFeatures').get(),
    currentRef.collection('versions').orderBy('revision', 'desc').limit(20).get(),
  ]);
  const pointer = currentSnapshot.exists ? mapDailyLoginCampaignPointer(currentSnapshot.data()) : undefined;
  const versions = versionsSnapshot.docs.flatMap((document) => {
    const version = mapDailyLoginCampaignVersion(document.data());
    return version.ok ? [{
      ...version.value,
      createdAtMillis: timestampToMillis(document.data()?.createdAt),
      publishedAtMillis: timestampToMillis(document.data()?.publishedAt),
    }] : [];
  });
  const draftData = draftSnapshot.exists ? draftSnapshot.data() : undefined;
  const draft = normalizeDailyLoginTemplate(draftData?.template);
  const effectiveRevision = pointer?.ok
    ? resolveDailyLoginCampaignRevision(pointer.value, clock.nowMillis())
    : 0;
  const effective = versions.find((version) => version.revision === effectiveRevision);
  const metrics = await getDailyLoginMetrics({ db, effective });
  const revision = Math.max(
    pointer?.ok ? pointer.value.revision : 0,
    Number.isSafeInteger(draftData?.revision) ? draftData.revision : 0,
  );
  return {
    current: pointer?.ok ? pointer.value : null,
    draft: draft ? {
      revision: draftData.revision,
      template: draft,
      updatedAtMillis: timestampToMillis(draftData.updatedAt),
      updatedBy: typeof draftData.updatedBy === 'string' ? draftData.updatedBy : '',
    } : null,
    effective: effective || null,
    features: {
      itemRewardsEnabled: featuresSnapshot.data()?.daily_login_reward_items === true,
      rewardsEnabled: featuresSnapshot.data()?.daily_login_rewards === true,
    },
    liability: effective ? [100, 1_000, 10_000].map((claimants) => (
      calculateDailyLoginLiability(effective, claimants)
    )) : [],
    metrics,
    revision,
    versions,
  };
}

async function mutateAdminDailyLoginCampaign({ clock, db, decodedToken, fieldValue, input }) {
  const normalized = normalizeAdminDailyLoginMutation(input);
  if (!normalized.ok) throw httpError(normalized.status, normalized.error);
  if (decodedToken?.adminRole !== 'owner') {
    throw httpError(403, 'Only the Platform Owner can change Daily Login rewards.');
  }
  const value = normalized.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      actor: db.doc(`adminProfiles/${decodedToken.uid}`),
      audit: db.doc(`adminAuditEvents/daily_login_${value.requestId}`),
      command: db.doc(`dailyLoginAdminCommands/${value.requestId}`),
      current: db.doc('dailyLoginCampaign/current'),
      draft: db.doc('dailyLoginCampaign/draft'),
    };
    const [actorSnapshot, commandSnapshot, currentSnapshot, draftSnapshot] = await Promise.all([
      transaction.get(refs.actor),
      transaction.get(refs.command),
      transaction.get(refs.current),
      transaction.get(refs.draft),
    ]);
    const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
    if (!actor || actor.uid !== decodedToken.uid || actor.role !== 'owner' || actor.status !== 'active') {
      throw httpError(403, 'The Platform Owner account is not active.');
    }
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      if (previous.operation !== value.operation || previous.actorUid !== decodedToken.uid || !previous.result) {
        throw httpError(409, 'This request ID was already used.');
      }
      return { ...previous.result, replayed: true };
    }
    const current = currentSnapshot.exists ? mapDailyLoginCampaignPointer(currentSnapshot.data()) : undefined;
    if (currentSnapshot.exists && !current?.ok) throw httpError(409, 'The active campaign pointer is invalid.');
    const draftData = draftSnapshot.exists ? draftSnapshot.data() : undefined;
    const actualRevision = Math.max(
      current?.ok ? current.value.revision : 0,
      Number.isSafeInteger(draftData?.revision) ? draftData.revision : 0,
    );
    if (actualRevision !== value.expectedRevision) {
      throw httpError(409, 'The Daily Login campaign changed. Refresh and try again.');
    }
    const nextControlRevision = actualRevision + 1;
    const nowMillis = clock.nowMillis();
    const today = createDailyLoginDay(nowMillis);
    if (!today.ok) throw httpError(500, 'The Baghdad reward day could not be resolved.');
    let rollbackVersion;
    if (value.operation === 'rollback') {
      const snapshot = await transaction.get(
        refs.current.collection('versions').doc(String(value.rollbackRevision)),
      );
      const mapped = snapshot.exists ? mapDailyLoginCampaignVersion(snapshot.data()) : undefined;
      if (!mapped?.ok) throw httpError(404, 'The selected campaign version was not found.');
      rollbackVersion = mapped.value;
    }

    const timestamp = fieldValue.serverTimestamp();
    let result;
    if (value.operation === 'save-draft') {
      transaction.set(refs.draft, {
        revision: nextControlRevision,
        schemaVersion: 1,
        template: value.template,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
      result = { revision: nextControlRevision };
    } else if (value.operation === 'publish' || value.operation === 'rollback') {
      const template = value.operation === 'rollback'
        ? {
            minimumClientVersion: rollbackVersion.minimumClientVersion,
            rewards: rollbackVersion.rewards,
            schemaVersion: 1,
            timeZone: 'Asia/Baghdad',
          }
        : value.template || normalizeDailyLoginTemplate(draftData?.template);
      if (!template) throw httpError(400, 'Publish a valid saved draft or provide a valid template.');
      const lastPublishedRevision = current?.ok ? current.value.lastPublishedRevision : 0;
      const versionRevision = lastPublishedRevision + 1;
      const effectiveAtMillis = today.value.nextResetAtMillis;
      const versionRef = refs.current.collection('versions').doc(String(versionRevision));
      transaction.create(versionRef, {
        createdAt: timestamp,
        createdBy: decodedToken.uid,
        minimumClientVersion: template.minimumClientVersion,
        publicationStatus: 'published',
        publishedAt: timestamp,
        publishedBy: decodedToken.uid,
        revision: versionRevision,
        rewards: template.rewards,
        schemaVersion: 1,
        startsAt: clock.timestampFromMillis(effectiveAtMillis),
        timeZone: 'Asia/Baghdad',
      });
      const previous = current?.ok ? current.value : undefined;
      transaction.set(refs.current, {
        activeRevision: previous?.activeRevision || versionRevision,
        claimsPaused: previous?.claimsPaused === true,
        emergencyDisabled: previous?.emergencyDisabled === true,
        lastPublishedRevision: versionRevision,
        presentationVisible: previous ? previous.presentationVisible : true,
        publicationStatus: 'published',
        revision: nextControlRevision,
        ...(previous ? {
          scheduledAt: clock.timestampFromMillis(effectiveAtMillis),
          scheduledRevision: versionRevision,
        } : {}),
        schemaVersion: 1,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
      transaction.delete(refs.draft);
      result = {
        effectiveAtMillis,
        publishedRevision: versionRevision,
        revision: nextControlRevision,
      };
    } else {
      if (!current?.ok) throw httpError(409, 'Publish a campaign before changing live controls.');
      const patch = {
        revision: nextControlRevision,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      };
      if (value.operation === 'emergency-disable') patch.emergencyDisabled = true;
      if (value.operation === 'emergency-enable') patch.emergencyDisabled = false;
      if (value.operation === 'set-claims-paused') patch.claimsPaused = value.enabled;
      if (value.operation === 'set-presentation-visible') patch.presentationVisible = value.enabled;
      transaction.update(refs.current, patch);
      result = { revision: nextControlRevision };
    }
    const action = `daily-login-${value.operation}`;
    transaction.create(refs.audit, {
      action,
      actorEmail: decodedToken.email || '',
      actorRole: 'owner',
      actorUid: decodedToken.uid,
      after: result,
      before: current?.ok ? current.value : null,
      createdAt: timestamp,
      entityId: 'current',
      entityType: 'system',
      id: refs.audit.id,
      kind: 'daily-login-campaign',
      note: value.reason,
      requestId: value.requestId,
      status: 'completed',
    });
    transaction.create(refs.command, {
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      operation: value.operation,
      requestId: value.requestId,
      result,
    });
    return { ...result, replayed: false };
  });
}

async function activateScheduledDailyLoginCampaign({ clock, db, fieldValue }) {
  return db.runTransaction(async (transaction) => {
    const ref = db.doc('dailyLoginCampaign/current');
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { activated: false, reason: 'missing' };
    const pointer = mapDailyLoginCampaignPointer(snapshot.data());
    if (!pointer.ok || !pointer.value.scheduledRevision || !pointer.value.scheduledAtMillis) {
      return { activated: false, reason: pointer.ok ? 'not-scheduled' : 'invalid' };
    }
    if (clock.nowMillis() < pointer.value.scheduledAtMillis) {
      return { activated: false, reason: 'not-due' };
    }
    const versionRef = ref.collection('versions').doc(String(pointer.value.scheduledRevision));
    const versionSnapshot = await transaction.get(versionRef);
    const version = versionSnapshot.exists ? mapDailyLoginCampaignVersion(versionSnapshot.data()) : undefined;
    if (!version?.ok) return { activated: false, reason: 'version-invalid' };
    const timestamp = fieldValue.serverTimestamp();
    const auditRef = db.doc(`adminAuditEvents/daily_login_activation_${pointer.value.scheduledRevision}`);
    transaction.update(ref, {
      activeRevision: pointer.value.scheduledRevision,
      scheduledAt: fieldValue.delete(),
      scheduledRevision: fieldValue.delete(),
      updatedAt: timestamp,
      updatedBy: 'system',
    });
    transaction.set(auditRef, {
      action: 'daily-login-scheduled-activation',
      actorRole: 'system',
      actorUid: 'system',
      createdAt: timestamp,
      entityId: 'current',
      entityType: 'system',
      id: auditRef.id,
      kind: 'daily-login-campaign',
      status: 'completed',
      versionRevision: pointer.value.scheduledRevision,
    }, { merge: false });
    return { activated: true, revision: pointer.value.scheduledRevision };
  });
}

async function getDailyLoginMetrics({ db, effective }) {
  const [claims, replays, holds, settlements, reconciliation, failures] = await Promise.all([
    safeGet(() => db.collectionGroup('days').where('kind', '==', 'daily-login-claim').limit(1000).get()),
    safeGet(() => db.collectionGroup('requests').where('replayOfReceiptId', '!=', '').limit(1000).get()),
    safeGet(() => db.collection('economyRestrictions').where('dailyLoginRewardsBlocked', '==', true).limit(1000).get()),
    safeGet(() => db.collection('rewardSettlements').where('feature', '==', 'daily-login').limit(1000).get()),
    safeGet(() => db.collection('adminAuditEvents').where('kind', '==', 'daily-login-reconciliation').limit(20).get()),
    safeGet(() => db.collection('dailyLoginFailureMetrics').limit(1000).get()),
  ]);
  const settled = settlements.docs.reduce((total, document) => {
    for (const credit of document.data()?.result?.walletCredits || []) {
      if (credit.currency === 'coins') total.coins += Number(credit.amount) || 0;
      if (credit.currency === 'diamonds') total.diamonds += Number(credit.amount) || 0;
    }
    return total;
  }, { coins: 0, diamonds: 0 });
  return {
    claimCount: claims.size,
    failedClaimCount: failures.docs.reduce(
      (total, document) => total + (Number(document.data()?.count) || 0),
      0,
    ),
    heldUserCount: holds.size,
    itemRewardCount: settlements.docs.reduce(
      (total, document) => total + (document.data()?.result?.items?.length || 0),
      0,
    ),
    lastReconciliationAtMillis: Math.max(
      0,
      ...reconciliation.docs.map((document) => timestampToMillis(document.data()?.createdAt) || 0),
    ),
    replayCount: replays.size,
    settled,
    sevenDayPerUser: effective
      ? calculateDailyLoginLiability(effective, 1)
      : { claimants: 1, coins: 0, diamonds: 0, items: 0 },
  };
}

async function safeGet(factory) {
  try {
    return await factory();
  } catch {
    return { docs: [], size: 0 };
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  activateScheduledDailyLoginCampaign,
  getAdminDailyLoginCampaign,
  getDailyLoginMetrics,
  mutateAdminDailyLoginCampaign,
};
