const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const { isTimestampLike } = require('./socialProfileCore');
const {
  applyEconomyMutation,
  applyPlatformGiftRevenue,
  buildEconomyFields,
  buildEconomyLedgerEntry,
  buildRoomGiftFingerprint,
  createRoomGiftEventId,
  createRoomGiftLedgerId,
  createRoomGiftQuoteId,
  mapCatalogForRoomGift,
  mapCommissionPolicy,
  mapPlatformGiftAccount,
  mapWalletEconomy,
  normalizeRoomGiftBody,
  quoteRoomGift,
  resolveRoomGiftSend,
  roomGiftError,
  PLATFORM_GIFT_ACCOUNT_ID,
  ROOM_GIFT_CATALOG_LIMIT,
  timestampToMillis,
  validateRoomGiftRequest,
} = require('./roomGiftCore');
const {
  createGiftComboId,
  inspectGiftPresentation,
  isEligibleGlobalGiftCampaign,
  resolveGiftComboState,
  resolveGiftPresentationDelivery,
} = require('./roomGiftPresentationCore');
const {
  buildGiftEffectCopySnapshot,
  resolveRoomEffectSurface,
} = require('./roomEffectPresentationCore');
const {
  publicLuckyOdds,
  resolveGiftComboForTheater,
  resolveGiftTheaterFlags,
  resolveGiftTheaterKind,
  resolveLuckyGiftRoll,
  resolveMagicGiftTemplate,
  resolvePublishedLuckyTable,
  resolvePublishedMagicTemplates,
} = require('./giftTheaterCore');
const {
  ROOM_GIFT_RATE_LIMIT,
  ROOM_GIFT_RATE_WINDOW_MS,
  VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
  VOICE_ROOM_RATE_RECORD_RETENTION_MS,
  resolveSlidingWindowRateLimit,
} = require('./voiceRoomRateLimitCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeRoomGiftCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomGiftRequest(normalizeRoomGiftBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomGiftFingerprint(decodedToken.uid, command);

  if (command.action === 'get-room-gift-center') {
    return getRoomGiftCenter({ command, db, decodedToken });
  }
  if (command.action === 'quote-room-gift') {
    return quoteRoomGiftCommand({
      clock,
      command,
      db,
      decodedToken,
      fieldValue,
      fingerprint,
    });
  }

  return sendRoomGiftCommand({
    clock,
    command,
    db,
    decodedToken,
    fieldValue,
    fingerprint,
  });
}

async function getRoomGiftCenter({ command, db, decodedToken }) {
  const [
    featureSnapshot,
    growthSnapshot,
    policySnapshot,
    roomSnapshot,
    actorMemberSnapshot,
    actorPublicSnapshot,
    walletSnapshot,
    catalogSnapshot,
    luckyTableSnapshot,
    magicTemplatesSnapshot,
  ] = await Promise.all([
    db.doc('appConfig/voiceRoomFeatures').get(),
    db.doc('appConfig/growthFeatures').get(),
    db.doc('appConfig/roomGiftCommissionPolicy').get(),
    db.doc(`rooms/${command.roomId}`).get(),
    db.doc(`rooms/${command.roomId}/members/${decodedToken.uid}`).get(),
    db.doc(`publicProfiles/${decodedToken.uid}`).get(),
    db.doc(`walletSummaries/${decodedToken.uid}`).get(),
    db.collection('giftCatalog').where('status', '==', 'available').orderBy('price').limit(ROOM_GIFT_CATALOG_LIMIT).get(),
    db.doc('appConfig/giftLuckyTable').get(),
    db.doc('appConfig/magicGiftFrameTemplates').get(),
  ]);

  if (featureSnapshot.data()?.voice_room_gifts !== true) {
    return roomGiftError('FEATURE_DISABLED', 503, 'Room gifts are not enabled.');
  }
  const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
  const membership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
  const profile = actorPublicSnapshot.exists ? actorPublicSnapshot.data() : undefined;
  if (!room || room.status !== 'active' || (room.availability && room.availability !== 'active')) {
    return roomGiftError('ROOM_NOT_ACTIVE', 409, 'The room is not available for gifts.');
  }
  if (!membership || membership.uid !== decodedToken.uid || membership.status !== 'active') {
    return roomGiftError('ROOM_NOT_ACTIVE', 409, 'Join the room before opening gifts.');
  }
  if (!profile || profile.moderationStatus !== 'active') {
    return roomGiftError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }

  const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, decodedToken.uid);
  const economy = mapWalletEconomy(walletSnapshot.exists ? walletSnapshot.data() : undefined);
  const policy = mapCommissionPolicy(policySnapshot.exists ? policySnapshot.data() : undefined);
  const theaterFlags = resolveGiftTheaterFlags(growthSnapshot.exists ? growthSnapshot.data() : undefined);
  const luckyTable = resolvePublishedLuckyTable(
    luckyTableSnapshot.exists ? luckyTableSnapshot.data() : undefined,
    'default',
  );
  return {
    ok: true,
    result: {
      action: 'get-room-gift-center',
      balances: wallet.balances,
      catalog: catalogSnapshot.docs
        .map((document) => mapCatalogForRoomGift(document.data()))
        .filter(Boolean),
      economyBalances: economy.balances,
      ...(theaterFlags.luckyGifts ? { luckyOdds: publicLuckyOdds(luckyTable) } : {}),
      ...(theaterFlags.magicGiftTemplates
        ? {
          magicFrameTemplates: resolvePublishedMagicTemplates(
            magicTemplatesSnapshot.exists ? magicTemplatesSnapshot.data() : undefined,
          ),
        }
        : {}),
      policy: policy
        ? {
          commissionBps: policy.commissionBps,
          policyVersion: policy.version,
        }
        : null,
      requestId: command.requestId,
      roomId: command.roomId,
      theaterFlags,
    },
  };
}

