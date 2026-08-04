const crypto = require('node:crypto');

const { mapStoreCatalogItem } = require('./storeCore');
const { buildStoreOwnership, durationToMilliseconds, mapStoreOwnership } = require('./storePurchaseCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const {
  createDailyLoginDay,
  createDailyLoginFingerprint,
  createDailyLoginReceiptId,
  createDailyLoginSettlementId,
  isCampaignActive,
  isClientVersionCompatible,
  mapDailyLoginCampaignPointer,
  mapDailyLoginCampaignVersion,
  normalizeDailyLoginCommandBody,
  publicDailyLoginCalendar,
  resolveDailyLoginCampaignRevision,
  resolveDailyLoginPosition,
  resolveDailyLoginRateLimit,
  resolveEffectiveReward,
} = require('./dailyLoginCore');

const DAILY_LOGIN_FEATURE_DOCUMENT = 'appConfig/dailyLoginFeatures';
const DAILY_LOGIN_CAMPAIGN_DOCUMENT = 'dailyLoginCampaign/current';
const REWARDABLE_STORE_CATEGORIES = Object.freeze(['avatar-frames', 'cars', 'game-items']);

async function getDailyLoginStatus({ clock, db, input, uid }) {
  const command = normalizeDailyLoginCommandBody(input);
  if (!command.ok || command.value.action !== 'get-daily-login-status' || !isUid(uid)) {
    return dailyLoginError('INVALID_REQUEST');
  }
  const day = createDailyLoginDay(clock.nowMillis());
  if (!day.ok) return dailyLoginError(day.code);
  const refs = {
    campaign: db.doc(DAILY_LOGIN_CAMPAIGN_DOCUMENT),
    features: db.doc(DAILY_LOGIN_FEATURE_DOCUMENT),
    profile: db.doc(`publicProfiles/${uid}`),
    restriction: db.doc(`economyRestrictions/${uid}`),
    state: db.doc(`dailyLoginStates/${uid}`),
    today: db.doc(`dailyLoginClaims/${uid}/days/${day.value.dayId}`),
  };
  const [featuresSnapshot, campaignSnapshot, profileSnapshot, restrictionSnapshot, stateSnapshot, todaySnapshot] = await Promise.all([
    refs.features.get(),
    refs.campaign.get(),
    refs.profile.get(),
    refs.restriction.get(),
    refs.state.get(),
    refs.today.get(),
  ]);
  const features = featuresSnapshot.exists ? featuresSnapshot.data() : {};
  const enabled = features.daily_login_rewards === true;
  const itemRewardsEnabled = features.daily_login_reward_items === true;
  const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
  if (!profile || profile.uid !== uid || profile.moderationStatus !== 'active') {
    return dailyLoginError('ACCOUNT_NOT_ELIGIBLE');
  }
  if (isEconomyRestricted(restrictionSnapshot.exists ? restrictionSnapshot.data() : undefined)) {
    return dailyLoginError('ECONOMY_RESTRICTED');
  }
  if (!campaignSnapshot.exists) {
    return {
      result: disabledStatus({ day: day.value, enabled, reason: 'CAMPAIGN_MISSING' }),
    };
  }
  const pointer = mapDailyLoginCampaignPointer(campaignSnapshot.data());
  if (!pointer.ok) {
    return { result: disabledStatus({ day: day.value, enabled, reason: pointer.code }) };
  }
  const effectiveRevision = resolveDailyLoginCampaignRevision(pointer.value, clock.nowMillis());
  const versionSnapshot = await refs.campaign.collection('versions').doc(String(effectiveRevision)).get();
  const campaign = versionSnapshot.exists ? mapDailyLoginCampaignVersion(versionSnapshot.data()) : { ok: false, code: 'CAMPAIGN_MISSING' };
  if (
    !enabled
    || pointer.value.publicationStatus !== 'published'
    || pointer.value.emergencyDisabled
    || !campaign.ok
    || campaign.value.revision !== effectiveRevision
    || !isCampaignActive(campaign.value, clock.nowMillis())
  ) {
    const reason = !enabled
      ? 'FEATURE_DISABLED'
      : pointer.value.emergencyDisabled
        ? 'EMERGENCY_DISABLED'
        : !campaign.ok
          ? campaign.code
          : 'CAMPAIGN_INACTIVE';
    return {
      result: disabledStatus({
        day: day.value,
        enabled,
        presentationVisible: pointer.value.presentationVisible,
        reason,
      }),
    };
  }
  const compatible = isClientVersionCompatible(
    command.value.clientVersion,
    campaign.value.minimumClientVersion,
  );
  const state = stateSnapshot.exists ? stateSnapshot.data() : {};
  const position = resolveDailyLoginPosition({
    lastClaimDateId: readString(state.lastClaimDateId),
    lastStreakPosition: state.streakPosition,
    today: day.value,
  });
  const receipt = todaySnapshot.exists ? mapSafeReceipt(todaySnapshot.data(), uid, day.value.dayId) : undefined;
  const alreadyClaimed = Boolean(receipt) || position.value?.alreadyClaimed === true;
  const claimable = enabled && compatible && !alreadyClaimed;
  return {
      result: {
      alreadyClaimed,
      calendar: publicDailyLoginCalendar(campaign.value, itemRewardsEnabled),
      campaignRevision: campaign.value.revision,
      claimable: claimable && !pointer.value.claimsPaused,
      enabled,
      itemRewardsEnabled,
      minimumClientVersion: campaign.value.minimumClientVersion,
      nextResetAtMillis: day.value.nextResetAtMillis,
      presentationVisible: pointer.value.presentationVisible,
      ...(receipt ? { lastReceipt: receipt } : {}),
      reason: pointer.value.claimsPaused
        ? 'CLAIMS_PAUSED'
        : claimable
          ? ''
          : alreadyClaimed
            ? 'ALREADY_CLAIMED'
            : 'CLIENT_INCOMPATIBLE',
      streakPosition: position.value?.position || 1,
      timeZone: day.value.timeZone,
      todayDayId: day.value.dayId,
    },
  };
}

