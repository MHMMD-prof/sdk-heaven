const { createHash } = require('node:crypto');
const { mapGiftCatalogItem } = require('./socialGiftsCore');
const { buildLegacyGiftPresentation, mapGiftPresentation } = require('./roomGiftPresentationCore');

const ROOM_GIFT_ACTIONS = Object.freeze(['get-room-gift-center', 'quote-room-gift', 'send-room-gift']);
const ROOM_GIFT_TARGET_MODES = Object.freeze(['member']);
const ECONOMY_CURRENCIES = Object.freeze(['giftEarnings', 'gameRewards', 'promotions']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const CLIENT_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const QUOTE_TTL_MS = 60_000;
const MAX_QUANTITY = 20;
const MAX_BPS = 10_000;
const ROOM_GIFT_CATALOG_LIMIT = 30;
const PLATFORM_GIFT_ACCOUNT_ID = 'room-gifts';

function normalizeRoomGiftBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    giftId: typeof body.giftId === 'string' ? body.giftId.trim() : '',
    magicFrameTemplateId: typeof body.magicFrameTemplateId === 'string' ? body.magicFrameTemplateId.trim() : '',
    quantity: Number.isInteger(body.quantity) && body.quantity >= 1 ? body.quantity : 1,
    quoteId: typeof body.quoteId === 'string' ? body.quoteId.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    targetMode: typeof body.targetMode === 'string' ? body.targetMode.trim() : 'member',
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
  };
}

function validateRoomGiftRequest(command) {
  if (!ROOM_GIFT_ACTIONS.includes(command.action) || !FIRESTORE_ID_PATTERN.test(command.roomId)) {
    return roomGiftError('INVALID_REQUEST', 400, 'A valid room gift command is required.');
  }
  if (command.action === 'get-room-gift-center') {
    if (!REQUEST_ID_PATTERN.test(command.requestId)) {
      return roomGiftError('INVALID_REQUEST', 400, 'A valid request ID is required.');
    }
    return { ok: true, value: command };
  }
  if (
    !REQUEST_ID_PATTERN.test(command.requestId)
    || !/^[a-z0-9_-]{2,40}$/.test(command.giftId)
    || !ROOM_GIFT_TARGET_MODES.includes(command.targetMode)
    || !FIRESTORE_ID_PATTERN.test(command.targetUid)
    || command.quantity < 1
    || command.quantity > MAX_QUANTITY
    || (command.clientVersion && !CLIENT_VERSION_PATTERN.test(command.clientVersion))
  ) {
    return roomGiftError('INVALID_REQUEST', 400, 'A valid room gift command is required.');
  }
  if (command.action === 'send-room-gift' && !REQUEST_ID_PATTERN.test(command.quoteId)) {
    return roomGiftError('INVALID_REQUEST', 400, 'A valid quote ID is required to send a room gift.');
  }
  return { ok: true, value: command };
}

function mapCommissionPolicy(data) {
  if (!data || typeof data !== 'object') return undefined;
  const version = Number.isInteger(data.version) && data.version >= 1 ? data.version : 0;
  const commissionBps = Number.isInteger(data.commissionBps) ? data.commissionBps : -1;
  if (version < 1 || commissionBps < 0 || commissionBps > MAX_BPS) return undefined;
  return {
    commissionBps,
    effectiveAtMs: timestampToMillis(data.effectiveAt) || 0,
    version,
  };
}

