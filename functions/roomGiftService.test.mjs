import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createRoomGiftEventId,
  createRoomGiftLedgerId,
} = require('./roomGiftCore');
const { executeRoomGiftCommand } = require('./roomGiftService');
const { createGiftPhysicalApprovalReceiptId } = require('./roomGiftPresentationCore');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomGiftService', () => {
  it('atomically commits a balanced three-leg gift and replays without double spend', async () => {
    const db = seededDb();
    const quote = await quoteGift(db, 'quote_request_00000001');
    const body = sendBody(quote.result.quote.quoteId, 'send_request_000000001');
    const args = {
      body,
      clock,
      db,
      decodedToken: { uid: 'sender-1' },
      fieldValue,
    };
    const first = await executeRoomGiftCommand(args);
    const replay = await executeRoomGiftCommand(args);

    expect(first).toMatchObject({ ok: true, result: { action: 'send-room-gift' } });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: first.result });
    expect(db.read('walletSummaries/sender-1').balances.coins).toBe(800);
    expect(db.read('walletSummaries/target-1').economyBalances.giftEarnings).toBe(180);
    expect(db.read('platformEconomyAccounts/room-gifts')).toMatchObject({
      accountId: 'room-gifts',
      balanceCoins: 20,
      lifetimeRevenueCoins: 20,
    });

    const eventId = createRoomGiftEventId(body.requestId, body.roomId);
    expect(db.read(`rooms/room-1/giftEvents/${eventId}`)).toMatchObject({
      comboCount: 2,
      comboWindowId: expect.stringMatching(/^gcw_[a-f0-9]{24}$/),
      platformShare: 20,
      price: 200,
      recipientCredit: 180,
      reconciliation: {
        balanced: true,
        platformCredit: 20,
        recipientCredit: 180,
        senderDebit: 200,
      },
      roomAvailability: 'active',
      roomStatus: 'active',
      roomVisibility: 'public',
      presentationTier: 'inline',
    });
    expect(db.read(`rooms/room-1/events/${eventId}`).payload).toMatchObject({
      animationEnabled: false,
      comboCount: 2,
      comboWindowExpiresAtMs: nowMs,
      presentationTier: 'inline',
      quantity: 2,
    });
    expect(db.read(`rooms/room-1/events/${eventId}`).payload.comboWindowId)
      .toMatch(/^gcw_[a-f0-9]{24}$/);
    expect(db.read(`roomGiftReceipts/sender-1/items/${eventId}`)).toMatchObject({
      eventId,
      presentationTier: 'inline',
      role: 'sender',
    });
    expect([...db.documents.values()].find((value) => value.comboId)?.comboCount).toBe(2);
    expect(db.read(`walletTransactions/${createRoomGiftLedgerId({
      kind: 'spend',
      requestId: body.requestId,
      roomId: body.roomId,
      uid: 'sender-1',
    })}`)).toMatchObject({ amount: 200, type: 'purchase' });
    expect(db.read(`walletTransactions/${createRoomGiftLedgerId({
      kind: 'earn',
      requestId: body.requestId,
      roomId: body.roomId,
      uid: 'target-1',
    })}`)).toMatchObject({ amount: 180, currency: 'giftEarnings', type: 'credit' });
    expect(db.read(`platformEconomyTransactions/${createRoomGiftLedgerId({
      kind: 'platform',
      requestId: body.requestId,
      roomId: body.roomId,
      uid: 'room-gifts',
    })}`)).toMatchObject({ amount: 20, currency: 'coins', type: 'credit' });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(2);
    expect([...db.documents.keys()].filter((path) => path.startsWith('platformEconomyTransactions/'))).toHaveLength(1);
  });

  it('serializes simultaneous sends and never overdraws the sender', async () => {
    const db = seededDb();
    db.documents.set('walletSummaries/sender-1', wallet('sender-1', 250));
    const quoteOne = await quoteGift(db, 'quote_request_00000002');
    const quoteTwo = await quoteGift(db, 'quote_request_00000003');

    const [first, second] = await Promise.all([
      executeRoomGiftCommand({
        body: sendBody(quoteOne.result.quote.quoteId, 'send_request_000000002'),
        clock,
        db,
        decodedToken: { uid: 'sender-1' },
        fieldValue,
      }),
      executeRoomGiftCommand({
        body: sendBody(quoteTwo.result.quote.quoteId, 'send_request_000000003'),
        clock,
        db,
        decodedToken: { uid: 'sender-1' },
        fieldValue,
      }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      ok: false,
    });
    expect(db.read('walletSummaries/sender-1').balances.coins).toBe(50);
    expect(db.read('walletSummaries/target-1').economyBalances.giftEarnings).toBe(180);
    expect(db.read('platformEconomyAccounts/room-gifts').balanceCoins).toBe(20);
  });

  it('keeps compatible sends in one authoritative combo window and charges each send once', async () => {
    const db = seededDb();
    db.documents.set('appConfig/growthFeatures', { giftCombos: true });

    const firstQuote = await quoteGift(db, 'quote_request_combo_0001');
    const firstBody = sendBody(firstQuote.result.quote.quoteId, 'send_request_combo_00001');
    const first = await executeRoomGiftCommand({
      body: firstBody,
      clock,
      db,
      decodedToken: { uid: 'sender-1' },
      fieldValue,
    });

    const secondQuote = await quoteGift(db, 'quote_request_combo_0002');
    const secondBody = sendBody(secondQuote.result.quote.quoteId, 'send_request_combo_00002');
    const second = await executeRoomGiftCommand({
      body: secondBody,
      clock,
      db,
      decodedToken: { uid: 'sender-1' },
      fieldValue,
    });

    expect(first).toMatchObject({
      ok: true,
      result: { effect: { comboCount: 2, comboSequence: 1 } },
    });
    expect(second).toMatchObject({
      ok: true,
      result: { effect: { comboCount: 4, comboSequence: 2 } },
    });
    expect(first.result.effect.comboWindowId).toMatch(/^gcw_[a-f0-9]{24}$/);
    expect(second.result.effect.comboWindowId).toBe(first.result.effect.comboWindowId);
    expect(second.result.effect.comboWindowExpiresAtMs).toBe(nowMs + 4_000);

    const firstEvent = db.read(`rooms/room-1/events/${first.result.eventId}`);
    const secondEvent = db.read(`rooms/room-1/events/${second.result.eventId}`);
    expect(firstEvent.payload.comboWindowId).toBe(first.result.effect.comboWindowId);
    expect(secondEvent.payload).toMatchObject({
      comboCount: 4,
      comboSequence: 2,
      comboWindowId: first.result.effect.comboWindowId,
    });

    expect(db.read('walletSummaries/sender-1').balances.coins).toBe(600);
    expect(db.read('walletSummaries/target-1').economyBalances.giftEarnings).toBe(360);
    expect(db.read('platformEconomyAccounts/room-gifts').balanceCoins).toBe(40);
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(4);
    expect([...db.documents.keys()].filter((path) => path.startsWith('platformEconomyTransactions/'))).toHaveLength(2);
  });

  it('honors an unexpired quote after policy and catalog changes', async () => {
    const db = seededDb();
    const quote = await quoteGift(db, 'quote_request_00000004');
    db.documents.set('appConfig/roomGiftCommissionPolicy', {
      commissionBps: 5000,
      effectiveAt: timestamp(nowMs),
      version: 2,
    });
    db.documents.set('giftCatalog/rose', {
      ...db.read('giftCatalog/rose'),
      price: 999,
      status: 'disabled',
    });

    const sent = await executeRoomGiftCommand({
      body: sendBody(quote.result.quote.quoteId, 'send_request_000000004'),
      clock,
      db,
      decodedToken: { uid: 'sender-1' },
      fieldValue,
    });
    expect(sent).toMatchObject({ ok: true });
    expect(db.read('walletSummaries/sender-1').balances.coins).toBe(800);
    expect(db.read('platformEconomyAccounts/room-gifts').balanceCoins).toBe(20);
  });

  it('denies blocked gifting before creating a quote', async () => {
    const db = seededDb();
    db.documents.set('blocks/target-1/blocked/sender-1', { createdAt: timestamp() });
    expect(await quoteGift(db, 'quote_request_00000005')).toMatchObject({
      code: 'BLOCKED_RELATIONSHIP',
      ok: false,
      status: 403,
    });
    expect([...db.documents.keys()].filter((path) => path.includes('/giftQuotes/'))).toHaveLength(0);
  });

  it('snapshots an exact approved global presentation and emits it only when separately enabled', async () => {
    const db = seededDb();
    seedAnimatedGift(db, 'global');
    const quote = await quoteGift(db, 'quote_request_animated01');
    expect(quote).toMatchObject({
      ok: true,
      result: { quote: { presentationTier: 'global' } },
    });
    const sent = await executeRoomGiftCommand({
      body: { ...sendBody(quote.result.quote.quoteId, 'send_request_animated001'), clientVersion: '1.0.0' },
      clock,
      db,
      decodedToken: { uid: 'sender-1' },
      fieldValue,
    });
    expect(sent, JSON.stringify(sent)).toMatchObject({
      ok: true,
      result: {
        effect: {
          animationEnabled: true,
          audioEnabled: true,
          copy: {
            itemName: { ar: 'وردة' },
            kind: 'gift',
            quantity: 2,
            recipientDisplayName: 'Target',
            schemaVersion: 1,
            senderDisplayName: 'Sender',
          },
          presentationTier: 'global',
          presentationSurface: 'bottom-stage',
        },
      },
    });
    expect(db.read(`globalRoomEffects/${sent.result.eventId}`)).toMatchObject({
      kind: 'room-gift',
      status: 'ready',
    });
    expect(db.read('walletSummaries/sender-1').balances.coins).toBe(800);
  });
});

