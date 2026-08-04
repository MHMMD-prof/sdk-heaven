const { mapEntryPhysicalApproval, mapEntryPresentation } = require('./roomEntryPresentationCore');

const STORE_CATEGORIES = Object.freeze([
  'game-items',
  'chat-themes',
  'avatar-frames',
  'profile-skins',
  'chat-bubbles',
  'nameplates',
  'cosmetic-badges',
  'seat-effects',
  'stickers',
  'cars',
  'custom-ids',
]);
const STORE_CURRENCIES = Object.freeze(['coins', 'diamonds']);
const STORE_DURATION_UNITS = Object.freeze(['days', 'weeks', 'months']);
const STORE_AVAILABILITY_STATES = Object.freeze(['available', 'disabled', 'unavailable']);
const STORE_ERROR_CODES = Object.freeze([
  'DUPLICATE_OWNERSHIP',
  'INSUFFICIENT_FUNDS',
  'INVALID_RECIPIENT',
  'ITEM_UNAVAILABLE',
  'OUT_OF_STOCK',
  'REQUEST_CONFLICT',
]);
const MAX_STORE_AMOUNT = 1_000_000_000;
const MAX_STORE_ORDER = 1_000_000;

function isStoreCategory(value) {
  return STORE_CATEGORIES.includes(value);
}

function isStoreCurrency(value) {
  return STORE_CURRENCIES.includes(value);
}

function isStoreDurationUnit(value) {
  return STORE_DURATION_UNITS.includes(value);
}

function isStoreAvailability(value) {
  return STORE_AVAILABILITY_STATES.includes(value);
}

function mapStoreCatalogItem(data, documentId) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  if (Object.keys(data).some((key) => ![
    'availability', 'category', 'cosmeticAsset', 'createdAt', 'customId', 'description', 'duration',
    'entryPresentation',
    'entryEffectAssetVersion', 'entryEffectDurationMs', 'entryEffectFallbackUrl',
    'entryEffectHeight', 'entryEffectMinimumClientVersion', 'entryEffectPerformanceTier',
    'entryEffectSoundPolicy', 'entryEffectWidth', 'itemId',
    'lastEditorEmail', 'lastEditorUid', 'name', 'order', 'previewAssetUrl', 'prices', 'purchasingEnabled',
    'stickerAsset', 'stock', 'thumbnailUrl', 'updatedAt',
  ].includes(key))) return undefined;
  const itemId = readStoreItemId(data.itemId);
  if (!itemId || itemId !== documentId || !isStoreCategory(data.category)) return undefined;
  const name = mapLocalizedText(data.name, 80);
  const description = mapLocalizedText(data.description, 500);
  const prices = mapStorePrices(data.prices);
  const duration = mapStoreDuration(data.duration);
  const stock = mapStoreStock(data.stock);
  const thumbnailUrl = readAssetUrl(data.thumbnailUrl);
  const previewAssetUrl = readAssetUrl(data.previewAssetUrl);
  const order = Number(data.order);
  if (
    !name
    || !description
    || !prices
    || !duration
    || !stock
    || !thumbnailUrl
    || !previewAssetUrl
    || !isStoreAvailability(data.availability)
    || typeof data.purchasingEnabled !== 'boolean'
    || !Number.isSafeInteger(order)
    || order < 0
    || order > MAX_STORE_ORDER
  ) return undefined;
  const customId = data.category === 'custom-ids' && typeof data.customId === 'string' && /^[0-9]{7}$/.test(data.customId)
    ? data.customId
    : undefined;
  if ((data.category === 'custom-ids' && !customId) || (data.category !== 'custom-ids' && data.customId !== undefined)) return undefined;
  if (data.category === 'custom-ids' && (duration.kind !== 'permanent' || stock.kind !== 'limited' || stock.remaining > 1)) return undefined;
  const cosmeticAsset = mapCosmeticAssetReference(data.cosmeticAsset);
  const stickerAsset = mapCosmeticAssetReference(data.stickerAsset);
  const cosmeticCategories = ['avatar-frames', 'profile-skins', 'chat-bubbles', 'nameplates', 'cosmetic-badges', 'seat-effects'];
  if ((data.cosmeticAsset !== undefined && !cosmeticAsset) || (cosmeticAsset && !cosmeticCategories.includes(data.category))) return undefined;
  if ((data.stickerAsset !== undefined && !stickerAsset) || (data.category === 'stickers' && !stickerAsset) || (stickerAsset && data.category !== 'stickers')) return undefined;
  const entryPresentation = data.entryPresentation === undefined
    ? undefined
    : mapEntryPresentation(data.entryPresentation);
  if ((data.entryPresentation !== undefined && !entryPresentation) || (entryPresentation && data.category !== 'cars')) return undefined;
  return {
    availability: data.availability,
    category: data.category,
    ...(cosmeticAsset ? { cosmeticAsset } : {}),
    ...(customId ? { customId } : {}),
    description,
    duration,
    ...(entryPresentation ? { entryPresentation } : {}),
    itemId,
    name,
    order,
    previewAssetUrl,
    prices,
    purchasingEnabled: data.purchasingEnabled,
    ...(stickerAsset ? { stickerAsset } : {}),
    stock,
    thumbnailUrl,
  };
}

function mapCosmeticAssetReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['assetId', 'assetVersionId'].includes(key))) return undefined;
  const assetId = typeof value.assetId === 'string' ? value.assetId.trim() : '';
  const assetVersionId = typeof value.assetVersionId === 'string' ? value.assetVersionId.trim() : '';
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId) && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
}

function mapLocalizedText(value, maxLength, allowEmpty = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (Object.keys(value).some((key) => !['ar', 'en'].includes(key))) return undefined;
  const ar = typeof value.ar === 'string' ? value.ar.trim() : '';
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  if ((!allowEmpty && (!ar || !en)) || ar.length > maxLength || en.length > maxLength) return undefined;
  return { ar, en };
}

function mapStorePrices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (Object.keys(value).some((key) => !isStoreCurrency(key))) return undefined;
  const prices = {};
  for (const currency of STORE_CURRENCIES) {
    if (value[currency] === undefined) continue;
    if (!Number.isSafeInteger(value[currency]) || value[currency] < 1 || value[currency] > MAX_STORE_AMOUNT) return undefined;
    prices[currency] = value[currency];
  }
  return Object.keys(prices).length > 0 ? prices : undefined;
}

function mapStoreDuration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (value.kind === 'permanent' && Object.keys(value).every((key) => key === 'kind')) return { kind: 'permanent' };
  if (
    value.kind !== 'timed'
    || !isStoreDurationUnit(value.unit)
    || !Number.isSafeInteger(value.value)
    || value.value < 1
    || value.value > 3650
    || Object.keys(value).some((key) => !['kind', 'unit', 'value'].includes(key))
  ) return undefined;
  return { kind: 'timed', unit: value.unit, value: value.value };
}

function mapStoreStock(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (value.kind === 'unlimited' && Object.keys(value).every((key) => key === 'kind')) return { kind: 'unlimited' };
  if (
    value.kind !== 'limited'
    || !Number.isSafeInteger(value.remaining)
    || value.remaining < 0
    || value.remaining > MAX_STORE_AMOUNT
    || Object.keys(value).some((key) => !['kind', 'remaining'].includes(key))
  ) return undefined;
  return { kind: 'limited', remaining: value.remaining };
}

function readStoreItemId(value) {
  const itemId = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId) ? itemId : '';
}

function readAssetUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/[^\s]{1,2039}$/.test(url) ? url : '';
}

function normalizeAdminStoreCatalogInput(input = {}) {
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const rawItem = input.item;
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    return { ok: false, status: 400, error: 'A valid requestId is required.' };
  }
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    return { ok: false, status: 400, error: 'A store item is required.' };
  }
  if (reason.length < 2) return { ok: false, status: 400, error: 'A catalog change reason is required.' };
  if (rawItem.createdAt !== undefined || rawItem.updatedAt !== undefined || rawItem.lastEditorEmail !== undefined || rawItem.lastEditorUid !== undefined) {
    return { ok: false, status: 400, error: 'Catalog timestamps are server controlled.' };
  }
  const featured = rawItem.featured === true;
  if (rawItem.featured !== undefined && typeof rawItem.featured !== 'boolean') {
    return { ok: false, status: 400, error: 'Store featured state is invalid.' };
  }
  const rawCatalogItem = { ...rawItem };
  delete rawCatalogItem.featured;
  const itemId = readStoreItemId(rawCatalogItem.itemId);
  const item = itemId ? mapStoreCatalogItem(rawCatalogItem, itemId) : undefined;
  if (!item) {
    return { ok: false, status: 400, error: 'Store item is invalid.' };
  }
  const entryPhysicalApproval = input.entryPhysicalApproval === undefined
    ? undefined
    : mapEntryPhysicalApproval(input.entryPhysicalApproval);
  if (input.entryPhysicalApproval !== undefined && !entryPhysicalApproval) {
    return { ok: false, status: 400, error: 'Entry-effect physical approval is invalid.' };
  }
  if (entryPhysicalApproval && !item.entryPresentation?.animationEnabled) {
    return { ok: false, status: 400, error: 'Physical approval requires an animated car entry presentation.' };
  }
  return {
    ok: true,
    value: {
      ...(entryPhysicalApproval ? { entryPhysicalApproval } : {}),
      expectedUpdatedAt,
      featured,
      item,
      reason,
      requestId,
    },
  };
}

module.exports = {
  STORE_AVAILABILITY_STATES,
  STORE_CATEGORIES,
  STORE_CURRENCIES,
  STORE_DURATION_UNITS,
  STORE_ERROR_CODES,
  MAX_STORE_AMOUNT,
  MAX_STORE_ORDER,
  isStoreAvailability,
  isStoreCategory,
  isStoreCurrency,
  isStoreDurationUnit,
  mapStoreCatalogItem,
  mapStoreDuration,
  mapStorePrices,
  mapStoreStock,
  normalizeAdminStoreCatalogInput,
};
