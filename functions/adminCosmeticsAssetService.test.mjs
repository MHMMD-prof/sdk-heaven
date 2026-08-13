import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getAdminCosmeticsAssets,
  getAdminPublishedCosmeticAssetOptions,
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

  it('paginates only exact approved, published, compatible versions', async () => {
    const summaries = [
      optionSummary('gift-a', 'v1-aaaaaaaaaaaa'),
      optionSummary('gift-b', 'v1-bbbbbbbbbbbb'),
      optionSummary('gift-c', 'v1-cccccccccccc'),
      optionSummary('gift-disabled', 'v1-dddddddddddd', { renderingEnabled: false }),
      optionSummary('gift-pending', 'v1-eeeeeeeeeeee', { moderationStatus: 'pending' }),
      optionSummary('gift-unpublished', 'v1-111111111111', { publicationStatus: 'unpublished' }),
      optionSummary('gift-stale', 'v1-222222222222', { approvedVersionId: 'v1-333333333333' }),
    ];
    const records = new Map();
    for (const document of summaries) {
      const data = document.data();
      const version = {
        assetId: document.id, assetVersionId: data.publishedVersionId, category: 'gift-effect', durationMs: 3000,
        fallbackAssetId: `${document.id}-fallback`, fallbackAssetVersionId: 'v1-ffffffffffff',
        audioCodec: '', byteSize: 1000, format: document.id === 'gift-b' ? 'lottie-json' : 'mp4', frameRate: 30,
        height: 720, loop: false, sha256: `${document.id}-sum`, storagePath: `cosmetic-assets/platform/${document.id}/${data.publishedVersionId}/source.mp4`,
        transparent: document.id === 'gift-b', usage: 'one-shot', videoCodec: document.id === 'gift-b' ? '' : 'h264', width: 1280,
      };
      records.set(`cosmeticAssets/${document.id}/versions/${data.publishedVersionId}`, snapshot(data.publishedVersionId, version));
      records.set(`cosmeticAssetApprovals/${document.id}__${data.publishedVersionId}`, snapshot(`${document.id}__${data.publishedVersionId}`, {
        assetId: document.id, assetVersionId: data.publishedVersionId, checksum: version.sha256, decision: 'approved',
      }));
      const fallbackId = version.fallbackAssetId;
      const fallbackVersionId = version.fallbackAssetVersionId;
      records.set(`cosmeticAssets/${fallbackId}`, snapshot(fallbackId, {
        approvalId: `${fallbackId}__${fallbackVersionId}`, approvedVersionId: fallbackVersionId,
        moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: fallbackVersionId, renderingEnabled: true,
      }));
      records.set(`cosmeticAssets/${fallbackId}/versions/${fallbackVersionId}`, snapshot(fallbackVersionId, {
        assetId: fallbackId, assetVersionId: fallbackVersionId, category: 'gift-effect', durationMs: 0, format: 'png', height: 720,
        loop: false, sha256: `${fallbackId}-sum`, usage: 'static', width: 1280,
      }));
      records.set(`cosmeticAssetApprovals/${fallbackId}__${fallbackVersionId}`, snapshot(`${fallbackId}__${fallbackVersionId}`, {
        assetId: fallbackId, assetVersionId: fallbackVersionId, checksum: `${fallbackId}-sum`, decision: 'approved',
      }));
    }
    const query = { get: async () => ({ docs: summaries }), limit: () => query, orderBy: () => query, startAfter: () => query, where: () => query };
    const db = {
      collection: () => query,
      doc: (path) => ({ path }),
      getAll: async (...references) => references.map((reference) => records.get(reference.path) || snapshot(reference.path)),
    };

    const first = await getAdminPublishedCosmeticAssetOptions({ db, input: { category: 'gift-effect', cursor: '', formats: ['mp4'], limit: 1 } });
    expect(first.items.map((item) => item.assetId)).toEqual(['gift-a']);
    expect(first.pageInfo).toEqual({ hasNextPage: true, nextCursor: 'gift-a' });
    const second = await getAdminPublishedCosmeticAssetOptions({ db, input: { category: 'gift-effect', cursor: first.pageInfo.nextCursor, formats: ['mp4'], limit: 2 } });
    expect(second.items.map((item) => item.assetId)).toEqual(['gift-c']);
    expect(second.pageInfo.hasNextPage).toBe(false);
  });

  it('excludes sensitive animated bundles whose fallback lacks safety attestations', async () => {
    const primaryId = 'safe-nameplate-motion';
    const primaryVersionId = 'v1-aaaaaaaaaaaa';
    const fallbackId = 'safe-nameplate-fallback';
    const fallbackVersionId = 'v1-bbbbbbbbbbbb';
    const summaries = [snapshot(primaryId, {
      approvalId: `${primaryId}__${primaryVersionId}`,
      approvedVersionId: primaryVersionId,
      category: 'nameplate',
      moderationStatus: 'approved',
      publicationStatus: 'published',
      publishedVersionId: primaryVersionId,
      renderingEnabled: true,
    })];
    const records = new Map([
      [`cosmeticAssets/${primaryId}/versions/${primaryVersionId}`, snapshot(primaryVersionId, {
        assetId: primaryId, assetVersionId: primaryVersionId, category: 'nameplate',
        fallbackAssetId: fallbackId, fallbackAssetVersionId: fallbackVersionId,
        format: 'lottie-json', loop: true, sha256: 'primary-sum', usage: 'looping',
      })],
      [`cosmeticAssetApprovals/${primaryId}__${primaryVersionId}`, snapshot(`${primaryId}__${primaryVersionId}`, {
        assetId: primaryId, assetVersionId: primaryVersionId, authoritySeparationPassed: true,
        checksum: 'primary-sum', decision: 'approved', readableIdentityPassed: true,
      })],
      [`cosmeticAssets/${fallbackId}`, snapshot(fallbackId, {
        approvalId: `${fallbackId}__${fallbackVersionId}`, approvedVersionId: fallbackVersionId,
        moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: fallbackVersionId,
        renderingEnabled: true,
      })],
      [`cosmeticAssets/${fallbackId}/versions/${fallbackVersionId}`, snapshot(fallbackVersionId, {
        assetId: fallbackId, assetVersionId: fallbackVersionId, category: 'nameplate', durationMs: 0,
        format: 'png', loop: false, sha256: 'fallback-sum', usage: 'static',
      })],
      [`cosmeticAssetApprovals/${fallbackId}__${fallbackVersionId}`, snapshot(`${fallbackId}__${fallbackVersionId}`, {
        assetId: fallbackId, assetVersionId: fallbackVersionId, checksum: 'fallback-sum', decision: 'approved',
      })],
    ]);
    const query = { get: async () => ({ docs: summaries }), limit: () => query, orderBy: () => query, startAfter: () => query, where: () => query };
    const db = {
      collection: () => query,
      doc: (path) => ({ path }),
      getAll: async (...references) => references.map((reference) => records.get(reference.path) || snapshot(reference.path)),
    };

    const result = await getAdminPublishedCosmeticAssetOptions({
      db,
      input: { category: 'nameplate', cursor: '', formats: ['lottie-json'], limit: 20 },
    });

    expect(result.items).toEqual([]);
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

function optionSummary(id, versionId, overrides = {}) {
  return snapshot(id, {
    approvalId: `${id}__${versionId}`, approvedVersionId: versionId, category: 'gift-effect', moderationStatus: 'approved',
    publicationStatus: 'published', publishedVersionId: versionId, renderingEnabled: true, ...overrides,
  });
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
