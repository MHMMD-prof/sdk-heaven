'use strict';

/**
 * Competitive Social Growth — Wave 2 VIP tier catalog + projection helpers.
 * Catalog docs live at `vipTier/{id}`; public projection at `publicProfiles/{uid}.vipTier`.
 */

const DEFAULT_VIP_TIERS = Object.freeze([
  Object.freeze({
    accentColor: '#CD7F32',
    id: 'bronze',
    minLifetimeCreditCoins: 1000,
    nameAr: 'برونزي',
    rank: 1,
  }),
  Object.freeze({
    accentColor: '#A8B0B8',
    id: 'silver',
    minLifetimeCreditCoins: 5000,
    nameAr: 'فضي',
    rank: 2,
  }),
  Object.freeze({
    accentColor: '#D4AF37',
    id: 'gold',
    minLifetimeCreditCoins: 20000,
    nameAr: 'ذهبي',
    rank: 3,
  }),
  Object.freeze({
    accentColor: '#7F8C9A',
    id: 'platinum',
    minLifetimeCreditCoins: 50000,
    nameAr: 'بلاتيني',
    rank: 4,
  }),
  Object.freeze({
    accentColor: '#4FC3F7',
    id: 'diamond',
    minLifetimeCreditCoins: 150000,
    nameAr: 'ألماسي',
    rank: 5,
  }),
]);

const VIP_TIER_IDS = Object.freeze(DEFAULT_VIP_TIERS.map((tier) => tier.id));

function mapVipTier(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const id = typeof data.id === 'string' ? data.id.trim().toLowerCase() : '';
  if (!id) return null;
  const rank = Number(data.rank);
  const minLifetimeCreditCoins = Number(data.minLifetimeCreditCoins);
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > 99) return null;
  if (!Number.isSafeInteger(minLifetimeCreditCoins) || minLifetimeCreditCoins < 0) return null;
  const nameAr = typeof data.nameAr === 'string' ? data.nameAr.trim().slice(0, 40) : '';
  const accentColor = typeof data.accentColor === 'string' ? data.accentColor.trim().slice(0, 32) : '';
  if (!nameAr || !accentColor) return null;
  return {
    accentColor,
    id,
    minLifetimeCreditCoins,
    nameAr,
    rank,
  };
}

function resolveVipTierForCredit(lifetimeCreditCoins, catalog = DEFAULT_VIP_TIERS) {
  const credit = Number.isSafeInteger(lifetimeCreditCoins) && lifetimeCreditCoins >= 0
    ? lifetimeCreditCoins
    : 0;
  const tiers = (Array.isArray(catalog) ? catalog : [])
    .map((entry) => mapVipTier(entry))
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank || left.minLifetimeCreditCoins - right.minLifetimeCreditCoins);

  let current = null;
  let nextTier = null;
  for (const tier of tiers) {
    if (credit >= tier.minLifetimeCreditCoins) {
      current = tier;
      continue;
    }
    nextTier = tier;
    break;
  }
  return {
    lifetimeCreditCoins: credit,
    nextTier,
    tier: current,
  };
}

function mapVipProjection(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const source = data.vipTier && typeof data.vipTier === 'object' && !Array.isArray(data.vipTier)
    ? data.vipTier
    : data;
  const id = typeof source.id === 'string' ? source.id.trim().toLowerCase() : '';
  const rank = Number(source.rank);
  if (!id || !Number.isSafeInteger(rank) || rank < 1) return null;
  const nameAr = typeof source.nameAr === 'string' ? source.nameAr.trim().slice(0, 40) : '';
  const accentColor = typeof source.accentColor === 'string' ? source.accentColor.trim().slice(0, 32) : '';
  if (!nameAr || !accentColor) return null;
  return {
    accentColor,
    id,
    nameAr,
    rank,
  };
}

function normalizeVipCatalogUpsert(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const mapped = mapVipTier(input);
  if (!mapped) return { ok: false, code: 'INVALID_VIP_TIER' };
  return { ok: true, value: mapped };
}

function listDefaultVipCatalog() {
  return DEFAULT_VIP_TIERS.map((tier) => ({ ...tier }));
}

module.exports = {
  DEFAULT_VIP_TIERS,
  VIP_TIER_IDS,
  listDefaultVipCatalog,
  mapVipProjection,
  mapVipTier,
  normalizeVipCatalogUpsert,
  resolveVipTierForCredit,
};