async function claimDailyLoginReward({ clock, db, fieldValue, input, uid }) {
  const command = normalizeDailyLoginCommandBody(input);
  if (!command.ok || command.value.action !== 'claim-daily-login-reward' || !isUid(uid)) {
    return dailyLoginError('INVALID_REQUEST');
  }
  const day = createDailyLoginDay(clock.nowMillis());
  if (!day.ok) return dailyLoginError(day.code);
  const receiptId = createDailyLoginReceiptId({ dayId: day.value.dayId, uid });
  const settlementId = createDailyLoginSettlementId({ dayId: day.value.dayId, uid });
  return db.runTransaction(async (transaction) => {
    const refs = {
      campaign: db.doc(DAILY_LOGIN_CAMPAIGN_DOCUMENT),
      command: db.doc(`dailyLoginCommands/${uid}/requests/${command.value.requestId}`),
      features: db.doc(DAILY_LOGIN_FEATURE_DOCUMENT),
      profile: db.doc(`publicProfiles/${uid}`),
      rateLimit: db.doc(`dailyLoginRateLimits/${uid}`),
      receipt: db.doc(`dailyLoginClaims/${uid}/days/${day.value.dayId}`),
      restriction: db.doc(`economyRestrictions/${uid}`),
      settlement: db.doc(`rewardSettlements/${settlementId}`),
      state: db.doc(`dailyLoginStates/${uid}`),
      wallet: db.doc(`walletSummaries/${uid}`),
    };
    const [
      commandSnapshot,
      receiptSnapshot,
      featuresSnapshot,
      campaignSnapshot,
      profileSnapshot,
      restrictionSnapshot,
      stateSnapshot,
      rateLimitSnapshot,
      walletSnapshot,
      settlementSnapshot,
    ] = await Promise.all([
      transaction.get(refs.command),
      transaction.get(refs.receipt),
      transaction.get(refs.features),
      transaction.get(refs.campaign),
      transaction.get(refs.profile),
      transaction.get(refs.restriction),
      transaction.get(refs.state),
      transaction.get(refs.rateLimit),
      transaction.get(refs.wallet),
      transaction.get(refs.settlement),
    ]);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      return previous.action === command.value.action
        && previous.dayId === day.value.dayId
        && previous.uid === uid
        && previous.result
        ? { replayed: true, result: previous.result }
        : dailyLoginError('REQUEST_CONFLICT');
    }
    if (receiptSnapshot.exists) {
      const receipt = mapSafeReceipt(receiptSnapshot.data(), uid, day.value.dayId);
      if (!receipt) return dailyLoginError('CLAIM_CONFLICT');
      const result = receiptSnapshot.data().result;
      if (!result) return dailyLoginError('CLAIM_CONFLICT');
      transaction.create(refs.command, {
        action: command.value.action,
        createdAt: fieldValue.serverTimestamp(),
        dayId: day.value.dayId,
        replayOfReceiptId: receipt.receiptId,
        requestId: command.value.requestId,
        result,
        uid,
      });
      return { replayed: true, result };
    }

    const features = featuresSnapshot.exists ? featuresSnapshot.data() : {};
    if (features.daily_login_rewards !== true) return dailyLoginError('FEATURE_DISABLED');
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    if (!profile || profile.uid !== uid || profile.moderationStatus !== 'active') {
      return dailyLoginError('ACCOUNT_NOT_ELIGIBLE');
    }
    if (isEconomyRestricted(restrictionSnapshot.exists ? restrictionSnapshot.data() : undefined)) {
      return dailyLoginError('ECONOMY_RESTRICTED');
    }
    if (!campaignSnapshot.exists) return dailyLoginError('CAMPAIGN_MISSING');
    const pointer = mapDailyLoginCampaignPointer(campaignSnapshot.data());
    if (!pointer.ok) return dailyLoginError(pointer.code);
    if (pointer.value.publicationStatus !== 'published') return dailyLoginError('CAMPAIGN_INACTIVE');
    if (pointer.value.emergencyDisabled) return dailyLoginError('EMERGENCY_DISABLED');
    if (pointer.value.claimsPaused) return dailyLoginError('CLAIMS_PAUSED');

    const effectiveRevision = resolveDailyLoginCampaignRevision(pointer.value, clock.nowMillis());
    const versionRef = refs.campaign.collection('versions').doc(String(effectiveRevision));
    const versionSnapshot = await transaction.get(versionRef);
    const campaign = versionSnapshot.exists
      ? mapDailyLoginCampaignVersion(versionSnapshot.data())
      : { ok: false, code: 'CAMPAIGN_MISSING' };
    if (!campaign.ok || campaign.value.revision !== effectiveRevision) {
      return dailyLoginError(campaign.code || 'CAMPAIGN_INVALID');
    }
    if (!isCampaignActive(campaign.value, clock.nowMillis())) return dailyLoginError('CAMPAIGN_INACTIVE');
    if (!isClientVersionCompatible(command.value.clientVersion, campaign.value.minimumClientVersion)) {
      return dailyLoginError('CLIENT_INCOMPATIBLE');
    }

    const state = stateSnapshot.exists ? stateSnapshot.data() : {};
    const position = resolveDailyLoginPosition({
      lastClaimDateId: readString(state.lastClaimDateId),
      lastStreakPosition: state.streakPosition,
      today: day.value,
    });
    if (!position.ok) return dailyLoginError(position.code);
    if (position.value.alreadyClaimed) return dailyLoginError('CLAIM_STATE_CONFLICT');

    const rateLimit = resolveDailyLoginRateLimit({
      nowMillis: clock.nowMillis(),
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
    });
    if (!rateLimit.ok) {
      transaction.set(refs.rateLimit, {
        attemptsMs: rateLimit.value?.attemptsMs || [],
        count: rateLimit.value?.count || 1,
        updatedAt: fieldValue.serverTimestamp(),
        uid,
        windowStartedAt: clock.timestampFromMillis(
          (rateLimit.value?.attemptsMs || [clock.nowMillis()])[0],
        ),
      });
      return dailyLoginError('RATE_LIMITED', { retryAfterMillis: rateLimit.retryAfterMillis });
    }

    const reward = resolveEffectiveReward(
      campaign.value.rewards[position.value.position - 1].reward,
      features.daily_login_reward_items === true,
    );
    if (!reward.ok) return dailyLoginError(reward.code);
    const itemRefs = reward.value.items.map((item) => ({
      catalog: db.doc(`storeCatalog/${item.itemId}`),
      ownership: db.doc(`storeOwnerships/${uid}/items/${item.itemId}`),
      reward: item,
    }));
    const itemSnapshots = await Promise.all(itemRefs.flatMap((item) => [
      transaction.get(item.catalog),
      transaction.get(item.ownership),
    ]));
    const catalogs = [];
    const ownerships = [];
    for (let index = 0; index < itemRefs.length; index += 1) {
      const catalogSnapshot = itemSnapshots[index * 2];
      const ownershipSnapshot = itemSnapshots[index * 2 + 1];
      const catalog = catalogSnapshot.exists
        ? mapStoreCatalogItem(catalogSnapshot.data(), itemRefs[index].reward.itemId)
        : undefined;
      const ownership = ownershipSnapshot.exists
        ? mapStoreOwnership(ownershipSnapshot.data(), itemRefs[index].reward.itemId)
        : undefined;
      if (
        !catalog
        || catalog.availability !== 'available'
        || !REWARDABLE_STORE_CATEGORIES.includes(catalog.category)
        || (catalog.stock.kind === 'limited' && catalog.stock.remaining === 0)
      ) return dailyLoginError('ITEM_NOT_REWARDABLE');
      if (ownershipSnapshot.exists && !ownership) return dailyLoginError('OWNERSHIP_INVALID');
      if (ownership && ownership.category !== catalog.category) {
        return dailyLoginError('OWNERSHIP_CATALOG_MISMATCH');
      }
      if (ownership && catalog.duration.kind === 'permanent' && !itemRefs[index].reward.duplicateFallback) {
        return dailyLoginError('DUPLICATE_FALLBACK_REQUIRED');
      }
      catalogs.push(catalog);
      ownerships.push(ownership);
    }

    const currencyCredits = { coins: reward.value.coins, diamonds: reward.value.diamonds };
    const itemResults = [];
    for (let index = 0; index < itemRefs.length; index += 1) {
      const itemReward = itemRefs[index].reward;
      const catalog = catalogs[index];
      const ownership = ownerships[index];
      if (ownership && catalog.duration.kind === 'permanent') {
        currencyCredits[itemReward.duplicateFallback.currency] += itemReward.duplicateFallback.amount;
        itemResults.push({
          fallback: itemReward.duplicateFallback,
          itemId: itemReward.itemId,
          outcome: 'duplicate-fallback',
        });
      } else {
        itemResults.push({
          itemId: itemReward.itemId,
          outcome: ownership ? 'extended' : 'granted',
        });
      }
    }

    let wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, uid);
    const walletCredits = [];
    for (const currency of ['coins', 'diamonds']) {
      const amount = currencyCredits[currency];
      if (amount === 0) continue;
      const credit = applyWalletMutation(wallet, { amount, currency, type: 'credit' });
      if (!credit.ok) return dailyLoginError('WALLET_LIMIT');
      wallet = credit.value.wallet;
      walletCredits.push({ amount, balanceAfter: credit.value.balanceAfter, currency });
    }
    const fingerprint = createDailyLoginFingerprint({
      campaignRevision: campaign.value.revision,
      dayId: day.value.dayId,
      rewardBundle: reward.value,
      streakPosition: position.value.position,
      uid,
    });
    if (!fingerprint || settlementSnapshot.exists) return dailyLoginError('CLAIM_CONFLICT');

    const timestamp = fieldValue.serverTimestamp();
    const result = {
      balances: wallet.balances,
      campaignRevision: campaign.value.revision,
      dayId: day.value.dayId,
      items: itemResults,
      nextResetAtMillis: day.value.nextResetAtMillis,
      receiptId,
      reward: reward.value,
      settlementId,
      streakPosition: position.value.position,
      walletCredits,
    };
    transaction.set(refs.rateLimit, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      updatedAt: timestamp,
      uid,
      windowStartedAt: clock.timestampFromMillis(rateLimit.value.attemptsMs[0]),
    });
    if (walletCredits.length > 0) {
      transaction.set(refs.wallet, buildWalletDocument(wallet, {
        createdAt: walletSnapshot.exists && walletSnapshot.data()?.createdAt
          ? walletSnapshot.data().createdAt
          : timestamp,
        updatedAt: timestamp,
      }), { merge: true });
      for (const credit of walletCredits) {
        transaction.create(
          db.doc(`walletTransactions/${settlementId}_${credit.currency}`),
          buildWalletTransaction({
            actorUid: 'system',
            amount: credit.amount,
            balanceAfter: credit.balanceAfter,
            createdAt: timestamp,
            currency: credit.currency,
            note: 'Daily login reward',
            referenceId: settlementId,
            source: 'daily-login',
            type: 'credit',
            uid,
          }),
        );
      }
    }
    for (let index = 0; index < itemRefs.length; index += 1) {
      const itemRef = itemRefs[index];
      const catalog = catalogs[index];
      const ownership = ownerships[index];
      const resultItem = itemResults[index];
      const entitlementLedger = db.doc(`rewardEntitlementTransactions/${settlementId}_${catalog.itemId}`);
      if (resultItem.outcome === 'duplicate-fallback') {
        transaction.create(entitlementLedger, {
          createdAt: timestamp,
          fallback: resultItem.fallback,
          itemId: catalog.itemId,
          outcome: resultItem.outcome,
          settlementId,
          source: 'daily-login',
          uid,
        });
        continue;
      }
      const durationMs = durationToMilliseconds(catalog.duration);
      const existingExpiry = ownership?.expiresAt?.toMillis?.() || 0;
      const expiresAt = durationMs
        ? clock.timestampFromMillis(Math.max(clock.nowMillis(), existingExpiry) + durationMs)
        : undefined;
      if (ownership) {
        transaction.update(itemRef.ownership, {
          equipped: ownership.equipped,
          ...(expiresAt ? { expiresAt } : {}),
          state: 'active',
          updatedAt: timestamp,
        });
      } else {
        transaction.create(itemRef.ownership, {
          ...buildStoreOwnership({
            acquiredAt: timestamp,
            expiresAt,
            item: catalog,
            ownershipId: catalog.itemId,
            uid,
          }),
          equipped: false,
          source: 'daily-login',
        });
      }
      transaction.create(entitlementLedger, {
        createdAt: timestamp,
        ...(expiresAt ? { expiresAt } : {}),
        itemId: catalog.itemId,
        outcome: resultItem.outcome,
        settlementId,
        source: 'daily-login',
        uid,
      });
      if (catalog.stock.kind === 'limited') {
        transaction.update(itemRef.catalog, {
          stock: { kind: 'limited', remaining: catalog.stock.remaining - 1 },
          updatedAt: timestamp,
        });
      }
    }
    transaction.create(refs.settlement, {
      campaignRevision: campaign.value.revision,
      cycleId: day.value.dayId,
      feature: 'daily-login',
      fingerprint,
      paidAt: timestamp,
      rewardBundle: reward.value,
      result: { items: itemResults, settlementId, walletCredits },
      schemaVersion: 1,
      settlementId,
      source: { dayId: day.value.dayId, receiptId, streakPosition: position.value.position },
      state: 'paid',
      uid,
      updatedAt: timestamp,
    });
    transaction.create(refs.receipt, {
      campaignRevision: campaign.value.revision,
      claimedAt: timestamp,
      dateId: day.value.dateId,
      dayId: day.value.dayId,
      deviceHash: command.value.deviceHash,
      fingerprint,
      kind: 'daily-login-claim',
      receiptId,
      requestId: command.value.requestId,
      result,
      rewardBundle: reward.value,
      schemaVersion: 1,
      settlementId,
      streakPosition: position.value.position,
      timeZone: day.value.timeZone,
      uid,
    });
    transaction.set(refs.state, {
      campaignRevision: campaign.value.revision,
      lastClaimDateId: day.value.dateId,
      lastClaimDayId: day.value.dayId,
      lastReceiptId: receiptId,
      schemaVersion: 1,
      streakPosition: position.value.position,
      uid,
      updatedAt: timestamp,
    });
    transaction.create(refs.command, {
      action: command.value.action,
      createdAt: timestamp,
      dayId: day.value.dayId,
      requestId: command.value.requestId,
      result,
      uid,
    });
    return { replayed: false, result };
  });
}

