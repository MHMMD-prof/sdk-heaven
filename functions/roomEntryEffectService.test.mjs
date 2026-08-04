import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredRoomEntryEffectRecords,
  executeRoomEntryEffectCommand,
} = require('./roomEntryEffectService');
const { createEntryPhysicalApprovalReceiptId } = require('./roomEntryPresentationCore');
const { ROOM_ENTRY_EFFECT_RATE_LIMIT } = require('./voiceRoomRateLimitCore');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomEntryEffectService', () => {
  it('atomically announces once and does not amplify writes for new replay request IDs', async () => {
    const db = seededDb();
    const first = await execute(db, body('entryfx_request_00001'));
    const replay = await execute(db, body('entryfx_request_00002'));

    expect(first).toMatchObject({
      ok: true,
      result: { announced: true, reason: 'ANNOUNCED', skipped: false },
    });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      result: { announced: true, skipped: false },
    });
    expect(paths(db, '/events/')).toHaveLength(1);
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(1);
    expect(paths(db, '/entryEffectRequests/')).toHaveLength(1);
    expect(db.read('rooms/room-1/entryEffectRateLimits/user-1')).toMatchObject({
      count: 1,
      uid: 'user-1',
    });
  });

  it('serializes concurrent requests into one event and one claim', async () => {
    const db = seededDb();
    const [first, second] = await Promise.all([
      execute(db, body('entryfx_request_00003')),
      execute(db, body('entryfx_request_00004')),
    ]);

    expect([first, second].filter((result) => result.result?.reason === 'ANNOUNCED')).toHaveLength(1);
    expect(paths(db, '/events/')).toHaveLength(1);
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(1);
    expect(paths(db, '/entryEffectRequests/')).toHaveLength(1);
  });

  it('rejects a stale presence session before creating operational documents', async () => {
    const db = seededDb();
    const result = await execute(db, {
      ...body('entryfx_request_00005'),
      sessionId: 'presence_session_stale_0001',
    });

    expect(result).toMatchObject({ code: 'SESSION_MISMATCH', ok: false, status: 409 });
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(0);
    expect(paths(db, '/entryEffectRequests/')).toHaveLength(0);
  });

  it('rate limits repeated rejected ownership checks', async () => {
    const db = seededDb();
    db.documents.set('storeOwnerships/user-1/items/car-1', {
      category: 'cars',
      itemId: 'car-1',
      state: 'inactive',
      uid: 'user-1',
    });
    for (let index = 0; index < ROOM_ENTRY_EFFECT_RATE_LIMIT; index += 1) {
      const result = await execute(db, body(`entryfx_denied_${String(index).padStart(4, '0')}`));
      expect(result).toMatchObject({ code: 'OWNERSHIP_INACTIVE', ok: false });
    }
    expect(await execute(db, body('entryfx_denied_limit_0001')))
      .toMatchObject({ code: 'RATE_LIMITED', ok: false, status: 429 });
  });

  it('deletes expired requests, claims, rate limits, and room events', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-1/entryEffectRequests/old-request', { purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/entryEffectClaims/old-claim', { purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/entryEffectRateLimits/old-rate', { purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/events/old-event', { kind: 'room-entry', purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/events/future-event', { kind: 'room-entry', purgeAfter: timestamp(nowMs + 1) });

    expect(await cleanupExpiredRoomEntryEffectRecords({ clock, db })).toEqual({ deleted: 4, scanned: 4 });
    expect(db.read('rooms/room-1/events/future-event')).toBeDefined();
    expect(db.read('rooms/room-1/events/old-event')).toBeUndefined();
  });

  it('snapshots the exact approved canonical entry version when dark flags are enabled', async () => {
    const db = seededDb();
    seedApprovedEntryBundle(db);
    const result = await execute(db, body('entryfx_motion_00001'));
    expect(result).toMatchObject({
      ok: true,
      result: {
        effect: {
          animationEnabled: true,
          audioEnabled: false,
          canonicalSlot: 'entry-effect',
          cosmeticAsset: {
            assetId: 'royal-entry',
            assetVersionId: 'v1-aaaaaaaaaaaa',
          },
          legacyEquipmentSlot: 'cars',
          visualFormat: 'lottie-json',
        },
      },
    });
    const event = db.read(`rooms/room-1/events/${result.result.eventId}`);
    expect(event.payload.assetSnapshot).toMatchObject({
      physicalApprovalReceiptId: createEntryPhysicalApprovalReceiptId('car-1', 'v1-aaaaaaaaaaaa'),
      visualAsset: { assetId: 'royal-entry', assetVersionId: 'v1-aaaaaaaaaaaa' },
    });
  });
});

