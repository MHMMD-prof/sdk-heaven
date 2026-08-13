const admin = require('firebase-admin');

const {
  DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
  DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
  DIRECT_CHAT_RETENTION_POLICY_PATH,
  DIRECT_CHAT_RETENTION_POLICY_VERSION,
  mapDirectChatRetentionPolicy,
} = require('../directChatRetentionCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  const policyRef = db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH);
  const snapshot = await policyRef.get();
  const current = mapDirectChatRetentionPolicy(snapshot.exists ? snapshot.data() : undefined);
  // Requested days go through the same clamp the sweep uses, so the dry run prints exactly what the
  // cleanup job will honour rather than what the operator typed.
  const requested = mapDirectChatRetentionPolicy({
    evidenceRetentionDays: options.evidenceRetentionDays ?? current.evidenceRetentionDays,
    legalHoldRetentionDays: options.legalHoldRetentionDays ?? current.legalHoldRetentionDays,
    messageRetentionDays: options.messageRetentionDays ?? current.messageRetentionDays,
    policyVersion: DIRECT_CHAT_RETENTION_POLICY_VERSION,
  });
  console.info(JSON.stringify({
    actorUid: options.actorUid,
    apply: options.apply,
    bounds: {
      evidenceRetentionDays: DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
      legalHoldRetentionDays: DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
      messageRetentionDays: DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
    },
    current,
    requested,
  }, null, 2));

  if (!options.apply) return;
  if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
  if (isSamePolicy(current, requested)) {
    console.info(JSON.stringify({ applied: false, reason: 'unchanged' }));
    return;
  }
  await requirePlatformOwner(db, options.actorUid);
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(policyRef, {
      evidenceRetentionDays: requested.evidenceRetentionDays,
      legalHoldRetentionDays: requested.legalHoldRetentionDays,
      messageRetentionDays: requested.messageRetentionDays,
      policyVersion: requested.policyVersion,
      updatedAt: timestamp,
      updatedBy: options.actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'direct-chat-retention-policy',
      actorUid: options.actorUid,
      after: policyFields(requested),
      before: policyFields(current),
      createdAt: timestamp,
      entityId: 'current',
      entityType: 'system',
      kind: 'direct-chat-retention',
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id }));
}

function parseOptions(args) {
  const options = {
    actorUid: readArgument(args, '--actor-uid'),
    apply: args.includes('--apply'),
    evidenceRetentionDays: readDays(args, '--evidence-days'),
    legalHoldRetentionDays: readDays(args, '--legal-hold-days'),
    messageRetentionDays: readDays(args, '--message-days'),
  };
  if (
    options.evidenceRetentionDays === undefined
    && options.legalHoldRetentionDays === undefined
    && options.messageRetentionDays === undefined
    && options.apply
  ) throw new Error('--apply requires at least one of --message-days, --evidence-days, or --legal-hold-days.');
  return options;
}

function readDays(args, name) {
  const raw = readArgument(args, name);
  if (!raw) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) throw new Error(`${name} must be a whole number of days.`);
  return days;
}

function policyFields(policy) {
  return {
    evidenceRetentionDays: policy.evidenceRetentionDays,
    legalHoldRetentionDays: policy.legalHoldRetentionDays,
    messageRetentionDays: policy.messageRetentionDays,
    policyVersion: policy.policyVersion,
  };
}

function isSamePolicy(current, requested) {
  return current.evidenceRetentionDays === requested.evidenceRetentionDays
    && current.legalHoldRetentionDays === requested.legalHoldRetentionDays
    && current.messageRetentionDays === requested.messageRetentionDays;
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function readArgument(args, name) {
  const prefix = `${name}=`;
  const candidate = args.find((value) => value.startsWith(prefix));
  return candidate ? candidate.slice(prefix.length).trim() : '';
}

module.exports = { parseOptions };
