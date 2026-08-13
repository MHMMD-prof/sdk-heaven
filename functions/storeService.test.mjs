import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { equipStoreItem, expireStoreOwnerships, getMyStoreItems, getStoreCatalog, giftStoreItem, purchaseStoreItem } = require('./storeService');

const fieldValue = { delete: () => ({ __delete: true }), serverTimestamp: () => timestamp(9_999) };
const clock = { nowMillis: () => 1_000, timestampFromMillis: (value) => timestamp(value) };

describe('storeService', () => {
  it('returns visible catalog cards with the server wallet', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/gold-car', catalogItem());
    db.documents.set('storeCatalog/hidden-car', { ...catalogItem('hidden-car'), availability: 'disabled' });
    db.documents.set('appConfig/storefront', { featuredItemId: 'gold-car' });
    const response = await getStoreCatalog({ db, uid: 'self' });
    expect(response.result.items.map((item) => item.itemId)).toEqual(['gold-car']);
    expect(response.result.featuredItemId).toBe('gold-car');
    expect(response.result.wallet.balances).toEqual({ coins: 100, diamonds: 10 });
  });

  it('drops a featured selection that is not visible in the customer catalog', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/gold-car', catalogItem());
    db.documents.set('appConfig/storefront', { featuredItemId: 'disabled-car' });
    db.documents.set('storeCatalog/disabled-car', { ...catalogItem('disabled-car'), availability: 'disabled' });
    expect(await getStoreCatalog({ db, uid: 'self' })).toMatchObject({ result: { featuredItemId: '' } });
  });

  it('never releases or mutates mock item IDs', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/mock-preview-car', catalogItem('mock-preview-car'));
    expect((await getStoreCatalog({ db, uid: 'self' })).result.items).toEqual([]);
    expect(await purchaseStoreItem({ clock, db, fieldValue, input: { currency: 'coins', itemId: 'mock-preview-car' }, requestId: 'mock_purchase_1234', uid: 'self' })).toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
    expect(await equipStoreItem({ clock, db, fieldValue, input: { itemId: 'demo-car' }, requestId: 'mock_equip_123456', uid: 'self' })).toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
    expect(await giftStoreItem({ clock, db, fieldValue, input: { currency: 'coins', itemId: 'mock-preview-car', recipientPublicId: '7654321' }, requestId: 'mock_gift_1234567', uid: 'self' })).toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
  });

  it('purchases with the chosen currency, decrements stock, and auto-equips without deleting the old item', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/gold-car', { ...catalogItem(), duration: { kind: 'timed', unit: 'weeks', value: 1 }, stock: { kind: 'limited', remaining: 2 } });
    db.documents.set('storeOwnerships/self/items/blue-car', { category: 'cars', equipped: true, itemId: 'blue-car', ownershipId: 'blue-car', state: 'active', uid: 'self' });
    db.documents.set('storeEquipment/self', { slots: { cars: 'blue-car' }, uid: 'self' });
    const command = { clock, db, fieldValue, input: { currency: 'diamonds', itemId: 'gold-car' }, requestId: 'purchase_12345678', uid: 'self' };
    expect(await purchaseStoreItem(command)).toMatchObject({ result: { balances: { coins: 100, diamonds: 6 }, itemId: 'gold-car' } });
    expect(await purchaseStoreItem(command)).toMatchObject({ result: { balances: { coins: 100, diamonds: 6 } } });
    expect(db.documents.get('storeOwnerships/self/items/blue-car').equipped).toBe(false);
    expect(db.documents.get('storeOwnerships/self/items/gold-car')).toMatchObject({ equipped: true, state: 'active' });
    expect(db.documents.get('storeOwnerships/self/items/gold-car').expiresAt.toMillis()).toBe(604_801_000);
    expect(db.documents.get('storeCatalog/gold-car').stock.remaining).toBe(1);
    expect(db.documents.get('walletTransactions/self_purchase_12345678')).toMatchObject({ amount: 4, currency: 'diamonds' });
  });

  it('rejects duplicate ownership, unavailable currency prices, sold-out stock, and insufficient funds without writes', async () => {
    const duplicate = storeDb(); duplicate.documents.set('storeCatalog/gold-car', catalogItem()); duplicate.documents.set('storeOwnerships/self/items/gold-car', { itemId: 'gold-car' });
    expect(await buy(duplicate)).toEqual({ errorCode: 'DUPLICATE_OWNERSHIP' });
    const noPrice = storeDb(); noPrice.documents.set('storeCatalog/gold-car', { ...catalogItem(), prices: { coins: 40 } });
    expect(await buy(noPrice)).toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
    const sold = storeDb(); sold.documents.set('storeCatalog/gold-car', { ...catalogItem(), stock: { kind: 'limited', remaining: 0 } });
    expect(await buy(sold)).toEqual({ errorCode: 'OUT_OF_STOCK' });
    const poor = storeDb(); poor.documents.set('storeCatalog/gold-car', { ...catalogItem(), prices: { diamonds: 11 } });
    expect(await buy(poor)).toEqual({ errorCode: 'INSUFFICIENT_FUNDS' });
    expect(poor.documents.has('storeTransactions/self_purchase_12345678')).toBe(false);
  });

  it('claims and immediately equips a globally reserved seven-digit custom ID', async () => {
    const db = storeDb();
    const custom = {
      ...catalogItem('custom-id-0000777'), category: 'custom-ids', customId: '0000777', duration: { kind: 'permanent' },
      name: { ar: '0000777', en: '0000777' }, prices: { diamonds: 5 }, stock: { kind: 'limited', remaining: 1 },
    };
    db.documents.set('storeCatalog/custom-id-0000777', custom);
    db.documents.set('storeCustomIds/0000777', { itemId: 'custom-id-0000777' });
    const response = await purchaseStoreItem({ clock, db, fieldValue, input: { currency: 'diamonds', itemId: custom.itemId }, requestId: 'custom_purchase_001', uid: 'self' });
    expect(response).toMatchObject({ result: { itemId: custom.itemId } });
    expect(db.documents.get('publicProfiles/self').specialId).toBe('0000777');
    expect(db.documents.get('specialIds/0000777')).toMatchObject({ uid: 'self' });
    expect(db.documents.get('storeCatalog/custom-id-0000777').stock.remaining).toBe(0);
  });

  it('expires timed equipment without auto-equipping the previous item', async () => {
    const db = storeDb();
    db.documents.set('storeOwnerships/self/items/gold-car', { category: 'cars', equipped: true, expiresAt: timestamp(900), itemId: 'gold-car', kind: 'store-ownership', ownershipId: 'gold-car', state: 'active', uid: 'self' });
    db.documents.set('storeEquipment/self', { slots: { cars: 'gold-car' }, uid: 'self' });
    expect(await expireStoreOwnerships({ clock, db, fieldValue })).toEqual({ expired: 1, scanned: 1 });
    expect(db.documents.get('storeOwnerships/self/items/gold-car')).toMatchObject({ equipped: false, state: 'expired' });
    expect(db.documents.get('storeEquipment/self').slots).toEqual({});
  });

  it('equips only an exact approved seat effect and clears every projection on expiry', async () => {
    const db = storeDb();
    const item = cosmeticItem('safe-seat', 'seat-effects', 'seat-effect');
    approveCosmetic(db, item, 'seat-effect');
    db.documents.set('storeCatalog/safe-seat', item);
    db.documents.set('storeOwnerships/self/items/safe-seat', {
      acquiredAt: timestamp(), category: 'seat-effects', cosmeticAsset: item.cosmeticAsset, duration: { kind: 'timed', unit: 'days', value: 1 },
      equipped: false, expiresAt: timestamp(1_100), itemId: 'safe-seat', kind: 'store-ownership', ownershipId: 'safe-seat', state: 'active', uid: 'self', updatedAt: timestamp(),
    });
    expect(await equipStoreItem({ clock, db, fieldValue, input: { itemId: 'safe-seat' }, requestId: 'equip_safe_seat_001', uid: 'self' })).toMatchObject({ result: { itemId: 'safe-seat' } });
    expect(db.documents.get('storeEquipment/self').cosmetics.seatEffect).toEqual({ ...item.cosmeticAsset, itemId: 'safe-seat' });
    expect(db.documents.get('publicProfiles/self')['equippedCosmetics.seatEffect']).toEqual({ ...item.cosmeticAsset, itemId: 'safe-seat' });
    clock.nowMillis = () => 1_200;
    expect(await expireStoreOwnerships({ clock, db, fieldValue })).toEqual({ expired: 1, scanned: 1 });
    expect(db.documents.get('storeEquipment/self').cosmetics).toBeUndefined();
    expect(db.documents.get('publicProfiles/self')['equippedCosmetics.seatEffect']).toEqual({ __delete: true });
    clock.nowMillis = () => 1_000;
  });

  it('rejects cosmetic equipment when publication is disabled', async () => {
    const db = storeDb();
    const item = cosmeticItem('unsafe-badge', 'cosmetic-badges', 'cosmetic-badge');
    approveCosmetic(db, item, 'cosmetic-badge');
    db.documents.get('cosmeticAssets/unsafe-badge').renderingEnabled = false;
    db.documents.set('storeCatalog/unsafe-badge', item);
    db.documents.set('storeOwnerships/self/items/unsafe-badge', {
      acquiredAt: timestamp(), category: item.category, cosmeticAsset: item.cosmeticAsset, duration: { kind: 'permanent' }, equipped: false,
      itemId: item.itemId, kind: 'store-ownership', ownershipId: item.itemId, state: 'active', uid: 'self', updatedAt: timestamp(),
    });
    expect(await equipStoreItem({ clock, db, fieldValue, input: { itemId: item.itemId }, requestId: 'equip_unsafe_badge', uid: 'self' })).toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
  });

  it('returns My Items and manually equips another active owned item', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/gold-car', catalogItem());
    db.documents.set('storeOwnerships/self/items/gold-car', { acquiredAt: timestamp(), category: 'cars', duration: { kind: 'permanent' }, equipped: false, itemId: 'gold-car', kind: 'store-ownership', ownershipId: 'gold-car', state: 'active', uid: 'self', updatedAt: timestamp() });
    db.documents.set('storeOwnerships/self/items/blue-car', { acquiredAt: timestamp(), category: 'cars', duration: { kind: 'permanent' }, equipped: true, itemId: 'blue-car', kind: 'store-ownership', ownershipId: 'blue-car', state: 'active', uid: 'self', updatedAt: timestamp() });
    db.documents.set('storeEquipment/self', { slots: { cars: 'blue-car' }, uid: 'self' });
    expect(await getMyStoreItems({ db, uid: 'self' })).toMatchObject({ result: { items: [{ catalog: { itemId: 'gold-car' }, ownership: { itemId: 'gold-car' } }, { catalog: null, ownership: { itemId: 'blue-car' } }] } });
    expect(await equipStoreItem({ clock, db, fieldValue, input: { itemId: 'gold-car' }, requestId: 'equip_12345678901', uid: 'self' })).toMatchObject({ result: { itemId: 'gold-car' } });
    expect(db.documents.get('storeOwnerships/self/items/gold-car').equipped).toBe(true);
    expect(db.documents.get('storeOwnerships/self/items/blue-car').equipped).toBe(false);
  });

  it('buys another copy only as an immediate gift to a normal seven-digit account ID', async () => {
    const db = storeDb();
    db.documents.set('storeCatalog/gold-car', { ...catalogItem(), stock: { kind: 'limited', remaining: 2 } });
    db.documents.set('storeOwnerships/self/items/gold-car', { itemId: 'gold-car', uid: 'self' });
    db.documents.set('publicIds/7654321', { createdAt: timestamp(), uid: 'target' });
    db.documents.set('publicProfiles/target', { ...publicProfile(), displayName: 'Target', normalizedName: 'target', publicId: '7654321', uid: 'target' });
    const command = { clock, db, fieldValue, input: { currency: 'coins', itemId: 'gold-car', recipientPublicId: '7654321' }, requestId: 'storegift_1234567', uid: 'self' };
    const response = await giftStoreItem(command);
    expect(response).toMatchObject({ result: { balances: { coins: 60, diamonds: 10 }, recipientPublicId: '7654321', recipientUid: 'target' } });
    expect(db.documents.get('storeOwnerships/target/items/gold-car')).toMatchObject({ equipped: true, uid: 'target' });
    expect(db.documents.get('storeOwnerships/self/items/gold-car')).toEqual({ itemId: 'gold-car', uid: 'self' });
    expect(db.documents.get('storeCatalog/gold-car').stock.remaining).toBe(1);
    expect(db.documents.get('storeGiftEvents/self_storegift_1234567')).toMatchObject({ senderUid: 'self', recipientUid: 'target' });
    expect(await giftStoreItem(command)).toEqual(response);
  });

  it('rejects self-gifting and recipients who already own the item', async () => {
    const self = storeDb(); self.documents.set('storeCatalog/gold-car', catalogItem());
    expect(await giftStoreItem({ clock, db: self, fieldValue, input: { currency: 'coins', itemId: 'gold-car', recipientPublicId: '1234567' }, requestId: 'storegift_1234567', uid: 'self' })).toEqual({ errorCode: 'INVALID_RECIPIENT' });
    const duplicate = storeDb(); duplicate.documents.set('storeCatalog/gold-car', catalogItem()); duplicate.documents.set('publicIds/7654321', { createdAt: timestamp(), uid: 'target' }); duplicate.documents.set('publicProfiles/target', { ...publicProfile(), publicId: '7654321', uid: 'target' }); duplicate.documents.set('storeOwnerships/target/items/gold-car', { itemId: 'gold-car' });
    expect(await giftStoreItem({ clock, db: duplicate, fieldValue, input: { currency: 'coins', itemId: 'gold-car', recipientPublicId: '7654321' }, requestId: 'storegift_1234567', uid: 'self' })).toEqual({ errorCode: 'DUPLICATE_OWNERSHIP' });
  });
});

