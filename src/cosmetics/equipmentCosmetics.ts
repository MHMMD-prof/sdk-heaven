import { readCosmeticAssetReference, type CosmeticAssetReference } from './avatarFrameProjection';

export const EQUIPMENT_COSMETIC_KEYS = ['profileSkin', 'chatBubble', 'nameplate', 'cosmeticBadge', 'seatEffect'] as const;
export type EquipmentCosmeticKey = typeof EQUIPMENT_COSMETIC_KEYS[number];
export type EquipmentCosmeticProjection = CosmeticAssetReference & { itemId: string };
export type EquipmentCosmetics = Partial<Record<EquipmentCosmeticKey, EquipmentCosmeticProjection>>;

const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;

export function readEquipmentCosmetics(profile: unknown): EquipmentCosmetics {
  if (!isRecord(profile) || !isRecord(profile.equippedCosmetics)) return {};
  const result: EquipmentCosmetics = {};
  for (const key of EQUIPMENT_COSMETIC_KEYS) {
    const value = profile.equippedCosmetics[key];
    if (!isRecord(value)) continue;
    const asset = readCosmeticAssetReference(value);
    const itemId = typeof value.itemId === 'string' ? value.itemId.trim() : '';
    if (asset && ITEM_ID_PATTERN.test(itemId)) result[key] = { ...asset, itemId };
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