async function quoteRoomGiftCommand({
  clock,
  command,
  db,
  decodedToken,
  fieldValue,
  fingerprint,
}) {
  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('giftCommandRequests').doc(command.requestId);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const policyRef = db.doc('appConfig/roomGiftCommissionPolicy');
    const catalogRef = db.doc(`giftCatalog/${command.giftId}`);
    const actorMemberRef = roomRef.collection('members').doc(decodedToken.uid);
    const targetMemberRef = roomRef.collection('members').doc(command.targetUid);
    const actorPublicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const targetPublicRef = db.doc(`publicProfiles/${command.targetUid}`);
    const blockedBySenderRef = db.doc(`blocks/${decodedToken.uid}/blocked/${command.targetUid}`);
    const blockedByRecipientRef = db.doc(`blocks/${command.targetUid}/blocked/${decodedToken.uid}`);
    const walletRef = db.doc(`walletSummaries/${decodedToken.uid}`);

    const [
      requestSnapshot,
      featureSnapshot,
      policySnapshot,
      catalogSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      targetMemberSnapshot,
      actorPublicSnapshot,
      targetPublicSnapshot,
      blockedBySenderSnapshot,
      blockedByRecipientSnapshot,
      walletSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
      transaction.get(policyRef),
      transaction.get(catalogRef),
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      transaction.get(targetMemberRef),
      transaction.get(actorPublicRef),
      transaction.get(targetPublicRef),
      transaction.get(blockedBySenderRef),
      transaction.get(blockedByRecipientRef),
      transaction.get(walletRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomGiftError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    if (featureSnapshot.data()?.voice_room_gifts !== true) {
      return roomGiftError('FEATURE_DISABLED', 503, 'Room gifts are not enabled.');
    }

    const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
    const actorMembership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
    const recipientMembership = targetMemberSnapshot.exists ? targetMemberSnapshot.data() : undefined;
    const actorPublicProfile = actorPublicSnapshot.exists ? actorPublicSnapshot.data() : undefined;
    const recipientPublicProfile = targetPublicSnapshot.exists ? targetPublicSnapshot.data() : undefined;

    if (!room || room.status !== 'active' || (room.availability && room.availability !== 'active')) {
      return roomGiftError('ROOM_NOT_ACTIVE', 409, 'The room is not available for gifts.');
    }
    if (!actorMembership || actorMembership.uid !== decodedToken.uid || actorMembership.status !== 'active') {
      return roomGiftError('ROOM_NOT_ACTIVE', 409, 'Join the room before sending gifts.');
    }
    if (command.targetUid === decodedToken.uid) {
      return roomGiftError('SELF_GIFT_FORBIDDEN', 400, 'You cannot send a room gift to yourself.');
    }
    if (blockedBySenderSnapshot.exists || blockedByRecipientSnapshot.exists) {
      return roomGiftError('BLOCKED_RELATIONSHIP', 403, 'Room gifts are unavailable between these users.');
    }
    if (
      !recipientMembership
      || recipientMembership.uid !== command.targetUid
      || recipientMembership.status !== 'active'
      || !recipientPublicProfile
      || recipientPublicProfile.moderationStatus !== 'active'
    ) {
      return roomGiftError('RECIPIENT_UNAVAILABLE', 409, 'The recipient is not available in this room.');
    }
    if (!actorPublicProfile || actorPublicProfile.moderationStatus !== 'active') {
      return roomGiftError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
    }

    const quoteId = createRoomGiftQuoteId(command.requestId);
    const catalogItem = mapCatalogForRoomGift(catalogSnapshot.exists ? catalogSnapshot.data() : undefined);
    if (catalogItem?.presentation?.animationEnabled) {
      const inspected = inspectGiftPresentation({
        presentation: catalogItem.presentation,
        records: await readGiftPresentationRecords(transaction, db, catalogItem.presentation),
      });
      if (!inspected.ok) {
        return roomGiftError(inspected.code, 409, 'Gift presentation approval is unavailable.');
      }
      catalogItem.presentation = inspected.presentation;
    }
    const quoted = quoteRoomGift({
      catalogItem,
      command,
      nowMs: clock.nowMillis(),
      policy: mapCommissionPolicy(policySnapshot.exists ? policySnapshot.data() : undefined),
      quoteId,
    });
    if (!quoted.ok) return quoted;

    const timestamp = fieldValue.serverTimestamp();
    const expiresAt = clock.timestampFromMillis(quoted.value.expiresAtMs);
    const purgeAfter = clock.timestampFromMillis(
      clock.nowMillis() + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
    );
    const quoteRef = roomRef.collection('giftQuotes').doc(quoteId);
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, decodedToken.uid);
    const response = {
      ok: true,
      result: {
        action: 'quote-room-gift',
        balances: wallet.balances,
        economyBalances: mapWalletEconomy(walletSnapshot.exists ? walletSnapshot.data() : undefined).balances,
        quote: quoted.value,
        requestId: command.requestId,
        roomId: command.roomId,
      },
    };

    transaction.create(quoteRef, {
      ...quoted.value,
      createdAt: timestamp,
      expiresAt,
      senderUid: decodedToken.uid,
      status: 'open',
      purgeAfter,
    });
    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      giftId: command.giftId,
      quantity: command.quantity,
      quoteId,
      purgeAfter,
      requestId: command.requestId,
      response,
      targetUid: command.targetUid,
    });
    return response;
  });
}

