import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { clearSuspendedEquipmentCosmetics, reconcileEquipmentCosmeticProjections } = require('./equipmentCosmeticsService');

const fieldValue = { delete: () => ({ __delete: true }), serverTimestamp: () => timestamp(9_999) };
const clock = { nowMillis: () => 1_000 };

describe('equipment cosmetics reconciliation', () => {
  it('repairs an approved projection then clears refunded ownership fail-closed', async () => {
    const db = fixture();
    expect(await reconcileEquipmentCosmeticProjections({ clock, db, fieldValue })).toEqual({ cleared: 0, repaired: 1, scanned: 1 });
    expect(db.documents.get('storeEquipment/u1').cosmetics.seatEffect).toEqual({ assetId: 'safe-seat', assetVersionId: 'v1-123456789abc', itemId: 'safe-seat' });
    expect(db.documents.get('publicProfiles/u1')['equippedCosmetics.seatEffect']).toEqual({ assetId: 'safe-seat', assetVersionId: 'v1-123456789abc', itemId: 'safe-seat' });
    db.documents.get('storeOwnerships/u1/items/safe-seat').state = 'refunded';
    expect(await reconcileEquipmentCosmeticProjections({ clock, db, fieldValue })).toEqual({ cleared: 1, repaired: 0, scanned: 1 });
    expect(db.documents.get('storeEquipment/u1').slots).toEqual({});
    expect(db.documents.get('storeEquipment/u1').cosmetics).toBeUndefined();
  });

  it('immediately clears every Wave 6 slot when profile moderation is suspended', async () => {
    const db = fixture();
    db.documents.get('publicProfiles/u1').moderationStatus = 'suspended';
    expect(await clearSuspendedEquipmentCosmetics({ db, fieldValue, uid: 'u1' })).toEqual({ cleared: 1 });
    expect(db.documents.get('storeOwnerships/u1/items/safe-seat').equipped).toBe(false);
    expect(db.documents.get('publicProfiles/u1')['equippedCosmetics.seatEffect']).toEqual({ __delete: true });
  });
});

function fixture() {
  const item = {
    availability: 'available', category: 'seat-effects', cosmeticAsset: { assetId: 'safe-seat', assetVersionId: 'v1-123456789abc' },
    description: { ar: 'تأثير آمن', en: 'Safe effect' }, duration: { kind: 'permanent' }, itemId: 'safe-seat', name: { ar: 'آمن', en: 'Safe' }, order: 1,
    previewAssetUrl: 'https://cdn.example.com/seat.png', prices: { coins: 1 }, purchasingEnabled: true, stock: { kind: 'unlimited' }, thumbnailUrl: 'https://cdn.example.com/seat-thumb.png',
  };
  return new FakeFirestore({
    'cosmeticAssets/safe-seat': { approvalId: 'safe-seat__v1-123456789abc', approvedVersionId: 'v1-123456789abc', moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: 'v1-123456789abc', renderingEnabled: true },
    'cosmeticAssets/safe-seat/versions/v1-123456789abc': { assetId: 'safe-seat', assetVersionId: 'v1-123456789abc', category: 'seat-effect', format: 'lottie-json', sha256: 'abc' },
    'cosmeticAssetApprovals/safe-seat__v1-123456789abc': { assetId: 'safe-seat', assetVersionId: 'v1-123456789abc', checksum: 'abc', decision: 'approved' },
    'publicProfiles/u1': { moderationStatus: 'active' },
    'storeCatalog/safe-seat': item,
    'storeEquipment/u1': { slots: { 'seat-effects': 'safe-seat' }, uid: 'u1' },
    'storeOwnerships/u1/items/safe-seat': { acquiredAt: timestamp(), category: 'seat-effects', duration: { kind: 'permanent' }, equipped: true, itemId: 'safe-seat', kind: 'store-ownership', ownershipId: 'safe-seat', state: 'active', uid: 'u1', updatedAt: timestamp() },
  });
}

function timestamp(value = 1) { return { toMillis: () => value, toDate: () => new Date(value) }; }
function snapshot(path, data) { const ref = { path }; return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) { return { path }; }
  collection(path) { return { limit: (limit) => ({ get: async () => { const rows = [...this.documents.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).slice(0, limit); return { docs: rows.map(([key, value]) => snapshot(key, value)), size: rows.length }; } }) }; }
  async runTransaction(callback) { const transaction = new FakeTransaction(this); const result = await callback(transaction); transaction.commit(); return result; }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', path: ref.path, data }); }
  commit() { for (const operation of this.operations) this.db.documents.set(operation.path, operation.kind === 'update' ? { ...this.db.documents.get(operation.path), ...operation.data } : operation.data); }
}