function execute(db, requestBody) {
  return executeRoomEntryEffectCommand({
    body: requestBody,
    clock,
    db,
    decodedToken: { uid: 'user-1' },
    fieldValue,
  });
}

function body(requestId) {
  return {
    action: 'announce-entry-effect',
    clientVersion: '1.0.0',
    requestId,
    roomId: 'room-1',
    sessionId: 'presence_session_0001',
  };
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': { voice_room_entry_effects: true },
    'publicProfiles/user-1': {
      displayName: 'Ali',
      moderationStatus: 'active',
      uid: 'user-1',
    },
    'rooms/room-1': {
      availability: 'active',
      effectsPolicy: 'full',
      status: 'active',
    },
    'rooms/room-1/members/user-1': {
      status: 'active',
      uid: 'user-1',
    },
    'rooms/room-1/presence/user-1': {
      sessionId: 'presence_session_0001',
      status: 'online',
      uid: 'user-1',
    },
    'storeCatalog/car-1': {
      availability: 'available',
      category: 'cars',
      description: { ar: 'سيارة دخول', en: 'Entry car' },
      duration: { kind: 'permanent' },
      itemId: 'car-1',
      name: { ar: 'سيارة الظل', en: 'Shadow Car' },
      order: 1,
      previewAssetUrl: 'https://firebasestorage.googleapis.com/v0/b/test/o/store-assets%2Fcar-1%2Fpreview%2Fversion_00000001',
      prices: { coins: 100 },
      purchasingEnabled: true,
      stock: { kind: 'unlimited' },
      thumbnailUrl: 'https://firebasestorage.googleapis.com/v0/b/test/o/store-assets%2Fcar-1%2Fthumbnail%2Fversion_00000001',
    },
    'storeEquipment/user-1': { slots: { cars: 'car-1' }, uid: 'user-1' },
    'storeOwnerships/user-1/items/car-1': {
      category: 'cars',
      itemId: 'car-1',
      state: 'active',
      uid: 'user-1',
    },
  });
}

function seedApprovedEntryBundle(db) {
  const visual = { assetId: 'royal-entry', assetVersionId: 'v1-aaaaaaaaaaaa' };
  const fallback = { assetId: 'royal-entry-static', assetVersionId: 'v1-bbbbbbbbbbbb' };
  const receiptId = createEntryPhysicalApprovalReceiptId('car-1', visual.assetVersionId);
  db.documents.set('appConfig/cosmeticsFeatures', {
    room_entry_animations: true,
    room_entry_audio: false,
    room_entry_video: false,
  });
  db.documents.set('storeCatalog/car-1', {
    ...db.read('storeCatalog/car-1'),
    entryPresentation: {
      animationEnabled: true,
      durationMs: 4_000,
      fallbackAsset: fallback,
      minimumClientVersion: '1.0.0',
      performanceTier: 'standard',
      physicalApprovalReceiptId: receiptId,
      schemaVersion: 1,
      soundPolicy: 'off',
      visualAsset: visual,
      visualFormat: 'lottie-json',
    },
  });
  seedAsset(db, visual, 'lottie-json', 'a'.repeat(64), {
    fallbackAssetId: fallback.assetId,
    fallbackAssetVersionId: fallback.assetVersionId,
    usage: 'one-shot',
  });
  seedAsset(db, fallback, 'png', 'b'.repeat(64), { usage: 'static' });
  db.documents.set(`entryPresentationApprovalReceipts/${receiptId}`, {
    androidDevice: 'Pixel 9', androidPassed: true, controlsSafeZonePassed: true,
    durationMs: 4_000, fallbackAssetId: fallback.assetId,
    fallbackAssetVersionId: fallback.assetVersionId, fallbackChecksum: 'b'.repeat(64),
    id: receiptId, iosDevice: 'iPhone 16', iosPassed: true, minimumClientVersion: '1.0.0',
    opaqueCompositionPassed: false, performanceTier: 'standard', soundPolicy: 'off',
    status: 'passed', testedClientVersion: '1.0.0', visualAssetId: visual.assetId,
    visualAssetVersionId: visual.assetVersionId, visualChecksum: 'a'.repeat(64),
  });
}

