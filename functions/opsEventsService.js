'use strict';

const { mapGrowthFeatures } = require('./growthRolloutCore');
const {
  buildMissionClaimKey,
  isEventActive,
  listDefaultDailyMissions,
  mapMissionDefinition,
  mapMissionProgressRow,
  mapOpsEvent,
  normalizeAdminOpsEventMutation,
  normalizeClaimMissionInput,
  resolveMissionDay,
} = require('./opsEventsCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');

async function readGrowthFlags(db) {
  const snap = await db.doc('appConfig/growthFeatures').get();
  return mapGrowthFeatures(snap.exists ? snap.data() : {});
}

async function loadActiveEvent(db, nowMs = Date.now()) {
  const configSnap = await db.doc('opsEventsConfig/current').get();
  const activeEventId = configSnap.exists && typeof configSnap.data()?.activeEventId === 'string'
    ? configSnap.data().activeEventId.trim()
    : '';
  if (activeEventId) {
    const eventSnap = await db.doc(`opsEvents/${activeEventId}`).get();
    if (eventSnap.exists) {
      const mapped = mapOpsEvent({ eventId: activeEventId, ...eventSnap.data() });
      if (mapped && isEventActive(mapped, nowMs)) return mapped;
    }
  }

  const published = await db.collection('opsEvents')
    .where('status', '==', 'published')
    .limit(20)
    .get()
    .catch(() => null);
  if (!published || published.empty) return null;
  const active = published.docs
    .map((doc) => mapOpsEvent({ eventId: doc.id, ...doc.data() }))
    .filter((event) => event && isEventActive(event, nowMs))
    .sort((left, right) => right.startsAtMs - left.startsAtMs);
  return active[0] || null;
}

async function loadMissionCatalog(db) {
  const catalogSnap = await db.doc('opsMissionsCatalog/daily').get();
  if (catalogSnap.exists && Array.isArray(catalogSnap.data()?.missions)) {
    const mapped = catalogSnap.data().missions.map((row) => mapMissionDefinition(row)).filter(Boolean);
    if (mapped.length) return mapped;
  }
  return listDefaultDailyMissions();
}

