export type LocalizedName = { ar: string; en: string };
export type StatusBenefit = string;
export type VipTier = {
  accentColor: string;
  band: 'vip' | 'svip';
  benefits: StatusBenefit[];
  id: string;
  level: number;
  minPoints: number;
  name: LocalizedName;
  order: number;
};
export type AristocracyRank = {
  accentColor: string;
  benefits: StatusBenefit[];
  durationDays: number;
  id: string;
  name: LocalizedName;
  order: number;
  priceCoins: number;
};
export type VipHistoryItem = {
  eventId: string;
  kind: 'representative-recharge' | 'representative-reversal' | 'admin-correction';
  occurredAtMillis: number;
  pointDelta: number;
  settlementState: 'settled' | 'reversed' | 'review';
};
export type AristocracyHistoryItem = {
  amountCoins: number;
  createdAtMillis: number;
  expiresAtMillis: number;
  kind: 'purchase' | 'renewal' | 'upgrade' | 'complimentary-grant' | 'admin-revoke' | 'freeze' | 'unfreeze' | 'expiry';
  rankId: string;
  rankOrder: number;
  transactionId: string;
};
export type StatusCenter = {
  aristocracy: null | { catalogVersion: string; expiresAtMillis: number; rankId: string; rankOrder: number; state: 'active' | 'expired' | 'frozen' | 'review' };
  catalogs: {
    aristocracy: null | { catalogVersion: string; durationDays: number; ranks: AristocracyRank[] };
    vip: null | { catalogVersion: string; tiers: VipTier[] };
  };
  flags: { aristocracyShop: boolean; statusPresentation: boolean; vipProgression: boolean };
  history: { aristocracy: AristocracyHistoryItem[]; vip: VipHistoryItem[] };
  schemaVersion: 1;
  vip: null | { band: null | 'vip' | 'svip'; catalogVersion: string; level: number | null; levelId: string | null; order: number | null; points: number; state: 'active' | 'frozen' | 'review' };
  visibility: 'public' | 'hidden';
};

export type AristocracyQuote = {
  amountCoins: number;
  autoRenew: false;
  balanceAfter: number;
  balanceBefore: number;
  catalogVersion: string;
  durationDays: number;
  expiresAtMillis: number;
  operation: 'purchase' | 'renewal' | 'upgrade';
  quoteId: string;
  resultingExpiryMillis: number;
  targetRankId: string;
  targetRankOrder: number;
};

const ID = /^[a-z0-9][a-z0-9_-]{2,79}$/;

export function mapStatusCenter(value: unknown): StatusCenter | undefined {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.flags) || !record(value.catalogs)
    || !record(value.history) || !['public', 'hidden'].includes(String(value.visibility))) return undefined;
  if (typeof value.flags.aristocracyShop !== 'boolean' || typeof value.flags.statusPresentation !== 'boolean'
    || typeof value.flags.vipProgression !== 'boolean') return undefined;
  const vipCatalog = value.catalogs.vip === null ? null : mapVipCatalog(value.catalogs.vip);
  const nobleCatalog = value.catalogs.aristocracy === null ? null : mapAristocracyCatalog(value.catalogs.aristocracy);
  const vip = value.vip === null ? null : mapVipAccount(value.vip);
  const aristocracy = value.aristocracy === null ? null : mapAristocracyEntitlement(value.aristocracy);
  const vipHistory = Array.isArray(value.history.vip) ? value.history.vip.map(mapVipHistory).filter(defined) : undefined;
  const nobleHistory = Array.isArray(value.history.aristocracy) ? value.history.aristocracy.map(mapAristocracyHistory).filter(defined) : undefined;
  if (vipCatalog === undefined || nobleCatalog === undefined || vip === undefined || aristocracy === undefined || !vipHistory || !nobleHistory
    || vipHistory.length !== (value.history.vip as unknown[]).length || nobleHistory.length !== (value.history.aristocracy as unknown[]).length) return undefined;
  return {
    schemaVersion: 1,
    flags: {
      aristocracyShop: value.flags.aristocracyShop === true,
      statusPresentation: value.flags.statusPresentation === true,
      vipProgression: value.flags.vipProgression === true,
    },
    catalogs: { vip: vipCatalog, aristocracy: nobleCatalog },
    vip,
    aristocracy,
    history: { vip: vipHistory, aristocracy: nobleHistory },
    visibility: value.visibility as 'public' | 'hidden',
  };
}

export function mapAristocracyQuote(value: unknown): AristocracyQuote | undefined {
  if (!record(value) || value.autoRenew !== false || !['purchase', 'renewal', 'upgrade'].includes(String(value.operation))) return undefined;
  const strings = ['quoteId', 'catalogVersion', 'targetRankId'] as const;
  const numbers = ['amountCoins', 'balanceAfter', 'balanceBefore', 'durationDays', 'expiresAtMillis', 'resultingExpiryMillis', 'targetRankOrder'] as const;
  if (strings.some((key) => !text(value[key], 80)) || numbers.some((key) => !integer(value[key], key === 'balanceAfter' ? 0 : 1))) return undefined;
  return value as unknown as AristocracyQuote;
}