function quoteRoomGift({
  catalogItem,
  command,
  nowMs,
  policy,
  quoteId,
}) {
  if (!policy) {
    return roomGiftError('POLICY_MISSING', 503, 'Room gift commission policy is not configured.');
  }
  if (policy.effectiveAtMs > nowMs) {
    return roomGiftError('POLICY_NOT_EFFECTIVE', 503, 'Room gift commission policy is not effective yet.');
  }
  if (!catalogItem || catalogItem.status !== 'available') {
    return roomGiftError('CATALOG_UNAVAILABLE', 404, 'This gift is unavailable.');
  }
  const unitPrice = catalogItem.price;
  const gross = unitPrice * command.quantity;
  if (!Number.isSafeInteger(gross) || gross < 1) {
    return roomGiftError('INVALID_REQUEST', 400, 'Gift total is invalid.');
  }
  const platformShare = Math.floor((gross * policy.commissionBps) / MAX_BPS);
  const recipientCredit = gross - platformShare;
  if (!Number.isSafeInteger(platformShare) || !Number.isSafeInteger(recipientCredit) || recipientCredit < 0) {
    return roomGiftError('POLICY_INVALID', 503, 'Commission policy produced an invalid split.');
  }
  const expiresAtMs = nowMs + QUOTE_TTL_MS;
  return {
    ok: true,
    value: {
      assetVersion: typeof catalogItem.assetVersion === 'string' ? catalogItem.assetVersion : '1',
      commissionBps: policy.commissionBps,
      currency: 'coins',
      expiresAtMs,
      giftId: catalogItem.giftId,
      iconKey: catalogItem.iconKey,
      nameAr: catalogItem.nameAr,
      platformShare,
      policyVersion: policy.version,
      presentation: catalogItem.presentation || buildLegacyGiftPresentation(),
      presentationTier: catalogItem.presentation?.tier || 'inline',
      price: gross,
      quantity: command.quantity,
      quoteId,
      recipientCredit,
      roomId: command.roomId,
      scoreValue: catalogItem.scoreValue * command.quantity,
      targetMode: command.targetMode,
      targetUid: command.targetUid,
      unitPrice,
    },
  };
}

function resolveRoomGiftSend({
  actorMembership,
  actorPublicProfile,
  blockedByRecipient = false,
  blockedBySender = false,
  command,
  featureFlags,
  nowMs,
  quote,
  recipientMembership,
  recipientPublicProfile,
  room,
  senderUid,
}) {
  if (featureFlags?.voice_room_gifts !== true) {
    return roomGiftError('FEATURE_DISABLED', 503, 'Room gifts are not enabled.');
  }
  if (room?.giftsPaused === true || (room?.staffLockdown && typeof room.staffLockdown === 'object')) {
    return roomGiftError('GIFTS_PAUSED', 409, 'Room gifts are paused by staff lockdown.');
  }
  if (!isActiveRoom(room) || !isActiveMembership(actorMembership, senderUid)) {
    return roomGiftError('ROOM_NOT_ACTIVE', 409, 'The room is not available for gifts.');
  }
  if (!isEligiblePublicProfile(actorPublicProfile, senderUid)) {
    return roomGiftError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }
  if (command.targetUid === senderUid) {
    return roomGiftError('SELF_GIFT_FORBIDDEN', 400, 'You cannot send a room gift to yourself.');
  }
  if (blockedByRecipient || blockedBySender) {
    return roomGiftError('BLOCKED_RELATIONSHIP', 403, 'Room gifts are unavailable between these users.');
  }
  if (
    !isActiveMembership(recipientMembership, command.targetUid)
    || !isEligiblePublicProfile(recipientPublicProfile, command.targetUid)
  ) {
    return roomGiftError('RECIPIENT_UNAVAILABLE', 409, 'The recipient is not available in this room.');
  }
  if (!quote || quote.senderUid !== senderUid || quote.roomId !== command.roomId) {
    return roomGiftError('QUOTE_NOT_FOUND', 409, 'Gift quote was not found.');
  }
  if (quote.status !== 'open') {
    return roomGiftError('QUOTE_NOT_OPEN', 409, 'Gift quote is no longer open.');
  }
  if (timestampToMillis(quote.expiresAt) <= nowMs) {
    return roomGiftError('QUOTE_EXPIRED', 409, 'Gift quote expired. Request a new quote.');
  }
  const stored = validateStoredRoomGiftQuote(quote, command);
  if (!stored.ok) {
    return roomGiftError('QUOTE_MISMATCH', 409, 'Gift price or commission changed. Request a new quote.');
  }
  return { ok: true, value: stored.value };
}

