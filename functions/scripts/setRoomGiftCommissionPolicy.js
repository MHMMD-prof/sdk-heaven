const admin = require('firebase-admin');
const { mapRoomGiftPolicyForAdmin, normalizeRoomGiftPolicyUpdate } = require('../roomGiftPolicyCore');
const { updateRoomGiftPolicy } = require('../roomGiftPolicyService');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const actorUid = readArgument('--actor-uid');
  const commissionBps = Number(readArgument('--commission-bps') || '1000');
  const reason = readArgument('--reason') || 'Room gift commission policy update';
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');

  const db = admin.firestore();
  const ref = db.doc('appConfig/roomGiftCommissionPolicy');
  const snapshot = await ref.get();
  const current = mapRoomGiftPolicyForAdmin(snapshot.exists ? snapshot.data() : undefined);
  const requestId = readArgument('--request-id')
    || `gift_policy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  const normalized = normalizeRoomGiftPolicyUpdate({
    commissionBps,
    expectedVersion: current.version,
    reason,
    requestId,
  });
  if (!normalized.ok) throw new Error(normalized.error);

  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    current,
    next: { commissionBps, version: current.version + 1 },
    reason,
    requestId,
  }));
  if (!apply) return;

  const actor = await requirePlatformOwner(db, actorUid);
  const result = await updateRoomGiftPolicy({
    db,
    decodedToken: {
      admin: true,
      adminRole: 'owner',
      email: actor.email || '',
      uid: actorUid,
    },
    fieldValue: admin.firestore.FieldValue,
    input: normalized.value,
  });
  console.info(JSON.stringify({ applied: true, eventId: result.eventId, path: ref.path }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
  return profile;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