async function sendRoomGiftCommand({
  clock,
  command,
  db,
  decodedToken,
  fieldValue,
  fingerprint,
}) {
  const response = await db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('giftCommandRequests').doc(command.requestId);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const growthRef = db.doc('appConfig/growthFeatures');
    const cosmeticsFeatureRef = db.doc('appConfig/cosmeticsFeatures');
    const globalCampaignRef = db.doc('appConfig/roomGiftGlobalCampaign');
    const luckyTableRef = db.doc('appConfig/giftLuckyTable');
    const magicTemplatesRef = db.doc('appConfig/magicGiftFrameTemplates');
    const catalogRef = db.doc(`giftCatalog/${command.giftId}`);
    const quoteRef = roomRef.collection('giftQuotes').doc(command.quoteId);
    const eventId = createRoomGiftEventId(command.requestId, command.roomId);
    const eventRef = roomRef.collection('giftEvents').doc(eventId);
    const effectRef = roomRef.collection('events').doc(eventId);
    const globalEffectRef = db.doc(`globalRoomEffects/${eventId}`);
    const actorMemberRef = roomRef.collection('members').doc(decodedToken.uid);
    const targetMemberRef = roomRef.collection('members').doc(command.targetUid);
    const actorPublicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const targetPublicRef = db.doc(`publicProfiles/${command.targetUid}`);
    const blockedBySenderRef = db.doc(`blocks/${decodedToken.uid}/blocked/${command.targetUid}`);
    const blockedByRecipientRef = db.doc(`blocks/${command.targetUid}/blocked/${decodedToken.uid}`);
    const senderWalletRef = db.doc(`walletSummaries/${decodedToken.uid}`);
    const recipientWalletRef = db.doc(`walletSummaries/${command.targetUid}`);
    const senderLedgerRef = db.doc(`walletTransactions/${createRoomGiftLedgerId({
      kind: 'spend',
      requestId: command.requestId,
      roomId: command.roomId,
      uid: decodedToken.uid,
    })}`);
    const recipientLedgerRef = db.doc(`walletTransactions/${createRoomGiftLedgerId({
      kind: 'earn',
      requestId: command.requestId,
      roomId: command.roomId,
      uid: command.targetUid,
    })}`);
    const platformAccountRef = db.doc(`platformEconomyAccounts/${PLATFORM_GIFT_ACCOUNT_ID}`);
    const platformLedgerRef = db.doc(`platformEconomyTransactions/${createRoomGiftLedgerId({
      kind: 'platform',
      requestId: command.requestId,
      roomId: command.roomId,
      uid: PLATFORM_GIFT_ACCOUNT_ID,
    })}`);
    const receiptSenderRef = db.doc(`roomGiftReceipts/${decodedToken.uid}/items/${eventId}`);
    const receiptRecipientRef = db.doc(`roomGiftReceipts/${command.targetUid}/items/${eventId}`);
    const contributionRef = roomRef.collection('giftContributions').doc(decodedToken.uid);
    const rateLimitRef = roomRef.collection('giftRateLimits').doc(decodedToken.uid);
    const comboRef = roomRef.collection('giftCombos').doc(createGiftComboId({
      giftId: command.giftId,
      senderUid: decodedToken.uid,
      targetUid: command.targetUid,
    }));

    const [
      requestSnapshot,
      featureSnapshot,
      growthSnapshot,
      cosmeticsFeatureSnapshot,
      globalCampaignSnapshot,
      luckyTableSnapshot,
      magicTemplatesSnapshot,
      catalogSnapshot,
      quoteSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      targetMemberSnapshot,
      actorPublicSnapshot,
      targetPublicSnapshot,
      blockedBySenderSnapshot,
      blockedByRecipientSnapshot,
      senderWalletSnapshot,
      recipientWalletSnapshot,
      platformAccountSnapshot,
      contributionSnapshot,
      rateLimitSnapshot,
      comboSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
      transaction.get(growthRef),
      transaction.get(cosmeticsFeatureRef),
      transaction.get(globalCampaignRef),
      transaction.get(luckyTableRef),
      transaction.get(magicTemplatesRef),
      transaction.get(catalogRef),
      transaction.get(quoteRef),
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      transaction.get(targetMemberRef),
      transaction.get(actorPublicRef),
      transaction.get(targetPublicRef),
      transaction.get(blockedBySenderRef),
      transaction.get(blockedByRecipientRef),
      transaction.get(senderWalletRef),
      transaction.get(recipientWalletRef),
      transaction.get(platformAccountRef),
      transaction.get(contributionRef),
      transaction.get(rateLimitRef),
      transaction.get(comboRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomGiftError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    const resolution = resolveRoomGiftSend({
      actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
      actorPublicProfile: actorPublicSnapshot.exists ? actorPublicSnapshot.data() : undefined,
      blockedByRecipient: blockedByRecipientSnapshot.exists,
      blockedBySender: blockedBySenderSnapshot.exists,
      command,
      featureFlags: featureSnapshot.exists ? featureSnapshot.data() : undefined,
      nowMs: clock.nowMillis(),
      quote: quoteSnapshot.exists ? quoteSnapshot.data() : undefined,
      recipientMembership: targetMemberSnapshot.exists ? targetMemberSnapshot.data() : undefined,
      recipientPublicProfile: targetPublicSnapshot.exists ? targetPublicSnapshot.data() : undefined,
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
      senderUid: decodedToken.uid,
    });
    if (!resolution.ok) return resolution;

    let approvedPresentation = resolution.value.presentation;
    if (approvedPresentation?.animationEnabled) {
      const inspected = inspectGiftPresentation({
        presentation: approvedPresentation,
        records: await readGiftPresentationRecords(transaction, db, approvedPresentation),
      });
      if (!inspected.ok) {
        return roomGiftError(inspected.code, 409, 'Gift presentation approval is unavailable.');
      }
      approvedPresentation = inspected.presentation;
    }

    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_GIFT_RATE_LIMIT,
      nowMs: clock.nowMillis(),
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_GIFT_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) return rateLimit;

    const quote = { ...resolution.value, presentation: approvedPresentation };
    const cosmeticsFeatures = cosmeticsFeatureSnapshot.exists ? cosmeticsFeatureSnapshot.data() : {};
    const globalCampaign = globalCampaignSnapshot.exists ? globalCampaignSnapshot.data() : undefined;
    const globalCampaignEligible = isEligibleGlobalGiftCampaign({
      campaign: globalCampaign,
      giftId: quote.giftId,
      nowMs: clock.nowMillis(),
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
    });
    const delivery = resolveGiftPresentationDelivery(
      approvedPresentation,
      {
        ...cosmeticsFeatures,
        room_gift_global_effects: cosmeticsFeatures.room_gift_global_effects === true && globalCampaignEligible,
      },
      command.clientVersion,
    );
    const theaterFlags = resolveGiftTheaterFlags(growthSnapshot.exists ? growthSnapshot.data() : undefined);
    const catalogTheater = mapCatalogForRoomGift(catalogSnapshot.exists ? catalogSnapshot.data() : undefined)?.theater
      || { luckyTableId: 'default', tags: [] };
    const combo = resolveGiftComboForTheater({
      combosEnabled: theaterFlags.giftCombos,
      existing: comboSnapshot.exists ? comboSnapshot.data() : undefined,
      giftId: quote.giftId,
      nowMs: clock.nowMillis(),
      quantity: quote.quantity,
      requestId: command.requestId,
      resolveGiftComboState,
      senderUid: decodedToken.uid,
      targetUid: command.targetUid,
      tier: quote.presentationTier,
    });
    let luckyOutcome = null;
    if (theaterFlags.luckyGifts && catalogTheater.tags.includes('lucky')) {
      const table = resolvePublishedLuckyTable(
        luckyTableSnapshot.exists ? luckyTableSnapshot.data() : undefined,
        catalogTheater.luckyTableId || 'default',
      );
      const roll = resolveLuckyGiftRoll({
        giftId: quote.giftId,
        requestId: command.requestId,
        table,
      });
      if (!roll.ok) {
        return roomGiftError(roll.code, 503, 'Lucky gift table is unavailable.');
      }
      luckyOutcome = roll.value;
    }
    let magicFrame = null;
    if (theaterFlags.magicGiftTemplates && catalogTheater.tags.includes('magic')) {
      const templates = resolvePublishedMagicTemplates(
        magicTemplatesSnapshot.exists ? magicTemplatesSnapshot.data() : undefined,
      );
      const resolvedMagic = resolveMagicGiftTemplate({
        magicFrameTemplateId: command.magicFrameTemplateId,
        templates,
      });
      if (!resolvedMagic.ok) {
        return roomGiftError(
          resolvedMagic.code,
          400,
          resolvedMagic.code === 'MAGIC_TEMPLATE_UNKNOWN'
            ? 'Unknown magic gift frame template.'
            : 'Select an approved magic gift frame template.',
        );
      }
      magicFrame = resolvedMagic.value;
    }
    const theaterKind = resolveGiftTheaterKind({
      presentationTier: delivery.presentationTier,
      tags: catalogTheater.tags,
    });
    const activePkSessionId = typeof roomSnapshot.data()?.activePkSessionId === 'string'
      ? roomSnapshot.data().activePkSessionId.trim()
      : '';
    let pkContext;
    const giftCommittedAtMs = clock.nowMillis();
    if (activePkSessionId) {
      const pkSessionSnapshot = await transaction.get(db.doc(`roomPkSessions/${activePkSessionId}`));
      const pkSession = pkSessionSnapshot.exists ? pkSessionSnapshot.data() : undefined;
      const startedAtMs = typeof pkSession?.startedAt?.toMillis === 'function'
        ? pkSession.startedAt.toMillis()
        : Number(pkSession?.startedAtMs) || 0;
      const endsAtMs = typeof pkSession?.endsAt?.toMillis === 'function'
        ? pkSession.endsAt.toMillis()
        : Number(pkSession?.endsAtMs) || 0;
      if (
        pkSession?.pkId === activePkSessionId
        && ['in-room-teams', 'cross-room'].includes(pkSession.mode)
        && pkSession.status === 'active'
        && startedAtMs <= giftCommittedAtMs
        && giftCommittedAtMs <= endsAtMs
      ) {
        pkContext = { mode: pkSession.mode, pkId: activePkSessionId };
      }
    }
    const senderWallet = mapWalletSummary(
      senderWalletSnapshot.exists ? senderWalletSnapshot.data() : undefined,
      decodedToken.uid,
    );
    const debit = applyWalletMutation(senderWallet, {
      amount: quote.price,
      currency: 'coins',
      type: 'debit',
    });
    if (!debit.ok) {
      return roomGiftError(
        debit.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : debit.code,
        debit.code === 'INSUFFICIENT_FUNDS' ? 409 : 400,
        debit.code === 'INSUFFICIENT_FUNDS' ? 'Insufficient spend coins for this gift.' : 'Wallet mutation failed.',
      );
    }

    const recipientEconomy = mapWalletEconomy(
      recipientWalletSnapshot.exists ? recipientWalletSnapshot.data() : undefined,
    );
    const credit = quote.recipientCredit > 0
      ? applyEconomyMutation(recipientEconomy, {
        amount: quote.recipientCredit,
        currency: 'giftEarnings',
        type: 'credit',
      })
      : { ok: true, value: { balanceAfter: recipientEconomy.balances.giftEarnings, economy: recipientEconomy } };
    if (!credit.ok) {
      return roomGiftError(credit.code, 409, 'Unable to credit gift earnings.');
    }
    const platformAccount = mapPlatformGiftAccount(
      platformAccountSnapshot.exists ? platformAccountSnapshot.data() : undefined,
    );
    const platformCredit = quote.platformShare > 0
      ? applyPlatformGiftRevenue(platformAccount, quote.platformShare)
      : { ok: true, value: platformAccount };
    if (!platformCredit.ok) {
      return roomGiftError(platformCredit.code, 409, 'Unable to credit platform gift revenue.');
    }

    const recipientProfile = targetPublicSnapshot.data();
    const nextGiftScore = Number.isSafeInteger(recipientProfile.giftScore)
      ? recipientProfile.giftScore + quote.scoreValue
      : quote.scoreValue;
    if (!Number.isSafeInteger(nextGiftScore) || nextGiftScore > 1_000_000_000) {
      return roomGiftError('CONFLICT', 409, 'Gift score overflow.');
    }

    const timestamp = fieldValue.serverTimestamp();
    const senderCreatedAt = senderWalletSnapshot.exists && isTimestampLike(senderWalletSnapshot.data().createdAt)
      ? senderWalletSnapshot.data().createdAt
      : timestamp;
    const recipientCreatedAt = recipientWalletSnapshot.exists && isTimestampLike(recipientWalletSnapshot.data().createdAt)
      ? recipientWalletSnapshot.data().createdAt
      : timestamp;
    const previousContribution = contributionSnapshot.exists ? contributionSnapshot.data() : {};
    const contributionTotal = (Number.isSafeInteger(previousContribution.totalSpentCoins)
      ? previousContribution.totalSpentCoins
      : 0) + quote.price;
    if (!Number.isSafeInteger(contributionTotal)) {
      return roomGiftError('CONFLICT', 409, 'Contribution total overflow.');
    }

    const senderLedger = buildWalletTransaction({
      actorUid: decodedToken.uid,
      amount: quote.price,
      balanceAfter: debit.value.balanceAfter,
      createdAt: timestamp,
      currency: 'coins',
      referenceId: eventId,
      source: 'room-gift',
      type: 'purchase',
      uid: decodedToken.uid,
    });
    const recipientLedger = quote.recipientCredit > 0
      ? buildEconomyLedgerEntry({
        actorUid: decodedToken.uid,
        amount: quote.recipientCredit,
        balanceAfter: credit.value.balanceAfter,
        createdAt: timestamp,
        currency: 'giftEarnings',
        referenceId: eventId,
        source: 'room-gift',
        type: 'credit',
        uid: command.targetUid,
      })
      : undefined;
    const platformLedger = quote.platformShare > 0
      ? {
        accountId: PLATFORM_GIFT_ACCOUNT_ID,
        actorUid: decodedToken.uid,
        amount: quote.platformShare,
        balanceAfter: platformCredit.value.balanceCoins,
        createdAt: timestamp,
        currency: 'coins',
        referenceId: eventId,
        roomId: command.roomId,
        source: 'room-gift-commission',
        type: 'credit',
      }
      : undefined;
    if (
      !senderLedger
      || (quote.recipientCredit > 0 && !recipientLedger)
      || (quote.platformShare > 0 && !platformLedger)
    ) {
      return roomGiftError('CONFLICT', 409, 'Unable to build gift ledger entries.');
    }

    const event = {
      assetVersion: quote.assetVersion,
      comboCount: combo.comboCount,
      comboKey: combo.comboKey,
      comboSequence: combo.sequence,
      comboWindowExpiresAtMs: combo.windowExpiresAtMs,
      comboWindowId: combo.comboWindowId,
      commissionBps: quote.commissionBps,
      createdAt: timestamp,
      createdAtMs: giftCommittedAtMs,
      currency: quote.currency,
      eventId,
      giftId: quote.giftId,
      iconKey: quote.iconKey,
      ...(luckyOutcome ? { luckyOutcome } : {}),
      ...(magicFrame ? { magicFrame } : {}),
      nameAr: quote.nameAr,
      platformShare: quote.platformShare,
      policyVersion: quote.policyVersion,
      presentation: quote.presentation,
      presentationDelivery: delivery,
      presentationTier: quote.presentationTier,
      price: quote.price,
      priceCoins: quote.price,
      ...(pkContext ? { pkContext } : {}),
      quantity: quote.quantity,
      quoteId: command.quoteId,
      recipientCredit: quote.recipientCredit,
      reconciliation: {
        balanced: quote.price === quote.recipientCredit + quote.platformShare,
        platformCredit: quote.platformShare,
        recipientCredit: quote.recipientCredit,
        senderDebit: quote.price,
      },
      recipientDisplayName: recipientProfile.displayName,
      recipientUid: command.targetUid,
      requestId: command.requestId,
      roomAvailability: roomSnapshot.data().availability || 'active',
      roomId: command.roomId,
      roomStatus: roomSnapshot.data().status || 'active',
      roomVisibility: roomSnapshot.data().visibility === 'public' ? 'public' : 'private',
      scoreValue: quote.scoreValue,
      senderDisplayName: actorPublicSnapshot.data().displayName,
      senderUid: decodedToken.uid,
      status: 'committed',
      targetMode: quote.targetMode,
      theaterKind,
      theaterTags: catalogTheater.tags,
      unitPrice: quote.unitPrice,
    };

    const response = {
      ok: true,
      result: {
        action: 'send-room-gift',
        balances: debit.value.wallet.balances,
        economyBalances: credit.value.economy.balances,
        effect: {
          ...(delivery.animationEnabled ? {
            cosmeticAsset: quote.presentation.visualAsset,
          } : {}),
          animationEnabled: delivery.animationEnabled,
          audioEnabled: delivery.audioEnabled,
          comboCount: combo.comboCount,
          comboKey: combo.comboKey,
          comboSequence: combo.sequence,
          comboWindowExpiresAtMs: combo.windowExpiresAtMs,
          comboWindowId: combo.comboWindowId,
          copy: buildGiftEffectCopySnapshot({
            giftNameAr: quote.nameAr,
            quantity: combo.comboCount,
            recipientDisplayName: recipientProfile.displayName,
            senderDisplayName: actorPublicSnapshot.data().displayName,
          }),
          durationMs: quote.presentation.durationMs,
          eventId,
          expiresAtMs: clock.nowMillis() + Math.max(8_000, quote.presentation.durationMs + 2_000),
          giftId: quote.giftId,
          ...(delivery.globalEnabled ? {
            globalAudience: {
              allowedRoomVisibilities: globalCampaign.allowedRoomVisibilities,
              countryCodes: Array.isArray(globalCampaign.countryCodes) ? globalCampaign.countryCodes : [],
            },
          } : {}),
          hapticPolicy: quote.presentation.hapticPolicy,
          iconKey: quote.iconKey,
          ...(luckyOutcome ? {
            luckyOutcome: {
              kind: luckyOutcome.kind,
              labelAr: luckyOutcome.labelAr,
              oddsLabelAr: luckyOutcome.oddsLabelAr,
            },
          } : {}),
          ...(magicFrame ? { magicFrame } : {}),
          nameAr: quote.nameAr,
          presentationTier: delivery.presentationTier,
          presentationSurface: resolveRoomEffectSurface('room-gift', delivery.presentationTier),
          priority: delivery.presentationTier === 'global' ? 4 : delivery.presentationTier === 'major' ? 3 : delivery.presentationTier === 'targeted' ? 2 : 1,
          quantity: quote.quantity,
          recipientDisplayName: recipientProfile.displayName,
          recipientUid: command.targetUid,
          roomId: command.roomId,
          senderDisplayName: actorPublicSnapshot.data().displayName,
          senderUid: decodedToken.uid,
          soundPolicy: delivery.audioEnabled ? quote.presentation.soundPolicy : 'off',
          theaterKind,
        },
        eventId,
        priceCoins: quote.price,
        receiptId: eventId,
        requestId: command.requestId,
        roomId: command.roomId,
        scoreValue: quote.scoreValue,
      },
    };

    transaction.set(senderWalletRef, {
      ...buildWalletDocument(debit.value.wallet, {
        createdAt: senderCreatedAt,
        updatedAt: timestamp,
      }),
      ...buildEconomyFields(mapWalletEconomy(
        senderWalletSnapshot.exists ? senderWalletSnapshot.data() : undefined,
      )),
    });

    const recipientWalletBase = recipientWalletSnapshot.exists
      ? recipientWalletSnapshot.data()
      : {
        balances: { coins: 0, diamonds: 0 },
        lifetimeCredit: { coins: 0, diamonds: 0 },
        lifetimeDebit: { coins: 0, diamonds: 0 },
        uid: command.targetUid,
      };
    const recipientSpendWallet = mapWalletSummary(recipientWalletBase, command.targetUid);
    transaction.set(recipientWalletRef, {
      ...buildWalletDocument(recipientSpendWallet, {
        createdAt: recipientCreatedAt,
        updatedAt: timestamp,
      }),
      ...buildEconomyFields(credit.value.economy),
      uid: command.targetUid,
    });

    transaction.create(senderLedgerRef, senderLedger);
    if (recipientLedger) transaction.create(recipientLedgerRef, recipientLedger);
    if (platformLedger) {
      transaction.set(platformAccountRef, {
        ...platformCredit.value,
        createdAt: platformAccountSnapshot.exists && isTimestampLike(platformAccountSnapshot.data().createdAt)
          ? platformAccountSnapshot.data().createdAt
          : timestamp,
        updatedAt: timestamp,
      });
      transaction.create(platformLedgerRef, platformLedger);
    }
    transaction.create(eventRef, event);
    transaction.create(effectRef, {
      createdAt: timestamp,
      expiresAt: clock.timestampFromMillis(response.result.effect.expiresAtMs),
      kind: 'room-gift',
      payload: response.result.effect,
      priority: response.result.effect.priority,
      roomId: command.roomId,
      status: 'ready',
    });
    if (delivery.globalEnabled) {
      transaction.create(globalEffectRef, {
        createdAt: timestamp,
        expiresAt: clock.timestampFromMillis(response.result.effect.expiresAtMs),
        eventId,
        kind: 'room-gift',
        payload: response.result.effect,
        priority: response.result.effect.priority,
        roomId: command.roomId,
        status: 'ready',
      });
    }
    transaction.create(receiptSenderRef, { ...event, role: 'sender' });
    transaction.create(receiptRecipientRef, { ...event, role: 'recipient' });
    transaction.set(contributionRef, {
      displayName: actorPublicSnapshot.data().displayName,
      lastGiftAt: timestamp,
      totalSpentCoins: contributionTotal,
      uid: decodedToken.uid,
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set(rateLimitRef, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      purgeAfter: clock.timestampFromMillis(
        clock.nowMillis() + VOICE_ROOM_RATE_RECORD_RETENTION_MS,
      ),
      uid: decodedToken.uid,
      updatedAt: timestamp,
      windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
    }, { merge: true });
    transaction.set(comboRef, {
      ...combo,
      updatedAt: timestamp,
      windowExpiresAt: clock.timestampFromMillis(combo.windowExpiresAtMs),
    });
    if (luckyOutcome) {
      transaction.create(roomRef.collection('luckyGiftOutcomes').doc(command.requestId), {
        createdAt: timestamp,
        eventId,
        giftId: quote.giftId,
        outcome: luckyOutcome,
        requestId: command.requestId,
        roomId: command.roomId,
        senderUid: decodedToken.uid,
        targetUid: command.targetUid,
      });
    }
    transaction.update(targetPublicRef, {
      giftScore: nextGiftScore,
      updatedAt: timestamp,
    });
    transaction.update(quoteRef, {
      consumedAt: timestamp,
      eventId,
      status: 'consumed',
    });
    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      eventId,
      fingerprint,
      giftId: command.giftId,
      quantity: command.quantity,
      quoteId: command.quoteId,
      purgeAfter: clock.timestampFromMillis(
        clock.nowMillis() + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
      ),
      requestId: command.requestId,
      response,
      targetUid: command.targetUid,
    });

    return response;
  });

  if (response?.ok && response.result?.eventId) {
    void applyRoomGiftLeaderboardContributionSafely({
      clock,
      db,
      fieldValue,
      response,
      senderUid: decodedToken.uid,
      targetUid: command.targetUid,
    });
    void applyRoomPkGiftContributionSafely({
      clock,
      db,
      fieldValue,
      response,
      roomId: command.roomId,
      senderUid: decodedToken.uid,
      targetUid: command.targetUid,
    });
  }
  return response;
}