function validateStoredRoomGiftQuote(stored, command) {
  if (
    !stored
    || stored.quoteId !== command.quoteId
    || stored.roomId !== command.roomId
    || stored.giftId !== command.giftId
    || stored.targetUid !== command.targetUid
    || stored.targetMode !== command.targetMode
    || stored.quantity !== command.quantity
    || stored.currency !== 'coins'
    || !Number.isSafeInteger(stored.unitPrice)
    || stored.unitPrice < 1
    || !Number.isSafeInteger(stored.price)
    || stored.price !== stored.unitPrice * stored.quantity
    || !Number.isInteger(stored.commissionBps)
    || stored.commissionBps < 0
    || stored.commissionBps > MAX_BPS
    || !Number.isSafeInteger(stored.platformShare)
    || stored.platformShare !== Math.floor((stored.price * stored.commissionBps) / MAX_BPS)
    || !Number.isSafeInteger(stored.recipientCredit)
    || stored.recipientCredit < 0
    || stored.recipientCredit + stored.platformShare !== stored.price
    || !Number.isInteger(stored.policyVersion)
    || stored.policyVersion < 1
    || !Number.isSafeInteger(stored.scoreValue)
    || stored.scoreValue < 0
  ) {
    return roomGiftError('QUOTE_MISMATCH', 409, 'Gift quote snapshot is invalid.');
  }
  const presentation = mapGiftPresentation(stored.presentation);
  if (!presentation || stored.presentationTier !== presentation.tier) {
    return roomGiftError('QUOTE_MISMATCH', 409, 'Gift presentation snapshot is invalid.');
  }
  return {
    ok: true,
    value: {
      assetVersion: typeof stored.assetVersion === 'string' ? stored.assetVersion : '1',
      commissionBps: stored.commissionBps,
      currency: 'coins',
      expiresAtMs: timestampToMillis(stored.expiresAt),
      giftId: stored.giftId,
      iconKey: typeof stored.iconKey === 'string' ? stored.iconKey : '',
      nameAr: typeof stored.nameAr === 'string' ? stored.nameAr : '',
      platformShare: stored.platformShare,
      policyVersion: stored.policyVersion,
      presentation,
      presentationTier: presentation.tier,
      price: stored.price,
      quantity: stored.quantity,
      quoteId: stored.quoteId,
      recipientCredit: stored.recipientCredit,
      roomId: stored.roomId,
      scoreValue: stored.scoreValue,
      targetMode: stored.targetMode,
      targetUid: stored.targetUid,
      unitPrice: stored.unitPrice,
    },
  };
}

function mapEconomyBalances(data) {
  const candidate = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    gameRewards: readAmount(candidate.gameRewards),
    giftEarnings: readAmount(candidate.giftEarnings),
    promotions: readAmount(candidate.promotions),
  };
}

function applyEconomyMutation(walletEconomy, { amount, currency, type }) {
  if (!ECONOMY_CURRENCIES.includes(currency) || !Number.isSafeInteger(amount) || amount < 1 || !['credit', 'debit'].includes(type)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const current = walletEconomy.balances[currency];
  if (type === 'debit' && current < amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' };
  const balanceAfter = type === 'credit' ? current + amount : current - amount;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) return { ok: false, code: 'CONFLICT' };
  const lifetimeKey = type === 'credit' ? 'lifetimeCredit' : 'lifetimeDebit';
  const lifetimeAfter = walletEconomy[lifetimeKey][currency] + amount;
  if (!Number.isSafeInteger(lifetimeAfter)) return { ok: false, code: 'CONFLICT' };
  return {
    ok: true,
    value: {
      balanceAfter,
      economy: {
        ...walletEconomy,
        balances: { ...walletEconomy.balances, [currency]: balanceAfter },
        [lifetimeKey]: { ...walletEconomy[lifetimeKey], [currency]: lifetimeAfter },
      },
    },
  };
}

function mapWalletEconomy(data) {
  return {
    balances: mapEconomyBalances(data?.economyBalances),
    lifetimeCredit: mapEconomyBalances(data?.economyLifetimeCredit),
    lifetimeDebit: mapEconomyBalances(data?.economyLifetimeDebit),
  };
}

function buildEconomyFields(economy) {
  return {
    economyBalances: { ...economy.balances },
    economyLifetimeCredit: { ...economy.lifetimeCredit },
    economyLifetimeDebit: { ...economy.lifetimeDebit },
  };
}

function buildEconomyLedgerEntry({
  actorUid,
  amount,
  balanceAfter,
  createdAt,
  currency,
  note = '',
  referenceId = '',
  source,
  type,
  uid,
}) {
  if (!ECONOMY_CURRENCIES.includes(currency) || !Number.isSafeInteger(amount) || amount < 1) return undefined;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) return undefined;
  if (!['credit', 'debit'].includes(type)) return undefined;
  return {
    actorUid,
    amount,
    balanceAfter,
    createdAt,
    currency,
    ...(note ? { note } : {}),
    ...(referenceId ? { referenceId } : {}),
    source,
    type,
    uid,
  };
}