async function reconcileDailyLoginClaim({ db, dayId, uid }) {
  const receiptSnapshot = await db.doc(`dailyLoginClaims/${uid}/days/${dayId}`).get();
  if (!receiptSnapshot.exists) return { errorCode: 'NOT_FOUND' };
  const receipt = receiptSnapshot.data();
  const expectedReceiptId = createDailyLoginReceiptId({ dayId, uid });
  const expectedSettlementId = createDailyLoginSettlementId({ dayId, uid });
  const discrepancies = [];
  if (
    receipt.uid !== uid
    || receipt.dayId !== dayId
    || receipt.receiptId !== expectedReceiptId
    || receipt.settlementId !== expectedSettlementId
  ) discrepancies.push('RECEIPT_IDENTITY');
  const settlementSnapshot = await db.doc(`rewardSettlements/${expectedSettlementId}`).get();
  const settlement = settlementSnapshot.exists ? settlementSnapshot.data() : undefined;
  if (
    !settlement
    || settlement.state !== 'paid'
    || settlement.uid !== uid
    || settlement.settlementId !== expectedSettlementId
    || settlement.fingerprint !== receipt.fingerprint
  ) discrepancies.push('SETTLEMENT');
  for (const credit of receipt.result?.walletCredits || []) {
    const ledgerSnapshot = await db.doc(`walletTransactions/${expectedSettlementId}_${credit.currency}`).get();
    const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() : undefined;
    if (
      !ledger
      || ledger.uid !== uid
      || ledger.amount !== credit.amount
      || ledger.balanceAfter !== credit.balanceAfter
      || ledger.referenceId !== expectedSettlementId
      || ledger.source !== 'daily-login'
    ) discrepancies.push(`WALLET_LEDGER_${String(credit.currency).toUpperCase()}`);
  }
  for (const item of receipt.result?.items || []) {
    const ledgerSnapshot = await db.doc(`rewardEntitlementTransactions/${expectedSettlementId}_${item.itemId}`).get();
    const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() : undefined;
    if (
      !ledger
      || ledger.uid !== uid
      || ledger.itemId !== item.itemId
      || ledger.outcome !== item.outcome
      || ledger.settlementId !== expectedSettlementId
    ) discrepancies.push(`ITEM_LEDGER_${item.itemId}`);
    if (['granted', 'extended'].includes(item.outcome)) {
      const ownershipSnapshot = await db.doc(`storeOwnerships/${uid}/items/${item.itemId}`).get();
      const ownership = ownershipSnapshot.exists ? ownershipSnapshot.data() : undefined;
      if (!ownership || ownership.uid !== uid || ownership.itemId !== item.itemId || ownership.state !== 'active') {
        discrepancies.push(`ITEM_ENTITLEMENT_${item.itemId}`);
      }
    }
  }
  return {
    balanced: discrepancies.length === 0,
    dayId,
    discrepancies,
    receiptId: expectedReceiptId,
    settlementId: expectedSettlementId,
    uid,
  };
}

