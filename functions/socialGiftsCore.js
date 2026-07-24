const GIFT_CATALOG_LIMIT = 30;
const GIFT_HISTORY_LIMIT = 20;
const GIFT_KINDS = Object.freeze(['rose', 'crown', 'diamond', 'heart', 'star']);

function normalizeGiftCenterInput(input, uid) {
  if (input === undefined) return { ok: true, value: { targetUid: '' } };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'targetUid')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!targetUid || targetUid === uid || targetUid.length > 128) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { targetUid } };
}

function normalizeSendGiftInput(input, uid) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  if (Object.keys(input).some((key) => !['giftId', 'message', 'targetUid'].includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const giftId = typeof input.giftId === 'string' ? input.giftId.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!/^[a-z0-9_-]{2,40}$/.test(giftId) || !targetUid || targetUid === uid || targetUid.length > 128 || message.length > 80) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { giftId, message, targetUid } };
}

function mapGiftCatalogItem(data) {
  if (!data || typeof data !== 'object') return undefined;
  const giftId = typeof data.giftId === 'string' ? data.giftId.trim() : '';
  const nameAr = typeof data.nameAr === 'string' ? data.nameAr.trim() : '';
  if (!/^[a-z0-9_-]{2,40}$/.test(giftId) || nameAr.length < 2 || nameAr.length > 32) return undefined;
  if (!GIFT_KINDS.includes(data.iconKey) || !['available', 'disabled'].includes(data.status)) return undefined;
  if (!Number.isSafeInteger(data.price) || data.price < 1 || !Number.isSafeInteger(data.scoreValue) || data.scoreValue < 1) return undefined;
  return {
    giftId,
    iconKey: data.iconKey,
    nameAr,
    price: data.price,
    scoreValue: data.scoreValue,
    status: data.status,
  };
}

function mapGiftEvent(document) {
  const data = document?.data?.() || document;
  if (!data || typeof data !== 'object') return undefined;
  const giftId = typeof data.giftId === 'string' ? data.giftId.trim() : '';
  const senderUid = typeof data.senderUid === 'string' ? data.senderUid.trim() : '';
  const recipientUid = typeof data.recipientUid === 'string' ? data.recipientUid.trim() : '';
  if (!giftId || !senderUid || !recipientUid) return undefined;
  return {
    createdAt: data.createdAt,
    eventId: typeof document?.id === 'string' ? document.id : (typeof data.eventId === 'string' ? data.eventId : ''),
    giftId,
    iconKey: GIFT_KINDS.includes(data.iconKey) ? data.iconKey : 'star',
    message: typeof data.message === 'string' ? data.message.slice(0, 80) : '',
    nameAr: typeof data.nameAr === 'string' ? data.nameAr.slice(0, 32) : '',
    price: readNonNegativeInteger(data.price),
    recipientDisplayName: typeof data.recipientDisplayName === 'string' ? data.recipientDisplayName.slice(0, 32) : '',
    recipientUid,
    scoreValue: readNonNegativeInteger(data.scoreValue),
    senderDisplayName: typeof data.senderDisplayName === 'string' ? data.senderDisplayName.slice(0, 32) : '',
    senderUid,
  };
}

function normalizeAdminGiftCatalogInput(input) {
  const expectedUpdatedAt = typeof input?.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const item = mapGiftCatalogItem({
    giftId: typeof input?.giftId === 'string' ? input.giftId.trim() : '',
    iconKey: input?.iconKey,
    nameAr: typeof input?.nameAr === 'string' ? input.nameAr.trim() : '',
    price: Number(input?.price),
    scoreValue: Number(input?.scoreValue),
    status: input?.status,
  });
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId) || reason.length < 2 || !item) {
    return { ok: false, error: 'Valid requestId and gift catalog fields are required.' };
  }
  return { ok: true, value: { ...item, expectedUpdatedAt, reason, requestId } };
}

function readNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  GIFT_CATALOG_LIMIT,
  GIFT_HISTORY_LIMIT,
  GIFT_KINDS,
  mapGiftCatalogItem,
  mapGiftEvent,
  normalizeAdminGiftCatalogInput,
  normalizeGiftCenterInput,
  normalizeSendGiftInput,
};
