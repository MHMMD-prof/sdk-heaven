import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeRoomGiftPolicyUpdate } = require('./roomGiftPolicyCore');
const { resolveRoomGiftPolicy, updateRoomGiftPolicy } = require('./roomGiftPolicyService');

const nowMs = 2_000_000_000_000;
const timestamp = (value = nowMs) => ({ toDate: () => new Date(value), toMillis: () => value });
const fieldValue = { serverTimestamp: () => timestamp() };

describe('roomGiftPolicyService', () => {
  it('validates an owner policy update', () => {
    expect(normalizeRoomGiftPolicyUpdate({
      commissionBps: 1200,
      expectedVersion: 2,
      reason: 'Testing revised commission',
      requestId: 'gift_policy_request_0001',
    })).toMatchObject({
      ok: true,
      value: { commissionBps: 1200, expectedVersion: 2 },
    });
    expect(normalizeRoomGiftPolicyUpdate({
      commissionBps: 10_001,
      expectedVersion: 2,
      reason: 'Bad rate',
      requestId: 'gift_policy_request_0002',
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('creates one immutable, audited, monotonic policy version', async () => {
    const db = new FakeFirestore({
      'appConfig/roomGiftCommissionPolicy': {
        commissionBps: 1000,
        effectiveAt: timestamp(nowMs - 1000),
        updatedAt: timestamp(nowMs - 1000),
        updatedBy: 'owner-0',
        version: 2,
      },
    });
    const args = {
      db,
      decodedToken: { admin: true, adminRole: 'owner', email: 'owner@example.test', uid: 'owner-1' },
      fieldValue,
      input: {
        commissionBps: 1200,
        expectedVersion: 2,
        reason: 'Testing revised commission',
        requestId: 'gift_policy_request_0001',
      },
    };
    const first = await updateRoomGiftPolicy(args);
    const replay = await updateRoomGiftPolicy(args);
    expect(first).toMatchObject({ replayed: false, policy: { commissionBps: 1200, version: 3 } });
    expect(replay).toMatchObject({ replayed: true, policy: { commissionBps: 1200, version: 3 } });
    expect(db.read('roomGiftCommissionPolicyVersions/v_00000003')).toMatchObject({
      commissionBps: 1200,
      reason: 'Testing revised commission',
      version: 3,
    });
    expect(db.read('adminAuditEvents/room_gift_policy_gift_policy_request_0001')).toMatchObject({
      action: 'room-gift-policy-update',
      before: { version: 2 },
      after: { version: 3 },
      status: 'completed',
    });
    expect(await resolveRoomGiftPolicy(db)).toMatchObject({
      commissionBps: 1200,
      configured: true,
      version: 3,
    });
  });

  it('rejects stale revisions and non-owner operators without writing history', async () => {
    const db = new FakeFirestore({
      'appConfig/roomGiftCommissionPolicy': {
        commissionBps: 1000,
        effectiveAt: timestamp(),
        version: 4,
      },
    });
    const input = {
      commissionBps: 900,
      expectedVersion: 3,
      reason: 'Stale update',
      requestId: 'gift_policy_request_0002',
    };
    await expect(updateRoomGiftPolicy({
      db,
      decodedToken: { admin: true, adminRole: 'owner', uid: 'owner-1' },
      fieldValue,
      input,
    })).rejects.toMatchObject({ status: 409 });
    await expect(updateRoomGiftPolicy({
      db,
      decodedToken: { admin: true, adminRole: 'moderator', uid: 'mod-1' },
      fieldValue,
      input: { ...input, expectedVersion: 4 },
    })).rejects.toMatchObject({ status: 403 });
    expect([...db.documents.keys()].filter((path) => path.startsWith('roomGiftCommissionPolicyVersions/'))).toHaveLength(0);
  });
});

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) {
    return {
      get: async () => snapshot(path, this.documents.get(path)),
      id: path.split('/').at(-1),
      path,
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
  set(ref, data) {
    this.operations.push({ data, kind: 'set', path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) {
        throw new Error(`Exists: ${operation.path}`);
      }
      this.db.documents.set(operation.path, operation.data);
    }
  }
}

function snapshot(path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: { path },
  };
}
