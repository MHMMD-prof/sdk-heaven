import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hashRepresentativeOpaqueToken } = require('./representativePortalCore');
const {
  executeAdminRepresentativeUpdate,
  getRepresentativeStatus,
  mapRepresentativePinState,
  reconcileRepresentativeBadges,
  reverseRepresentativeTransfer,
  resolveRepresentativeTransferPolicy,
  synchronizeRepresentativeBadge,
  transferRepresentativeFunds,
  utcDayBucket,
  utcHourBucket,
} = require('./representativeService');
const { processStatusSourceEvent, processStatusSourceOutbox } = require('./statusProgressionService');

const fieldValue = { delete: () => '__delete__', serverTimestamp: () => timestamp(9_999) };
const nowMillis = 1_000_000;
const portalOrigin = 'https://representative.example.com';
const portalSessionId = 'a'.repeat(64);
const proof = Buffer.alloc(32, 4).toString('base64url');
const proofId = hashRepresentativeOpaqueToken(proof);

describe('representativeService hardened transfer', () => {
  it('moves the shared balance, consumes proof, increments counters, enriches receipts, and is exactly idempotent', async () => {
    const db = representativeDb();
    const command = transferArgs(db);
    const first = await transferRepresentativeFunds(command);
    expect(first).toMatchObject({
      result: {
        amount: 20,
        balances: { coins: 80, diamonds: 5 },
        publicReference: 'RPT-0123456789ABCDEF',
        recipient: { displayName: 'recipient', publicId: '2222222' },
        recipientUid: 'recipient',
      },
    });
    await expect(transferRepresentativeFunds(command)).resolves.toEqual(first);
    expect(db.read('walletSummaries/recipient').balances).toEqual({ coins: 30, diamonds: 1 });
    expect(db.read(`representativeRecipientProofs/${proofId}`)).toMatchObject({ consumedByRequestId: 'representative_transfer_1', state: 'consumed' });
    expect(db.read('representativeTransferCounters/sender/days/1970-01-01')).toMatchObject({ amounts: { coins: 20, diamonds: 0 } });
    expect(db.read('representativeTransferCounters/sender/hours/1970-01-01T00')).toMatchObject({ counts: { coins: 1, diamonds: 0 } });
    expect(db.read('representativePublicReferences/RPT-0123456789ABCDEF')).toMatchObject({ transferId: 'sender_representative_transfer_1' });
    expect(db.read('representativeTransferReceipts/sender/items/sender_representative_transfer_1')).toMatchObject({
      amount: 20, balanceAfter: 80, balanceBefore: 100, publicReference: 'RPT-0123456789ABCDEF', recipientDisplayName: 'recipient',
    });
    expect(db.read('walletRechargeReceipts/recipient/items/sender_representative_transfer_1')).toMatchObject({
      amount: 20, balanceAfter: 30, balanceBefore: 10, publicReference: 'RPT-0123456789ABCDEF', representativeDisplayName: 'sender',
    });
    expect(db.read('statusSourceOutbox/representative_sender_representative_transfer_1')).toMatchObject({
      amount: 20, currency: 'coins', sourceKind: 'representative-recharge', state: 'queued', uid: 'recipient',
    });
    expect([...db.documents.keys()].filter((path) => path.startsWith('representativeTransfers/'))).toHaveLength(1);

    await expect(getRepresentativeStatus({ clock: testClock(), db, portalOrigin, uid: 'sender' })).resolves.toMatchObject({
      result: {
        dailyAllowance: { coins: 999_980 },
        feature: { available: true },
        pin: { state: 'ready' },
        recentTransfers: [{ amount: 20, balanceBefore: 100, publicReference: 'RPT-0123456789ABCDEF', recipientDisplayName: 'recipient' }],
      },
    });
  });

  it('returns one result for simultaneous duplicate submissions and consumes a proof only once across different requests', async () => {
    const duplicateDb = representativeDb();
    const duplicate = transferArgs(duplicateDb);
    const [left, right] = await Promise.all([transferRepresentativeFunds(duplicate), transferRepresentativeFunds(duplicate)]);
    expect(left).toEqual(right);
    expect(duplicateDb.read('walletSummaries/sender').balances.coins).toBe(80);

    const proofDb = representativeDb();
    const [first, second] = await Promise.all([
      transferRepresentativeFunds(transferArgs(proofDb, { requestId: 'representative_transfer_a' })),
      transferRepresentativeFunds(transferArgs(proofDb, { requestId: 'representative_transfer_b' })),
    ]);
    expect([first.errorCode, second.errorCode].filter(Boolean)).toEqual(['PROOF_INVALID']);
    expect(proofDb.read('walletSummaries/sender').balances.coins).toBe(80);
  });

  it('rejects reuse of a request ID with a changed amount', async () => {
    const db = representativeDb();
    await expect(transferRepresentativeFunds(transferArgs(db))).resolves.toHaveProperty('result');
    await expect(transferRepresentativeFunds(transferArgs(db, { amount: 21 }))).resolves.toEqual({ errorCode: 'REQUEST_CONFLICT' });
    expect(db.read('walletSummaries/sender').balances.coins).toBe(80);
  });

  it('rejects stale proofs, consumed proofs, self recipients, and expired sessions without wallet writes', async () => {
    for (const [mutate, expected] of [
      [(db) => db.documents.set(`representativeRecipientProofs/${proofId}`, { ...db.read(`representativeRecipientProofs/${proofId}`), expiresAt: timestamp(nowMillis) }), 'PROOF_INVALID'],
      [(db) => db.documents.set(`representativeRecipientProofs/${proofId}`, { ...db.read(`representativeRecipientProofs/${proofId}`), state: 'consumed' }), 'PROOF_INVALID'],
      [(db) => db.documents.set(`representativeRecipientProofs/${proofId}`, { ...db.read(`representativeRecipientProofs/${proofId}`), recipientPublicId: '1111111', recipientUid: 'sender' }), 'PROOF_INVALID'],
      [(db) => db.documents.set(`representativePortalSessions/${portalSessionId}`, { ...db.read(`representativePortalSessions/${portalSessionId}`), expiresAt: timestamp(nowMillis) }), 'PORTAL_SESSION_INVALID'],
    ]) {
      const db = representativeDb();
      mutate(db);
      await expect(transferRepresentativeFunds(transferArgs(db))).resolves.toEqual({ errorCode: expected });
      expect(db.read('walletSummaries/sender').balances.coins).toBe(100);
    }
  });

  it('enforces permission, balance, per-transfer, daily, and hourly policy limits', async () => {
    const diamondDb = representativeDb();
    await expect(transferRepresentativeFunds(transferArgs(diamondDb, { amount: 1, currency: 'diamonds' }))).resolves.toEqual({ errorCode: 'PERMISSION_DENIED' });

    const balanceDb = representativeDb();
    await expect(transferRepresentativeFunds(transferArgs(balanceDb, { amount: 101 }))).resolves.toEqual({ errorCode: 'INSUFFICIENT_FUNDS' });

    const perTransferDb = representativeDb();
    perTransferDb.documents.set('appConfig/representativeTransferPolicy', policy({ maxPerTransfer: 10 }));
    await expect(transferRepresentativeFunds(transferArgs(perTransferDb, { amount: 11 }))).resolves.toEqual({ errorCode: 'TRANSFER_LIMIT_EXCEEDED' });
    expect(perTransferDb.read('representativePortalSecurityEvents/transfer_limit_sender_representative_transfer_1')).toMatchObject({
      amount: 11, currency: 'coins', kind: 'transfer-limit-exceeded', limitKind: 'per-transfer', representativeUid: 'sender',
    });

    const dailyDb = representativeDb();
    dailyDb.documents.set('appConfig/representativeTransferPolicy', policy({ maxPerDay: 100, maxPerTransfer: 100 }));
    dailyDb.documents.set('representativeTransferCounters/sender/days/1970-01-01', { amounts: { coins: 95, diamonds: 0 } });
    await expect(transferRepresentativeFunds(transferArgs(dailyDb, { amount: 6 }))).resolves.toEqual({ errorCode: 'TRANSFER_LIMIT_EXCEEDED' });

    const hourlyDb = representativeDb();
    hourlyDb.documents.set('representativeTransferCounters/sender/hours/1970-01-01T00', { counts: { coins: 20, diamonds: 0 } });
    await expect(transferRepresentativeFunds(transferArgs(hourlyDb, { amount: 1 }))).resolves.toEqual({ errorCode: 'TRANSFER_RATE_LIMITED' });
    expect(hourlyDb.read('representativePortalSecurityEvents/transfer_limit_sender_representative_transfer_1')).toMatchObject({
      kind: 'rapid-transfer-limit', limitKind: 'hourly-count', representativeUid: 'sender',
    });
  });

  it('fails closed when the feature or policy is missing', async () => {
    const withoutFlag = representativeDb();
    withoutFlag.documents.set('appConfig/socialFeatures', { wallet: true });
    await expect(transferRepresentativeFunds(transferArgs(withoutFlag))).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });

    const withoutPolicy = representativeDb();
    withoutPolicy.documents.delete('appConfig/representativeTransferPolicy');
    await expect(transferRepresentativeFunds(transferArgs(withoutPolicy))).resolves.toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('requires a configured PIN, honors reset-required, counts failures, and locks after five attempts', async () => {
    const missing = representativeDb();
    missing.documents.delete('representativeTransferPins/sender');
    await expect(transferRepresentativeFunds(transferArgs(missing))).resolves.toEqual({ errorCode: 'PIN_NOT_CONFIGURED' });

    const reset = representativeDb();
    reset.documents.set('representativeTransferPins/sender', { ...reset.read('representativeTransferPins/sender'), resetRequired: true });
    await expect(transferRepresentativeFunds(transferArgs(reset))).resolves.toEqual({ errorCode: 'PIN_RESET_REQUIRED' });

    const wrong = representativeDb();
    const args = transferArgs(wrong, { verifyPin: async () => false });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(transferRepresentativeFunds(args)).resolves.toEqual({ errorCode: 'PIN_INVALID' });
      expect(wrong.read('representativeTransferPins/sender').failedAttempts).toBe(attempt);
    }
    await expect(transferRepresentativeFunds(args)).resolves.toEqual({ errorCode: 'PIN_LOCKED' });
    expect(wrong.read('representativeTransferPins/sender').lockedUntil.toMillis()).toBe(nowMillis + 900_000);
    await expect(transferRepresentativeFunds(args)).resolves.toEqual({ errorCode: 'PIN_LOCKED' });
    expect([...wrong.documents.values()].filter((value) => value?.kind === 'pin-failed')).toHaveLength(4);
    expect([...wrong.documents.values()].filter((value) => value?.kind === 'pin-locked')).toHaveLength(1);
    expect(wrong.read('walletSummaries/sender').balances.coins).toBe(100);
  });
});

