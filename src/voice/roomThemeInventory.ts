import {
  DEFAULT_ROOM_THEME_ID,
  MAJLIS_DEFAULT_MANIFEST,
  RoomThemeId,
  RoomThemeManifest,
} from './roomThemeContract';

export type RoomThemeInventoryState = 'free' | 'owned' | 'locked' | 'expired';

export type RoomThemeInventoryEntry = {
  catalog: {
    itemId: string;
    name: { ar: string; en: string };
    prices: { coins?: number; diamonds?: number };
    previewAssetUrl: string;
    thumbnailUrl: string;
  } | null;
  entitlement: {
    acquiredAt: unknown;
    expiresAt: unknown;
    itemId: string;
    roomId: string;
    state: 'active' | 'expired';
    themeId: RoomThemeId;
  } | null;
  manifest: RoomThemeManifest | null;
  state: RoomThemeInventoryState;
  themeId?: RoomThemeId;
};

export type RoomThemeInventory = {
  equippedThemeId: RoomThemeId;
  inventory: RoomThemeInventoryEntry[];
  roomId: string;
};

export function ensureDefaultRoomThemeInventory(inventory: RoomThemeInventory): RoomThemeInventory {
  const defaultEntry: RoomThemeInventoryEntry = {
    catalog: null,
    entitlement: null,
    manifest: MAJLIS_DEFAULT_MANIFEST,
    state: 'free',
    themeId: DEFAULT_ROOM_THEME_ID,
  };
  const withoutDefault = inventory.inventory.filter((entry) => (
    (entry.manifest?.themeId ?? entry.themeId) !== DEFAULT_ROOM_THEME_ID
  ));
  return {
    ...inventory,
    inventory: [defaultEntry, ...withoutDefault],
  };
}
