import type { CustomerStoreCatalogItem, MyStoreItem } from '../social/types';

export const MOCK_STORE_ITEM_PREFIX = 'mock-store-';

export const mockStoreFeaturedItemId = `${MOCK_STORE_ITEM_PREFIX}royal-frame`;

export const mockStoreCatalogItems: CustomerStoreCatalogItem[] = [
  {
    availability: 'available',
    category: 'avatar-frames',
    description: {
      ar: 'إطار ملكي ذهبي مرصّع بالياقوت ليمنح صورتك حضوراً فاخراً.',
      en: 'A ruby-set royal gold frame for a distinguished profile.',
    },
    duration: { kind: 'permanent' },
    itemId: mockStoreFeaturedItemId,
    name: { ar: 'إطار السلطان', en: 'Sultan Frame' },
    order: 10,
    previewAssetUrl: 'mock-store://royal-frame',
    prices: { coins: 3_800, diamonds: 75 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'mock-store://royal-frame',
  },
  {
    availability: 'available',
    category: 'chat-themes',
    description: {
      ar: 'ثيم دردشة داكن مستوحى من ليالي بغداد بإضاءة ذهبية هادئة.',
      en: 'A dark chat theme inspired by Baghdad nights and warm gold light.',
    },
    duration: { kind: 'timed', unit: 'months', value: 1 },
    itemId: `${MOCK_STORE_ITEM_PREFIX}baghdad-theme`,
    name: { ar: 'ليالي بغداد', en: 'Baghdad Nights' },
    order: 20,
    previewAssetUrl: 'mock-store://baghdad-theme',
    prices: { coins: 1_200, diamonds: 25 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'mock-store://baghdad-theme',
  },
  {
    availability: 'available',
    category: 'avatar-frames',
    description: {
      ar: 'إطار داكن مزين بنجوم وفوانيس ذهبية لمظهر ليلي هادئ.',
      en: 'A dark frame decorated with stars and warm golden lanterns.',
    },
    duration: { kind: 'permanent' },
    itemId: `${MOCK_STORE_ITEM_PREFIX}night-frame`,
    name: { ar: 'إطار الليالي', en: 'Night Frame' },
    order: 11,
    previewAssetUrl: 'mock-store://night-frame',
    prices: { coins: 2_100, diamonds: 40 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'mock-store://night-frame',
  },
  {
    availability: 'available',
    category: 'avatar-frames',
    description: {
      ar: 'إطار زمردي ملكي بتفاصيل ذهبية، متاح لفترة احتفالية محدودة.',
      en: 'A royal emerald frame with gold detailing for a limited celebration.',
    },
    duration: { kind: 'timed', unit: 'days', value: 14 },
    itemId: `${MOCK_STORE_ITEM_PREFIX}emerald-frame`,
    name: { ar: 'إطار الزمرد', en: 'Emerald Frame' },
    order: 12,
    previewAssetUrl: 'mock-store://emerald-frame',
    prices: { coins: 1_700, diamonds: 32 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'mock-store://emerald-frame',
  },
  {
    availability: 'available',
    category: 'game-items',
    description: {
      ar: 'لوح كاروم بطابع المجلس الملكي وتفاصيل خشبية حمراء فاخرة.',
      en: 'A royal-majlis carrom board with rich red wood detailing.',
    },
    duration: { kind: 'permanent' },
    itemId: `${MOCK_STORE_ITEM_PREFIX}royal-carrom`,
    name: { ar: 'لوح الكاروم الملكي', en: 'Royal Carrom Board' },
    order: 30,
    previewAssetUrl: 'mock-store://royal-carrom',
    prices: { coins: 5_200, diamonds: 95 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'mock-store://royal-carrom',
  },
  {
    availability: 'available',
    category: 'cars',
    description: {
      ar: 'سيارة رياضية داكنة تظهر بجانب ملفك لمدة ثمانية أسابيع.',
      en: 'A dark sports car displayed by your profile for eight weeks.',
    },
    duration: { kind: 'timed', unit: 'weeks', value: 8 },
    itemId: `${MOCK_STORE_ITEM_PREFIX}shadow-car`,
    name: { ar: 'سيارة الظل', en: 'Shadow Car' },
    order: 40,
    previewAssetUrl: 'mock-store://shadow-car',
    prices: { coins: 2_400, diamonds: 48 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'limited', remaining: 18 },
    thumbnailUrl: 'mock-store://shadow-car',
  },
  {
    availability: 'available',
    category: 'custom-ids',
    customId: '7654321',
    description: {
      ar: 'معرّف رقمي مميز من سبعة أرقام، متاح لمستخدم واحد فقط.',
      en: 'A unique seven-digit public ID available to one user only.',
    },
    duration: { kind: 'permanent' },
    itemId: `${MOCK_STORE_ITEM_PREFIX}custom-id-7654321`,
    name: { ar: 'المعرّف 7654321', en: 'ID 7654321' },
    order: 50,
    previewAssetUrl: 'mock-store://custom-id',
    prices: { coins: 9_999, diamonds: 150 },
    purchasingEnabled: true,
    soldOut: false,
    stock: { kind: 'limited', remaining: 1 },
    thumbnailUrl: 'mock-store://custom-id',
  },
  {
    availability: 'available',
    category: 'game-items',
    description: {
      ar: 'مجموعة نرد احتفالية محدودة نفدت حالياً من المتجر.',
      en: 'A limited celebration dice set that is currently sold out.',
    },
    duration: { kind: 'timed', unit: 'days', value: 14 },
    itemId: `${MOCK_STORE_ITEM_PREFIX}celebration-dice`,
    name: { ar: 'نرد الاحتفال', en: 'Celebration Dice' },
    order: 60,
    previewAssetUrl: 'mock-store://celebration-dice',
    prices: { coins: 900 },
    purchasingEnabled: true,
    soldOut: true,
    stock: { kind: 'limited', remaining: 0 },
    thumbnailUrl: 'mock-store://celebration-dice',
  },
];

const catalogById = new Map(mockStoreCatalogItems.map((item) => [item.itemId, item]));

export const mockMyStoreItems: MyStoreItem[] = [
  createMockOwnership(mockStoreFeaturedItemId, {
    equipped: true,
    ownershipId: 'mock-ownership-royal-frame',
  }),
  createMockOwnership(`${MOCK_STORE_ITEM_PREFIX}baghdad-theme`, {
    equipped: false,
    expiresAt: { seconds: Date.UTC(2027, 0, 15) / 1000 },
    ownershipId: 'mock-ownership-baghdad-theme',
  }),
  createMockOwnership(`${MOCK_STORE_ITEM_PREFIX}night-frame`, {
    equipped: false,
    ownershipId: 'mock-ownership-night-frame',
  }),
  createMockOwnership(`${MOCK_STORE_ITEM_PREFIX}emerald-frame`, {
    equipped: false,
    expiresAt: { seconds: Date.UTC(2026, 6, 1) / 1000 },
    ownershipId: 'mock-ownership-emerald-frame',
    state: 'expired',
  }),
  createMockOwnership(`${MOCK_STORE_ITEM_PREFIX}shadow-car`, {
    equipped: false,
    expiresAt: { seconds: Date.UTC(2026, 4, 1) / 1000 },
    ownershipId: 'mock-ownership-shadow-car',
    state: 'expired',
  }),
];

export function isMockStoreItemId(itemId: string) {
  return itemId.startsWith(MOCK_STORE_ITEM_PREFIX);
}

function createMockOwnership(
  itemId: string,
  options: {
    equipped: boolean;
    expiresAt?: unknown;
    ownershipId: string;
    state?: 'active' | 'expired';
  },
): MyStoreItem {
  const catalog = catalogById.get(itemId);
  if (!catalog) throw new Error(`Missing mock catalog item: ${itemId}`);
  const now = '2026-07-21T12:00:00.000Z';
  return {
    catalog,
    ownership: {
      acquiredAt: now,
      category: catalog.category,
      duration: catalog.duration,
      equipped: options.equipped,
      expiresAt: options.expiresAt,
      itemId,
      kind: 'store-ownership',
      ownershipId: options.ownershipId,
      state: options.state || 'active',
      uid: 'mock-current-user',
      updatedAt: now,
    },
  };
}
