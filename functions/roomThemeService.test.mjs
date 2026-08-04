import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeRoomThemeCommand,
  expireRoomThemeEntitlements,
} = require('./roomThemeService');

const fieldValue = { serverTimestamp: () => timestamp(9_999) };
const clock = { nowMillis: () => 1_000, timestampFromMillis: (value) => timestamp(value) };
const owner = { uid: 'owner-1' };

describe('roomThemeService', () => {
  it('purchases a room-owned theme, debits once, and replays an identical request', async () => {
    const db = themeDb();
    const body = purchaseBody();

    const first = await executeRoomThemeCommand({ body, clock, db, decodedToken: owner, fieldValue });
    const replay = await executeRoomThemeCommand({ body, clock, db, decodedToken: owner, fieldValue });

    expect(first).toMatchObject({
      ok: true,
      result: {
        balances: { coins: 1_000, diamonds: 75 },
        equipped: true,
        roomId: 'room-1',
        themeId: 'royal-theater',
      },
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: first.result });
    expect(db.documents.get('walletSummaries/owner-1').balances.diamonds).toBe(75);
    expect(db.documents.get('rooms/room-1')).toMatchObject({ themeId: 'royal-theater', revision: 5 });
    expect(db.documents.get('rooms/room-1/themeEntitlements/royal-theater')).toMatchObject({
      acquiredByUid: 'owner-1',
      roomId: 'room-1',
      state: 'active',
      themeId: 'royal-theater',
    });
  });

  it('serializes concurrent purchases so only one entitlement and debit can commit', async () => {
    const db = themeDb();
    const first = executeRoomThemeCommand({
      body: purchaseBody('room_theme_purchase_0002'),
      clock,
      db,
      decodedToken: owner,
      fieldValue,
    });
    const second = executeRoomThemeCommand({
      body: purchaseBody('room_theme_purchase_0003'),
      clock,
      db,
      decodedToken: owner,
      fieldValue,
    });

    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: 'DUPLICATE_ENTITLEMENT' });
    expect(db.documents.get('walletSummaries/owner-1').balances.diamonds).toBe(75);
  });

  it('rejects non-owners and insufficient balances without creating an entitlement', async () => {
    const outsiderDb = themeDb();
    outsiderDb.documents.set('publicProfiles/outsider-1', publicProfile('outsider-1'));
    outsiderDb.documents.set('walletSummaries/outsider-1', wallet('outsider-1'));
    expect(await executeRoomThemeCommand({
      body: purchaseBody(),
      clock,
      db: outsiderDb,
      decodedToken: { uid: 'outsider-1' },
      fieldValue,
    })).toMatchObject({ code: 'OWNER_REQUIRED', ok: false });

    const poorDb = themeDb();
    poorDb.documents.set('walletSummaries/owner-1', wallet('owner-1', 10));
    expect(await executeRoomThemeCommand({
      body: purchaseBody(),
      clock,
      db: poorDb,
      decodedToken: owner,
      fieldValue,
    })).toMatchObject({ code: 'INSUFFICIENT_FUNDS', ok: false });
    expect(poorDb.documents.has('rooms/room-1/themeEntitlements/royal-theater')).toBe(false);
  });

  it('keeps room entitlements through ownership transfer and lets the new owner equip them', async () => {
    const db = themeDb();
    await executeRoomThemeCommand({
      body: { ...purchaseBody(), applyTheme: false },
      clock,
      db,
      decodedToken: owner,
      fieldValue,
    });
    db.documents.set('publicProfiles/owner-2', publicProfile('owner-2'));
    db.documents.set('rooms/room-1', {
      ...db.documents.get('rooms/room-1'),
      ownerUid: 'owner-2',
      hostId: 'owner-2',
    });

    const response = await executeRoomThemeCommand({
      body: {
        action: 'equip-room-theme',
        clientVersion: '1.0.0',
        requestId: 'room_theme_equip_00001',
        roomId: 'room-1',
        themeId: 'royal-theater',
      },
      clock,
      db,
      decodedToken: { uid: 'owner-2' },
      fieldValue,
    });

    expect(response).toMatchObject({ ok: true, result: { equipped: true, themeId: 'royal-theater' } });
    expect(db.documents.get('rooms/room-1/themeEntitlements/royal-theater').acquiredByUid).toBe('owner-1');
    expect(db.documents.get('rooms/room-1').themeId).toBe('royal-theater');
  });

  it('expires timed entitlements and transactionally restores Majlis when equipped', async () => {
    const db = themeDb();
    db.documents.set('rooms/room-1', { ...db.documents.get('rooms/room-1'), themeId: 'royal-theater' });
    db.documents.set('rooms/room-1/themeEntitlements/royal-theater', {
      acquiredAt: timestamp(100),
      acquiredByUid: 'owner-1',
      expiresAt: timestamp(900),
      itemId: 'royal-theater',
      roomId: 'room-1',
      state: 'active',
      themeId: 'royal-theater',
      updatedAt: timestamp(100),
    });

    expect(await expireRoomThemeEntitlements({ clock, db, fieldValue })).toEqual({ expired: 1, scanned: 1 });
    expect(db.documents.get('rooms/room-1/themeEntitlements/royal-theater').state).toBe('expired');
    expect(db.documents.get('rooms/room-1')).toMatchObject({ revision: 5, themeId: 'majlis-default' });
  });
});

function purchaseBody(requestId = 'room_theme_purchase_0001') {
  return {
    action: 'purchase-room-theme',
    applyTheme: true,
    clientVersion: '1.0.0',
    currency: 'diamonds',
    requestId,
    roomId: 'room-1',
    themeId: 'royal-theater',
  };
}

function themeDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': {
      voice_room_theme_purchases: true,
      voice_room_themes: true,
    },
    'publicProfiles/owner-1': publicProfile('owner-1'),
    'roomThemes/royal-theater': manifest(),
    'rooms/room-1': {
      hostId: 'owner-1',
      ownerUid: 'owner-1',
      revision: 4,
      status: 'active',
      themeId: 'majlis-default',
    },
    'storeCatalog/royal-theater': catalogItem(),
    'walletSummaries/owner-1': wallet('owner-1'),
  });
}

function publicProfile(uid) {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 0,
    createdAt: timestamp(),
    displayName: uid,
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: uid,
    publicId: uid === 'owner-1' ? '1234567' : '7654321',
    uid,
    updatedAt: timestamp(),
  };
}

function wallet(uid, diamonds = 100) {
  return {
    balances: { coins: 1_000, diamonds },
    createdAt: timestamp(),
    lifetimeCredit: { coins: 1_000, diamonds },
    lifetimeDebit: { coins: 0, diamonds: 0 },
    uid,
    updatedAt: timestamp(),
  };
}

function catalogItem() {
  return {
    availability: 'available',
    category: 'chat-themes',
    description: { ar: 'سمة غرفة ملكية', en: 'Royal room theme' },
    duration: { kind: 'permanent' },
    itemId: 'royal-theater',
    name: { ar: 'المسرح الملكي', en: 'Royal Theater' },
    order: 1,
    previewAssetUrl: 'https://cdn.example.com/royal-preview.png',
    prices: { coins: 250, diamonds: 25 },
    purchasingEnabled: true,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'https://cdn.example.com/royal-thumb.png',
  };
}

function manifest() {
  const colors = {
    background: '#090505',
    panel: '#160B0B',
    panelRaised: '#211010',
    ruby: '#7A1022',
    rubyBright: '#C92C43',
    gold: '#D8B56A',
    goldSoft: '#F0D99B',
    text: '#FFF7E6',
    textMuted: '#C9B99B',
  };
  const asset = { uri: 'https://cdn.example.com/royal-v1.png', version: 1 };
  return {
    assets: {
      background: asset,
      badge: null,
      dock: null,
      drawer: null,
      emptySeatFrame: null,
      stage: null,
    },
    colors,
    layouts: Object.fromEntries([5, 10, 15, 20].map((count) => [String(count), seats(count)])),
    manifestVersion: 1,
    minimumClientVersion: '1.0.0',
    publicationStatus: 'published',
    purchasingEnabled: true,
    renderingEnabled: true,
    revision: 1,
    themeId: 'royal-theater',
  };
}

function seats(count) {
  const xs = [0.12, 0.31, 0.5, 0.69, 0.88];
  const ys = [0.14, 0.37, 0.6, 0.83];
  return Array.from({ length: count }, (_, index) => ({
    scale: 1,
    seatNumber: index + 1,
    x: xs[index % 5],
    y: ys[Math.floor(index / 5)],
    z: index,
  }));
}

function timestamp(value = 1) {
  return { toMillis: () => value, toDate: () => new Date(value) };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }

  doc(path) {
    return makeRef(path, this);
  }

  collection(path) {
    return new FakeQuery(this, path, false);
  }

  collectionGroup(name) {
    return new FakeQuery(this, name, true);
  }

  async runTransaction(callback) {
    let release;
    const predecessor = this.transactionTail;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(ref) {
    return snapshot(ref.path, this.db.documents.get(ref.path), this.db);
  }

  create(ref, data) {
    this.operations.push({ data, kind: 'create', path: ref.path });
  }

  set(ref, data) {
    this.operations.push({ data, kind: 'set', path: ref.path });
  }

  update(ref, data) {
    this.operations.push({ data, kind: 'update', path: ref.path });
  }

  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) {
        throw new Error(`Exists: ${operation.path}`);
      }
      this.db.documents.set(
        operation.path,
        operation.kind === 'update'
          ? { ...this.db.documents.get(operation.path), ...operation.data }
          : operation.data,
      );
    }
  }
}

class FakeQuery {
  constructor(db, path, group, filters = [], queryLimit = undefined) {
    this.db = db;
    this.path = path;
    this.group = group;
    this.filters = filters;
    this.queryLimit = queryLimit;
  }

  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, this.group, [...this.filters, { field, operator, value }], this.queryLimit);
  }

  limit(value) {
    return new FakeQuery(this.db, this.path, this.group, this.filters, value);
  }

  async get() {
    let rows = [...this.db.documents.entries()].filter(([path]) => (
      this.group
        ? path.includes(`/${this.path}/`)
        : path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/')
    ));
    for (const { field, operator, value } of this.filters) {
      rows = rows.filter(([, data]) => {
        if (operator === '==') return data[field] === value;
        if (operator === '<=') return data[field]?.toMillis() <= value.toMillis();
        return false;
      });
    }
    if (this.queryLimit) rows = rows.slice(0, this.queryLimit);
    return { docs: rows.map(([path, data]) => snapshot(path, data, this.db)) };
  }
}

function makeRef(path, db) {
  const parts = path.split('/');
  const ref = {
    get: async () => snapshot(path, db.documents.get(path), db),
    path,
  };
  if (parts.length >= 2) {
    const collectionPath = parts.slice(0, -1).join('/');
    ref.parent = {
      parent: parts.length >= 4 ? makeRef(parts.slice(0, -2).join('/'), db) : null,
      path: collectionPath,
    };
  }
  return ref;
}

function snapshot(path, data, db) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeRef(path, db),
  };
}
