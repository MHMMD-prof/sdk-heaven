import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createRelationshipId } = require('./coupleEffectsCore');
const {
  applyDissolutionClear,
  clearSuspendedCoupleEffects,
  equipCoupleEffect,
  prepareDissolutionClear,
  purchaseCoupleEffect,
  reconcileCoupleEffects,
} = require('./coupleEffectsService');

const fieldValue = {
  delete: () => ({ __delete: true }),
  serverTimestamp: () => timestamp(9_999),
};
const clock = {
  nowMillis: () => 1_000,
  timestampFromMillis: (value) => timestamp(value),
};

describe('couple effects authority and lifecycle', () => {
  it('debits one purchaser once and replays the pair-scoped result', async () => {
    const db = fixture();
    const command = purchaseCommand(db, 'purchase_couple_0001');
    const first = await purchaseCoupleEffect(command);
    const replay = await purchaseCoupleEffect(command);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ result: { balances: { coins: 60, diamonds: 10 }, itemId: 'royal-pair' } });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(1);
    expect(db.documents.get('walletSummaries/u1').balances.coins).toBe(60);
    const firstProjection = db.documents.get('publicProfiles/u1').coupleEffect;
    expect(db.documents.get('publicProfiles/u2').coupleEffect).toEqual(firstProjection);
    expect(firstProjection).not.toHaveProperty('partnerUid');
    expect(firstProjection).toMatchObject({
      assetId: 'royal-pair',
      assetVersionId: 'v1-123456789abc',
      format: 'png',
      itemId: 'royal-pair',
    });
  });

  it('rejects stale relationship history and forged canonical assets', async () => {
    const stale = fixture();
    stale.documents.get('coupleMemberships/u2').relationshipId = createRelationshipId('couple-1', 'future-relationship');
    await expect(purchaseCoupleEffect(purchaseCommand(stale, 'purchase_couple_0002')))
      .resolves.toEqual({ errorCode: 'STALE_RELATIONSHIP' });

    const forged = fixture();
    forged.documents.get('cosmeticAssets/royal-pair/versions/v1-123456789abc').category = 'avatar-frame';
    await expect(purchaseCoupleEffect(purchaseCommand(forged, 'purchase_couple_0003')))
      .resolves.toEqual({ errorCode: 'ITEM_UNAVAILABLE' });
    expect(forged.documents.has('walletTransactions/u1_purchase_couple_0003')).toBe(false);
  });

  it('makes an equip racing dissolution end without stale projections', async () => {
    const db = fixture();
    await purchaseCoupleEffect(purchaseCommand(db, 'purchase_couple_0004'));
    db.documents.get(`${ownershipPath(db)}`).equipped = false;
    db.documents.get(`coupleEffectEquipment/${relationshipId(db)}`).state = 'unequipped';
    const equip = equipCoupleEffect({
      clock,
      db,
      fieldValue,
      input: { itemId: 'royal-pair' },
      requestId: 'equip_couple_effect_01',
      uid: 'u1',
    });
    const dissolve = dissolveFixture(db);
    await expect(Promise.all([equip, dissolve])).resolves.toEqual([
      expect.objectContaining({ result: expect.objectContaining({ itemId: 'royal-pair' }) }),
      { result: { status: 'none' } },
    ]);
    expect(db.documents.get(`coupleEffectEquipment/${relationshipId(db)}`).state).toBe('dissolved');
    expect(db.documents.get('publicProfiles/u1').coupleEffect).toEqual({ __delete: true });
    expect(db.documents.get('publicProfiles/u2').coupleEffect).toEqual({ __delete: true });
    expect(db.documents.has(ownershipPath(db))).toBe(true);
  });

  it('clears expiry, refund, asset disable, and suspension without deleting ownership history', async () => {
    const expired = fixture();
    await purchaseCoupleEffect(purchaseCommand(expired, 'purchase_couple_0005'));
    expired.documents.get(ownershipPath(expired)).expiresAt = timestamp(900);
    expect(await reconcileCoupleEffects({ clock, db: expired, fieldValue })).toMatchObject({ cleared: 1 });
    expect(expired.documents.get(ownershipPath(expired))).toMatchObject({ equipped: false, state: 'expired' });

    const refunded = fixture();
    await purchaseCoupleEffect(purchaseCommand(refunded, 'purchase_couple_0006'));
    refunded.documents.get(ownershipPath(refunded)).state = 'refunded';
    expect(await reconcileCoupleEffects({ clock, db: refunded, fieldValue })).toMatchObject({ cleared: 1 });
    expect(refunded.documents.has(ownershipPath(refunded))).toBe(true);

    const disabled = fixture();
    await purchaseCoupleEffect(purchaseCommand(disabled, 'purchase_couple_0007'));
    disabled.documents.get('cosmeticAssets/royal-pair').renderingEnabled = false;
    expect(await reconcileCoupleEffects({ clock, db: disabled, fieldValue })).toMatchObject({ cleared: 1 });

    const suspended = fixture();
    await purchaseCoupleEffect(purchaseCommand(suspended, 'purchase_couple_0008'));
    suspended.documents.get('publicProfiles/u2').moderationStatus = 'suspended';
    expect(await clearSuspendedCoupleEffects({ clock, db: suspended, fieldValue, uid: 'u2' }))
      .toEqual({ cleared: 1 });
    expect(suspended.documents.get('publicProfiles/u1').coupleEffect).toEqual({ __delete: true });
  });
});

