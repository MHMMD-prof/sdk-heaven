import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getAdminCosmeticsAssets,
  mutateAdminCosmeticsAsset,
  reconcileCosmeticAssetRegistryBatch,
} = require('./adminCosmeticsAssetService');

function snapshot(id, data) {
  return { data: () => data, exists: Boolean(data), id };
}

describe('admin cosmetics asset service', () => {
  it('filters the bounded registry listing without composite filter indexes', async () => {
    const documents = [
      snapshot('frame-one', { category: 'avatar-frame', moderationStatus: 'approved', publicationStatus: 'published' }),
      snapshot('theme-one', { category: 'room-theme', moderationStatus: 'pending', publicationStatus: 'unpublished' }),
    ];
    const query = {
      get: async () => ({ docs: documents }),
      limit: (limit) => {
        expect(limit).toBe(100);
        return query;
      },
    };
    const result = await getAdminCosmeticsAssets({
      db: { collection: () => query },
      input: {
        assetId: '',
        category: 'avatar-frame',
        limit: 25,
        moderationStatus: 'approved',
        publicationStatus: 'published',
      },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].id).toBe('frame-one');
  });

  it('dry-runs reconciliation and disables only invalid published pointers on apply', async () => {
    const updates = [];
    const assetDocuments = [
      registryDocument('valid-asset', 'v1-good', true),
      registryDocument('broken-asset', 'v1-bad', false),
    ];
    const query = {
      get: async () => ({ docs: assetDocuments }),
      limit: () => query,
      where: () => query,
    };
    const db = {
      batch: () => ({
        commit: async () => undefined,
        update: (ref, data) => updates.push({ data, ref }),
      }),
      collection: () => query,
      doc: (path) => ({
        get: async () => path.includes('valid-asset')
          ? snapshot(path, { checksum: 'sum', decision: 'approved', storagePath: 'path' })
          : snapshot(path),
        path,
      }),
    };

    const dryRun = await reconcileCosmeticAssetRegistryBatch({ db });
    expect(dryRun).toMatchObject({ applied: false, invalid: 1, scanned: 2 });
    expect(updates).toHaveLength(0);

    const applied = await reconcileCosmeticAssetRegistryBatch({
      apply: true,
      db,
      fieldValue: { serverTimestamp: () => 'server-time' },
    });
    expect(applied.invalid).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].ref.id).toBe('broken-asset');
    expect(updates[0].data).toMatchObject({
      publicationStatus: 'disabled',
      renderingEnabled: false,
      revision: 4,
    });
  });

  it('creates an immutable approval, audit, idempotent replay, and published pointer', async () => {
    const db = transactionalDb({
      'cosmeticAssets/gold-frame': {
        assetId: 'gold-frame',
        category: 'avatar-frame',
        moderationStatus: 'pending',
        publicationStatus: 'unpublished',
        renderingEnabled: false,
        revision: 1,
      },
      'cosmeticAssets/gold-frame/versions/v1-aaaaaaaaaaaa': {
        assetId: 'gold-frame',
        assetVersionId: 'v1-aaaaaaaaaaaa',
        byteSize: 80,
        category: 'avatar-frame',
        sha256: 'abc123',
        storagePath: 'cosmetic-assets/platform/gold-frame/v1-aaaaaaaaaaaa/source.png',
        validationReceiptId: 'validation_gold-frame_v1-aaaaaaaaaaaa',
      },
      'cosmeticAssetValidationReceipts/validation_gold-frame_v1-aaaaaaaaaaaa': {
        sha256: 'abc123',
        status: 'passed',
      },
    });
    const common = {
      db,
      decodedToken: { email: 'owner@example.test', uid: 'owner-1' },
      fieldValue: { serverTimestamp: () => 'server-time' },
    };
    const approve = {
      assetId: 'gold-frame',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      expectedRevision: 1,
      operation: 'approve-version',
      reason: 'Reviewed source and fallback.',
      requestId: 'approve_gold_frame_0001',
    };

    const approved = await mutateAdminCosmeticsAsset({ ...common, input: approve });
    expect(approved).toMatchObject({ replayed: false, revision: 2 });
    expect(db.read('cosmeticAssetApprovals/gold-frame__v1-aaaaaaaaaaaa'))
      .toMatchObject({ decision: 'approved', checksum: 'abc123' });
    expect(db.read('adminAuditEvents/cosmetic_asset_approve_gold_frame_0001'))
      .toMatchObject({ actorUid: 'owner-1', status: 'completed' });

    const replay = await mutateAdminCosmeticsAsset({ ...common, input: approve });
    expect(replay).toMatchObject({ replayed: true, revision: 2 });

    const published = await mutateAdminCosmeticsAsset({
      ...common,
      input: {
        ...approve,
        expectedRevision: 2,
        operation: 'publish-version',
        requestId: 'publish_gold_frame_001',
      },
    });
    expect(published.revision).toBe(3);
    expect(db.read('cosmeticAssets/gold-frame')).toMatchObject({
      publicationStatus: 'published',
      publishedVersionId: 'v1-aaaaaaaaaaaa',
      renderingEnabled: true,
      revision: 3,
    });
  });

  it('requires immutable readability and authority-separation attestations for nameplates', async () => {
    const db = transactionalDb({
      'cosmeticAssets/safe-nameplate': { assetId: 'safe-nameplate', category: 'nameplate', moderationStatus: 'pending', publicationStatus: 'unpublished', renderingEnabled: false, revision: 1 },
      'cosmeticAssets/safe-nameplate/versions/v1-bbbbbbbbbbbb': {
        assetId: 'safe-nameplate', assetVersionId: 'v1-bbbbbbbbbbbb', byteSize: 80, category: 'nameplate', sha256: 'safe123',
        storagePath: 'cosmetic-assets/platform/safe-nameplate/v1-bbbbbbbbbbbb/source.png', validationReceiptId: 'validation_safe-nameplate_v1-bbbbbbbbbbbb',
      },
      'cosmeticAssetValidationReceipts/validation_safe-nameplate_v1-bbbbbbbbbbbb': { sha256: 'safe123', status: 'passed' },
    });
    const common = { db, decodedToken: { email: 'owner@example.test', uid: 'owner-1' }, fieldValue: { serverTimestamp: () => 'server-time' } };
    const input = {
      assetId: 'safe-nameplate', assetVersionId: 'v1-bbbbbbbbbbbb', expectedRevision: 1, operation: 'approve-version',
      reason: 'Reviewed identity safety.', requestId: 'approve_nameplate_001',
    };
    await expect(mutateAdminCosmeticsAsset({ ...common, input })).rejects.toThrow('readability and authority-separation');
    await expect(mutateAdminCosmeticsAsset({ ...common, input: { ...input, authoritySeparationPassed: true, readableIdentityPassed: true } })).resolves.toMatchObject({ revision: 2 });
    expect(db.read('cosmeticAssetApprovals/safe-nameplate__v1-bbbbbbbbbbbb')).toMatchObject({ authoritySeparationPassed: true, readableIdentityPassed: true });
  });
});

function registryDocument(id, versionId, valid) {
  const version = valid
    ? snapshot(versionId, { sha256: 'sum', storagePath: 'path' })
    : snapshot(versionId);
  return {
    data: () => ({ publishedVersionId: versionId, renderingEnabled: true, revision: 3 }),
    id,
    ref: {
      collection: () => ({ doc: () => ({ get: async () => version }) }),
      id,
    },
  };
}

function transactionalDb(seed) {
  const values = new Map(Object.entries(seed));
  const ref = (path) => ({
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    id: path.split('/').at(-1),
    path,
  });
  const snap = (reference) => snapshot(reference.id, values.get(reference.path));
  return {
    doc: ref,
    read: (path) => values.get(path),
    runTransaction: async (callback) => callback({
      create: (reference, data) => {
        if (values.has(reference.path)) throw new Error(`Already exists: ${reference.path}`);
        values.set(reference.path, data);
      },
      get: async (reference) => snap(reference),
      getAll: async (...references) => references.map(snap),
      set: (reference, data) => values.set(reference.path, data),
    }),
  };
}