function seedAnimatedGift(db, tier) {
  const visual = { assetId: 'gift-motion', assetVersionId: 'v1-aaaaaaaaaaaa' };
  const fallback = { assetId: 'gift-fallback', assetVersionId: 'v1-bbbbbbbbbbbb' };
  const audio = { assetId: 'gift-audio', assetVersionId: 'v1-cccccccccccc' };
  const receiptId = createGiftPhysicalApprovalReceiptId('rose', visual.assetVersionId);
  db.documents.set('appConfig/cosmeticsFeatures', {
    room_gift_animations: true,
    room_gift_audio: true,
    room_gift_global_effects: true,
    room_gift_video: false,
  });
  db.documents.set('appConfig/roomGiftGlobalCampaign', {
    allowedRoomVisibilities: ['public'],
    countryCodes: [],
    enabled: true,
    endsAt: timestamp(nowMs + 60_000),
    giftIds: ['rose'],
    startsAt: timestamp(nowMs - 60_000),
    status: 'active',
  });
  db.documents.set('giftCatalog/rose', {
    ...db.read('giftCatalog/rose'),
    presentation: {
      animationEnabled: true,
      audioAsset: audio,
      durationMs: 3_000,
      fallbackAsset: fallback,
      hapticPolicy: 'light',
      minimumClientVersion: '1.0.0',
      performanceTier: 'standard',
      physicalApprovalReceiptId: receiptId,
      schemaVersion: 1,
      soundPolicy: 'soft',
      tier,
      visualAsset: visual,
    },
  });
  seedAsset(db, visual, 'gift-effect', 'lottie-json', 'a'.repeat(64), { audio, fallback });
  seedAsset(db, fallback, 'gift-effect', 'png', 'b'.repeat(64));
  seedAsset(db, audio, 'effect-audio', 'm4a-aac', 'c'.repeat(64));
  db.documents.set(`giftPresentationApprovalReceipts/${receiptId}`, {
    androidPassed: true,
    androidDevice: 'Pixel 9',
    audioAssetId: audio.assetId,
    audioAssetVersionId: audio.assetVersionId,
    audioChecksum: 'c'.repeat(64),
    controlsSafeZonePassed: true,
    durationMs: 3_000,
    fallbackAssetId: fallback.assetId,
    fallbackAssetVersionId: fallback.assetVersionId,
    fallbackChecksum: 'b'.repeat(64),
    id: receiptId,
    hapticPolicy: 'light',
    iosPassed: true,
    iosDevice: 'iPhone 16',
    minimumClientVersion: '1.0.0',
    performanceTier: 'standard',
    status: 'passed',
    soundPolicy: 'soft',
    testedClientVersion: '1.0.0',
    tier,
    visualAssetId: visual.assetId,
    visualAssetVersionId: visual.assetVersionId,
    visualChecksum: 'a'.repeat(64),
  });
}