function seedAsset(db, reference, format, checksum, extra) {
  db.documents.set(`cosmeticAssets/${reference.assetId}`, {
    approvalId: `${reference.assetId}__${reference.assetVersionId}`,
    approvedVersionId: reference.assetVersionId,
    assetId: reference.assetId,
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: reference.assetVersionId,
    renderingEnabled: true,
  });
  db.documents.set(`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`, {
    assetId: reference.assetId, assetVersionId: reference.assetVersionId,
    category: 'entry-effect', format, height: 720, sha256: checksum,
    transparent: format === 'lottie-json', width: 1280,
    ...(['lottie-json', 'mp4'].includes(format) ? { durationMs: 4_000 } : {}),
    ...extra,
  });
  db.documents.set(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`, {
    assetId: reference.assetId, assetVersionId: reference.assetVersionId,
    checksum, decision: 'approved',
  });
}

function paths(db, fragment) {
  return [...db.documents.keys()].filter((path) => path.includes(fragment));
}

function timestamp(value = nowMs) {
  return {
    toDate: () => new Date(value),
    toMillis: () => value,
  };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) {
    return makeRef(path);
  }
  collectionGroup(name) {
    return new FakeQuery(this, name, true);
  }
  batch() {
    const deleted = [];
    return {
      commit: async () => {
        deleted.forEach((path) => this.documents.delete(path));
      },
      delete: (ref) => deleted.push(ref.path),
    };
  }
  read(path) {
    return this.documents.get(path);
  }
  async runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }
  async get(ref) {
    return snapshot(ref.path, this.db.documents.get(ref.path));
  }
  create(ref, data) {
    this.operations.push({ data, kind: 'create', path: ref.path });
  }
  set(ref, data, options) {
    this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) {
        throw new Error(`Exists: ${operation.path}`);
      }
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(operation.path, operation.merge ? { ...current, ...operation.data } : operation.data);
    }
  }
}

class FakeQuery {
  constructor(db, name, collectionGroup = false, limitCount = 300, filters = []) {
    this.db = db;
    this.name = name;
    this.collectionGroup = collectionGroup;
    this.limitCount = limitCount;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.name, this.collectionGroup, this.limitCount, [
      ...this.filters,
      { field, operator, value },
    ]);
  }
  orderBy() {
    return this;
  }
  limit(count) {
    return new FakeQuery(this.db, this.name, this.collectionGroup, count, this.filters);
  }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => {
        const parts = path.split('/');
        return this.collectionGroup && parts.at(-2) === this.name;
      })
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => {
        if (operator !== '<=') return false;
        return data[field]?.toMillis?.() <= value.toMillis();
      }))
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(path) {
  return {
    collection(name) {
      return { doc: (id) => makeRef(`${path}/${name}/${id}`) };
    },
    id: path.split('/').at(-1),
    path,
  };
}

function snapshot(path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeRef(path),
  };
}