function buy(db) { return purchaseStoreItem({ clock, db, fieldValue, input: { currency: 'diamonds', itemId: 'gold-car' }, requestId: 'purchase_12345678', uid: 'self' }); }
function storeDb() { return new FakeFirestore({
  'appConfig/socialFeatures': { wallet: true }, 'publicProfiles/self': publicProfile(), 'publicIds/1234567': { createdAt: timestamp(), uid: 'self' },
  'walletSummaries/self': { balances: { coins: 100, diamonds: 10 }, createdAt: timestamp(), lifetimeCredit: { coins: 100, diamonds: 10 }, lifetimeDebit: { coins: 0, diamonds: 0 }, uid: 'self', updatedAt: timestamp() },
}); }
function publicProfile() { return { avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', coupleLevel: 0, createdAt: timestamp(), displayName: 'Self', friendCount: 0, giftScore: 0, moderationStatus: 'active', normalizedName: 'self', publicId: '1234567', uid: 'self', updatedAt: timestamp() }; }
function catalogItem(itemId = 'gold-car') { return { availability: 'available', category: 'cars', description: { ar: 'سيارة', en: 'Car' }, duration: { kind: 'permanent' }, itemId, name: { ar: 'ذهبية', en: 'Gold' }, order: 1, previewAssetUrl: 'https://cdn.example.com/preview.png', prices: { coins: 40, diamonds: 4 }, purchasingEnabled: true, stock: { kind: 'unlimited' }, thumbnailUrl: 'https://cdn.example.com/thumb.png' }; }
function cosmeticItem(itemId, category, assetCategory) { return { ...catalogItem(itemId), category, cosmeticAsset: { assetId: itemId, assetVersionId: 'v1-123456789abc' }, description: { ar: 'زينة آمنة', en: 'Safe cosmetic' }, name: { ar: 'زينة', en: 'Cosmetic' }, previewAssetUrl: `https://cdn.example.com/${assetCategory}.png`, thumbnailUrl: `https://cdn.example.com/${assetCategory}-thumb.png` }; }
function approveCosmetic(db, item, assetCategory) {
  const { assetId, assetVersionId } = item.cosmeticAsset;
  db.documents.set(`cosmeticAssets/${assetId}`, { approvalId: `${assetId}__${assetVersionId}`, approvedVersionId: assetVersionId, moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: assetVersionId, renderingEnabled: true });
  db.documents.set(`cosmeticAssets/${assetId}/versions/${assetVersionId}`, { assetId, assetVersionId, category: assetCategory, format: 'png', sha256: 'abc' });
  db.documents.set(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`, { assetId, assetVersionId, authoritySeparationPassed: true, checksum: 'abc', decision: 'approved', readableIdentityPassed: true });
}
function timestamp(value = 1) { return { toMillis: () => value, toDate: () => new Date(value) }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) { return { get: async () => snapshot(path, this.documents.get(path)), path }; }
  collection(path) { return new FakeQuery(this, path, false); }
  collectionGroup(name) { return new FakeQuery(this, name, true); }
  async getAll(...refs) { return refs.map((ref) => snapshot(ref.path, this.documents.get(ref.path))); }
  async runTransaction(callback) { const transaction = new FakeTransaction(this); const result = await callback(transaction); transaction.commit(); return result; }
}
class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', path: ref.path, data }); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', path: ref.path, data }); }
  commit() { for (const operation of this.operations) { if (operation.kind === 'create' && this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`); this.db.documents.set(operation.path, operation.kind === 'update' ? { ...this.db.documents.get(operation.path), ...operation.data } : operation.data); } }
}
class FakeQuery {
  constructor(db, path, group, state = {}) { this.db = db; this.path = path; this.group = group; this.state = state; }
  where(field, operator, value) { return new FakeQuery(this.db, this.path, this.group, { ...this.state, filter: { field, operator, value } }); }
  limit(value) { return new FakeQuery(this.db, this.path, this.group, { ...this.state, limit: value }); }
  async get() {
    let rows = [...this.db.documents.entries()].filter(([path]) => this.group ? path.includes(`/${this.path}/`) : path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    if (this.state.filter) { const { field, operator, value } = this.state.filter; rows = rows.filter(([, data]) => operator === '<=' && data[field]?.toMillis() <= value.toMillis()); }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(([path, data]) => snapshot(path, data)) };
  }
}
function snapshot(path, data) { const ref = { path }; return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref }; }
