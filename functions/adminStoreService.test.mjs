import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { executeAdminStoreCatalogUpsert, stableFingerprint } = require('./adminStoreService');
const { createEntryPhysicalApprovalReceiptId } = require('./roomEntryPresentationCore');

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

  it('creates one immutable exact-version receipt before assigning animated car entry assets', async () => {
    const writes = [];
    const visual = { assetId: 'royal-entry', assetVersionId: 'v1-aaaaaaaaaaaa' };
    const fallback = { assetId: 'royal-entry-static', assetVersionId: 'v1-bbbbbbbbbbbb' };
    const receiptId = createEntryPhysicalApprovalReceiptId('car-1', visual.assetVersionId);
    const car = {
      ...item,
      category: 'cars',
      customId: undefined,
      entryPresentation: {
        animationEnabled: true, durationMs: 4_000, fallbackAsset: fallback,
        minimumClientVersion: '1.0.0', performanceTier: 'standard',
        physicalApprovalReceiptId: receiptId, schemaVersion: 1, soundPolicy: 'off',
        visualAsset: visual, visualFormat: 'lottie-json',
      },
      itemId: 'car-1',
      stock: { kind: 'unlimited' },
    };
    const seed = {};
    seedApprovedAsset(seed, visual, 'lottie-json', 'a'.repeat(64), {
      fallbackAssetId: fallback.assetId,
      fallbackAssetVersionId: fallback.assetVersionId,
      usage: 'one-shot',
    });
    seedApprovedAsset(seed, fallback, 'png', 'b'.repeat(64), { usage: 'static' });
    await executeAdminStoreCatalogUpsert({
      db: fakeDb(seed, writes),
      decodedToken: { email: 'admin@example.com', uid: 'admin-1' },
      fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: {
        entryPhysicalApproval: {
          androidDevice: 'Pixel 9', androidPassed: true, controlsSafeZonePassed: true,
          iosDevice: 'iPhone 16', iosPassed: true, notes: 'Safe zone verified.',
          opaqueCompositionPassed: false, testedClientVersion: '1.0.0',
        },
        expectedUpdatedAt: '', item: car, reason: 'Approve entrance motion', requestId: 'request_entry_0001',
      },
    });
    expect(writes.find((write) => write.ref.path === `entryPresentationApprovalReceipts/${receiptId}`)?.data)
      .toMatchObject({
        controlsSafeZonePassed: true,
        copyTemplateVersion: 1,
        presentationSurface: 'bottom-stage',
        status: 'passed',
        visualChecksum: 'a'.repeat(64),
      });
    expect(writes.find((write) => write.ref.path === 'storeCatalog/car-1')?.data.entryPresentation)
      .toMatchObject({ fallbackFormat: 'png', visualFormat: 'lottie-json' });
  });

  it('assigns only the exact approved couple-effect version and strict presentation', async () => {
    const writes = [];
    const reference = { assetId: 'royal-pair', assetVersionId: 'v1-aaaaaaaaaaaa' };
    const pair = {
      ...item,
      category: 'couple-effects',
      cosmeticAsset: reference,
      coupleEffectPresentation: { borderMode: 'static', entranceMode: 'one-shot', profileMode: 'looping' },
      customId: undefined,
      itemId: 'royal-pair-item',
      stock: { kind: 'unlimited' },
    };
    const seed = {};
    seedApprovedAsset(seed, reference, 'png', 'c'.repeat(64), { usage: 'static' }, 'couple-effect');
    await executeAdminStoreCatalogUpsert({
      db: fakeDb(seed, writes),
      decodedToken: { email: 'admin@example.com', uid: 'admin-1' },
      fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: { expectedUpdatedAt: '', item: pair, reason: 'Approve pair effect', requestId: 'request_pair_000001' },
    });
    expect(writes.find((write) => write.ref.path === 'storeCatalog/royal-pair-item')?.data)
      .toMatchObject({ cosmeticAsset: reference, coupleEffectPresentation: pair.coupleEffectPresentation });

    seed[`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`].checksum = 'd'.repeat(64);
    await expect(executeAdminStoreCatalogUpsert({
      db: fakeDb(seed, []),
      decodedToken: { uid: 'admin-1' },
      fieldValue: { serverTimestamp: () => 'SERVER_TIME' },
      input: { expectedUpdatedAt: '', item: pair, reason: 'Forged approval', requestId: 'request_pair_000002' },
    })).rejects.toMatchObject({ status: 409 });
  });
});

function seedApprovedAsset(seed, reference, format, checksum, extra, category = 'entry-effect') {
  seed[`cosmeticAssets/${reference.assetId}`] = {
    approvalId: `${reference.assetId}__${reference.assetVersionId}`,
    approvedVersionId: reference.assetVersionId, assetId: reference.assetId,
    moderationStatus: 'approved', publicationStatus: 'published',
    publishedVersionId: reference.assetVersionId, renderingEnabled: true,
  };
  seed[`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`] = {
    assetId: reference.assetId, assetVersionId: reference.assetVersionId,
    category, format, height: 720, sha256: checksum,
    transparent: format === 'lottie-json', width: 1280,
    ...(['lottie-json', 'mp4'].includes(format) ? { durationMs: 4_000 } : {}),
    ...extra,
  };
  seed[`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`] = {
    assetId: reference.assetId, assetVersionId: reference.assetVersionId,
    checksum, decision: 'approved',
  };
}

function fakeDb(seed, writes) {
  const makeRef = (collection, id) => ({ path: `${collection}/${id}` });
  return {
    collection(collection) { return { doc(id) { return makeRef(collection, id); } }; },
    doc(path) { return { path }; },
    async runTransaction(handler) {
      return handler({
        async getAll(...refs) { return refs.map((ref) => ({ data: () => seed[ref.path], exists: Object.hasOwn(seed, ref.path), ref })); },
        create(ref, data) { writes.push({ kind: 'create', ref, data }); },
        set(ref, data) { writes.push({ kind: 'set', ref, data }); },
      });
    },
  };
}