async function recordDailyLoginClaimFailure({ clock, code, db, fieldValue, uid }) {
  const day = createDailyLoginDay(clock.nowMillis());
  if (!day.ok || !isUid(uid) || typeof code !== 'string' || !/^[A-Z_]{3,64}$/.test(code)) return;
  const shard = Number.parseInt(
    crypto.createHash('sha256').update(uid).digest('hex').slice(0, 2),
    16,
  ) % 16;
  await db.doc(`dailyLoginFailureMetrics/${day.value.dateId}_${code}_${shard}`).set({
    code,
    count: fieldValue.increment(1),
    dateId: day.value.dateId,
    dayId: day.value.dayId,
    shard,
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });
}

function disabledStatus({ day, enabled, presentationVisible = false, reason }) {
  return {
    alreadyClaimed: false,
    calendar: [],
    campaignRevision: 0,
    claimable: false,
    enabled,
    itemRewardsEnabled: false,
    minimumClientVersion: '',
    nextResetAtMillis: day.nextResetAtMillis,
    presentationVisible,
    reason,
    streakPosition: 1,
    timeZone: day.timeZone,
    todayDayId: day.dayId,
  };
}

function mapSafeReceipt(data, uid, dayId) {
  if (
    !data
    || data.uid !== uid
    || data.dayId !== dayId
    || data.receiptId !== createDailyLoginReceiptId({ dayId, uid })
    || data.settlementId !== createDailyLoginSettlementId({ dayId, uid })
  ) return undefined;
  return {
    campaignRevision: data.campaignRevision,
    dayId: data.dayId,
    receiptId: data.receiptId,
    result: data.result,
    settlementId: data.settlementId,
    streakPosition: data.streakPosition,
  };
}