async function applyRoomPkGiftContributionSafely({
  clock,
  db,
  fieldValue,
  response,
  roomId,
  senderUid,
  targetUid,
}) {
  try {
    const { applyRoomPkGiftContribution } = require('./roomPkService');
    const priceCoins = Number(response.result?.priceCoins);
    if (!Number.isSafeInteger(priceCoins) || priceCoins < 1) return;
    await applyRoomPkGiftContribution({
      contribution: {
        eventId: response.result.eventId,
        nowMs: typeof clock.nowMillis === 'function' ? clock.nowMillis() : Date.now(),
        priceCoins,
        recipientUid: targetUid,
        roomId,
        senderUid,
      },
      db,
      fieldValue,
    });
  } catch (error) {
    console.error('[roomGift] PK projection failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
      eventId: response?.result?.eventId,
    });
  }
}

async function applyRoomGiftLeaderboardContributionSafely({
  clock,
  db,
  fieldValue,
  response,
  senderUid,
  targetUid,
}) {
  try {
    const { applyGiftLeaderboardContribution } = require('./growthLeaderboardService');
    const effect = response.result?.effect || {};
    const priceCoins = Number(response.result?.priceCoins);
    const scoreValue = Number(response.result?.scoreValue);
    if (!Number.isSafeInteger(priceCoins) || priceCoins < 1) return;
    if (!Number.isSafeInteger(scoreValue) || scoreValue < 0) return;
    const [senderSnap, recipientSnap] = await Promise.all([
      db.doc(`publicProfiles/${senderUid}`).get(),
      db.doc(`publicProfiles/${targetUid}`).get(),
    ]);
    const sender = senderSnap.exists ? senderSnap.data() : {};
    const recipient = recipientSnap.exists ? recipientSnap.data() : {};
    await applyGiftLeaderboardContribution({
      contribution: {
        eventId: response.result.eventId,
        nowMs: typeof clock.nowMillis === 'function' ? clock.nowMillis() : Date.now(),
        priceCoins,
        recipientCountryCode: typeof recipient.countryCode === 'string' ? recipient.countryCode : '',
        recipientDisplayName: effect.recipientDisplayName || recipient.displayName || '',
        recipientPublicId: recipient.publicId || '',
        recipientUid: targetUid,
        scoreValue,
        senderCountryCode: typeof sender.countryCode === 'string' ? sender.countryCode : '',
        senderDisplayName: effect.senderDisplayName || sender.displayName || '',
        senderPublicId: sender.publicId || '',
        senderUid,
      },
      db,
      fieldValue,
    });
    const { recordOpsMissionProgressSafely } = require('./opsEventsService');
    await recordOpsMissionProgressSafely({
      amount: 1,
      clock,
      db,
      fieldValue,
      kind: 'send_gifts',
      uid: senderUid,
    });
  } catch (error) {
    console.error('[roomGift] leaderboard projection failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
      eventId: response?.result?.eventId,
    });
  }
}

async function readGiftPresentationRecords(transaction, db, presentation) {
  const references = [
    ['visual', presentation.visualAsset],
    ['fallback', presentation.fallbackAsset],
    ...(presentation.audioAsset ? [['audio', presentation.audioAsset]] : []),
  ];
  const records = {};
  for (const [key, reference] of references) {
    const [summary, version, approval] = await Promise.all([
      transaction.get(db.doc(`cosmeticAssets/${reference.assetId}`)),
      transaction.get(db.doc(`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`)),
      transaction.get(db.doc(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`)),
    ]);
    records[key] = {
      approval: approval.exists ? approval.data() : undefined,
      summary: summary.exists ? summary.data() : undefined,
      version: version.exists ? version.data() : undefined,
    };
  }
  if (presentation.physicalApprovalReceiptId) {
    const receipt = await transaction.get(
      db.doc(`giftPresentationApprovalReceipts/${presentation.physicalApprovalReceiptId}`),
    );
    records.physicalReceipt = receipt.exists ? receipt.data() : undefined;
  }
  return records;
}

module.exports = {
  executeRoomGiftCommand,
  timestampToMillis,
};
