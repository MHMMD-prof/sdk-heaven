const { isStoreCategory, isStoreCurrency, mapStoreCatalogItem, mapStoreDuration } = require('./storeCore');

const STORE_CATALOG_LIMIT = 200;

function normalizeStorePurchaseInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['currency', 'itemId'].includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId) || !isStoreCurrency(input.currency)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { currency: input.currency, itemId } };
}

function normalizeStoreEquipInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'itemId')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)
    ? { ok: true, value: { itemId } }
    : { ok: false, code: 'INVALID_REQUEST' };
}

function normalizeStoreGiftInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['currency', 'itemId', 'recipientPublicId'].includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const purchase = normalizeStorePurchaseInput({ currency: input.currency, itemId: input.itemId });
  const recipientPublicId = typeof input.recipientPublicId === 'string' ? input.recipientPublicId.trim() : '';
  if (!purchase.ok || !/^[0-9]{7}$/.test(recipientPublicId)) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { ...purchase.value, recipientPublicId } };
}

function mapStoreOwnership(data, documentId) {
  if (!data || data.kind !== 'store-ownership' || data.ownershipId !== documentId || data.itemId !== documentId) return undefined;
  const duration = mapStoreDuration(data.duration);
  if (!data.uid || !isStoreCategory(data.category) || !duration || !['active', 'expired'].includes(data.state) || typeof data.equipped !== 'boolean') return undefined;
  return {
    acquiredAt: data.acquiredAt,
    category: data.category,
    duration,
    equipped: data.equipped,
    ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    itemId: data.itemId,
    kind: 'store-ownership',
    ownershipId: data.ownershipId,
    state: data.state,
    uid: data.uid,
    updatedAt: data.updatedAt,
  };
}

function mapCustomerCatalogItem(data, documentId) {
  const item = mapStoreCatalogItem(data, documentId);
  if (!item || item.availability === 'disabled') return undefined;
  return {
    ...item,
    soldOut: item.stock.kind === 'limited' && item.stock.remaining === 0,
  };
}

function durationToMilliseconds(duration) {
  if (!duration || duration.kind !== 'timed') return undefined;
  const unitDays = { days: 1, weeks: 7, months: 30 }[duration.unit];
  return unitDays ? duration.value * unitDays * 24 * 60 * 60 * 1000 : undefined;
}

function buildStoreOwnership({ acquiredAt, expiresAt, item, ownershipId, uid }) {
  return {
    acquiredAt,
    category: item.category,
    duration: item.duration,
    equipped: true,
    ...(expiresAt ? { expiresAt } : {}),
    itemId: item.itemId,
    kind: 'store-ownership',
    ownershipId,
    state: 'active',
    uid,
    updatedAt: acquiredAt,
  };
}

module.exports = {
  STORE_CATALOG_LIMIT,
  buildStoreOwnership,
  durationToMilliseconds,
  mapCustomerCatalogItem,
  mapStoreOwnership,
  normalizeStoreEquipInput,
  normalizeStoreGiftInput,
  normalizeStorePurchaseInput,
};