function isEconomyRestricted(data) {
  return Boolean(
    data
    && (
      data.dailyLoginRewardsBlocked === true
      || data.status === 'restricted'
      || data.status === 'suspended'
    )
  );
}

function isUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function readString(value) {
  return typeof value === 'string' ? value : '';
}

function dailyLoginError(code, details) {
  const map = {
    ACCOUNT_NOT_ELIGIBLE: [403, 'This account cannot claim daily rewards.'],
    CAMPAIGN_INACTIVE: [409, 'The daily reward campaign is not active.'],
    CAMPAIGN_INVALID: [503, 'The daily reward campaign is invalid.'],
    CAMPAIGN_MISSING: [503, 'The daily reward campaign is unavailable.'],
    CLAIMS_PAUSED: [503, 'Daily reward claims are temporarily paused.'],
    CLAIM_CONFLICT: [409, 'The daily reward claim is inconsistent.'],
    CLAIM_STATE_CONFLICT: [409, 'The daily reward state requires reconciliation.'],
    CLIENT_INCOMPATIBLE: [426, 'Update the app before claiming this reward.'],
    DUPLICATE_FALLBACK_REQUIRED: [503, 'The item reward fallback is not configured.'],
    ECONOMY_RESTRICTED: [403, 'Daily rewards are restricted for this account.'],
    EMERGENCY_DISABLED: [503, 'Daily rewards are temporarily unavailable.'],
    FEATURE_DISABLED: [503, 'Daily rewards are not enabled.'],
    INVALID_DAY: [500, 'The reward day could not be determined.'],
    INVALID_REQUEST: [400, 'The daily reward request is invalid.'],
    ITEM_NOT_REWARDABLE: [503, 'The configured item reward is unavailable.'],
    ITEM_REWARDS_DISABLED: [503, 'Item rewards are not enabled.'],
    OWNERSHIP_CATALOG_MISMATCH: [503, 'The item reward ownership is inconsistent.'],
    OWNERSHIP_INVALID: [503, 'The item reward ownership is invalid.'],
    RATE_LIMITED: [429, 'Too many daily reward attempts.'],
    REQUEST_CONFLICT: [409, 'This request ID was already used.'],
    WALLET_LIMIT: [409, 'The wallet cannot accept this reward.'],
  };
  const [status, error] = map[code] || [500, 'The daily reward command failed.'];
  return { code, ...(details ? { details } : {}), error, ok: false, status };
}

module.exports = {
  DAILY_LOGIN_CAMPAIGN_DOCUMENT,
  DAILY_LOGIN_FEATURE_DOCUMENT,
  REWARDABLE_STORE_CATEGORIES,
  claimDailyLoginReward,
  dailyLoginError,
  getDailyLoginStatus,
  isEconomyRestricted,
  recordDailyLoginClaimFailure,
  reconcileDailyLoginClaim,
};
