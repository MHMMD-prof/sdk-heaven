import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createCosmeticSubmissionVersionId,
} = require('./cosmeticCustomSubmissionCore');
const {
  approveCosmeticCustomSubmission,
  attestCosmeticCustomSubmission,
  createCosmeticCustomUpload,
  finalizeCosmeticCustomUpload,
  revokeCosmeticCustomEligibility,
  suspendCosmeticCustomSubmission,
} = require('./cosmeticCustomSubmissionService');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_SHA = createHash('sha256').update(PNG_1X1).digest('hex');

const fieldValue = {
  delete: () => ({ __delete: true }),
  serverTimestamp: () => timestamp(9_999),
};
const clock = {
  nowMillis: () => 1_000,
  timestampFromMillis: (value) => timestamp(value),
};

describe('cosmeticCustomSubmissionService', () => {
  it('fails closed when custom submission flags are off', async () => {
    const db = fixture({ flags: false });
    await expect(createCosmeticCustomUpload({
      clock,
      db,
      fieldValue,
      input: pngUploadInput(),
      requestId: 'custom_upload_req_0001',
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('creates an expiring authorization for eligible users only', async () => {
    const db = fixture();
    const created = await createCosmeticCustomUpload({
      clock,
      db,
      fieldValue,
      input: pngUploadInput(),
      requestId: 'custom_upload_req_0002',
      uid: 'u1',
    });
    expect(created.result.submissionId).toMatch(/^submission_/);
    expect(created.result.sourcePath).toContain('cosmetic-submissions/u1/');
    expect(db.documents.get(`cosmeticUploadAuthorizations/u1`)).toMatchObject({
      active: true,
      contentType: 'image/png',
      sizeBytes: PNG_1X1.length,
    });
    expect(timestampMillis(db.documents.get(`cosmeticUploadAuthorizations/u1`).expiresAt))
      .toBe(1_000 + 15 * 60 * 1_000);

    const ineligible = fixture();
    ineligible.documents.delete('cosmeticCustomEligibility/u1');
    await expect(createCosmeticCustomUpload({
      clock,
      db: ineligible,
      fieldValue,
      input: pngUploadInput(),
      requestId: 'custom_upload_req_0003',
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });
  });

  it('rejects forged size/checksum metadata and always rejects MP4', async () => {
    expect(require('./cosmeticCustomSubmissionCore').normalizeCreateCustomUploadInput({
      category: 'entry-effect',
      contentType: 'video/mp4',
      fallbackAssetId: 'entry-static',
      fallbackAssetVersionId: 'v1-abcdef123456',
      format: 'mp4',
      sizeBytes: 1024,
    }).ok).toBe(false);

    const db = fixture();
    const requestId = 'custom_upload_req_0004';
    const created = await createCosmeticCustomUpload({
      clock,
      db,
      fieldValue,
      input: pngUploadInput(),
      requestId,
      uid: 'u1',
    });
    const submissionId = created.result.submissionId;
    const assetVersionId = createCosmeticSubmissionVersionId({ requestId, submissionId, uid: 'u1' });
    const path = `cosmetic-submissions/u1/${submissionId}/${assetVersionId}/source.png`;
    const bucket = fakeBucket({
      [path]: {
        buffer: PNG_1X1,
        metadata: {
          contentType: 'image/png',
          generation: '1',
          metadata: { submissionId, uploaderUid: 'u1' },
          size: PNG_1X1.length + 1,
        },
      },
    });
    await expect(finalizeCosmeticCustomUpload({
      bucket,
      clock,
      db,
      fieldValue,
      input: { submissionId },
      requestId: 'custom_finalize_req_0001',
      safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) },
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'UPLOAD_INVALID' });
  });

  it('requires attestation before pending and binds checksum on approve', async () => {
    const db = fixture();
    const requestId = 'custom_upload_req_0005';
    const created = await createCosmeticCustomUpload({
      clock,
      db,
      fieldValue,
      input: pngUploadInput(),
      requestId,
      uid: 'u1',
    });
    const submissionId = created.result.submissionId;
    const assetVersionId = createCosmeticSubmissionVersionId({ requestId, submissionId, uid: 'u1' });
    const path = `cosmetic-submissions/u1/${submissionId}/${assetVersionId}/source.png`;
    const bucket = fakeBucket({
      [path]: {
        buffer: PNG_1X1,
        metadata: {
          contentType: 'image/png',
          generation: '7',
          metadata: { submissionId, uploaderUid: 'u1' },
          size: PNG_1X1.length,
        },
      },
    });
    await expect(finalizeCosmeticCustomUpload({
      bucket,
      clock,
      db,
      fieldValue,
      input: { submissionId },
      requestId: 'custom_finalize_req_0002',
      safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) },
      uid: 'u1',
    })).resolves.toMatchObject({ result: { sha256: PNG_SHA, status: 'processed' } });

    await expect(attestCosmeticCustomSubmission({
      clock,
      db,
      fieldValue,
      input: { attestation: 'short', submissionId },
      requestId: 'custom_attest_req_0001',
      uid: 'u1',
    })).resolves.toEqual({ errorCode: 'INVALID_REQUEST' });

    await expect(attestCosmeticCustomSubmission({
      clock,
      db,
      fieldValue,
      input: {
        attestation: 'I own this artwork and grant the platform review rights.',
        submissionId,
      },
      requestId: 'custom_attest_req_0002',
      uid: 'u1',
    })).resolves.toMatchObject({ result: { status: 'pending', submissionId } });
    expect(db.documents.get(`cosmeticSubmissions/${submissionId}`).status).toBe('pending');

    const approved = await approveCosmeticCustomSubmission({
      bucket,
      db,
      decodedToken: { email: 'owner@example.com', uid: 'admin-1' },
      fieldValue,
      input: {
        expectedRevision: 2,
        operation: 'approve-custom-submission',
        reason: 'Checksum-bound owner asset',
        requestId: 'custom_approve_req_0001',
        submissionId,
      },
    });
    expect(approved.assetId).toMatch(/^cu-pr-/);
    expect(db.documents.get(`cosmeticAssetApprovals/${approved.assetId}__${approved.assetVersionId}`))
      .toMatchObject({ checksum: PNG_SHA, decision: 'approved', visibility: 'owner-bound' });
    expect(db.documents.get(`cosmeticAssets/${approved.assetId}`)).toMatchObject({
      ownerType: 'user',
      ownerUid: 'u1',
      visibility: 'owner-bound',
      publicationStatus: 'published',
    });
    expect(db.documents.get(`cosmeticCustomOwnerships/u1/items/${approved.assetId}`))
      .toMatchObject({ checksum: PNG_SHA, state: 'active', uid: 'u1' });
    expect(db.documents.has(`storeCatalog/${approved.assetId}`)).toBe(false);
  });

  it('suspends atomically and clears custom equip while preserving store cars', async () => {
    const db = fixture();
    const assetId = 'cu-en-aaaaaaaaaaaaaaaaaaaa';
    db.documents.set('cosmeticSubmissions/submission_suspend_0001', {
      approvedAssetId: assetId,
      assetVersionId: 'v1-123456789abc',
      category: 'entry-effect',
      ownerUid: 'u1',
      revision: 2,
      status: 'approved',
      submissionId: 'submission_suspend_0001',
    });
    db.documents.set(`cosmeticAssets/${assetId}`, {
      assetId,
      publicationStatus: 'published',
      renderingEnabled: true,
      revision: 1,
    });
    db.documents.set(`cosmeticCustomOwnerships/u1/items/${assetId}`, {
      assetId,
      equipped: true,
      state: 'active',
      uid: 'u1',
    });
    db.documents.set('storeEquipment/u1', {
      customCosmetics: {
        entryEffect: {
          assetId,
          assetVersionId: 'v1-123456789abc',
          itemId: assetId,
          source: 'custom',
        },
      },
      slots: { cars: 'store-car' },
      uid: 'u1',
    });
    db.documents.set('storeOwnerships/u1/items/store-car', {
      category: 'cars',
      equipped: true,
      itemId: 'store-car',
      state: 'active',
      uid: 'u1',
    });
    db.documents.set('cosmeticCustomEligibility/u1', {
      ...db.documents.get('cosmeticCustomEligibility/u1'),
      pendingCount: 1,
    });

    await suspendCosmeticCustomSubmission({
      db,
      decodedToken: { email: 'admin@example.com', uid: 'admin-1' },
      fieldValue,
      input: {
        expectedRevision: 2,
        operation: 'suspend-custom-submission',
        reason: 'Policy violation of custom content',
        requestId: 'custom_suspend_req_0001',
        submissionId: 'submission_suspend_0001',
      },
    });

    expect(db.documents.get('cosmeticSubmissions/submission_suspend_0001').status).toBe('suspended');
    expect(db.documents.get(`cosmeticAssets/${assetId}`)).toMatchObject({
      renderingEnabled: false,
      publicationStatus: 'disabled',
    });
    expect(db.documents.get(`cosmeticCustomOwnerships/u1/items/${assetId}`)).toMatchObject({
      equipped: false,
      state: 'suspended',
    });
    expect(db.documents.get('storeEquipment/u1').customCosmetics).toEqual({});
    expect(db.documents.get('storeEquipment/u1').slots).toEqual({ cars: 'store-car' });
    expect(db.documents.get('storeOwnerships/u1/items/store-car').equipped).toBe(true);
    // Approve already left the open-pending set, so suspend must not double-decrement.
    expect(db.documents.get('cosmeticCustomEligibility/u1').pendingCount).toBe(1);
  });

  it('revokes eligibility and clears custom equips without touching store purchases', async () => {
    const db = fixture();
    db.documents.set('storeOwnerships/u1/items/store-frame', {
      category: 'avatar-frames',
      equipped: true,
      itemId: 'store-frame',
      state: 'active',
      uid: 'u1',
    });
    db.documents.set('cosmeticCustomOwnerships/u1/items/cu-pr-aaaaaaaaaaaaaaaaaaaa', {
      assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-123456789abc',
      checksum: 'abc',
      equipped: true,
      state: 'active',
      uid: 'u1',
    });
    db.documents.set('storeEquipment/u1', {
      customCosmetics: {
        profileSkin: {
          assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
          assetVersionId: 'v1-123456789abc',
          itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
          source: 'custom',
        },
      },
      slots: { 'avatar-frames': 'store-frame' },
      uid: 'u1',
    });
    db.documents.set('publicProfiles/u1', {
      ...db.documents.get('publicProfiles/u1'),
      equippedCosmetics: {
        profileSkin: {
          assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
          assetVersionId: 'v1-123456789abc',
          itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const revoked = await revokeCosmeticCustomEligibility({
      db,
      fieldValue,
      reason: 'Abuse of submission quota',
      uid: 'u1',
      updatedByUid: 'admin-1',
    });
    expect(revoked.cleared.cleared).toBe(1);
    expect(db.documents.get('cosmeticCustomEligibility/u1').active).toBe(false);
    expect(db.documents.get('storeOwnerships/u1/items/store-frame')).toMatchObject({
      equipped: true,
      state: 'active',
    });
    expect(db.documents.get('storeEquipment/u1').slots).toEqual({ 'avatar-frames': 'store-frame' });
    expect(db.documents.get('storeEquipment/u1').customCosmetics).toEqual({});
  });
});

function pngUploadInput() {
  return {
    category: 'profile-skin',
    contentType: 'image/png',
    format: 'png',
    sizeBytes: PNG_1X1.length,
  };
}

function fixture({ flags = true } = {}) {
  return new FakeFirestore({
    'appConfig/cosmeticsFeatures': {
      cosmetics_custom_rendering: flags,
      cosmetics_custom_submissions: flags,
    },
    'cosmeticCustomEligibility/u1': {
      active: true,
      categories: ['profile-skin', 'avatar-frame', 'entry-effect'],
      dailyUploadLimit: 5,
      maxPending: 3,
      uid: 'u1',
    },
    'publicProfiles/u1': {
      moderationStatus: 'active',
      publicId: '1111111',
      uid: 'u1',
    },
  });
}

function fakeBucket(files) {
  return {
    file(path) {
      return {
        async delete() { return undefined; },
        async download() {
          const entry = files[path];
          if (!entry) throw new Error('missing');
          return [entry.buffer];
        },
        async getMetadata() {
          const entry = files[path];
          if (!entry) throw new Error('missing');
          return [entry.metadata];
        },
        async save(buffer, options) {
          files[path] = {
            buffer,
            metadata: {
              contentType: options.metadata.contentType,
              generation: '9',
              metadata: options.metadata.metadata,
              size: buffer.length,
            },
          };
        },
      };
    },
  };
}

function timestamp(value = 1) {
  return { toDate: () => new Date(value), toMillis: () => value };
}
function timestampMillis(value) {
  return value?.toMillis?.() ?? Number.NaN;
}
function snapshot(path, data) {
  const ref = { path };
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.queue = Promise.resolve();
  }
  doc(path) {
    return {
      get: async () => snapshot(path, this.documents.get(path)),
      id: path.split('/').at(-1),
      path,
      set: async (data, options = {}) => {
        if (options.merge) {
          this.documents.set(path, { ...(this.documents.get(path) || {}), ...data });
        } else {
          this.documents.set(path, data);
        }
      },
      update: async (data) => {
        this.documents.set(path, { ...(this.documents.get(path) || {}), ...data });
      },
    };
  }
  collection(path) { return new FakeQuery(this, path); }
  async getAll(...refs) { return refs.map((ref) => snapshot(ref.path, this.documents.get(ref.path))); }
  runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ data, kind: 'create', path: ref.path }); }
  delete(ref) { this.operations.push({ kind: 'delete', path: ref.path }); }
  set(ref, data) { this.operations.push({ data, kind: 'set', path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'delete') this.db.documents.delete(operation.path);
      else if (operation.kind === 'create') {
        if (this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
      } else if (operation.kind === 'set') this.db.documents.set(operation.path, operation.data);
      else this.db.documents.set(operation.path, { ...this.db.documents.get(operation.path), ...operation.data });
    }
  }
}

class FakeQuery {
  constructor(db, path, state = {}) { this.db = db; this.path = path; this.state = state; }
  where(field, operator, value) {
    const filters = [...(this.state.filters || [])];
    filters.push({ field, operator, value });
    return new FakeQuery(this.db, this.path, { ...this.state, filters });
  }
  limit(value) { return new FakeQuery(this.db, this.path, { ...this.state, limit: value }); }
  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    for (const filter of this.state.filters || []) {
      if (filter.operator === '==') {
        rows = rows.filter(([, data]) => data?.[filter.field] === filter.value);
      }
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(([path, data]) => snapshot(path, data)), size: rows.length };
  }
}
