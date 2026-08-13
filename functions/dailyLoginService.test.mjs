import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  claimDailyLoginReward,
  getDailyLoginStatus,
  recordDailyLoginClaimFailure,
  reconcileDailyLoginClaim,
} = require('./dailyLoginService');

const nowMs = Date.parse('2026-07-31T12:00:00.000Z');
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = {
  serverTimestamp: () => timestamp(nowMs),
};
const todayId = 'day_2026-07-31_asia-baghdad';

describe('dailyLoginService', () => {
  it('records failed claims in a bounded daily shard without exposing user identity', async () => {
    const writes = [];
    await recordDailyLoginClaimFailure({
      clock,
      code: 'RATE_LIMITED',
      db: {
        doc: (path) => ({
          set: async (data, options) => writes.push({ data, options, path }),
        }),
      },
      fieldValue: {
        increment: (value) => ({ increment: value }),
        serverTimestamp: () => timestamp(nowMs),
      },
      uid: 'user-1',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      data: {
        code: 'RATE_LIMITED',
        count: { increment: 1 },
        dateId: '2026-07-31',
      },
      options: { merge: true },
    });
    expect(writes[0].path).toMatch(/^dailyLoginFailureMetrics\/2026-07-31_RATE_LIMITED_\d+$/);
    expect(JSON.stringify(writes[0])).not.toContain('user-1');
  });

  it('credits a claim atomically and replays the original receipt exactly once', async () => {
    const db = seededDb();
    const input = claimInput('request_12345678');
    const first = await claimDailyLoginReward({ clock, db, fieldValue, input, uid: 'user-1' });
    const replay = await claimDailyLoginReward({ clock, db, fieldValue, input, uid: 'user-1' });

    expect(first).toMatchObject({
      replayed: false,
      result: {
        balances: { coins: 110, diamonds: 3 },
        campaignRevision: 1,
        dayId: todayId,
        streakPosition: 1,
        walletCredits: [
          { amount: 10, balanceAfter: 110, currency: 'coins' },
          { amount: 1, balanceAfter: 3, currency: 'diamonds' },
        ],
      },
    });
    expect(replay).toEqual({ replayed: true, result: first.result });
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 110, diamonds: 3 });
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(2);
    expect([...db.documents.keys()].filter((path) => path.startsWith('dailyLoginCommands/'))).toHaveLength(1);
    expect(db.read(`dailyLoginClaims/user-1/days/${todayId}`)).toMatchObject({
      campaignRevision: 1,
      kind: 'daily-login-claim',
      streakPosition: 1,
      uid: 'user-1',
    });
  });

  it('serializes concurrent request IDs into one economic claim', async () => {
    const db = seededDb();
    const [first, second] = await Promise.all([
      claimDailyLoginReward({
        clock,
        db,
        fieldValue,
        input: claimInput('request_12345678'),
        uid: 'user-1',
      }),
      claimDailyLoginReward({
        clock,
        db,
        fieldValue,
        input: claimInput('request_abcdefgh'),
        uid: 'user-1',
      }),
    ]);
    expect([first, second].filter((result) => result.replayed === false)).toHaveLength(1);
    expect([first, second].filter((result) => result.replayed === true)).toHaveLength(1);
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 110, diamonds: 3 });
    expect([...db.documents.keys()].filter((path) => path.startsWith('rewardSettlements/'))).toHaveLength(1);
  });

  it('advances a consecutive streak and wraps day seven to day one', async () => {
    const db = seededDb();
    db.documents.set('dailyLoginStates/user-1', {
      lastClaimDateId: '2026-07-30',
      streakPosition: 7,
      uid: 'user-1',
    });
    const claim = await claimDailyLoginReward({
      clock,
      db,
      fieldValue,
      input: claimInput('request_wrap_123'),
      uid: 'user-1',
    });
    expect(claim).toMatchObject({
      replayed: false,
      result: { streakPosition: 1 },
    });
  });

  it('fails closed for disabled, suspended, and economy-restricted accounts', async () => {
    const disabled = seededDb();
    disabled.documents.set('appConfig/dailyLoginFeatures', {
      daily_login_reward_items: false,
      daily_login_rewards: false,
    });
    await expect(claimDailyLoginReward({
      clock,
      db: disabled,
      fieldValue,
      input: claimInput('request_disabled'),
      uid: 'user-1',
    })).resolves.toMatchObject({ code: 'FEATURE_DISABLED', ok: false, status: 503 });

    const suspended = seededDb();
    suspended.documents.set('publicProfiles/user-1', { moderationStatus: 'suspended', uid: 'user-1' });
    await expect(claimDailyLoginReward({
      clock,
      db: suspended,
      fieldValue,
      input: claimInput('request_suspended'),
      uid: 'user-1',
    })).resolves.toMatchObject({ code: 'ACCOUNT_NOT_ELIGIBLE', status: 403 });

    const restricted = seededDb();
    restricted.documents.set('economyRestrictions/user-1', {
      dailyLoginRewardsBlocked: true,
      status: 'restricted',
    });
    await expect(claimDailyLoginReward({
      clock,
      db: restricted,
      fieldValue,
      input: claimInput('request_restricted'),
      uid: 'user-1',
    })).resolves.toMatchObject({ code: 'ECONOMY_RESTRICTED', status: 403 });
    expect(restricted.read('walletSummaries/user-1').balances).toEqual({ coins: 100, diamonds: 2 });
  });

  it('makes no partial economic writes when a configured item is invalid', async () => {
    const db = seededDb({
      daily_login_reward_items: true,
      rewards: rewards({ items: [{ itemId: 'missing-item' }] }),
    });
    const result = await claimDailyLoginReward({
      clock,
      db,
      fieldValue,
      input: claimInput('request_bad_item'),
      uid: 'user-1',
    });
    expect(result).toMatchObject({ code: 'ITEM_NOT_REWARDABLE', ok: false });
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 100, diamonds: 2 });
    expect(db.read(`dailyLoginClaims/user-1/days/${todayId}`)).toBeUndefined();
    expect([...db.documents.keys()].filter((path) => path.startsWith('walletTransactions/'))).toHaveLength(0);
  });

  it('rate-limits repeated failed economic claims without partial rewards', async () => {
    const db = seededDb({
      daily_login_reward_items: true,
      rewards: rewards({ items: [{ itemId: 'missing-item' }] }),
    });
    const results = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      results.push(await claimDailyLoginReward({
        clock,
        db,
        fieldValue,
        input: claimInput(`request_failed_${attempt}`),
        uid: 'user-1',
      }));
    }
    expect(results.slice(0, 8).every((result) => result.code === 'ITEM_NOT_REWARDABLE')).toBe(true);
    expect(results[8]).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(db.read('dailyLoginRateLimits/user-1')).toMatchObject({ count: 9, uid: 'user-1' });
    expect(db.read('walletSummaries/user-1').balances).toEqual({ coins: 100, diamonds: 2 });
    expect(db.read(`dailyLoginClaims/user-1/days/${todayId}`)).toBeUndefined();
  });

  it('uses duplicate item fallback and reconciles every economic record', async () => {
    const db = seededDb({
      daily_login_reward_items: true,
      rewards: rewards({
        coins: 0,
        diamonds: 0,
        items: [{
          duplicateFallback: { amount: 5, currency: 'diamonds' },
          itemId: 'permanent-car',
        }],
      }),
    });
    db.documents.set('storeCatalog/permanent-car', catalog('permanent-car', 'cars', { kind: 'permanent' }));
    db.documents.set('storeOwnerships/user-1/items/permanent-car', ownership('permanent-car', 'cars', { kind: 'permanent' }));
    const claim = await claimDailyLoginReward({
      clock,
      db,
      fieldValue,
      input: claimInput('request_fallback'),
      uid: 'user-1',
    });
    expect(claim).toMatchObject({
      result: {
        items: [{
          fallback: { amount: 5, currency: 'diamonds' },
          itemId: 'permanent-car',
          outcome: 'duplicate-fallback',
        }],
        walletCredits: [{ amount: 5, balanceAfter: 7, currency: 'diamonds' }],
      },
    });
    await expect(reconcileDailyLoginClaim({ db, dayId: todayId, uid: 'user-1' }))
      .resolves.toMatchObject({ balanced: true, discrepancies: [] });
    const ledgerPath = [...db.documents.keys()].find((path) => path.startsWith('walletTransactions/'));
    db.documents.delete(ledgerPath);
    await expect(reconcileDailyLoginClaim({ db, dayId: todayId, uid: 'user-1' }))
      .resolves.toMatchObject({ balanced: false, discrepancies: ['WALLET_LEDGER_DIAMONDS'] });
  });

  it('returns a safe status without trusting client streak state', async () => {
    const db = seededDb();
    const status = await getDailyLoginStatus({
      clock,
      db,
      input: { action: 'get-daily-login-status', clientVersion: '1.0.0' },
      uid: 'user-1',
    });
    expect(status).toMatchObject({
      result: {
        calendar: expect.any(Array),
        campaignRevision: 1,
        claimable: true,
        nextResetAtMillis: Date.parse('2026-07-31T21:00:00.000Z'),
        streakPosition: 1,
        timeZone: 'Asia/Baghdad',
      },
    });
    expect(status.result.calendar).toHaveLength(7);
  });

  it('does not advertise an item-only day when item rewards are disabled', async () => {
    const db = seededDb({
      rewards: rewards({ coins: 0, diamonds: 0, items: [{ itemId: 'gold-frame' }] }),
    });
    const status = await getDailyLoginStatus({
      clock,
      db,
      input: { action: 'get-daily-login-status', clientVersion: '1.0.0' },
      uid: 'user-1',
    });
    expect(status).toMatchObject({
      result: {
        claimable: false,
        reason: 'ITEM_REWARDS_DISABLED',
        streakPosition: 1,
      },
    });
  });

  it('fails status closed when today state or receipt is inconsistent', async () => {
    const missingReceipt = seededDb();
    missingReceipt.documents.set('dailyLoginStates/user-1', {
      lastClaimDateId: '2026-07-31',
      streakPosition: 3,
      uid: 'user-1',
    });
    await expect(getDailyLoginStatus({
      clock,
      db: missingReceipt,
      input: { action: 'get-daily-login-status', clientVersion: '1.0.0' },
      uid: 'user-1',
    })).resolves.toMatchObject({
      result: { alreadyClaimed: true, claimable: false, reason: 'CLAIM_STATE_CONFLICT' },
    });

    const corruptReceipt = seededDb();
    await claimDailyLoginReward({
      clock,
      db: corruptReceipt,
      fieldValue,
      input: claimInput('request_corrupt_1'),
      uid: 'user-1',
    });
    const receipt = corruptReceipt.read(`dailyLoginClaims/user-1/days/${todayId}`);
    corruptReceipt.documents.set(`dailyLoginClaims/user-1/days/${todayId}`, {
      ...receipt,
      result: { ...receipt.result, settlementId: 'wrong-settlement' },
    });
    await expect(getDailyLoginStatus({
      clock,
      db: corruptReceipt,
      input: { action: 'get-daily-login-status', clientVersion: '1.0.0' },
      uid: 'user-1',
    })).resolves.toMatchObject({
      result: { claimable: false, reason: 'CLAIM_CONFLICT' },
    });
  });

  it('uses a valid receipt as the authoritative streak position when state lags', async () => {
    const db = seededDb();
    db.documents.set('dailyLoginStates/user-1', {
      lastClaimDateId: '2026-07-30',
      streakPosition: 4,
      uid: 'user-1',
    });
    await claimDailyLoginReward({
      clock,
      db,
      fieldValue,
      input: claimInput('request_receipt_5'),
      uid: 'user-1',
    });
    db.documents.delete('dailyLoginStates/user-1');
    await expect(getDailyLoginStatus({
      clock,
      db,
      input: { action: 'get-daily-login-status', clientVersion: '1.0.0' },
      uid: 'user-1',
    })).resolves.toMatchObject({
      result: { alreadyClaimed: true, claimable: false, streakPosition: 5 },
    });
  });
});

