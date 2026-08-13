'use strict';

const { createDailyBucket } = require('./weeklyIncentiveCore');
const { mapGrowthFeatures } = require('./growthRolloutCore');
const { incrementGrowthTelemetry } = require('./growthTelemetryCore');
const {
  LUCKY_BAG_COIN_AMOUNT,
  LUCKY_BAG_TIME_ZONE,
  QUICK_MATCH_CANDIDATE_LIMIT,
  QUICK_MATCH_RATE_LIMIT,
  QUICK_MATCH_RATE_WINDOW_MS,
  buildMaskedMatchProjection,
  isQuickMatchEligibleRoom,
  normalizeQuickMatchInput,
  pickQuickMatchRoom,
} = require('./growthMatchCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');

async function readGrowthFeatureFlags(db) {
  const snapshot = await db.doc('appConfig/growthFeatures').get();
  return mapGrowthFeatures(snapshot.exists ? snapshot.data() : {});
}

async function quickMatch({ clock = Date, db, fieldValue, input, requestId, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.quickMatch !== true) return { errorCode: 'FEATURE_DISABLED' };

  const normalized = normalizeQuickMatchInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };

  const preferredCountryCode = normalized.value.preferredCountryCode
    || await readProfileCountry(db, uid);

  const requestRef = db.doc(`growthMatchRequests/${requestId}`);
  const existing = await requestRef.get();
  if (existing.exists) {
    const prior = mapQuickMatchResult(existing.data());
    if (prior) return { result: prior };
    return { errorCode: 'REQUEST_CONFLICT' };
  }

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const rateLimitRef = db.doc(`growthMatchRateLimits/${uid}`);
  const rateSnapshot = await rateLimitRef.get();
  const rateLimit = resolveSlidingWindowRateLimit({
    limit: QUICK_MATCH_RATE_LIMIT,
    nowMs,
    rate: rateSnapshot.exists ? rateSnapshot.data() : undefined,
    windowMs: QUICK_MATCH_RATE_WINDOW_MS,
  });
  if (!rateLimit.ok) return { errorCode: 'RATE_LIMITED' };

  await incrementGrowthTelemetry({
    db,
    fieldValue,
    input: { key: 'matchAttempts', amount: 1 },
  });

  let globalSnapshot;
  try {
    globalSnapshot = await db.collection('rooms')
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .orderBy('updatedAt', 'desc')
      .limit(QUICK_MATCH_CANDIDATE_LIMIT)
      .get();
  } catch (error) {
    console.error('[growthMatch] room query failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }

  const candidates = globalSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));

  const selected = pickQuickMatchRoom(candidates, {
    preferredCountryCode,
    uid,
  });
  if (!selected || !isQuickMatchEligibleRoom(selected, { uid })) {
    return { errorCode: 'NOT_FOUND' };
  }

  const mask = buildMaskedMatchProjection({
    enabled: flags.maskedMatch === true,
    nowMs,
    roomId: selected.id,
    uid,
  });

  const result = {
    countryCode: typeof selected.countryCode === 'string' ? selected.countryCode : '',
    masked: Boolean(mask),
    mask: mask
      ? {
          expiresAtMs: mask.expiresAtMs,
          labelAr: mask.labelAr,
        }
      : null,
    participantCount: Number(selected.participantCount) || 0,
    roomId: selected.id,
    title: typeof selected.title === 'string' ? selected.title : '',
  };

  const timestamp = fieldValue.serverTimestamp();
  let committed = result;
  try {
    await db.runTransaction(async (transaction) => {
      const replay = await transaction.get(requestRef);
      if (replay.exists) {
        const prior = mapQuickMatchResult(replay.data());
        if (prior) {
          committed = prior;
          return;
        }
        throw Object.assign(new Error('REQUEST_CONFLICT'), { code: 'REQUEST_CONFLICT' });
      }

      const rateFresh = await transaction.get(rateLimitRef);
      const rateFreshLimit = resolveSlidingWindowRateLimit({
        limit: QUICK_MATCH_RATE_LIMIT,
        nowMs,
        rate: rateFresh.exists ? rateFresh.data() : undefined,
        windowMs: QUICK_MATCH_RATE_WINDOW_MS,
      });
      if (!rateFreshLimit.ok) {
        throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
      }

      transaction.set(requestRef, {
        ...result,
        createdAt: timestamp,
        preferredCountryCode,
        requestId,
        uid,
      });
      transaction.set(rateLimitRef, {
        attemptsMs: rateFreshLimit.value.attemptsMs,
        count: rateFreshLimit.value.count,
        uid,
        updatedAt: timestamp,
        windowStartedAt: rateFreshLimit.value.windowStartedAtMs,
      }, { merge: true });

      if (mask) {
        transaction.set(db.doc(`growthMatchMasks/${uid}`), {
          ...mask,
          createdAt: timestamp,
          requestId,
          updatedAt: timestamp,
        }, { merge: true });
      }
    });
  } catch (error) {
    if (error?.code === 'RATE_LIMITED') return { errorCode: 'RATE_LIMITED' };
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    console.error('[growthMatch] quick match commit failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }

  await incrementGrowthTelemetry({
    db,
    fieldValue,
    input: { key: 'matchRoomLandings', amount: 1 },
  });
  const empty = committed.participantCount <= 1;
  await incrementGrowthTelemetry({
    db,
    fieldValue,
    input: { key: empty ? 'emptyRoomJoins' : 'nonemptyRoomJoins', amount: 1 },
  });

  return { result: committed };
}

async function claimLuckyBag({ clock = Date, db, fieldValue, requestId, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.luckyBag !== true) return { errorCode: 'FEATURE_DISABLED' };

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const day = createDailyBucket({ nowMillis: nowMs, timeZone: LUCKY_BAG_TIME_ZONE });
  if (!day.ok) return { errorCode: 'INVALID_REQUEST' };

  const claimRef = db.doc(`growthLuckyBagClaims/${uid}/days/${day.value.dayId}`);
  const requestRef = db.doc(`growthLuckyBagRequests/${requestId}`);
  const walletRef = db.doc(`walletSummaries/${uid}`);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [requestSnap, claimSnap, walletSnap] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(claimRef),
        transaction.get(walletRef),
      ]);

      if (requestSnap.exists) {
        const prior = mapLuckyBagResult(requestSnap.data());
        if (prior) return prior;
        throw Object.assign(new Error('REQUEST_CONFLICT'), { code: 'REQUEST_CONFLICT' });
      }

      if (claimSnap.exists) {
        const prior = mapLuckyBagResult(claimSnap.data());
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

      let wallet = mapWalletSummary(walletSnap.exists ? walletSnap.data() : undefined, uid);
      const credit = applyWalletMutation(wallet, {
        amount: LUCKY_BAG_COIN_AMOUNT,
        currency: 'coins',
        type: 'credit',
      });
      if (!credit.ok) {
        throw Object.assign(new Error(credit.code || 'CONFLICT'), { code: credit.code || 'CONFLICT' });
      }
      wallet = credit.value.wallet;
      const timestamp = fieldValue.serverTimestamp();
      const settlementId = `glb_${day.value.dayId}_${uid}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
      const payload = {
        alreadyClaimed: false,
        amount: LUCKY_BAG_COIN_AMOUNT,
        balances: wallet.balances,
        currency: 'coins',
        dayId: day.value.dayId,
        nextResetAtMillis: day.value.endAtMillis,
        settlementId,
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
          amount: LUCKY_BAG_COIN_AMOUNT,
          balanceAfter: credit.value.balanceAfter,
          createdAt: timestamp,
          currency: 'coins',
          note: 'Lucky bag soft reward',
          referenceId: settlementId,
          source: 'lucky-bag',
          type: 'credit',
          uid,
        }),
      );
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
    if (error?.code === 'INSUFFICIENT_FUNDS') return { errorCode: 'INSUFFICIENT_FUNDS' };
    console.error('[growthMatch] lucky bag failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }
}

async function readProfileCountry(db, uid) {
  const snapshot = await db.doc(`publicProfiles/${uid}`).get();
  const country = typeof snapshot.data()?.countryCode === 'string'
    ? snapshot.data().countryCode.trim().toUpperCase()
    : '';
  return country;
}

function mapQuickMatchResult(data) {
  if (!data || typeof data !== 'object') return null;
  const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : '';
  if (!roomId) return null;
  return {
    countryCode: typeof data.countryCode === 'string' ? data.countryCode : '',
    masked: data.masked === true,
    mask: data.mask && typeof data.mask === 'object'
      ? {
          expiresAtMs: Number(data.mask.expiresAtMs) || 0,
          labelAr: typeof data.mask.labelAr === 'string' ? data.mask.labelAr : 'ضيف مقنع',
        }
      : null,
    participantCount: Number.isSafeInteger(data.participantCount) ? data.participantCount : 0,
    roomId,
    title: typeof data.title === 'string' ? data.title : '',
  };
}

function mapLuckyBagResult(data) {
  if (!data || typeof data !== 'object') return null;
  if (!Number.isSafeInteger(data.amount) || data.amount < 1) return null;
  if (typeof data.dayId !== 'string' || !data.dayId) return null;
  return {
    alreadyClaimed: data.alreadyClaimed === true,
    amount: data.amount,
    balances: data.balances && typeof data.balances === 'object' ? data.balances : undefined,
    currency: data.currency === 'diamonds' ? 'diamonds' : 'coins',
    dayId: data.dayId,
    nextResetAtMillis: Number.isSafeInteger(data.nextResetAtMillis) ? data.nextResetAtMillis : 0,
    settlementId: typeof data.settlementId === 'string' ? data.settlementId : '',
  };
}

module.exports = {
  claimLuckyBag,
  quickMatch,
};
