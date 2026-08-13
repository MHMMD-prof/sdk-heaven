export const STORE_CATEGORIES = [
  'game-items',
  'chat-themes',
  'avatar-frames',
  'profile-skins',
  'chat-bubbles',
  'nameplates',
  'cosmetic-badges',
  'seat-effects',
  'couple-effects',
  'stickers',
  'cars',
  'custom-ids',
] as const;

export const STORE_CURRENCIES = ['coins', 'diamonds'] as const;
export const STORE_DURATION_UNITS = ['days', 'weeks', 'months'] as const;
export const STORE_AVAILABILITY_STATES = ['available', 'disabled', 'unavailable'] as const;

export type StoreCategory = typeof STORE_CATEGORIES[number];
export type StoreCurrency = typeof STORE_CURRENCIES[number];
export type StoreDurationUnit = typeof STORE_DURATION_UNITS[number];
export type StoreAvailability = typeof STORE_AVAILABILITY_STATES[number];

export type LocalizedStoreText = {
  ar: string;
  en: string;
};

export type StorePrice =
  | { coins: number; diamonds?: number }
  | { coins?: number; diamonds: number };

export type StoreErrorCode =
  | 'DUPLICATE_OWNERSHIP'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_RECIPIENT'
  | 'ITEM_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'REQUEST_CONFLICT';

export type StoreDuration =
  | { kind: 'permanent' }
  | { kind: 'timed'; unit: StoreDurationUnit; value: number };

export type StoreStock =
  | { kind: 'unlimited' }
  | { kind: 'limited'; remaining: number };

export type StoreEntryPresentation = {
  animationEnabled: boolean;
  audioAsset?: { assetId: string; assetVersionId: string };
  durationMs: number;
  fallbackAsset?: { assetId: string; assetVersionId: string };
  minimumClientVersion: string;
  performanceTier: 'low' | 'standard' | 'high';
  physicalApprovalReceiptId?: string;
  schemaVersion: 1;
  soundPolicy: 'off' | 'soft' | 'full';
  visualAsset?: { assetId: string; assetVersionId: string };
  visualFormat?: 'lottie-json' | 'mp4';
};

export type StoreCoupleEffectPresentation = {
  borderMode: 'off' | 'static' | 'looping';
  entranceMode: 'off' | 'static' | 'one-shot';
  profileMode: 'off' | 'static' | 'looping';
};

export type StoreCatalogItem = {
  availability: StoreAvailability;
  category: StoreCategory;
  customId?: string;
  cosmeticAsset?: { assetId: string; assetVersionId: string };
  coupleEffectPresentation?: StoreCoupleEffectPresentation;
  description: LocalizedStoreText;
  duration: StoreDuration;
  entryPresentation?: StoreEntryPresentation;
  itemId: string;
  name: LocalizedStoreText;
  order: number;
  previewAssetUrl: string;
  prices: StorePrice;
  purchasingEnabled: boolean;
  stickerAsset?: { assetId: string; assetVersionId: string };
  stock: StoreStock;
  thumbnailUrl: string;
};

export type StoreOwnershipState = 'active' | 'expired';

export type StoreOwnership = {
  acquiredAt: unknown;
  category: StoreCategory;
  cosmeticAsset?: { assetId: string; assetVersionId: string };
  duration: StoreDuration;
  equipped: boolean;
  expiresAt?: unknown;
  itemId: string;
  kind: 'store-ownership';
  ownershipId: string;
  state: StoreOwnershipState;
  uid: string;
  updatedAt: unknown;
};
