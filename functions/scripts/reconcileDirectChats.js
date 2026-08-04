const admin = require('firebase-admin');

const { reconcileDirectChatBatch } = require('../directChatReconciliationService');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  if (options.apply) await requirePlatformOwner(db, options.actorUid);
  const reconciliation = await reconcileDirectChatBatch({
    apply: options.apply,
    clock: {
      nowMillis: () => Date.now(),
      timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
    },
    cursor: options.cursor,
    db,
    limit: options.limit,
  });
  const orphans = await scanOrphanCommands({ db, limit: options.limit });
  const result = { apply: options.apply, orphans, reconciliation };
  console.info(JSON.stringify(result, null, 2));
  if (options.apply) {
    await db.collection('adminAuditEvents').add({
      action: 'direct-chat-reconcile',
      actorUid: options.actorUid,
      applied: reconciliation.applied,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      drifted: reconciliation.drifted,
      nextCursor: reconciliation.nextCursor,
      orphanCommandCount: orphans.length,
      scanned: reconciliation.scanned,
    });
  }
  if (orphans.length > 0) process.exitCode = 2;
}

async function scanOrphanCommands({ db, limit }) {
  const actionsRequiringConversation = new Set([
    'accept-message-request',
    'delete-conversation-for-me',
    'mark-direct-chat-read',
    'reject-message-request',
    'send-direct-message',
    'send-message-request',
    'set-direct-chat-archive',
    'set-direct-chat-mute',
    'unsend-direct-message',
  ]);
  const snapshot = await db.collectionGroup('requests')
    .where('commandKind', '==', 'direct-chat')
    .where('status', '==', 'applied')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  const candidates = snapshot.docs.filter((document) => actionsRequiringConversation.has(document.data().action));
  const conversationSnapshots = candidates.length
    ? await db.getAll(...candidates.map((document) => db.doc(`directConversations/${document.data().conversationId}`)))
    : [];
  return candidates
    .filter((document, index) => !conversationSnapshots[index]?.exists)
    .map((document) => ({ action: document.data().action, commandPath: document.ref.path, conversationId: document.data().conversationId }));
}

function parseOptions(args) {
  const read = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  const limit = Number(read('--limit') || 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be from 1 to 100.');
  const actorUid = read('--actor-uid');
  const apply = args.includes('--apply');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  return { actorUid, apply, cursor: read('--cursor'), limit };
}

async function requirePlatformOwner(db, uid) {
  const snapshot = await db.doc(`adminProfiles/${uid}`).get();
  if (!snapshot.exists || snapshot.data()?.active !== true || snapshot.data()?.role !== 'platform-owner') {
    throw new Error('An active platform owner is required.');
  }
}

module.exports = {
  parseOptions,
  scanOrphanCommands,
};
