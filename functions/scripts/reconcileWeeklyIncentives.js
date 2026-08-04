const admin = require('firebase-admin');

const {
  processWeeklyIncentiveReconciliationBatch,
  processWeeklyIncentiveRetention,
} = require('../weeklyIncentiveIntegrityService');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  let actor;
  if (options.apply) {
    if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
    actor = await admin.auth().getUser(options.actorUid);
    if (actor.customClaims?.admin !== true || actor.customClaims?.adminRole !== 'owner') {
      throw new Error('Apply requires the Platform Owner account.');
    }
  }
  const db = admin.firestore();
  const clock = {
    nowMillis: () => Date.now(),
    timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
  };
  const result = options.retention
    ? await processWeeklyIncentiveRetention({
        actorUid: actor?.uid || 'dry-run',
        apply: options.apply,
        clock,
        db,
        fieldValue: admin.firestore.FieldValue,
        limit: options.limit,
      })
    : await processWeeklyIncentiveReconciliationBatch({
        apply: options.apply,
        db,
        documentIdField: admin.firestore.FieldPath.documentId(),
        fieldValue: admin.firestore.FieldValue,
        giftCursor: options.giftCursor,
        limit: options.limit,
        settlementCursor: options.settlementCursor,
      });
  if (options.apply && !options.retention) {
    const auditId = `weekly_incentive_reconcile_${Date.now()}_${actor.uid}`;
    await db.doc(`adminAuditEvents/${auditId}`).create({
      action: 'weekly-incentive-reconcile-script',
      actorEmail: actor.email || '',
      actorUid: actor.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      entityId: auditId,
      entityType: 'system',
      id: auditId,
      kind: 'weekly-incentive-integrity',
      status: 'completed',
      summary: result.summary,
    });
  }
  console.info(JSON.stringify({ apply: options.apply, mode: options.retention ? 'retention' : 'reconciliation', result }, null, 2));
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run.');
  const values = Object.fromEntries(args.filter((value) => value.startsWith('--') && value.includes('=')).map((value) => {
    const separator = value.indexOf('=');
    return [value.slice(2, separator), value.slice(separator + 1)];
  }));
  const limit = Number(values.limit || 100);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1 through 100.');
  return {
    actorUid: values['actor-uid'] || '',
    apply: args.includes('--apply'),
    giftCursor: values['gift-cursor'] || '',
    limit,
    retention: args.includes('--retention'),
    settlementCursor: values['settlement-cursor'] || '',
  };
}