function mapVipCatalog(value: unknown) {
  if (!record(value) || !ID.test(text(value.catalogVersion, 80)) || !Array.isArray(value.tiers)) return undefined;
  const tiers = value.tiers.map(mapVipTier).filter(defined);
  return tiers.length === value.tiers.length ? { catalogVersion: String(value.catalogVersion), tiers } : undefined;
}
function mapVipTier(value: unknown): VipTier | undefined {
  if (!record(value) || !['vip', 'svip'].includes(String(value.band)) || !integer(value.level, 1) || !integer(value.order, 1)
    || !integer(value.minPoints, 0) || !ID.test(text(value.id, 40)) || !color(value.accentColor)) return undefined;
  const name = mapName(value.name); const benefits = mapBenefits(value.benefits);
  return name && benefits ? { accentColor: String(value.accentColor), band: value.band as 'vip' | 'svip', benefits, id: String(value.id), level: Number(value.level), minPoints: Number(value.minPoints), name, order: Number(value.order) } : undefined;
}
function mapAristocracyCatalog(value: unknown) {
  if (!record(value) || !ID.test(text(value.catalogVersion, 80)) || !integer(value.durationDays, 1) || !Array.isArray(value.ranks)) return undefined;
  const ranks = value.ranks.map(mapRank).filter(defined);
  return ranks.length === value.ranks.length ? { catalogVersion: String(value.catalogVersion), durationDays: Number(value.durationDays), ranks } : undefined;
}
function mapRank(value: unknown): AristocracyRank | undefined {
  if (!record(value) || !ID.test(text(value.id, 40)) || !integer(value.order, 1) || !integer(value.priceCoins, 1) || !integer(value.durationDays, 1) || !color(value.accentColor)) return undefined;
  const name = mapName(value.name); const benefits = mapBenefits(value.benefits);
  return name && benefits ? { accentColor: String(value.accentColor), benefits, durationDays: Number(value.durationDays), id: String(value.id), name, order: Number(value.order), priceCoins: Number(value.priceCoins) } : undefined;
}
function mapVipAccount(value: unknown): StatusCenter['vip'] | undefined {
  if (!record(value) || !ID.test(text(value.catalogVersion, 80)) || !integer(value.points, 0) || !['active', 'frozen', 'review'].includes(String(value.state))) return undefined;
  if (value.levelId === null && value.band === null && value.level === null && value.order === null) return { band: null, catalogVersion: String(value.catalogVersion), level: null, levelId: null, order: null, points: Number(value.points), state: value.state as 'active' | 'frozen' | 'review' };
  if (!ID.test(text(value.levelId, 40)) || !['vip', 'svip'].includes(String(value.band)) || !integer(value.level, 1) || !integer(value.order, 1)) return undefined;
  return { band: value.band as 'vip' | 'svip', catalogVersion: String(value.catalogVersion), level: Number(value.level), levelId: String(value.levelId), order: Number(value.order), points: Number(value.points), state: value.state as 'active' | 'frozen' | 'review' };
}
function mapAristocracyEntitlement(value: unknown): StatusCenter['aristocracy'] | undefined {
  if (!record(value) || !ID.test(text(value.catalogVersion, 80)) || !ID.test(text(value.rankId, 40)) || !integer(value.rankOrder, 1)
    || !integer(value.expiresAtMillis, 1) || !['active', 'expired', 'frozen', 'review'].includes(String(value.state))) return undefined;
  return value as unknown as NonNullable<StatusCenter['aristocracy']>;
}
function mapVipHistory(value: unknown): VipHistoryItem | undefined {
  if (!record(value) || !text(value.eventId, 128) || !['representative-recharge', 'representative-reversal', 'admin-correction'].includes(String(value.kind))
    || !Number.isSafeInteger(value.pointDelta) || Number(value.pointDelta) === 0 || !integer(value.occurredAtMillis, 1)
    || !['settled', 'reversed', 'review'].includes(String(value.settlementState))) return undefined;
  return value as unknown as VipHistoryItem;
}
function mapAristocracyHistory(value: unknown): AristocracyHistoryItem | undefined {
  if (!record(value) || !text(value.transactionId, 160) || !ID.test(text(value.rankId, 40)) || !integer(value.rankOrder, 1)
    || !integer(value.amountCoins, 0) || !integer(value.createdAtMillis, 1) || !integer(value.expiresAtMillis, 1)
    || !['purchase', 'renewal', 'upgrade', 'complimentary-grant', 'admin-revoke', 'freeze', 'unfreeze', 'expiry'].includes(String(value.kind))) return undefined;
  return value as unknown as AristocracyHistoryItem;
}
function mapName(value: unknown): LocalizedName | undefined { return record(value) && text(value.ar, 40) && text(value.en, 40) ? { ar: String(value.ar), en: String(value.en) } : undefined; }
function mapBenefits(value: unknown): StatusBenefit[] | undefined { if (!Array.isArray(value)) return undefined; const result = value.map((item) => ID.test(text(item, 40)) ? String(item) : undefined).filter(defined); return result.length === value.length ? result : undefined; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function integer(value: unknown, min: number) { return Number.isSafeInteger(value) && Number(value) >= min; }
function color(value: unknown) { return /^#[0-9A-Fa-f]{6}$/.test(text(value, 7)); }
function defined<T>(value: T | undefined): value is T { return value !== undefined; }