async function getOpsMissionsOverview({ clock = Date, db, input, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const flags = await readGrowthFlags(db);
  if (flags.dailyMissions !== true && flags.opsEvents !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const day = resolveMissionDay(nowMs);
  if (!day.ok) return { errorCode: 'INVALID_REQUEST' };

  const [missions, activeEvent, progressSnap] = await Promise.all([
    flags.dailyMissions === true ? loadMissionCatalog(db) : Promise.resolve([]),
    flags.opsEvents === true ? loadActiveEvent(db, nowMs) : Promise.resolve(null),
    db.doc(`userMissionProgress/${uid}/days/${day.value.dayId}`).get(),
  ]);

  const progressData = progressSnap.exists ? progressSnap.data() : {};
  const missionProgress = typeof progressData.missions === 'object' && progressData.missions
    ? progressData.missions
    : {};

  const rows = missions
    .map((definition) => mapMissionProgressRow(definition, missionProgress[definition.missionId] || {}))
    .filter(Boolean);

  return {
    result: {
      dayId: day.value.dayId,
      event: activeEvent,
      missions: rows,
      nextResetAtMillis: day.value.endAtMillis,
    },
  };
}

async function claimOpsMission({ clock = Date, db, fieldValue, input, requestId, uid }) {
  const flags = await readGrowthFlags(db);
  if (flags.dailyMissions !== true) return { errorCode: 'FEATURE_DISABLED' };

  const validation = normalizeClaimMissionInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const { missionId } = validation.value;

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const day = resolveMissionDay(nowMs);
  if (!day.ok) return { errorCode: 'INVALID_REQUEST' };

  const catalog = await loadMissionCatalog(db);
  const definition = catalog.find((row) => row.missionId === missionId);
  if (!definition) return { errorCode: 'NOT_FOUND' };

  const progressRef = db.doc(`userMissionProgress/${uid}/days/${day.value.dayId}`);
  const claimKey = buildMissionClaimKey({ dayId: day.value.dayId, missionId, uid });
  const claimRef = db.doc(`opsMissionClaims/${claimKey}`);
  const requestRef = db.doc(`opsMissionRequests/${requestId}`);
  const walletRef = db.doc(`walletSummaries/${uid}`);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [requestSnap, claimSnap, progressSnap, walletSnap] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(claimRef),
        transaction.get(progressRef),
        transaction.get(walletRef),
      ]);

      if (requestSnap.exists) {
        const prior = mapClaimResult(requestSnap.data());
        if (prior) return prior;
        throw Object.assign(new Error('REQUEST_CONFLICT'), { code: 'REQUEST_CONFLICT' });
      }

      if (claimSnap.exists) {
        const prior = mapClaimResult(claimSnap.data());
        if (prior) {
          transaction.set(requestRef, {
            ...prior,
            createdAt: fieldValue.serverTimestamp(),
            replayed: true,
            requestId,
            uid,
          });
          return { ...prior, alreadyClaimed: true };
        }
        throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
      }

      const progressRoot = progressSnap.exists ? progressSnap.data() : {};
      const missions = typeof progressRoot.missions === 'object' && progressRoot.missions
        ? { ...progressRoot.missions }
        : {};
      const row = mapMissionProgressRow(definition, missions[missionId] || {});
      if (!row || !row.claimable) {
        throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
      }

      let wallet = mapWalletSummary(walletSnap.exists ? walletSnap.data() : undefined, uid);
      const credit = applyWalletMutation(wallet, {
        amount: definition.rewardCoins,
        currency: 'coins',
        type: 'credit',
      });
      if (!credit.ok) {
        throw Object.assign(new Error(credit.code || 'CONFLICT'), { code: credit.code || 'CONFLICT' });
      }
      wallet = credit.value.wallet;
      const timestamp = fieldValue.serverTimestamp();
      const settlementId = `opsm_${claimKey}`.slice(0, 120);
      const payload = {
        alreadyClaimed: false,
        amount: definition.rewardCoins,
        balances: wallet.balances,
        currency: 'coins',
        dayId: day.value.dayId,
        missionId,
        nextResetAtMillis: day.value.endAtMillis,
        settlementId,
      };

      missions[missionId] = {
        ...(missions[missionId] || {}),
        claimed: true,
        claimedAtMs: nowMs,
        kind: definition.kind,
        progress: definition.target,
        target: definition.target,
      };

      transaction.set(walletRef, buildWalletDocument(wallet, {
        createdAt: walletSnap.exists && walletSnap.data()?.createdAt
          ? walletSnap.data().createdAt
          : timestamp,
        updatedAt: timestamp,
      }), { merge: true });
      transaction.create(
        db.doc(`walletTransactions/${settlementId}_coins`),
        buildWalletTransaction({
          actorUid: 'system',
          amount: definition.rewardCoins,
          balanceAfter: credit.value.balanceAfter,
          createdAt: timestamp,
          currency: 'coins',
          note: `Ops mission ${missionId}`,
          referenceId: settlementId,
          source: 'ops-mission',
          type: 'credit',
          uid,
        }),
      );
      transaction.set(progressRef, {
        dayId: day.value.dayId,
        missions,
        updatedAt: timestamp,
        uid,
      }, { merge: true });
      transaction.set(claimRef, {
        ...payload,
        createdAt: timestamp,
        requestId,
        uid,
      });
      transaction.set(requestRef, {
        ...payload,
        createdAt: timestamp,
        requestId,
        uid,
      });
      return payload;
    });

    return { result };
  } catch (error) {
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    if (error?.code === 'CONFLICT') return { errorCode: 'CONFLICT' };
    console.error('[opsEvents] claim failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }
}

async function recordOpsMissionProgress({
  amount = 1,
  clock = Date,
  db,
  fieldValue,
  kind,
  uid,
}) {
  const flags = await readGrowthFlags(db);
  if (flags.dailyMissions !== true) {
    return { ok: true, skipped: true, reason: 'FEATURE_DISABLED' };
  }
  if (!kind || typeof uid !== 'string' || !uid.trim()) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const delta = Number(amount);
  if (!Number.isSafeInteger(delta) || delta < 1) return { ok: false, code: 'INVALID_REQUEST' };

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const day = resolveMissionDay(nowMs);
  if (!day.ok) return { ok: false, code: 'INVALID_PERIOD' };

  const catalog = await loadMissionCatalog(db);
  const matching = catalog.filter((row) => row.kind === kind);
  if (!matching.length) return { ok: true, skipped: true, reason: 'NO_MISSION' };

  const progressRef = db.doc(`userMissionProgress/${uid}/days/${day.value.dayId}`);
  try {
    await db.runTransaction(async (transaction) => {
      const progressSnap = await transaction.get(progressRef);
      const progressRoot = progressSnap.exists ? progressSnap.data() : {};
      const missions = typeof progressRoot.missions === 'object' && progressRoot.missions
        ? { ...progressRoot.missions }
        : {};
      let changed = false;
      for (const definition of matching) {
        const current = missions[definition.missionId] || {};
        if (current.claimed === true) continue;
        const previous = Number(current.progress);
        const nextProgress = Math.min(
          definition.target,
          (Number.isSafeInteger(previous) && previous >= 0 ? previous : 0) + delta,
        );
        if (nextProgress === previous) continue;
        missions[definition.missionId] = {
          kind: definition.kind,
          progress: nextProgress,
          target: definition.target,
          claimed: false,
        };
        changed = true;
      }
      if (!changed) return;
      transaction.set(progressRef, {
        dayId: day.value.dayId,
        missions,
        updatedAt: fieldValue.serverTimestamp(),
        uid,
      }, { merge: true });
    });
    return { ok: true, skipped: false };
  } catch (error) {
    console.error(
      '[opsEvents] record progress failed',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, code: 'INTERNAL' };
  }
}

async function recordOpsMissionProgressSafely(args) {
  try {
    return await recordOpsMissionProgress(args);
  } catch (error) {
    console.error(
      '[opsEvents] record progress unexpected',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, code: 'INTERNAL' };
  }
}

async function getAdminOpsEvents({ db }) {
  const [configSnap, eventsSnap] = await Promise.all([
    db.doc('opsEventsConfig/current').get(),
    db.collection('opsEvents').orderBy('startsAtMs', 'desc').limit(30).get().catch(async () => (
      db.collection('opsEvents').limit(30).get()
    )),
  ]);
  const events = eventsSnap.docs
    .map((doc) => mapOpsEvent({ eventId: doc.id, ...doc.data() }))
    .filter(Boolean);
  return {
    result: {
      activeEventId: configSnap.exists ? (configSnap.data()?.activeEventId || '') : '',
      events,
    },
  };
}

async function mutateAdminOpsEvent({ actorUid, db, fieldValue, input }) {
  const validation = normalizeAdminOpsEventMutation(input);
  if (!validation.ok) return { errorCode: validation.code };
  const value = validation.value;
  const requestRef = db.doc(`adminOpsEventRequests/${value.requestId}`);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) {
        const prior = requestSnap.data()?.result;
        if (prior) return prior;
        throw Object.assign(new Error('REQUEST_CONFLICT'), { code: 'REQUEST_CONFLICT' });
      }

      const timestamp = fieldValue.serverTimestamp();
      if (value.action === 'publish') {
        const eventRef = db.doc(`opsEvents/${value.event.eventId}`);
        transaction.set(eventRef, {
          ...value.event,
          createdAt: timestamp,
          publishedBy: actorUid,
          reason: value.reason,
          updatedAt: timestamp,
        }, { merge: true });
        transaction.set(db.doc('opsEventsConfig/current'), {
          activeEventId: value.event.eventId,
          updatedAt: timestamp,
          updatedBy: actorUid,
        }, { merge: true });
        const resultPayload = { event: value.event, status: 'published' };
        transaction.set(requestRef, {
          action: 'publish',
          actorUid,
          createdAt: timestamp,
          result: resultPayload,
        });
        return resultPayload;
      }

      const eventRef = db.doc(`opsEvents/${value.eventId}`);
      const configRef = db.doc('opsEventsConfig/current');
      const [eventSnap, configSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(configRef),
      ]);
      if (!eventSnap.exists) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }
      transaction.set(eventRef, {
        retiredAt: timestamp,
        retiredBy: actorUid,
        status: 'retired',
        updatedAt: timestamp,
      }, { merge: true });
      if (configSnap.exists && configSnap.data()?.activeEventId === value.eventId) {
        transaction.set(configRef, {
          activeEventId: '',
          updatedAt: timestamp,
          updatedBy: actorUid,
        }, { merge: true });
      }
      const resultPayload = { eventId: value.eventId, status: 'retired' };
      transaction.set(requestRef, {
        action: 'retire',
        actorUid,
        createdAt: timestamp,
        result: resultPayload,
      });
      return resultPayload;
    });
    return { result };
  } catch (error) {
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    if (error?.code === 'NOT_FOUND') return { errorCode: 'NOT_FOUND' };
    console.error('[opsEvents] admin mutate failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }
}

function mapClaimResult(data = {}) {
  if (!data || typeof data !== 'object') return null;
  const amount = Number(data.amount);
  const missionId = typeof data.missionId === 'string' ? data.missionId : '';
  const dayId = typeof data.dayId === 'string' ? data.dayId : '';
  const settlementId = typeof data.settlementId === 'string' ? data.settlementId : '';
  if (!missionId || !dayId || !settlementId || !Number.isSafeInteger(amount) || amount < 1) {
    return null;
  }
  return {
    alreadyClaimed: data.alreadyClaimed === true,
    amount,
    balances: data.balances && typeof data.balances === 'object' ? data.balances : undefined,
    currency: data.currency === 'diamonds' ? 'diamonds' : 'coins',
    dayId,
    missionId,
    nextResetAtMillis: Number.isSafeInteger(data.nextResetAtMillis) ? data.nextResetAtMillis : 0,
    settlementId,
  };
}

module.exports = {
  claimOpsMission,
  getAdminOpsEvents,
  getOpsMissionsOverview,
  mutateAdminOpsEvent,
  recordOpsMissionProgress,
  recordOpsMissionProgressSafely,
};
