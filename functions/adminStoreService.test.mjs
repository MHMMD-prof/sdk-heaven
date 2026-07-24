import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { executeAdminStoreCatalogUpsert, stableFingerprint } = require('./adminStoreService');

const item = {
  availability: 'available', category: 'custom-ids', customId: '0000777', description: { ar: 'معرّف', en: 'ID' },
  duration: { kind: 'permanent' }, itemId: 'custom-id-0000777', name: { ar: '0000777', en: '0000777' }, order: 1,
  previewAssetUrl: 'https://cdn.example.com/preview.png', prices: { diamonds: 5 }, purchasingEnabled: true,
  stock: { kind: 'limited', remaining: 1 }, thumbnailUrl: 'https://cdn.example.com/thumb.png',
};

describe('adminStoreService', () => {
  it('uses a stable fingerprint independent of object key order', () => {
    expect(stableFingerprint({ b: 2, a: 1 })).toBe(stableFingerprint({ a: 1, b: 2 }));
  });

  it('reserves a custom ID, writes the catalog, and records an audit event', async () => {
    const writes = [];
    const db = fakeDb({}, writes);
    const result = await executeAdminStoreCatalogUpsert({
      db, decodedToken: { email: 'admin@example.com', uid: 'admin-1' }, fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: { expectedUpdatedAt: '', item, reason: 'إضافة رقم مميز', requestId: 'request_123456789' },
    });
    expect(result).toMatchObject({ itemId: item.itemId, replayed: false });
    expect(writes.map((write) => write.ref.path)).toEqual(expect.arrayContaining([
      'storeCustomIds/0000777', 'storeCatalog/custom-id-0000777', 'adminAuditEvents/store_request_123456789',
    ]));
  });

  it('rejects a custom ID already used as a normal public ID', async () => {
    const db = fakeDb({ 'publicIds/0000777': { uid: 'user-1' } }, []);
    await expect(executeAdminStoreCatalogUpsert({
      db, decodedToken: { uid: 'admin-1' }, fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: { expectedUpdatedAt: '', item, reason: 'إضافة رقم مميز', requestId: 'request_123456789' },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('stores the single featured item selection in storefront configuration', async () => {
    const writes = [];
    const db = fakeDb({}, writes);
    await executeAdminStoreCatalogUpsert({
      db, decodedToken: { email: 'admin@example.com', uid: 'admin-1' }, fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: { expectedUpdatedAt: '', featured: true, item, reason: 'عرض العنصر في واجهة المتجر', requestId: 'request_featured_01' },
    });
    expect(writes.find((write) => write.ref.path === 'appConfig/storefront')?.data).toMatchObject({ featuredItemId: item.itemId });
  });
});

function fakeDb(seed, writes) {
  const makeRef = (collection, id) => ({ path: `${collection}/${id}` });
  return {
    collection(collection) { return { doc(id) { return makeRef(collection, id); } }; },
    async runTransaction(handler) {
      return handler({
        async getAll(...refs) { return refs.map((ref) => ({ data: () => seed[ref.path], exists: Object.hasOwn(seed, ref.path), ref })); },
        create(ref, data) { writes.push({ kind: 'create', ref, data }); },
        set(ref, data) { writes.push({ kind: 'set', ref, data }); },
      });
    },
  };
}
