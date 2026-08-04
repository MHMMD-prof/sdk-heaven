import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeRepresentativeOverrideUpdate,
  executeRepresentativePinReset,
  executeRepresentativePolicyUpdate,
  resolveRepresentativeOperations,
} = require('./representativeAdminService');

const fieldValue = { serverTimestamp: () => timestamp(9_999) };
const decodedToken = { email: 'owner@example.com', uid: 'owner' };
const limits = {
  coins: { maxPerDay: 5_000, maxPerTransfer: 1_000, maxTransfersPerHour: 10 },
  diamonds: { maxPerDay: 500, maxPerTransfer: 100, maxTransfersPerHour: 5 },
};

describe('representativeAdminService', () => {
  it('creates policy once, audits it, and rejects stale or conflicting replays', async () => {
    const db = new FakeFirestore();
    const input = {
      expectedUpdatedAt: 'missing',
      limits,
      reason: 'Initial production limits',
      requestId: 'policy_request_123',
    };
    await expect(executeRepresentativePolicyUpdate({ db, decodedToken, fieldValue, input }))
      .resolves.toBe('representative-policy_policy_request_123');
    expect(db.read('appConfig/representativeTransferPolicy')).toMatchObject({
      contractVersion: 1,
      limits,
      updatedBy: 'owner',
    });
    expect(db.read('adminAuditEvents/representative-policy_policy_request_123')).toMatchObject({
      action: 'representative-policy-update',
      note: 'Initial production limits',
      status: 'completed',
    });
    await expect(executeRepresentativePolicyUpdate({ db, decodedToken, fieldValue, input }))
      .resolves.toBe('representative-policy_policy_request_123');
    await expect(executeRepresentativePolicyUpdate({
      db,
      decodedToken: { ...decodedToken, uid: 'other-owner' },
      fieldValue,
      input,
    })).rejects.toMatchObject({ status: 409 });
    await expect(executeRepresentativePolicyUpdate({
      db,
      decodedToken,
      fieldValue,
      input: { ...input, expectedUpdatedAt: 'missing', requestId: 'policy_request_456' },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('updates only representative overrides and enforces the loaded privilege revision', async () => {
    const db = representativeDb();
    await expect(executeRepresentativeOverrideUpdate({
      db,
      decodedToken,
      fieldValue,
      input: {
        expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
        limits: { coins: limits.coins },
        reason: 'Lower coin exposure',
        requestId: 'override_request_123',
        targetUid: 'representative',
      },
    })).resolves.toBe('representative-override_override_request_123');
    expect(db.read('representativePrivileges/representative')).toMatchObject({
      active: true,
      currencies: { coins: true, diamonds: true },
      limits: { coins: limits.coins },
      updatedBy: 'owner',
    });
    await expect(executeRepresentativeOverrideUpdate({
      db,
      decodedToken,
      fieldValue,
      input: {
        expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
        limits: {},
        reason: 'Clear custom limits',
        requestId: 'override_request_456',
        targetUid: 'representative',
      },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('marks an existing PIN for reset and refuses stale or absent PIN records', async () => {
    const db = representativeDb();
    await expect(executeRepresentativePinReset({
      db,
      decodedToken,
      fieldValue,
      input: {
        expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
        reason: 'Reported PIN compromise',
        requestId: 'pin_reset_request_1',
        targetUid: 'representative',
      },
    })).resolves.toBe('representative-pin-reset_pin_reset_request_1');
    expect(db.read('representativeTransferPins/representative')).toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
      resetRequired: true,
      updatedBy: 'owner',
    });

    const missing = representativeDb();
    missing.documents.delete('representativeTransferPins/representative');
    await expect(executeRepresentativePinReset({
      db: missing,
      decodedToken,
      fieldValue,
      input: {
        expectedUpdatedAt: 'missing',
        reason: 'Cannot reset absent PIN',
        requestId: 'pin_reset_request_2',
        targetUid: 'representative',
      },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('returns policy, operational history, and balance-aware receipt eligibility', async () => {
    const db = representativeDb();
    const publicReference = 'RPT-0123456789ABCDEF';
    db.documents.set('appConfig/representativeTransferPolicy', { limits, updatedAt: timestamp(1) });
    db.documents.set('representativePublicReferences/RPT-0123456789ABCDEF', {
      representativeUid: 'representative',
      transferId: 'transfer-1',
    });
    db.documents.set('representativeTransfers/transfer-1', {
      amount: 50,
      createdAt: timestamp(1_000),
      currency: 'coins',
      publicReference,
      recipientDisplayName: 'Recipient',
      recipientPublicId: '2222222',
      recipientUid: 'recipient',
      representativeDisplayName: 'Representative',
      representativePublicId: '1111111',
      representativeUid: 'representative',
      status: 'completed',
    });
    db.documents.set('walletSummaries/recipient', { balances: { coins: 50, diamonds: 0 } });
    db.documents.set('representativePortalSecurityEvents/security-1', {
      createdAt: timestamp(1_100),
      kind: 'pin-failed',
      representativeUid: 'representative',
    });
    db.documents.set('adminAuditEvents/audit-1', {
      action: 'representative-override-update',
      actorUid: 'owner',
      createdAt: timestamp(1_200),
      status: 'completed',
      targetUid: 'representative',
    });

    await expect(resolveRepresentativeOperations({
      clock: { nowMillis: () => 2_000 },
      db,
      publicReference,
    })).resolves.toMatchObject({
      auditHistory: [{ id: 'audit-1', kind: 'representative-override-update' }],
      policy: { configured: true, limits, updatedAt: '1970-01-01T00:00:00.001Z' },
      receipt: { eligibleForReversal: true, publicReference, transferId: 'transfer-1' },
      recentSecurityEvents: [{ id: 'security-1', kind: 'pin-failed' }],
      recentTransfers: [{ publicReference, transferId: 'transfer-1' }],
    });
  });
});

function representativeDb() {
  return new FakeFirestore({
    'representativePrivileges/representative': {
      active: true,
      currencies: { coins: true, diamonds: true },
      limits: {},
      uid: 'representative',
      updatedAt: timestamp(1),
    },
    'representativeTransferPins/representative': {
      failedAttempts: 2,
      lockedUntil: timestamp(100),
      resetRequired: false,
      updatedAt: timestamp(1),
    },
  });
}

function timestamp(value) {
  return { toMillis: () => value };
}

class FakeFirestore {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(documents));
  }
  doc(path) {
    return {
      get: async () => snapshot(path, this.documents.get(path)),
      id: path.split('/').at(-1),
      path,
    };
  }
  collection(path) {
    return new FakeQuery(this, path);
  }
  read(path) {
    return this.documents.get(path);
  }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
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
        throw new Error(`Document already exists: ${operation.path}`);
      }
      this.db.documents.set(operation.path, operation.data);
    }
  }
}

class FakeQuery {
  constructor(db, path, descending = false, limitCount = 50) {
    this.db = db;
    this.path = path;
    this.descending = descending;
    this.limitCount = limitCount;
  }
  orderBy(_field, direction) {
    return new FakeQuery(this.db, this.path, direction === 'desc', this.limitCount);
  }
  limit(count) {
    return new FakeQuery(this.db, this.path, this.descending, count);
  }
  async get() {
    const depth = this.path.split('/').length + 1;
    const rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && path.split('/').length === depth)
      .sort((left, right) => (left[1].createdAt?.toMillis() || 0) - (right[1].createdAt?.toMillis() || 0));
    if (this.descending) rows.reverse();
    const docs = rows.slice(0, this.limitCount).map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
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
