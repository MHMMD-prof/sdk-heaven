import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeDirectChatRetentionPolicySet,
  mapAdminDirectChatRestrictAudit,
  mapAdminDirectChatRestriction,
  resolveDirectChatOpsStatus,
  resolveDirectChatRetentionPolicy,
  retentionPolicyFields,
} = require('./directChatAdminOpsService');
const { mapDirectChatRetentionPolicy } = require('./directChatRetentionCore');

function createDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const collectionQueries = [];
  const db = {
    collection(name) {
      return {
        where(field, op, value) {
          const filters = [[field, op, value]];
          const chain = {
            where(nextField, nextOp, nextValue) {
              filters.push([nextField, nextOp, nextValue]);
              return chain;
            },
            orderBy() { return chain; },
            limit(size) {
              return {
                async get() {
                  collectionQueries.push({ filters, name, size });
                  const rows = [...docs.entries()]
                    .filter(([path]) => path.startsWith(`${name}/`))
                    .map(([path, data]) => ({ id: path.slice(name.length + 1), data: () => data, exists: true }));
                  const matched = rows.filter((row) => filters.every(([field, op, value]) => {
                    if (op === '==') return row.data()?.[field] === value;
                    return true;
                  })).slice(0, size);
                  return { docs: matched, size: matched.length };
                },
              };
            },
            async get() {
              return { docs: [], size: 0 };
            },
          };
          return chain;
        },
        doc(id) {
          return db.doc(`${name}/${id}`);
        },
      };
    },
    doc(path) {
      return {
        async get() {
          const data = docs.get(path);
          return { exists: data !== undefined, data: () => data, id: path.split('/').pop() };
        },
      };
    },
    async runTransaction(handler) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const path = ref.path || ref._path;
          const data = docs.get(path);
          return { exists: data !== undefined, data: () => data, id: path.split('/').pop() };
        },
        set(ref, data, options = {}) {
          const path = ref.path || ref._path;
          writes.push({ data, options, path, type: 'set' });
        },
        create(ref, data) {
          const path = ref.path || ref._path;
          writes.push({ data, path, type: 'create' });
        },
      };
      const decorated = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'doc') {
            return (path) => Object.assign(db.doc(path), { path });
          }
          return db[prop];
        },
      });
      // Bind path onto doc refs used inside the service.
      const policyAwareDb = {
        doc(path) {
          return Object.assign(db.doc(path), { path });
        },
        runTransaction: db.runTransaction,
      };
      return handler(transaction, policyAwareDb);
    },
  };
  // Patch runTransaction to use path-bearing refs from the outer db helper.
  db.runTransaction = async (handler) => {
    const writes = [];
    const transaction = {
      async get(ref) {
        const path = ref.path;
        const data = docs.get(path);
        return { exists: data !== undefined, data: () => data, id: path.split('/').pop() };
      },
      set(ref, data, options = {}) {
        const path = ref.path;
        const next = options.merge ? { ...(docs.get(path) || {}), ...data } : data;
        docs.set(path, next);
        writes.push({ data: next, path, type: 'set' });
      },
      create(ref, data) {
        const path = ref.path;
        if (docs.has(path)) throw Object.assign(new Error('exists'), { code: 'already-exists' });
        docs.set(path, data);
        writes.push({ data, path, type: 'create' });
      },
    };
    const result = await handler(transaction);
    return { result, writes, docs };
  };
  db._docs = docs;
  db._queries = collectionQueries;
  return db;
}