function seedAsset(db, reference, category, format, sha256, linked = {}) {
  const animated = format === 'lottie-json' || format === 'mp4';
  const audio = format === 'm4a-aac';
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
    assetId: reference.assetId,
    assetVersionId: reference.assetVersionId,
    category,
    format,
    audioCodec: audio ? 'aac' : '',
    byteSize: audio ? 100_000 : animated ? 500_000 : 100_000,
    durationMs: audio || animated ? 3_000 : 0,
    frameRate: animated ? 30 : 0,
    height: audio ? 0 : 720,
    loop: false,
    ...(linked.fallback ? {
      fallbackAssetId: linked.fallback.assetId,
      fallbackAssetVersionId: linked.fallback.assetVersionId,
    } : {}),
    ...(linked.audio ? {
      audioAssetId: linked.audio.assetId,
      audioAssetVersionId: linked.audio.assetVersionId,
    } : {}),
    sha256,
    transparent: format === 'lottie-json' || format === 'png',
    usage: animated || audio ? 'one-shot' : 'static',
    videoCodec: format === 'mp4' ? 'h264' : '',
    width: audio ? 0 : 1280,
  });
  db.documents.set(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`, {
    assetId: reference.assetId,
    assetVersionId: reference.assetVersionId,
    checksum: sha256,
    decision: 'approved',
  });
}

function quoteGift(db, requestId) {
  return executeRoomGiftCommand({
    body: {
      action: 'quote-room-gift',
      giftId: 'rose',
      quantity: 2,
      requestId,
      roomId: 'room-1',
      targetUid: 'target-1',
    },
    clock,
    db,
    decodedToken: { uid: 'sender-1' },
    fieldValue,
  });
}

function sendBody(quoteId, requestId) {
  return {
    action: 'send-room-gift',
    giftId: 'rose',
    quantity: 2,
    quoteId,
    requestId,
    roomId: 'room-1',
    targetUid: 'target-1',
  };
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/roomGiftCommissionPolicy': {
      commissionBps: 1000,
      effectiveAt: timestamp(nowMs - 1000),
      version: 1,
    },
    'appConfig/voiceRoomFeatures': { voice_room_gifts: true },
    'giftCatalog/rose': {
      assetVersion: '1',
      giftId: 'rose',
      iconKey: 'rose',
      nameAr: 'وردة',
      price: 100,
      scoreValue: 5,
      status: 'available',
    },
    'publicProfiles/sender-1': profile('sender-1', 'Sender'),
    'publicProfiles/target-1': profile('target-1', 'Target'),
    'rooms/room-1': {
      availability: 'active',
      status: 'active',
      visibility: 'public',
    },
    'rooms/room-1/members/sender-1': {
      status: 'active',
      uid: 'sender-1',
    },
    'rooms/room-1/members/target-1': {
      status: 'active',
      uid: 'target-1',
    },
    'walletSummaries/sender-1': wallet('sender-1', 1000),
    'walletSummaries/target-1': wallet('target-1', 0),
  });
}

function profile(uid, displayName) {
  return {
    displayName,
    giftScore: 0,
    moderationStatus: 'active',
    uid,
    updatedAt: timestamp(nowMs - 1000),
  };
}

function wallet(uid, coins) {
  return {
    balances: { coins, diamonds: 0 },
    createdAt: timestamp(nowMs - 1000),
    economyBalances: { gameRewards: 0, giftEarnings: 0, promotions: 0 },
    economyLifetimeCredit: { gameRewards: 0, giftEarnings: 0, promotions: 0 },
    economyLifetimeDebit: { gameRewards: 0, giftEarnings: 0, promotions: 0 },
    lifetimeCredit: { coins, diamonds: 0 },
    lifetimeDebit: { coins: 0, diamonds: 0 },
    uid,
    updatedAt: timestamp(nowMs - 1000),
  };
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
  collection(path) {
    return new FakeQuery(this, path);
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
  update(ref, data) {
    this.operations.push({ data, kind: 'update', path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) {
        throw new Error(`Exists: ${operation.path}`);
      }
      if (operation.kind === 'update' && !this.db.documents.has(operation.path)) {
        throw new Error(`Missing: ${operation.path}`);
      }
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(
        operation.path,
        operation.kind === 'update' || operation.merge
          ? { ...current, ...operation.data }
          : operation.data,
      );
    }
  }
}

class FakeQuery {
  constructor(db, path, limitCount = 50, filters = []) {
    this.db = db;
    this.path = path;
    this.limitCount = limitCount;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, this.limitCount, [
      ...this.filters,
      { field, operator, value },
    ]);
  }
  orderBy() {
    return this;
  }
  limit(count) {
    return new FakeQuery(this.db, this.path, count, this.filters);
  }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => operator === '==' && data[field] === value))
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(path) {
  return {
    collection(name) {
      return {
        doc: (id) => makeRef(`${path}/${name}/${id}`),
      };
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