function claimInput(requestId) {
  return {
    action: 'claim-daily-login-reward',
    clientVersion: '1.0.0',
    deviceId: 'android-installation-1',
    requestId,
  };
}

function rewards(dayOne = { coins: 10, diamonds: 1 }) {
  return Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    reward: index === 0 ? dayOne : { coins: (index + 1) * 10 },
  }));
}

function seededDb(overrides = {}) {
  return new FakeFirestore({
    'appConfig/dailyLoginFeatures': {
      daily_login_reward_items: overrides.daily_login_reward_items === true,
      daily_login_rewards: true,
    },
    'dailyLoginCampaign/current': {
      activeRevision: 1,
      emergencyDisabled: false,
      presentationVisible: true,
      publicationStatus: 'published',
      schemaVersion: 1,
    },
    'dailyLoginCampaign/current/versions/1': {
      minimumClientVersion: '1.0.0',
      publicationStatus: 'published',
      revision: 1,
      rewards: overrides.rewards || rewards(),
      schemaVersion: 1,
      timeZone: 'Asia/Baghdad',
    },
    'publicProfiles/user-1': {
      moderationStatus: 'active',
      uid: 'user-1',
    },
    'walletSummaries/user-1': {
      balances: { coins: 100, diamonds: 2 },
      createdAt: timestamp(nowMs - 1000),
      economyBalances: { giftEarnings: 9 },
      lifetimeCredit: { coins: 100, diamonds: 2 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'user-1',
      updatedAt: timestamp(nowMs - 1000),
    },
  });
}

function catalog(itemId, category, duration) {
  return {
    availability: 'available',
    category,
    description: { ar: 'وصف', en: 'Description' },
    duration,
    itemId,
    name: { ar: 'مكافأة', en: 'Reward' },
    order: 1,
    previewAssetUrl: 'https://example.com/preview.png',
    prices: { coins: 10 },
    purchasingEnabled: true,
    stock: { kind: 'unlimited' },
    thumbnailUrl: 'https://example.com/thumb.png',
  };
}

function ownership(itemId, category, duration) {
  return {
    acquiredAt: timestamp(nowMs - 1000),
    category,
    duration,
    equipped: false,
    itemId,
    kind: 'store-ownership',
    ownershipId: itemId,
    state: 'active',
    uid: 'user-1',
    updatedAt: timestamp(nowMs - 1000),
  };
}

function timestamp(value) {
  return { toMillis: () => value };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) {
    return makeRef(this, path);
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
    return snapshot(this.db, ref.path, this.db.documents.get(ref.path));
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

function makeRef(db, path) {
  return {
    collection: (child) => ({
      doc: (id) => makeRef(db, `${path}/${child}/${id}`),
    }),
    get: async () => snapshot(db, path, db.documents.get(path)),
    id: path.split('/').at(-1),
    path,
  };
}

function snapshot(db, path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeRef(db, path),
  };
}
