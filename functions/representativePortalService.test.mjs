import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hashRepresentativeOpaqueToken } = require('./representativePortalCore');
const {
  createRepresentativePortalTicket,
  exchangeRepresentativePortalTicket,
  getRepresentativeHistory,
  getRepresentativePortalStatus,
  lookupRepresentativeReceipt,
  mapRepresentativePortalTransferResult,
  previewRepresentativeRecipient,
  setupRepresentativeTransferPin,
} = require('./representativePortalService');

const portalOrigin = 'https://representative.example.com';

describe('representativePortalService', () => {
  it('creates a hashed, short-lived ticket only for an enabled active representative', async () => {
    const db = representativePortalDb();
    const response = await createRepresentativePortalTicket({ clock: testClock(), db, portalOrigin, randomBytes: filledBytes(1), uid: 'sender' });
    expect(response).toMatchObject({ result: { portalOrigin, ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) } });
    const ticketId = hashRepresentativeOpaqueToken(response.result.ticket);
    expect(db.read(`representativePortalBootstrapTickets/${ticketId}`)).toMatchObject({ origin: portalOrigin, representativeUid: 'sender', state: 'unused' });
    expect(JSON.stringify([...db.documents.values()])).not.toContain(response.result.ticket);

    const disabled = representativePortalDb({ 'appConfig/socialFeatures': { representativeTransfers: false, wallet: true } });
    await expect(createRepresentativePortalTicket({ clock: testClock(), db: disabled, portalOrigin, randomBytes: filledBytes(1), uid: 'sender' })).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('exchanges a ticket once and stores only a hashed portal session', async () => {
    const db = representativePortalDb();
    const ticket = await createRepresentativePortalTicket({ clock: testClock(), db, portalOrigin, randomBytes: filledBytes(1), uid: 'sender' });
    const exchange = await exchangeRepresentativePortalTicket({ clock: testClock(1_001_000), db, portalOrigin, randomBytes: filledBytes(2), requestOrigin: portalOrigin, ticket: ticket.result.ticket });
    expect(exchange).toMatchObject({ result: { sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) } });
    const sessionId = hashRepresentativeOpaqueToken(exchange.result.sessionToken);
    expect(db.read(`representativePortalSessions/${sessionId}`)).toMatchObject({ representativeUid: 'sender', state: 'active' });
    expect(db.read(`representativePortalBootstrapTickets/${hashRepresentativeOpaqueToken(ticket.result.ticket)}`)).toMatchObject({ consumedBySessionId: sessionId, state: 'consumed' });
    expect(JSON.stringify([...db.documents.values()])).not.toContain(exchange.result.sessionToken);
    await expect(exchangeRepresentativePortalTicket({ clock: testClock(1_002_000), db, portalOrigin, randomBytes: filledBytes(3), requestOrigin: portalOrigin, ticket: ticket.result.ticket })).resolves.toEqual({ errorCode: 'PORTAL_SESSION_INVALID' });
  });

  it('rejects wrong origins and expired tickets without creating sessions', async () => {
    const db = representativePortalDb();
    const ticket = await createRepresentativePortalTicket({ clock: testClock(), db, portalOrigin, randomBytes: filledBytes(1), uid: 'sender' });
    await expect(exchangeRepresentativePortalTicket({ clock: testClock(1_001_000), db, portalOrigin, randomBytes: filledBytes(2), requestOrigin: 'https://evil.example.com', ticket: ticket.result.ticket })).resolves.toEqual({ errorCode: 'PORTAL_ORIGIN_DENIED' });
    await expect(exchangeRepresentativePortalTicket({ clock: testClock(1_061_000), db, portalOrigin, randomBytes: filledBytes(2), requestOrigin: portalOrigin, ticket: ticket.result.ticket })).resolves.toEqual({ errorCode: 'PORTAL_SESSION_INVALID' });
    expect([...db.documents.keys()].filter((path) => path.startsWith('representativePortalSessions/'))).toHaveLength(0);
  });

  it('returns portal status with shared wallet, effective limits, and fail-closed readiness', async () => {
    const { db, sessionToken } = await activeSession();
    const status = await getRepresentativePortalStatus({ clock: testClock(1_002_000), db, portalOrigin, requestOrigin: portalOrigin, sessionToken });
    expect(status).toMatchObject({
      result: {
        dailyAllowance: { coins: 1_000_000, diamonds: 100_000 },
        feature: { available: true, enabled: true, policyConfigured: true, portalConfigured: true },
        limits: { configured: true },
        pin: { state: 'not-configured' },
        privilege: { active: true },
        wallet: { balances: { coins: 100, diamonds: 5 } },
      },
    });
    expect(status.result.privilege).not.toHaveProperty('uid');
    expect(status.result.wallet).not.toHaveProperty('uid');
    expect(status.result.recentTransfers.every((receipt) => !('transferId' in receipt) && !('recipientUid' in receipt))).toBe(true);
    db.documents.set('appConfig/socialFeatures', { representativeTransfers: false, wallet: true });
    await expect(getRepresentativePortalStatus({ clock: testClock(1_003_000), db, portalOrigin, requestOrigin: portalOrigin, sessionToken })).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('sets or resets a PIN only from a session backed by fresh account authentication', async () => {
    const fresh = await activeSession({ authTimeMillis: 900_000 });
    const result = await setupRepresentativeTransferPin({
      clock: testClock(1_002_000), db: fresh.db, hashPin: async () => pinHash(), pin: '012345',
      portalOrigin, requestOrigin: portalOrigin, sessionToken: fresh.sessionToken,
    });
    expect(result).toEqual({ result: { pin: { state: 'ready' } } });
    expect(fresh.db.read('representativeTransferPins/sender')).toMatchObject({ algorithm: 'scrypt', failedAttempts: 0, resetRequired: false });
    expect(JSON.stringify(fresh.db.read('representativeTransferPins/sender'))).not.toContain('012345');
    await expect(setupRepresentativeTransferPin({
      clock: testClock(1_003_000), db: fresh.db, hashPin: async () => pinHash(), pin: '999999',
      portalOrigin, requestOrigin: portalOrigin, sessionToken: fresh.sessionToken,
    })).resolves.toEqual({ errorCode: 'PIN_ALREADY_CONFIGURED' });
    fresh.db.documents.set('representativeTransferPins/sender', { ...fresh.db.read('representativeTransferPins/sender'), resetRequired: true });
    await expect(setupRepresentativeTransferPin({
      clock: testClock(1_004_000), db: fresh.db, hashPin: async () => ({ ...pinHash(), derivedKey: Buffer.alloc(32, 3).toString('base64url') }), pin: '999999',
      portalOrigin, requestOrigin: portalOrigin, sessionToken: fresh.sessionToken,
    })).resolves.toEqual({ result: { pin: { state: 'ready' } } });
    expect(fresh.db.read('representativeTransferPins/sender')).toMatchObject({ derivedKey: Buffer.alloc(32, 3).toString('base64url'), resetRequired: false });

    const stale = await activeSession();
    await expect(setupRepresentativeTransferPin({
      clock: testClock(1_002_000), db: stale.db, hashPin: async () => pinHash(), pin: '012345',
      portalOrigin, requestOrigin: portalOrigin, sessionToken: stale.sessionToken,
    })).resolves.toEqual({ errorCode: 'FRESH_AUTH_REQUIRED' });
  });

  it('returns a minimal recipient preview and stores a one-minute proof', async () => {
    const { db, sessionToken } = await activeSession();
    const preview = await previewRepresentativeRecipient({
      clock: testClock(1_002_000), db, portalOrigin, randomBytes: filledBytes(3), recipientPublicId: '2222222', requestOrigin: portalOrigin, sessionToken,
    });
    expect(preview).toMatchObject({ result: { proof: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), recipient: { avatarUrl: 'https://example.com/recipient.png', displayName: 'recipient', publicId: '2222222' } } });
    expect(db.read(`representativeRecipientProofs/${hashRepresentativeOpaqueToken(preview.result.proof)}`)).toMatchObject({ recipientUid: 'recipient', representativeUid: 'sender', state: 'unused' });
    expect(db.read('representativePortalRateLimits/sender')).toMatchObject({ count: 1 });
  });

  it('counts invalid lookups and rate-limits recipient enumeration', async () => {
    const { db, sessionToken } = await activeSession();
    const invalid = await previewRepresentativeRecipient({
      clock: testClock(1_002_000), db, portalOrigin, randomBytes: filledBytes(3), recipientPublicId: '3333333', requestOrigin: portalOrigin, sessionToken,
    });
    expect(invalid).toEqual({ errorCode: 'INVALID_RECIPIENT' });
    expect(db.read('representativePortalRateLimits/sender')).toMatchObject({ count: 1 });
    expect([...db.documents.values()]).toContainEqual(expect.objectContaining({ kind: 'invalid-recipient-lookup', representativeUid: 'sender' }));
    db.documents.set('representativePortalRateLimits/sender', { count: 20, representativeUid: 'sender', windowStartedAt: timestamp(1_000_000) });
    await expect(previewRepresentativeRecipient({
      clock: testClock(1_002_000), db, portalOrigin, randomBytes: filledBytes(4), recipientPublicId: '2222222', requestOrigin: portalOrigin, sessionToken,
    })).resolves.toEqual({ errorCode: 'RATE_LIMITED' });
    expect(db.read('representativePortalRateLimits/sender')).toMatchObject({ count: 21 });
    expect([...db.documents.values()]).toContainEqual(expect.objectContaining({ kind: 'recipient-lookup-rate-limited', representativeUid: 'sender' }));
  });

  it('returns only public transfer fields to the portal', () => {
    const result = mapRepresentativePortalTransferResult({
      amount: 20,
      balances: { coins: 80, diamonds: 5 },
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipient: { displayName: 'recipient', publicId: '2222222' },
      recipientUid: 'internal-recipient',
      representativeUid: 'internal-sender',
      transferId: 'internal-transfer',
    });
    expect(result).toEqual({
      amount: 20,
      balances: { coins: 80, diamonds: 5 },
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipient: { displayName: 'recipient', publicId: '2222222' },
    });
  });

  it('looks up only the signed-in representative receipt and derives reversal state safely', async () => {
    const { db, sessionToken } = await activeSession();
    db.documents.set('representativePublicReferences/RPT-0123456789ABCDEF', {
      representativeUid: 'sender',
      transferId: 'transfer_1',
    });
    db.documents.set('representativeTransfers/transfer_1', {
      amount: 20,
      createdAt: timestamp(900_000),
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'recipient',
      recipientPublicId: '2222222',
      recipientUid: 'internal-recipient',
      representativeUid: 'sender',
      status: 'completed',
    });
    db.documents.set('representativeTransferReversals/transfer_1', {
      createdAt: timestamp(950_000),
      publicReference: 'RPT-0123456789ABCDEF',
      status: 'completed',
      transferId: 'transfer_1',
    });

    await expect(lookupRepresentativeReceipt({
      clock: testClock(1_002_000),
      db,
      portalOrigin,
      publicReference: 'RPT-0123456789ABCDEF',
      requestOrigin: portalOrigin,
      sessionToken,
    })).resolves.toEqual({
      result: {
        amount: 20,
        createdAt: '1970-01-01T00:15:00.000Z',
        currency: 'coins',
        kind: 'reversal',
        publicReference: 'RPT-0123456789ABCDEF',
        recipientDisplayName: 'recipient',
        recipientPublicId: '2222222',
        reversedAt: '1970-01-01T00:15:50.000Z',
        status: 'reversed',
      },
    });

    db.documents.set('representativePublicReferences/RPT-1111111111111111', {
      representativeUid: 'another-representative',
      transferId: 'hidden-transfer',
    });
    await expect(lookupRepresentativeReceipt({
      clock: testClock(1_002_000),
      db,
      portalOrigin,
      publicReference: 'RPT-1111111111111111',
      requestOrigin: portalOrigin,
      sessionToken,
    })).resolves.toEqual({ errorCode: 'RECEIPT_NOT_FOUND' });
  });

  it('filters representative history and uses a session-bound opaque cursor', async () => {
    const { db, sessionToken } = await activeSession();
    db.documents.set('representativeTransferReceipts/sender/items/transfer_2', {
      amount: 4,
      createdAt: timestamp(2_000),
      currency: 'diamonds',
      publicReference: 'RPT-1111111111111111',
      recipientDisplayName: 'other',
      recipientPublicId: '3333333',
      status: 'completed',
    });
    db.documents.set('representativeTransferReceipts/sender/items/reversal_transfer_3', {
      amount: 6,
      createdAt: timestamp(3_000),
      currency: 'coins',
      publicReference: 'RPT-2222222222222222',
      recipientDisplayName: 'recipient',
      recipientPublicId: '2222222',
      status: 'reversed',
    });
    const input = { currency: '', cursor: '', from: '', limit: 1, status: '', to: '' };
    const first = await getRepresentativeHistory({
      clock: testClock(1_002_000),
      db,
      input,
      portalOrigin,
      randomBytes: filledBytes(5),
      requestOrigin: portalOrigin,
      sessionToken,
    });
    expect(first).toMatchObject({
      result: {
        items: [{ amount: 6, kind: 'reversal', status: 'reversed' }],
        nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    expect(JSON.stringify(first)).not.toContain('internal');

    const second = await getRepresentativeHistory({
      clock: testClock(1_003_000),
      db,
      input: { ...input, cursor: first.result.nextCursor },
      portalOrigin,
      randomBytes: filledBytes(6),
      requestOrigin: portalOrigin,
      sessionToken,
    });
    expect(second).toMatchObject({
      result: { items: [{ amount: 4, currency: 'diamonds', kind: 'transfer' }] },
    });

    await expect(getRepresentativeHistory({
      clock: testClock(1_003_000),
      db,
      input: { ...input, currency: 'coins', cursor: first.result.nextCursor },
      portalOrigin,
      randomBytes: filledBytes(6),
      requestOrigin: portalOrigin,
      sessionToken,
    })).resolves.toEqual({ errorCode: 'CURSOR_INVALID' });
  });
});

async function activeSession({ authTimeMillis = 0 } = {}) {
  const db = representativePortalDb();
  const ticket = await createRepresentativePortalTicket({ authTimeMillis, clock: testClock(), db, portalOrigin, randomBytes: filledBytes(1), uid: 'sender' });
  const exchange = await exchangeRepresentativePortalTicket({ clock: testClock(1_001_000), db, portalOrigin, randomBytes: filledBytes(2), requestOrigin: portalOrigin, ticket: ticket.result.ticket });
  return { db, sessionToken: exchange.result.sessionToken };
}

function representativePortalDb(overrides = {}) {
  const createdAt = timestamp(1);
  return new FakeFirestore({
    'appConfig/representativeTransferPolicy': {
      contractVersion: 1,
      limits: {
        coins: { maxPerDay: 1_000_000, maxPerTransfer: 100_000, maxTransfersPerHour: 20 },
        diamonds: { maxPerDay: 100_000, maxPerTransfer: 10_000, maxTransfersPerHour: 10 },
      },
    },
    'appConfig/socialFeatures': { representativeTransfers: true, wallet: true },
    'publicIds/1111111': { createdAt, uid: 'sender' },
    'publicIds/2222222': { createdAt, uid: 'recipient' },
    'publicProfiles/sender': profile('sender', '1111111'),
    'publicProfiles/recipient': profile('recipient', '2222222', 'https://example.com/recipient.png'),
    'representativePrivileges/sender': { active: true, currencies: { coins: true, diamonds: false }, uid: 'sender', updatedAt: createdAt },
    'representativeTransferReceipts/sender/items/transfer_1': {
      amount: 20,
      createdAt,
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'recipient',
      recipientPublicId: '2222222',
      recipientUid: 'recipient',
      status: 'completed',
    },
    'walletSummaries/sender': wallet('sender', 100, 5),
    ...overrides,
  });
}

function profile(uid, publicId, avatarUrl = '') { return { avatarLabel: uid[0].toUpperCase(), avatarModerationStatus: 'clear', avatarUrl, bio: '', countryCode: 'IQ', createdAt: timestamp(1), coupleId: '', coupleLevel: 0, displayName: uid, friendCount: 0, giftScore: 0, moderationStatus: 'active', normalizedName: uid, publicId, searchPrefixes: [uid], uid, updatedAt: timestamp(1) }; }
function wallet(uid, coins, diamonds) { return { balances: { coins, diamonds }, createdAt: timestamp(1), lifetimeCredit: { coins, diamonds }, lifetimeDebit: { coins: 0, diamonds: 0 }, uid, updatedAt: timestamp(1) }; }
function pinHash() { return { algorithm: 'scrypt', derivedKey: Buffer.alloc(32, 1).toString('base64url'), params: { blockSize: 8, cost: 16384, keyBytes: 32, parallelization: 1 }, salt: Buffer.alloc(16, 2).toString('base64url') }; }
function filledBytes(fill) { return (size) => Buffer.alloc(size, fill); }
function testClock(nowMillis = 1_000_000) { return { nowMillis: () => nowMillis, timestampFromMillis: timestamp }; }
function timestamp(value) { return { toDate: () => new Date(value), toMillis: () => value }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) { return { get: async () => snapshot(path, this.documents.get(path)), id: path.split('/').at(-1), path }; }
  collection(path) { return new FakeQuery(this, path); }
  read(path) { return this.documents.get(path); }
  async runTransaction(callback) { const transaction = new FakeTransaction(this); const result = await callback(transaction); transaction.commit(); return result; }
}
class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', path: ref.path, data }); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  commit() { for (const operation of this.operations) { if (operation.kind === 'create' && this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`); this.db.documents.set(operation.path, operation.data); } }
}
class FakeQuery {
  constructor(db, path, descending = false, limitCount = 50, startAfterPath = '') {
    this.db = db;
    this.path = path;
    this.descending = descending;
    this.limitCount = limitCount;
    this.startAfterPath = startAfterPath;
  }
  orderBy(_field, direction) { return new FakeQuery(this.db, this.path, direction === 'desc', this.limitCount, this.startAfterPath); }
  limit(count) { return new FakeQuery(this.db, this.path, this.descending, count, this.startAfterPath); }
  startAfter(snapshotValue) { return new FakeQuery(this.db, this.path, this.descending, this.limitCount, snapshotValue.ref.path); }
  async get() {
    let rows = [...this.db.documents.entries()].filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    rows.sort((left, right) => (left[1].createdAt?.toMillis() || 0) - (right[1].createdAt?.toMillis() || 0));
    if (this.descending) rows.reverse();
    if (this.startAfterPath) {
      const index = rows.findIndex(([path]) => path === this.startAfterPath);
      rows = index >= 0 ? rows.slice(index + 1) : [];
    }
    const docs = rows.slice(0, this.limitCount).map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
  }
}
function snapshot(path, data) { return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: { path } }; }
