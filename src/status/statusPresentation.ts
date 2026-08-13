import type { CosmeticAssetReference } from '../cosmetics/avatarFrameProjection';

export const STATUS_ASSET_SLOTS = ['badge', 'frame', 'nameplate', 'chatBubble', 'entryEffect'] as const;
export type StatusAssetSlot = typeof STATUS_ASSET_SLOTS[number];
export type StatusAssets = Partial<Record<StatusAssetSlot, CosmeticAssetReference>>;

export type PublicVipStatus = {
  accentColor: string;
  assets: StatusAssets;
  band: 'vip' | 'svip';
  catalogVersion: string;
  id: string;
  level: number;
  nameAr: string;
  nameEn: string;
  order: number;
};

export type PublicAristocracyStatus = {
  accentColor: string;
  assets: StatusAssets;
  catalogVersion: string;
  id: string;
  nameAr: string;
  nameEn: string;
  order: number;
};

export type StatusPresentation = {
  aristocracy?: PublicAristocracyStatus;
  schemaVersion: 1;
  visibility: 'public' | 'hidden';
  vip?: PublicVipStatus;
};

export type CompactStatusBadge = {
  accentColor: string;
  accessibilityLabel: string;
  kind: 'vip' | 'svip' | 'aristocracy';
  label: string;
};

const ID = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const COLOR = /^#[A-Fa-f0-9]{6}$/;

export function mapStatusPresentation(value: unknown): StatusPresentation | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !onlyKeys(value, ['schemaVersion', 'visibility', 'vip', 'aristocracy'])) return undefined;
  if (value.visibility !== 'public' && value.visibility !== 'hidden') return undefined;
  if (value.visibility === 'hidden') {
    return value.vip === undefined && value.aristocracy === undefined
      ? { schemaVersion: 1, visibility: 'hidden' }
      : undefined;
  }
  const vip = value.vip === undefined ? undefined : mapVip(value.vip);
  const aristocracy = value.aristocracy === undefined ? undefined : mapAristocracy(value.aristocracy);
  if ((value.vip !== undefined && !vip) || (value.aristocracy !== undefined && !aristocracy)) return undefined;
  return {
    schemaVersion: 1,
    visibility: 'public',
    ...(vip ? { vip } : {}),
    ...(aristocracy ? { aristocracy } : {}),
  };
}

export function compactStatusBadges(presentation?: StatusPresentation, locale: 'ar' | 'en' = 'ar'): CompactStatusBadge[] {
  if (!presentation || presentation.visibility !== 'public') return [];
  const badges: CompactStatusBadge[] = [];
  if (presentation.vip) {
    const prefix = presentation.vip.band === 'svip' ? 'SVIP' : 'VIP';
    const label = `${prefix} ${presentation.vip.level}`;
    badges.push({
      accentColor: presentation.vip.accentColor,
      accessibilityLabel: locale === 'ar' ? `${prefix}، المستوى ${presentation.vip.level}` : `${prefix}, level ${presentation.vip.level}`,
      kind: presentation.vip.band,
      label,
    });
  }
  if (presentation.aristocracy) {
    const label = locale === 'ar' ? presentation.aristocracy.nameAr : presentation.aristocracy.nameEn;
    badges.push({
      accentColor: presentation.aristocracy.accentColor,
      accessibilityLabel: locale === 'ar' ? `الأرستقراطية، ${label}` : `Aristocracy, ${label}`,
      kind: 'aristocracy',
      label,
    });
  }
  return badges.slice(0, 2);
}

export function statusAsset(presentation: StatusPresentation | undefined, slot: StatusAssetSlot) {
  if (!presentation || presentation.visibility !== 'public') return undefined;
  return presentation.aristocracy?.assets[slot] || presentation.vip?.assets[slot];
}

function mapVip(value: unknown): PublicVipStatus | undefined {
  if (!isRecord(value) || !onlyKeys(value, ['catalogVersion', 'id', 'band', 'level', 'order', 'nameAr', 'nameEn', 'accentColor', 'assets'])) return undefined;
  const level = Number(value.level);
  const order = Number(value.order);
  const band = value.band === 'vip' || value.band === 'svip' ? value.band : undefined;
  const id = string(value.id, 40);
  const assets = mapStatusAssets(value.assets);
  if (!band || id !== `${band}-${level}` || !integer(level, 1, 20) || !integer(order, 1, 40) || !assets) return undefined;
  const common = commonStatus(value);
  return common ? { ...common, assets, band, id, level, order } : undefined;
}

function mapAristocracy(value: unknown): PublicAristocracyStatus | undefined {
  if (!isRecord(value) || !onlyKeys(value, ['catalogVersion', 'id', 'order', 'nameAr', 'nameEn', 'accentColor', 'assets'])) return undefined;
  const id = string(value.id, 40);
  const order = Number(value.order);
  const assets = mapStatusAssets(value.assets);
  if (!ID.test(id) || !integer(order, 1, 20) || !assets) return undefined;
  const common = commonStatus(value);
  return common ? { ...common, assets, id, order } : undefined;
}

function commonStatus(value: Record<string, unknown>) {
  const catalogVersion = string(value.catalogVersion, 80);
  const nameAr = string(value.nameAr, 40);
  const nameEn = string(value.nameEn, 40);
  const accentColor = string(value.accentColor, 7);
  return ID.test(catalogVersion) && nameAr && nameEn && COLOR.test(accentColor)
    ? { accentColor, catalogVersion, nameAr, nameEn }
    : undefined;
}

function mapStatusAssets(value: unknown): StatusAssets | undefined {
  if (!isRecord(value) || !onlyKeys(value, STATUS_ASSET_SLOTS)) return undefined;
  const result: StatusAssets = {};
  for (const slot of STATUS_ASSET_SLOTS) {
    if (value[slot] === undefined) continue;
    const reference = value[slot];
    if (!isRecord(reference) || !onlyKeys(reference, ['assetId', 'assetVersionId'])) return undefined;
    const assetId = string(reference.assetId, 80);
    const assetVersionId = string(reference.assetVersionId, 40);
    if (!ID.test(assetId) || !VERSION.test(assetVersionId)) return undefined;
    result[slot] = { assetId, assetVersionId };
  }
  return result;
}

function integer(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function string(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