function createRoomGiftQuoteId(requestId) {
  return `rgq_${createHash('sha256').update(requestId).digest('hex').slice(0, 24)}`;
}

function createRoomGiftEventId(requestId, roomId = '') {
  return `rge_${createHash('sha256').update(`${roomId}|${requestId}`).digest('hex').slice(0, 24)}`;
}

function createRoomGiftLedgerId({ kind, requestId, roomId, uid }) {
  return `room_gift_${kind}_${createHash('sha256')
    .update(`${roomId}|${uid}|${requestId}|${kind}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function mapPlatformGiftAccount(data) {
  return {
    accountId: PLATFORM_GIFT_ACCOUNT_ID,
    balanceCoins: readAmount(data?.balanceCoins),
    lifetimeRevenueCoins: readAmount(data?.lifetimeRevenueCoins),
  };
}

function applyPlatformGiftRevenue(account, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, code: 'INVALID_REQUEST' };
  const balanceCoins = account.balanceCoins + amount;
  const lifetimeRevenueCoins = account.lifetimeRevenueCoins + amount;
  if (!Number.isSafeInteger(balanceCoins) || !Number.isSafeInteger(lifetimeRevenueCoins)) {
    return { ok: false, code: 'CONFLICT' };
  }
  return {
    ok: true,
    value: {
      accountId: PLATFORM_GIFT_ACCOUNT_ID,
      balanceCoins,
      lifetimeRevenueCoins,
    },
  };
}

function buildRoomGiftFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.clientVersion,
      command.roomId,
      command.giftId,
      command.targetUid,
      command.targetMode,
      String(command.quantity),
      command.magicFrameTemplateId || '',
      command.quoteId || '',
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function roomGiftError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function isActiveRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && (room.availability === undefined || room.availability === 'active'),
  );
}

function isActiveMembership(member, uid) {
  return Boolean(member && member.uid === uid && member.status === 'active');
}

function isEligiblePublicProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && profile.moderationStatus === 'active'
    && typeof profile.displayName === 'string'
    && profile.displayName.length >= 2,
  );
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function mapCatalogForRoomGift(data) {
  const item = mapGiftCatalogItem(data);
  if (!item) return undefined;
  return {
    ...item,
    assetVersion: typeof data?.assetVersion === 'string' && data.assetVersion.trim()
      ? data.assetVersion.trim().slice(0, 40)
      : '1',
    presentation: item.presentation || buildLegacyGiftPresentation(),
  };
}

module.exports = {
  ECONOMY_CURRENCIES,
  MAX_QUANTITY,
  PLATFORM_GIFT_ACCOUNT_ID,
  QUOTE_TTL_MS,
  ROOM_GIFT_ACTIONS,
  ROOM_GIFT_CATALOG_LIMIT,
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
  timestampToMillis,
  validateStoredRoomGiftQuote,
  validateRoomGiftRequest,
};
