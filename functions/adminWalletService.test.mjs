import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { executeAdminWalletAdjustment, executeAdminWalletCredit } = require('./adminWalletService');
const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
const decodedToken = { email: 'admin@example.com', uid: 'admin-1' };

describe('adminWalletService', () => {
  it('credits only the selected currency and records an immutable ledger entry', async () => {
    const db = walletDb();
    const input = { amount: 4, currency: 'diamonds', note: 'representative stock', requestId: 'diamond_credit_001', targetUid: 'u1' };
    await expect(executeAdminWalletCredit({ db, decodedToken, fieldValue, input }))
      .resolves.toBe('wallet_diamond_credit_001');
    expect(db.read('walletSummaries/u1')).toMatchObject({
      balances: { coins: 100, diamonds: 6 },
      lifetimeCredit: { coins: 100, diamonds: 6 },
    });
    expect(db.read('walletTransactions/admin_diamond_credit_001')).toMatchObject({
      amount: 4,
      balanceAfter: 6,
      currency: 'diamonds',
    });
  });

  it('is idempotent only for the exact same actor, target, amount, and currency', async () => {
    const db = walletDb();
    const input = { amount: 10, currency: 'coins', note: '', requestId: 'coin_credit_0001', targetUid: 'u1' };
    await executeAdminWalletCredit({ db, decodedToken, fieldValue, input });
    await expect(executeAdminWalletCredit({ db, decodedToken, fieldValue, input })).resolves.toBe('wallet_coin_credit_0001');
    await expect(executeAdminWalletCredit({
      db,
      decodedToken,
      fieldValue,
      input: { ...input, currency: 'diamonds' },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.read('walletSummaries/u1').balances).toEqual({ coins: 110, diamonds: 2 });
  });

  it('debits a wallet with before/after ledger protection', async () => {
    const db = walletDb();
    const input = { amount: 35, currency: 'coins', mutationType: 'debit', note: 'chargeback correction', requestId: 'coin_debit_00001', targetUid: 'u1' };
    await expect(executeAdminWalletAdjustment({ db, decodedToken, fieldValue, input }))
      .resolves.toBe('wallet_coin_debit_00001');
    expect(db.read('walletSummaries/u1')).toMatchObject({
      balances: { coins: 65, diamonds: 2 },
      lifetimeDebit: { coins: 35, diamonds: 0 },
    });
    expect(db.read('walletTransactions/admin_coin_debit_00001')).toMatchObject({
      amount: 35,
      balanceAfter: 65,
      currency: 'coins',
      source: 'admin-debit',
      type: 'debit',
    });
  });

  it('rejects debits that would make a balance negative', async () => {
    const db = walletDb();
    await expect(executeAdminWalletAdjustment({
      db,
      decodedToken,
      fieldValue,
      input: { amount: 101, currency: 'coins', mutationType: 'debit', note: 'invalid correction', requestId: 'coin_debit_00002', targetUid: 'u1' },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.read('walletSummaries/u1').balances.coins).toBe(100);
  });

  it('rejects a stale wallet conflict token before writing a ledger entry', async () => {
    const db = walletDb();
    await expect(executeAdminWalletAdjustment({
      db,
      decodedToken,
      fieldValue,
      input: { amount: 1, currency: 'coins', expectedUpdatedAt: '2026-07-21T00:00:00.000Z', mutationType: 'credit', note: 'manual correction', requestId: 'stale_wallet_0001', targetUid: 'u1' },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.read('walletTransactions/admin_stale_wallet_0001')).toBeUndefined();
  });
});

function walletDb() {
  return new FakeFirestore({
    'publicProfiles/u1': { uid: 'u1' },
    'walletSummaries/u1': {
      balances: { coins: 100, diamonds: 2 },
      createdAt: timestamp(),
      lifetimeCredit: { coins: 100, diamonds: 2 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'u1',
      updatedAt: timestamp(),
    },
  });
}

function timestamp() {
  return { toMillis: () => 1 };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
  }

  doc(path) {
    return { id: path.split('/').at(-1), path };
  }

  read(path) {
    return this.documents.get(path);
  }

  async runTransaction(callback) {
    const operations = [];
    const transaction = {
      create: (ref, data) => operations.push({ data, kind: 'create', path: ref.path }),
      get: async (ref) => snapshot(this.documents.get(ref.path)),
      set: (ref, data) => operations.push({ data, kind: 'set', path: ref.path }),
    };
    const result = await callback(transaction);
    for (const operation of operations) {
      if (operation.kind === 'create' && this.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
      this.documents.set(operation.path, operation.data);
    }
    return result;
  }
}

function snapshot(data) {
  return { data: () => data, exists: data !== undefined };
}