describe('representativeService status and administration', () => {
  it('rejects reuse of an admin request ID for different representative permissions', async () => {
    const db = representativeDb();
    db.documents.set('adminAuditEvents/representative_admin_request_1', { action: 'representative-update', active: true, actorUid: 'admin', currencies: { coins: true, diamonds: false }, targetUid: 'sender' });
    const base = { db, decodedToken: { email: 'admin@example.com', uid: 'admin' }, fieldValue, input: { active: true, currencies: { coins: true, diamonds: false }, requestId: 'admin_request_1', targetUid: 'sender' } };
    await expect(executeAdminRepresentativeUpdate(base)).resolves.toBe('representative_admin_request_1');
    await expect(executeAdminRepresentativeUpdate({ ...base, input: { ...base.input, currencies: { coins: false, diamonds: true } } })).rejects.toMatchObject({ status: 409 });
  });

  it('projects an active representative badge into the public profile atomically', async () => {
    const db = representativeDb();
    await executeAdminRepresentativeUpdate({
      db,
      decodedToken: { email: 'admin@example.com', uid: 'admin' },
      fieldValue,
      input: {
        active: true,
        currencies: { coins: true, diamonds: false },
        expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
        reason: 'Activate representative access',
        requestId: 'activate_representative_1',
        targetUid: 'sender',
      },
    });
    expect(db.read('publicProfiles/sender').representativeBadge.active).toBe(true);
    expect(db.read('publicProfiles/sender').representativeBadge.updatedAt.toMillis()).toBe(9_999);
    expect(db.read('representativePrivileges/sender').active).toBe(true);
  });

  it('removes the public badge projection atomically when representative access is revoked', async () => {
    const db = representativeDb();
    db.documents.set('publicProfiles/sender', {
      ...db.read('publicProfiles/sender'),
      representativeBadge: { active: true, updatedAt: timestamp(1) },
    });
    await executeAdminRepresentativeUpdate({
      db,
      decodedToken: { email: 'admin@example.com', uid: 'admin' },
      fieldValue,
      input: {
        active: false,
        currencies: { coins: false, diamonds: false },
        expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
        reason: 'Revoke representative access',
        requestId: 'revoke_representative_1',
        targetUid: 'sender',
      },
    });
    expect(db.read('publicProfiles/sender').representativeBadge.active).toBe(false);
    expect(db.read('publicProfiles/sender').representativeBadge.updatedAt.toMillis()).toBe(9_999);
    expect(db.read('representativePrivileges/sender').active).toBe(false);
  });

  it('synchronizes privilege writes without requiring an admin-dashboard deployment', async () => {
    const db = representativeDb();
    await expect(synchronizeRepresentativeBadge({
      db,
      fieldValue,
      privilegeData: { active: true },
      uid: 'sender',
    })).resolves.toEqual({ active: true, status: 'synchronized', uid: 'sender' });
    expect(db.read('publicProfiles/sender').representativeBadge.active).toBe(true);
    expect(db.read('publicProfiles/sender').representativeBadge.updatedAt.toMillis()).toBe(9_999);

    await expect(synchronizeRepresentativeBadge({
      db,
      fieldValue,
      privilegeData: { active: true },
      uid: 'sender',
    })).resolves.toEqual({ active: true, status: 'already-synchronized', uid: 'sender' });

    await expect(synchronizeRepresentativeBadge({
      db,
      fieldValue,
      privilegeData: undefined,
      uid: 'sender',
    })).resolves.toEqual({ active: false, status: 'synchronized', uid: 'sender' });
    expect(db.read('publicProfiles/sender').representativeBadge.active).toBe(false);
  });

  it('fails closed without creating a profile when badge synchronization finds no public profile', async () => {
    const db = representativeDb();
    db.documents.delete('publicProfiles/sender');
    await expect(synchronizeRepresentativeBadge({
      db,
      fieldValue,
      privilegeData: { active: true },
      uid: 'sender',
    })).resolves.toEqual({ active: false, status: 'missing-public-profile', uid: 'sender' });
  });

  it('reconciles existing privileges and removes badges whose privilege document was deleted', async () => {
    const db = representativeDb();
    db.documents.set('publicProfiles/removed-representative', {
      ...profile('removed-representative', '3333333'),
      representativeBadge: { active: true, updatedAt: timestamp(1) },
    });

    await expect(reconcileRepresentativeBadges({ db, fieldValue })).resolves.toEqual({
      alreadySynchronized: 0,
      missingPublicProfiles: 0,
      scanned: 2,
      synchronized: 2,
      truncated: false,
    });
    expect(db.read('publicProfiles/sender').representativeBadge.active).toBe(true);
    expect(db.read('publicProfiles/removed-representative').representativeBadge.active).toBe(false);
  });

  it('rejects stale representative permission edits', async () => {
    const db = representativeDb();
    await expect(executeAdminRepresentativeUpdate({
      db,
      decodedToken: { email: 'admin@example.com', uid: 'admin' },
      fieldValue,
      input: { active: true, currencies: { coins: true, diamonds: false }, expectedUpdatedAt: '2026-07-21T00:00:00.000Z', reason: 'Stale update test', requestId: 'stale_representative_1', targetUid: 'sender' },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.read('adminAuditEvents/representative_stale_representative_1')).toBeUndefined();
  });

  it('reverses a completed transfer with compensating wallets, ledgers, receipts, and audit only', async () => {
    const db = representativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    const originalTransfer = { ...db.read('representativeTransfers/sender_representative_transfer_1') };
    const originalRepresentativeReceipt = { ...db.read('representativeTransferReceipts/sender/items/sender_representative_transfer_1') };

    await expect(reverseRepresentativeTransfer(reversalArgs(db))).resolves.toMatchObject({
      amount: 20,
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      status: 'reversed',
    });

    expect(db.read('walletSummaries/sender').balances.coins).toBe(100);
    expect(db.read('walletSummaries/recipient').balances.coins).toBe(10);
    expect(db.read('representativeTransfers/sender_representative_transfer_1')).toEqual(originalTransfer);
    expect(db.read('representativeTransferReceipts/sender/items/sender_representative_transfer_1')).toEqual(originalRepresentativeReceipt);
    expect(db.read('representativeTransferReversals/sender_representative_transfer_1')).toMatchObject({
      amount: 20,
      status: 'completed',
    });
    expect(db.read('representativeTransferReceipts/sender/items/reversal_sender_representative_transfer_1')).toMatchObject({
      balanceAfter: 100,
      balanceBefore: 80,
      status: 'reversed',
    });
    expect(db.read('walletRechargeReceipts/recipient/items/reversal_sender_representative_transfer_1')).toMatchObject({
      balanceAfter: 10,
      balanceBefore: 30,
      status: 'reversed',
    });
    expect(db.read('walletTransactions/representative_reversal_credit_sender_sender_representative_transfer_1')).toMatchObject({
      balanceAfter: 100,
      source: 'representative-transfer-reversal',
    });
    expect(db.read('adminAuditEvents/representative-reversal_reversal_request_1')).toMatchObject({
      action: 'representative-reversal',
      note: 'Duplicate external settlement',
      status: 'completed',
    });
    expect(db.read('statusSourceOutbox/representative_reversal_sender_representative_transfer_1')).toMatchObject({
      reversalOf: 'representative_sender_representative_transfer_1',
      sourceKind: 'representative-reversal',
      state: 'queued',
      uid: 'recipient',
    });
  });

  it('awards a recharge exactly once and demotes from only its linked reversal', async () => {
    const db = representativeDb();
    db.documents.set('appConfig/statusFeatures', {
      schemaVersion: 1, vipProgression: true, aristocracyShop: false, statusPresentation: false,
      statusProjectionRepair: false, statusAnnouncements: false, statusAnimations: false,
    });
    db.documents.set('statusCatalogPointers/vip-svip', {
      schemaVersion: 1, kind: 'vip-svip', activeCatalogVersion: 'vip-wave2-test',
    });
    db.documents.set('vipTierCatalogVersions/vip-wave2-test', vipCatalog());

    await transferRepresentativeFunds(transferArgs(db));
    const first = await processStatusSourceOutbox({ clock: testClock(), db, fieldValue });
    expect(first).toMatchObject({ processed: 1, promoted: 1, replayed: 0 });
    expect(db.read('vipAccounts/recipient')).toMatchObject({ points: 20, levelId: 'vip-1', highestLevelOrder: 1 });
    expect(db.read('vipContributions/representative_sender_representative_transfer_1')).toMatchObject({
      pointDelta: 20, settlementState: 'settled', uid: 'recipient',
    });
    await expect(processStatusSourceOutbox({ clock: testClock(), db, fieldValue })).resolves.toMatchObject({ processed: 0 });

    await reverseRepresentativeTransfer(reversalArgs(db));
    const reversed = await processStatusSourceOutbox({ clock: testClock(), db, fieldValue });
    expect(reversed).toMatchObject({ processed: 1, demoted: 1 });
    expect(db.read('vipAccounts/recipient')).toMatchObject({ points: 0, levelId: null, highestLevelOrder: 1 });
    expect(db.read('vipContributions/representative_reversal_sender_representative_transfer_1')).toMatchObject({
      pointDelta: -20,
      reversalOf: 'representative_sender_representative_transfer_1',
      settlementState: 'reversed',
    });
    expect([...db.documents.keys()].filter((path) => path.startsWith('vipContributions/'))).toHaveLength(2);
  });

  it('can drain verified migration evidence while public VIP progression remains dark', async () => {
    const db = representativeDb();
    db.documents.set('appConfig/statusFeatures', {
      schemaVersion: 1, vipProgression: false, aristocracyShop: false, statusPresentation: false,
      statusProjectionRepair: true, statusAnnouncements: false, statusAnimations: false,
    });
    db.documents.set('statusCatalogPointers/vip-svip', {
      schemaVersion: 1, kind: 'vip-svip', activeCatalogVersion: 'vip-wave2-test',
    });
    db.documents.set('vipTierCatalogVersions/vip-wave2-test', vipCatalog());
    await transferRepresentativeFunds(transferArgs(db));
    await expect(processStatusSourceOutbox({ clock: testClock(), db, fieldValue }))
      .resolves.toMatchObject({ processed: 1, promoted: 1 });
    expect(db.read('vipAccounts/recipient')).toMatchObject({ points: 20, levelId: 'vip-1' });
  });

  it('serializes concurrent worker replays and writes one immutable contribution', async () => {
    const db = statusEnabledRepresentativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    const eventId = 'representative_sender_representative_transfer_1';
    const event = db.read(`statusSourceOutbox/${eventId}`);
    const [left, right] = await Promise.all([
      processStatusSourceEvent({ clock: testClock(), db, event, fieldValue }),
      processStatusSourceEvent({ clock: testClock(), db, event, fieldValue }),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(db.read('vipAccounts/recipient').points).toBe(20);
    expect([...db.documents.keys()].filter((path) => path.startsWith('vipContributions/'))).toHaveLength(1);
  });

  it('dead-letters evidence that no longer matches its authoritative transfer', async () => {
    const db = statusEnabledRepresentativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    db.documents.set('representativeTransfers/sender_representative_transfer_1', {
      ...db.read('representativeTransfers/sender_representative_transfer_1'), amount: 21,
    });
    const result = await processStatusSourceOutbox({ clock: testClock(), db, fieldValue });
    expect(result.failures).toEqual([{ eventId: 'representative_sender_representative_transfer_1', errorCode: 'SOURCE_MISMATCH' }]);
    expect(db.read('statusSourceOutbox/representative_sender_representative_transfer_1')).toMatchObject({
      attempts: 1, lastError: 'SOURCE_MISMATCH', state: 'dead-letter',
    });
    expect(db.read('vipAccounts/recipient')).toBeUndefined();
  });

  it('retries an out-of-order reversal until its original contribution settles', async () => {
    const db = statusEnabledRepresentativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    await reverseRepresentativeTransfer(reversalArgs(db));
    const rechargePath = 'statusSourceOutbox/representative_sender_representative_transfer_1';
    const reversalPath = 'statusSourceOutbox/representative_reversal_sender_representative_transfer_1';
    db.documents.set(rechargePath, { ...db.read(rechargePath), nextAttemptAt: timestamp(nowMillis + 600_000) });

    const early = await processStatusSourceOutbox({ clock: testClock(), db, fieldValue });
    expect(early.failures).toEqual([{
      eventId: 'representative_reversal_sender_representative_transfer_1',
      errorCode: 'ORIGINAL_CONTRIBUTION_PENDING',
    }]);
    expect(db.read(reversalPath)).toMatchObject({ attempts: 1, state: 'queued' });
    expect(db.read('vipAccounts/recipient')).toBeUndefined();

    db.documents.set(rechargePath, { ...db.read(rechargePath), nextAttemptAt: timestamp(nowMillis) });
    await processStatusSourceOutbox({ clock: testClock(), db, fieldValue });
    expect(db.read('vipAccounts/recipient').points).toBe(20);
    await processStatusSourceOutbox({ clock: testClock(nowMillis + 120_000), db, fieldValue });
    expect(db.read('vipAccounts/recipient').points).toBe(0);
    expect(db.read(reversalPath).state).toBe('completed');
  });

  it('makes a reversal request idempotent and signals a second reversal request', async () => {
    const db = representativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    const first = await reverseRepresentativeTransfer(reversalArgs(db));
    await expect(reverseRepresentativeTransfer(reversalArgs(db))).resolves.toEqual(first);
    await expect(reverseRepresentativeTransfer(reversalArgs(db, {
      requestId: 'reversal_request_2',
    }))).rejects.toMatchObject({ code: 'ALREADY_REVERSED', status: 409 });
    expect(db.read('representativePortalSecurityEvents/reversal_reversal_request_2')).toMatchObject({
      kind: 'repeated-reversal-attempt',
    });
    expect([...db.documents.keys()].filter((path) => path.startsWith('representativeTransferReversals/'))).toHaveLength(1);
  });

  it('rejects expired, mismatched, and underfunded reversals without moving either wallet', async () => {
    const expired = representativeDb();
    await transferRepresentativeFunds(transferArgs(expired));
    await expect(reverseRepresentativeTransfer(reversalArgs(expired, {}, nowMillis + 86_400_001)))
      .rejects.toMatchObject({ code: 'REVERSAL_EXPIRED' });
    expect(expired.read('walletSummaries/sender').balances.coins).toBe(80);
    expect(expired.read('walletSummaries/recipient').balances.coins).toBe(30);

    const mismatch = representativeDb();
    await transferRepresentativeFunds(transferArgs(mismatch));
    await expect(reverseRepresentativeTransfer(reversalArgs(mismatch, {
      expectedCurrency: 'diamonds',
    }))).rejects.toMatchObject({ code: 'TRANSFER_MISMATCH' });
    expect(mismatch.read('representativePortalSecurityEvents/reversal_reversal_request_1')).toMatchObject({
      kind: 'reversal-record-mismatch',
    });

    const underfunded = representativeDb();
    await transferRepresentativeFunds(transferArgs(underfunded));
    underfunded.documents.set('walletSummaries/recipient', wallet('recipient', 19, 1));
    await expect(reverseRepresentativeTransfer(reversalArgs(underfunded)))
      .rejects.toMatchObject({ code: 'RECIPIENT_FUNDS_CHANGED' });
    expect(underfunded.read('walletSummaries/sender').balances.coins).toBe(80);
    expect(underfunded.read('walletSummaries/recipient').balances.coins).toBe(19);
  });

  it('serializes concurrent recipient spend before reversal and never overdraws', async () => {
    const db = representativeDb();
    await transferRepresentativeFunds(transferArgs(db));
    const spend = db.runTransaction(async (transaction) => {
      const ref = db.doc('walletSummaries/recipient');
      const snapshot = await transaction.get(ref);
      transaction.set(ref, { ...snapshot.data(), balances: { coins: 15, diamonds: 1 } });
      return 'spent';
    });
    const reversal = reverseRepresentativeTransfer(reversalArgs(db));
    await expect(spend).resolves.toBe('spent');
    await expect(reversal).rejects.toMatchObject({ code: 'RECIPIENT_FUNDS_CHANGED' });
    expect(db.read('walletSummaries/recipient').balances.coins).toBe(15);
    expect(db.read('walletSummaries/sender').balances.coins).toBe(80);
  });

  it('maps overrides, PIN states, and deterministic UTC buckets', () => {
    const global = representativeDb().read('appConfig/representativeTransferPolicy');
    expect(resolveRepresentativeTransferPolicy(global, { limits: {} })).toMatchObject({
      configured: true,
      effective: global.limits,
      overrideCurrencies: [],
    });
    expect(resolveRepresentativeTransferPolicy(global, { limits: { coins: { maxPerDay: 200, maxPerTransfer: 50, maxTransfersPerHour: 5 } } })).toMatchObject({
      configured: true,
      effective: { coins: { maxPerDay: 200 }, diamonds: { maxPerDay: 100_000 } },
      overrideCurrencies: ['coins'],
    });
    expect(resolveRepresentativeTransferPolicy(global, { limits: { coins: { maxPerDay: 10, maxPerTransfer: 20, maxTransfersPerHour: 5 } } })).toMatchObject({ configured: false });
    expect(mapRepresentativePinState({ ...pinDocument(), lockedUntil: timestamp(2_000) }, 1_000)).toEqual({ lockedUntil: '1970-01-01T00:00:02.000Z', state: 'locked' });
    expect(mapRepresentativePinState({ ...pinDocument(), lockedUntil: timestamp(500) }, 1_000)).toEqual({ state: 'ready' });
    expect(utcDayBucket(Date.parse('2026-07-22T23:59:59.000Z'))).toBe('2026-07-22');
    expect(utcHourBucket(Date.parse('2026-07-22T23:59:59.000Z'))).toBe('2026-07-22T23');
  });
});

function transferArgs(db, overrides = {}) {
  const { amount = 20, currency = 'coins', requestId = 'representative_transfer_1', verifyPin = async () => true } = overrides;
  return {
    clock: testClock(),
    createPublicReference: () => 'RPT-0123456789ABCDEF',
    db,
    fieldValue,
    input: { amount, currency, pin: '012345', proof },
    portalOrigin,
    portalSessionId,
    requestId,
    uid: 'sender',
    verifyPin,
  };
}

function reversalArgs(db, overrides = {}, reversalNowMillis = nowMillis) {
  return {
    clock: testClock(reversalNowMillis),
    db,
    decodedToken: { email: 'admin@example.com', uid: 'admin' },
    fieldValue,
    input: {
      expectedAmount: 20,
      expectedCurrency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      reason: 'Duplicate external settlement',
      requestId: 'reversal_request_1',
      ...overrides,
    },
  };
}

function representativeDb() {
  const createdAt = timestamp(1);
  return new FakeFirestore({
    'appConfig/representativeTransferPolicy': policy(),
    'appConfig/socialFeatures': { representativeTransfers: true, wallet: true },
    'publicIds/1111111': { createdAt, uid: 'sender' },
    'publicIds/2222222': { createdAt, uid: 'recipient' },
    'publicProfiles/sender': profile('sender', '1111111'),
    'publicProfiles/recipient': profile('recipient', '2222222'),
    [`representativePortalSessions/${portalSessionId}`]: { expiresAt: timestamp(nowMillis + 900_000), origin: portalOrigin, representativeUid: 'sender', state: 'active' },
    'representativePrivileges/sender': { active: true, currencies: { coins: true, diamonds: false }, uid: 'sender', updatedAt: createdAt },
    [`representativeRecipientProofs/${proofId}`]: { expiresAt: timestamp(nowMillis + 60_000), recipientPublicId: '2222222', recipientUid: 'recipient', representativeUid: 'sender', state: 'unused' },
    'representativeTransferPins/sender': pinDocument(),
    'walletSummaries/sender': wallet('sender', 100, 5),
    'walletSummaries/recipient': wallet('recipient', 10, 1),
  });
}

function statusEnabledRepresentativeDb() {
  const db = representativeDb();
  db.documents.set('appConfig/statusFeatures', {
    schemaVersion: 1, vipProgression: true, aristocracyShop: false, statusPresentation: false,
    statusProjectionRepair: false, statusAnnouncements: false, statusAnimations: false,
  });
  db.documents.set('statusCatalogPointers/vip-svip', {
    schemaVersion: 1, kind: 'vip-svip', activeCatalogVersion: 'vip-wave2-test',
  });
  db.documents.set('vipTierCatalogVersions/vip-wave2-test', vipCatalog());
  return db;
}

function policy(coins = {}) {
  return {
    limits: {
      coins: { maxPerDay: 1_000_000, maxPerTransfer: 100_000, maxTransfersPerHour: 20, ...coins },
      diamonds: { maxPerDay: 100_000, maxPerTransfer: 10_000, maxTransfersPerHour: 10 },
    },
  };
}
function vipCatalog() {
  return {
    schemaVersion: 1,
    catalogVersion: 'vip-wave2-test',
    kind: 'vip-svip',
    state: 'published',
    authoredBy: 'economy-admin',
    approvedBy: 'platform-owner',
    reason: 'Wave 2 integration test',
    pointPolicy: {
      currency: 'coins', eligibleSources: ['representative-transfer'], pointsPerCoinNumerator: 1,
      pointsPerCoinDenominator: 1, reversalMode: 'linked-net', spendingMode: 'no-effect',
    },
    tiers: [
      { id: 'vip-1', band: 'vip', level: 1, order: 1, minPoints: 10, name: { ar: 'VIP 1', en: 'VIP 1' }, accentColor: '#D4AF37', benefits: [], assets: {} },
      { id: 'svip-1', band: 'svip', level: 1, order: 2, minPoints: 100, name: { ar: 'SVIP 1', en: 'SVIP 1' }, accentColor: '#22A978', benefits: [], assets: {} },
    ],
  };
}
function pinDocument() {
  return {
    algorithm: 'scrypt',
    derivedKey: Buffer.alloc(32, 1).toString('base64url'),
    failedAttempts: 0,
    lockedUntil: null,
    params: { blockSize: 8, cost: 16384, keyBytes: 32, parallelization: 1 },
    resetRequired: false,
    salt: Buffer.alloc(16, 2).toString('base64url'),
  };
}
function profile(uid, publicId) { return { avatarLabel: 'A', avatarModerationStatus: 'clear', avatarUrl: '', bio: '', countryCode: 'IQ', createdAt: timestamp(1), coupleId: '', coupleLevel: 0, displayName: uid, friendCount: 0, giftScore: 0, moderationStatus: 'active', normalizedName: uid, publicId, searchPrefixes: [uid], uid, updatedAt: timestamp(1) }; }
function wallet(uid, coins, diamonds) { return { balances: { coins, diamonds }, createdAt: timestamp(1), lifetimeCredit: { coins, diamonds }, lifetimeDebit: { coins: 0, diamonds: 0 }, uid, updatedAt: timestamp(1) }; }
function testClock(value = nowMillis) { return { nowMillis: () => value, timestampFromMillis: timestamp }; }
function timestamp(value) { return { toDate: () => new Date(value), toMillis: () => value }; }

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); this.transactionTail = Promise.resolve(); }
  doc(path) {
    return {
      get: async () => snapshot(path, this.documents.get(path)),
      id: path.split('/').at(-1),
      path,
      update: async (data) => {
        if (!this.documents.has(path)) throw new Error(`Missing: ${path}`);
        this.documents.set(path, { ...this.documents.get(path), ...data });
      },
    };
  }
  collection(path) { return new FakeQuery(this, path); }
  read(path) { return this.documents.get(path); }
  async runTransaction(callback) {
    const run = async () => {
      const tx = new FakeTransaction(this);
      const result = await callback(tx);
      tx.commit();
      return result;
    };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
class FakeTransaction {
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ kind: 'create', path: ref.path, data }); }
  set(ref, data) { this.operations.push({ kind: 'set', path: ref.path, data }); }
  update(ref, data) { this.operations.push({ kind: 'update', path: ref.path, data }); }
  commit() {
    for (const op of this.operations) {
      if (op.kind === 'create' && this.db.documents.has(op.path)) throw new Error(`Exists: ${op.path}`);
      this.db.documents.set(op.path, op.kind === 'update'
        ? { ...this.db.documents.get(op.path), ...op.data }
        : op.data);
    }
  }
}
class FakeQuery {
  constructor(db, path, descending = false, limitCount = 50, filters = []) {
    this.db = db;
    this.path = path;
    this.descending = descending;
    this.limitCount = limitCount;
    this.filters = filters;
  }
  orderBy(_field, direction) { return new FakeQuery(this.db, this.path, direction === 'desc', this.limitCount, this.filters); }
  limit(count) { return new FakeQuery(this.db, this.path, this.descending, count, this.filters); }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, this.descending, this.limitCount, [...this.filters, { field, operator, value }]);
  }
  async get() {
    let rows = [...this.db.documents.entries()].filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'));
    rows = rows.filter(([, data]) => this.filters.every(({ field, operator, value }) => {
      const actual = field.split('.').reduce((current, key) => current?.[key], data);
      if (operator === '==') return actual === value;
      if (operator === '<=') {
        const left = typeof actual?.toMillis === 'function' ? actual.toMillis() : actual;
        const right = typeof value?.toMillis === 'function' ? value.toMillis() : value;
        return left <= right;
      }
      return false;
    }));
    rows.sort((left, right) => (left[1].createdAt?.toMillis() || 0) - (right[1].createdAt?.toMillis() || 0));
    if (this.descending) rows.reverse();
    const docs = rows.slice(0, this.limitCount).map(([path, data]) => ({
      ...snapshot(path, data),
      ref: this.db.doc(path),
    }));
    return { docs, size: docs.length };
  }
}
function snapshot(path, data) { return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: { path } }; }
