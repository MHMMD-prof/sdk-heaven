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

  it.each([
    ['offline status', (presence) => { presence.status = 'offline'; }],
    ['expired lease', (presence) => { presence.leaseExpiresAt = timestamp(nowMs); }],
    ['future join timestamp', (presence) => { presence.joinedAt = timestamp(nowMs + 1); }],
  ])('requires genuine current presence when %s', async (_label, mutate) => {
    const db = seededDb();
    mutate(db.documents.get('rooms/room-1/presence/user-1'));

    expect(await execute(db, body(`presence_rejected_${_label.replace(/\s/g, '_')}_0001`)))
      .toMatchObject({ code: 'SESSION_MISMATCH', ok: false, status: 409 });
    expect(paths(db, '/events/')).toHaveLength(0);
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(0);
  });

  it('does not create another event when the same presence session reconnects', async () => {
    const db = seededDb();
    const first = await execute(db, body('entryfx_reconnect_00001'));
    db.documents.get('rooms/room-1/presence/user-1').status = 'reconnecting';
    db.documents.get('rooms/room-1/presence/user-1').leaseExpiresAt = timestamp(nowMs + 60_000);
    const replay = await execute(db, body('entryfx_reconnect_00002'));

    expect(first).toMatchObject({ ok: true, result: { reason: 'ANNOUNCED' } });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(paths(db, '/events/')).toHaveLength(1);
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(1);
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
    db.documents.set('rooms/room-1/coupleEntryClaims/old-pair-claim', { purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/entryEffectRateLimits/old-rate', { purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/events/old-event', { kind: 'room-entry', purgeAfter: timestamp(nowMs - 1) });
    db.documents.set('rooms/room-1/events/future-event', { kind: 'room-entry', purgeAfter: timestamp(nowMs + 1) });

    expect(await cleanupExpiredRoomEntryEffectRecords({ clock, db })).toEqual({ deleted: 5, scanned: 5 });
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

  it('delivers the exact approved static fallback when entry motion is disabled', async () => {
    const db = seededDb();
    seedApprovedEntryBundle(db);
    db.documents.get('appConfig/cosmeticsFeatures').room_entry_animations = false;

    const result = await execute(db, body('entryfx_static_fallback_0001'));
    expect(result).toMatchObject({
      ok: true,
      result: {
        effect: {
          animationEnabled: false,
          cosmeticAsset: {
            assetId: 'royal-entry-static',
            assetVersionId: 'v1-bbbbbbbbbbbb',
          },
          presentationSurface: 'bottom-stage',
        },
      },
    });
    expect(result.result.effect.assetSnapshot).toMatchObject({
      fallbackAsset: { assetId: 'royal-entry-static', assetVersionId: 'v1-bbbbbbbbbbbb' },
      visualAsset: { assetId: 'royal-entry', assetVersionId: 'v1-aaaaaaaaaaaa' },
    });
  });

  it('coalesces concurrent couple entries into one pair event and one rate-limit debit', async () => {
    const db = seededDb();
    seedActiveCoupleEntrance(db);
    const [first, second] = await Promise.all([
      execute(db, body('couple_entry_request_0001'), 'user-1'),
      execute(db, {
        ...body('couple_entry_request_0002'),
        sessionId: 'presence_session_0002',
      }, 'user-2'),
    ]);
    expect(first).toMatchObject({ ok: true, result: { pairEntrance: true } });
    expect(second).toMatchObject({ ok: true, result: { pairEntrance: true } });
    expect(paths(db, '/events/')).toHaveLength(1);
    expect(paths(db, '/coupleEntryClaims/')).toHaveLength(1);
    expect(paths(db, '/entryEffectClaims/')).toHaveLength(2);
    expect(paths(db, '/entryEffectRateLimits/')).toHaveLength(1);
    const event = db.read(`rooms/room-1/events/${first.result.eventId}`);
    expect(event.payload).toEqual(expect.objectContaining({
      assetId: 'couple-entry',
      assetVersionId: 'v1-cccccccccccc',
      coupleEntrance: true,
      memberDisplayNames: ['Ali', 'Noor'],
      memberUids: ['user-1', 'user-2'],
    }));
    expect(event.payload).not.toHaveProperty('coupleIdHash');
    expect(event.payload).not.toHaveProperty('relationshipId');
  });

  it.each([
    ['pair flag off', (db) => { db.documents.set('appConfig/cosmeticsFeatures', { cosmetics_couple_effects: true, cosmetics_couple_entrances: false }); }],
    ['stale public pair', (db) => { db.documents.get('publicProfiles/user-2').coupleEffect.coupleIdHash = 'f'.repeat(64); }],
    ['disabled exact asset', (db) => { db.documents.get('cosmeticAssets/couple-entry').renderingEnabled = false; }],
    ['expired ownership', (db) => { db.documents.get(`coupleEffectOwnerships/rel_${'b'.repeat(40)}/items/couple-fx`).expiresAt = timestamp(nowMs); }],
    ['outside entrance window', (db) => { db.documents.get('rooms/room-1/presence/user-2').joinedAt = timestamp(nowMs - 8_001); }],
    ['partner is only present in another room', (db) => {
      const partnerPresence = db.documents.get('rooms/room-1/presence/user-2');
      db.documents.delete('rooms/room-1/presence/user-2');
      db.documents.set('rooms/room-2/presence/user-2', partnerPresence);
    }],
  ])('falls back to the individual entrance when %s', async (_label, mutate) => {
    const db = seededDb();
    seedActiveCoupleEntrance(db);
    mutate(db);
    const result = await execute(db, body(`fallback_${_label.replace(/\s/g, '_')}_0001`), 'user-1');
    expect(result).toMatchObject({
      ok: true,
      result: { announced: true, reason: 'ANNOUNCED' },
    });
    expect(result.result).not.toHaveProperty('pairEntrance');
    expect(paths(db, '/events/')).toHaveLength(1);
    expect(paths(db, '/coupleEntryClaims/')).toHaveLength(0);
  });
});

function execute(db, requestBody, uid = 'user-1') {
  return executeRoomEntryEffectCommand({
    body: requestBody,
    clock,
    db,
    decodedToken: { uid },
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
      joinedAt: timestamp(nowMs - 1_000),
      leaseExpiresAt: timestamp(nowMs + 45_000),
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

function seedActiveCoupleEntrance(db) {
  const relationshipId = `rel_${'b'.repeat(40)}`;
  const coupleIdHash = require('./coupleEffectsCore').createCoupleIdHash(relationshipId);
  const projection = {
    assetId: 'couple-entry',
    assetVersionId: 'v1-cccccccccccc',
    borderMode: 'looping',
    coupleIdHash,
    entranceMode: 'one-shot',
    fallbackAssetId: 'couple-entry-static',
    fallbackAssetVersionId: 'v1-dddddddddddd',
    format: 'lottie-json',
    itemId: 'couple-fx',
    profileMode: 'looping',
  };
  db.documents.set('appConfig/cosmeticsFeatures', {
    cosmetics_couple_effects: true,
    cosmetics_couple_entrances: true,
  });
  db.documents.set('couples/couple-1', {
    createdAt: timestamp(nowMs - 100_000),
    memberUids: ['user-1', 'user-2'],
    relationshipId,
  });
  db.documents.set('coupleMemberships/user-1', {
    coupleId: 'couple-1', partnerUid: 'user-2', relationshipId, uid: 'user-1',
  });
  db.documents.set('coupleMemberships/user-2', {
    coupleId: 'couple-1', partnerUid: 'user-1', relationshipId, uid: 'user-2',
  });
  db.documents.set('publicProfiles/user-1', {
    ...db.read('publicProfiles/user-1'),
    coupleEffect: projection,
  });
  db.documents.set('publicProfiles/user-2', {
    coupleEffect: projection,
    displayName: 'Noor',
    moderationStatus: 'active',
    uid: 'user-2',
  });
  db.documents.set('rooms/room-1/members/user-2', { status: 'active', uid: 'user-2' });
  db.documents.set('rooms/room-1/presence/user-1', {
    ...db.read('rooms/room-1/presence/user-1'),
    joinedAt: timestamp(nowMs - 1_000),
    leaseExpiresAt: timestamp(nowMs + 30_000),
  });
  db.documents.set('rooms/room-1/presence/user-2', {
    joinedAt: timestamp(nowMs - 500),
    leaseExpiresAt: timestamp(nowMs + 30_000),
    sessionId: 'presence_session_0002',
    status: 'online',
    uid: 'user-2',
  });
  db.documents.set(`coupleEffectEquipment/${relationshipId}`, {
    coupleId: 'couple-1',
    itemId: 'couple-fx',
    memberUids: ['user-1', 'user-2'],
    projection,
    relationshipId,
    state: 'equipped',
  });
  db.documents.set(`coupleEffectOwnerships/${relationshipId}/items/couple-fx`, {
    equipped: true,
    itemId: 'couple-fx',
    kind: 'couple-effect-ownership',
    memberUids: ['user-1', 'user-2'],
    ownershipId: 'couple-fx',
    purchaserUid: 'user-1',
    relationshipId,
    state: 'active',
  });
  db.documents.set('storeCatalog/couple-fx', {
    availability: 'available',
    category: 'couple-effects',
    cosmeticAsset: { assetId: 'couple-entry', assetVersionId: 'v1-cccccccccccc' },
    coupleEffectPresentation: {
      borderMode: 'looping', entranceMode: 'one-shot', profileMode: 'looping',
    },
    description: { ar: 'دخول ثنائي', en: 'Couple entrance' },
    duration: { kind: 'permanent' },
    itemId: 'couple-fx',
    name: { ar: 'دخول ثنائي', en: 'Couple entrance' },
    order: 2,
    previewAssetUrl: 'https://cdn.example.test/couple-entry-preview.png',
    prices: { coins: 100 },
    purchasingEnabled: true,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'https://cdn.example.test/couple-entry-thumbnail.png',
  });
  seedCoupleAsset(db, 'couple-entry', 'v1-cccccccccccc', 'lottie-json', 'c'.repeat(64), {
    fallbackAssetId: 'couple-entry-static',
    fallbackAssetVersionId: 'v1-dddddddddddd',
  });
  seedCoupleAsset(db, 'couple-entry-static', 'v1-dddddddddddd', 'png', 'd'.repeat(64));
}

function seedCoupleAsset(db, assetId, assetVersionId, format, checksum, extra = {}) {
  db.documents.set(`cosmeticAssets/${assetId}`, {
    approvalId: `${assetId}__${assetVersionId}`,
    approvedVersionId: assetVersionId,
    assetId,
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: assetVersionId,
    renderingEnabled: true,
  });
  db.documents.set(`cosmeticAssets/${assetId}/versions/${assetVersionId}`, {
    assetId, assetVersionId, category: 'couple-effect', format, sha256: checksum, ...extra,
  });
  db.documents.set(`cosmeticAssetApprovals/${assetId}__${assetVersionId}`, {
    assetId, assetVersionId, checksum, decision: 'approved',
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
