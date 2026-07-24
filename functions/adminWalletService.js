const { isTimestampLike } = require('./socialProfileCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');

async function executeAdminWalletCredit({ db, decodedToken, fieldValue, input }) {
  return executeAdminWalletAdjustment({ db, decodedToken, fieldValue, input: { ...input, mutationType: 'credit' } });
}

async function executeAdminWalletAdjustment({ db, decodedToken, fieldValue, input }) {
  return db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`publicProfiles/${input.targetUid}`);
    const walletRef = db.doc(`walletSummaries/${input.targetUid}`);
    const ledgerRef = db.doc(`walletTransactions/admin_${input.requestId}`);
    const auditRef = db.doc(`adminAuditEvents/wallet_${input.requestId}`);
    const [profileSnapshot, walletSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(walletRef),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (
        previous.action === `wallet-${input.mutationType}`
        && previous.actorUid === decodedToken.uid
        && previous.amount === input.amount
        && previous.currency === input.currency
        && previous.targetUid === input.targetUid
      ) return auditRef.id;
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    if (!profileSnapshot.exists) throw Object.assign(new Error('Target public profile was not found.'), { status: 404 });
    const currentUpdatedAt = walletSnapshot.exists && isTimestampLike(walletSnapshot.data()?.updatedAt)
      ? new Date(walletSnapshot.data().updatedAt.toMillis()).toISOString()
      : '';
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentUpdatedAt) {
      throw Object.assign(new Error('This wallet changed since the user record was opened. Refresh before continuing.'), { status: 409 });
    }
    const wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, input.targetUid);
    const adjustment = applyWalletMutation(wallet, { amount: input.amount, currency: input.currency, type: input.mutationType });
    if (!adjustment.ok) throw Object.assign(new Error(adjustment.code === 'INSUFFICIENT_FUNDS' ? 'Wallet has insufficient funds.' : 'Wallet balance limit exceeded.'), { status: 409 });
    const { balanceAfter, wallet: walletAfter } = adjustment.value;
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(walletRef, buildWalletDocument(walletAfter, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data().createdAt) ? walletSnapshot.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(ledgerRef, buildWalletTransaction({
      actorUid: decodedToken.uid,
      amount: input.amount,
      balanceAfter,
      createdAt: timestamp,
      currency: input.currency,
      note: input.note,
      source: `admin-${input.mutationType}`,
      type: input.mutationType,
      uid: input.targetUid,
    }));
    transaction.create(auditRef, {
      action: `wallet-${input.mutationType}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      amount: input.amount,
      createdAt: timestamp,
      currency: input.currency,
      kind: 'economy',
      note: input.note,
      status: 'completed',
      targetUid: input.targetUid,
      transactionId: ledgerRef.id,
    });
    return auditRef.id;
  });
}

module.exports = { executeAdminWalletAdjustment, executeAdminWalletCredit };