function dissolveFixture(db) {
  return db.runTransaction(async (transaction) => {
    const coupleRef = db.doc('couples/couple-1');
    const couple = await transaction.get(coupleRef);
    const clearState = await prepareDissolutionClear({
      couple: couple.data(),
      coupleId: 'couple-1',
      db,
      transaction,
    });
    applyDissolutionClear({
      auditActorUid: 'u1',
      auditReason: 'test-race',
      clearState,
      coupleId: 'couple-1',
      db,
      fieldValue,
      memberUids: ['u1', 'u2'],
      transaction,
    });
    transaction.delete(coupleRef);
    transaction.delete(db.doc('coupleMemberships/u1'));
    transaction.delete(db.doc('coupleMemberships/u2'));
    return { result: { status: 'none' } };
  });
}

function purchaseCommand(db, requestId) {
  return {
    clock,
    db,
    fieldValue,
    input: { currency: 'coins', itemId: 'royal-pair' },
    requestId,
    uid: 'u1',
  };
}

function fixture() {
  const relationship = createRelationshipId('couple-1', 'accept_couple_0001');
  return new FakeFirestore({
    'appConfig/cosmeticsFeatures': { cosmetics_couple_effects: true },
    'appConfig/socialFeatures': { couples: true, wallet: true },
    'cosmeticAssetApprovals/royal-pair__v1-123456789abc': approval('royal-pair'),
    'cosmeticAssets/royal-pair': summary('royal-pair'),
    'cosmeticAssets/royal-pair/versions/v1-123456789abc': {
      assetId: 'royal-pair',
      assetVersionId: 'v1-123456789abc',
      category: 'couple-effect',
      format: 'png',
      sha256: 'abc',
    },
    'coupleMemberships/u1': { coupleId: 'couple-1', createdAt: timestamp(10), partnerUid: 'u2', relationshipId: relationship, uid: 'u1' },
    'coupleMemberships/u2': { coupleId: 'couple-1', createdAt: timestamp(10), partnerUid: 'u1', relationshipId: relationship, uid: 'u2' },
    'couples/couple-1': { createdAt: timestamp(10), level: 1, memberUids: ['u1', 'u2'], relationshipId: relationship },
    'publicIds/1111111': { createdAt: timestamp(), uid: 'u1' },
    'publicIds/2222222': { createdAt: timestamp(), uid: 'u2' },
    'publicProfiles/u1': profile('u1', 'First', '1111111'),
    'publicProfiles/u2': profile('u2', 'Second', '2222222'),
    'storeCatalog/royal-pair': {
      availability: 'available',
      category: 'couple-effects',
      cosmeticAsset: { assetId: 'royal-pair', assetVersionId: 'v1-123456789abc' },
      coupleEffectPresentation: { borderMode: 'static', entranceMode: 'static', profileMode: 'static' },
      description: { ar: 'تأثير للثنائي', en: 'Couple effect' },
      duration: { kind: 'permanent' },
      itemId: 'royal-pair',
      name: { ar: 'الثنائي الملكي', en: 'Royal pair' },
      order: 1,
      previewAssetUrl: 'https://cdn.example.com/pair.png',
      prices: { coins: 40 },
      purchasingEnabled: true,
      stock: { kind: 'unlimited' },
      thumbnailUrl: 'https://cdn.example.com/pair-thumb.png',
    },
    'walletSummaries/u1': {
      balances: { coins: 100, diamonds: 10 },
      createdAt: timestamp(),
      lifetimeCredit: { coins: 100, diamonds: 10 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'u1',
      updatedAt: timestamp(),
    },
  });
}

function relationshipId(db) {
  return db.documents.get('couples/couple-1')?.relationshipId
    || [...db.documents.keys()].find((path) => path.startsWith('coupleEffectEquipment/'))?.split('/')[1];
}
function ownershipPath(db) { return `coupleEffectOwnerships/${relationshipId(db)}/items/royal-pair`; }
function summary(assetId) {
  return {
    approvalId: `${assetId}__v1-123456789abc`,
    approvedVersionId: 'v1-123456789abc',
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: 'v1-123456789abc',
    renderingEnabled: true,
  };
}
function approval(assetId) {
  return { assetId, assetVersionId: 'v1-123456789abc', checksum: 'abc', decision: 'approved' };
}
function profile(uid, displayName, publicId) {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 1,
    createdAt: timestamp(),
    displayName,
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: displayName.toLowerCase(),
    publicId,
    uid,
    updatedAt: timestamp(),
  };
}
function timestamp(value = 1) { return { toDate: () => new Date(value), toMillis: () => value }; }
function snapshot(path, data) {
  const ref = { path };
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.queue = Promise.resolve();
  }
  doc(path) { return { get: async () => snapshot(path, this.documents.get(path)), path }; }
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
  where(field, operator, value) { return new FakeQuery(this.db, this.path, { ...this.state, filter: { field, operator, value } }); }
  limit(value) { return new FakeQuery(this.db, this.path, { ...this.state, limit: value }); }
  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    if (this.state.filter?.operator === 'array-contains') {
      rows = rows.filter(([, data]) => Array.isArray(data[this.state.filter.field]) && data[this.state.filter.field].includes(this.state.filter.value));
    }
    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(([path, data]) => snapshot(path, data)), size: rows.length };
  }
}