describe('directChatAdminOpsService', () => {
  it('maps restriction documents for admin context without message bodies', () => {
    const nowMs = 1_000_000;
    expect(mapAdminDirectChatRestriction({
      actorUid: 'admin-1',
      endsAt: { toMillis: () => nowMs + 60_000 },
      reason: 'Harassment',
      reportId: 'dmr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      startsAt: { toMillis: () => nowMs - 1_000 },
      state: 'restricted',
      uid: 'user-1',
    }, 'user-1', nowMs)).toMatchObject({
      active: true,
      actorUid: 'admin-1',
      reason: 'Harassment',
      reportId: 'dmr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      state: 'restricted',
    });
    expect(mapAdminDirectChatRestrictAudit('evt-1', {
      action: 'direct-chat-restrict-direct-chat',
      actorUid: 'admin-1',
      createdAt: { toDate: () => new Date(nowMs) },
      note: 'Abuse',
      reportId: 'dmr_1',
      status: 'completed',
    })).toMatchObject({ action: 'direct-chat-restrict-direct-chat', id: 'evt-1' });
    expect(mapAdminDirectChatRestrictAudit('evt-2', { action: 'direct-chat-remove-direct-message' })).toBeNull();
  });

  it('clamps retention through the shared policy mapper and audits before/after', async () => {
    const db = createDb({
      'directChatRetention/current': {
        evidenceRetentionDays: 90,
        legalHoldRetentionDays: 180,
        messageRetentionDays: 365,
        policyVersion: 1,
      },
    });
    const fieldValue = { serverTimestamp: () => ({ __server: true }) };
    const patched = {
      doc(path) { return Object.assign(db.doc(path), { path }); },
      async runTransaction(handler) {
        const outcome = await db.runTransaction(handler);
        return outcome.result;
      },
    };
    const result = await executeDirectChatRetentionPolicySet(patched, {
      email: 'owner@example.com',
      uid: 'owner-1',
    }, {
      messageRetentionDays: 5,
      reason: 'Tighten retention for incident',
      requestId: 'retention_request_123456',
    }, fieldValue);
    expect(result.unchanged).toBe(false);
    expect(result.policy.messageRetentionDays).toBe(30);
    expect(db._docs.get('directChatRetention/current')).toMatchObject({
      messageRetentionDays: 30,
      updatedBy: 'owner-1',
    });
    expect(db._docs.get('adminAuditEvents/direct_chat_retention_retention_request_123456')).toMatchObject({
      action: 'direct-chat-retention-policy',
      before: retentionPolicyFields(mapDirectChatRetentionPolicy({
        evidenceRetentionDays: 90,
        legalHoldRetentionDays: 180,
        messageRetentionDays: 365,
      })),
      after: result.policy,
      kind: 'direct-chat-retention',
      status: 'completed',
    });
  });

  it('returns an unchanged audit when clamped values match current policy', async () => {
    const current = mapDirectChatRetentionPolicy({
      evidenceRetentionDays: 90,
      legalHoldRetentionDays: 180,
      messageRetentionDays: 365,
    });
    const db = createDb({ 'directChatRetention/current': current });
    const patched = {
      doc(path) { return Object.assign(db.doc(path), { path }); },
      async runTransaction(handler) {
        const outcome = await db.runTransaction(handler);
        return outcome.result;
      },
    };
    const result = await executeDirectChatRetentionPolicySet(patched, {
      email: 'owner@example.com',
      uid: 'owner-1',
    }, {
      messageRetentionDays: 365,
      reason: 'No-op check',
      requestId: 'retention_request_abcdef',
    }, { serverTimestamp: () => ({ __server: true }) });
    expect(result).toMatchObject({ unchanged: true });
    expect(db._docs.get('adminAuditEvents/direct_chat_retention_retention_request_abcdef')).toMatchObject({
      status: 'unchanged',
    });
  });

  it('assembles a light ops status payload without conversation content', async () => {
    const db = createDb({
      'appConfig/socialFeatures': {
        directMessageMedia: false,
        directMessageRequests: false,
        directMessages: true,
      },
      'appRuntime/directChatRollout': {
        note: 'friends-text',
        stageId: 1,
        updatedAt: { toDate: () => new Date('2026-08-01T00:00:00.000Z') },
        updatedBy: 'owner-1',
      },
      'directChatRetention/current': { messageRetentionDays: 120 },
      'directChatRetention/sweepState': { cursor: 'conv-1', wrapped: false },
      'directChatRestrictions/user-a': { state: 'restricted' },
      'directChatRestrictions/user-b': { state: 'restricted' },
      'adminAuditEvents/reconcile-1': {
        action: 'direct-chat-reconcile',
        createdAt: { toDate: () => new Date('2026-08-02T00:00:00.000Z') },
      },
    });
    const patched = {
      doc(path) { return Object.assign(db.doc(path), { path }); },
      collection(name) { return db.collection(name); },
    };
    const status = await resolveDirectChatOpsStatus(patched);
    expect(status).toMatchObject({
      flags: { directMessages: true, directMessageRequests: false, directMessageMedia: false },
      stage: { stageId: 1, name: 'friends-text' },
      restrictedAccountSampleCount: 2,
      lastReconcile: { id: 'reconcile-1' },
      retention: { messageRetentionDays: 120, sweepCursor: 'conv-1' },
    });
    expect(status).not.toHaveProperty('conversations');
    expect(status).not.toHaveProperty('messages');
  });

  it('resolves retention policy with hard bounds for the dashboard', async () => {
    const db = createDb({});
    const patched = { doc(path) { return Object.assign(db.doc(path), { path }); } };
    const retention = await resolveDirectChatRetentionPolicy(patched);
    expect(retention.policy.source).toBe('default');
    expect(retention.bounds.messageRetentionDays.minDays).toBe(30);
    expect(retention.bounds.legalHoldRetentionDays.minDays).toBe(90);
  });
});
