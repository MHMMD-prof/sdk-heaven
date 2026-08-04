const admin = require('firebase-admin');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const enabled = !args.has('--disable');
  const actorUid = readArgument('--actor-uid');
  const reason = readArgument('--reason')
    || (enabled ? 'Allow new voice-room joins' : 'Emergency freeze for new voice-room joins');
  const requestId = readArgument('--request-id')
    || `voice_room_new_joins_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  if (reason.length < 3) throw new Error('--reason must contain at least 3 characters.');

  const db = admin.firestore();
  const ref = db.doc('appConfig/voiceRoomFeatures');
  const snapshot = await ref.get();
  // Kill switch: explicit false blocks new joins; true/absent allows (fail-open for capacity).
  const patch = { voice_room_new_joins: enabled };

  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    current: snapshot.exists ? snapshot.data() : null,
    patch,
    reason,
    requestId,
    note: 'disable sets voice_room_new_joins=false and blocks create/join; enable restores true.',
  }));
  if (!apply) return;

  const actor = await requirePlatformOwner(db, actorUid);
  const auditRef = db.doc(`adminAuditEvents/voice_room_new_joins_${requestId}`);
  await db.runTransaction(async (transaction) => {
    const [configSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (
        previous.action === 'voice-room-new-joins-flag-update'
        && previous.actorUid === actorUid
        && previous.after === enabled
      ) return;
      throw new Error('The request ID conflicts with an existing audit event.');
    }
    const before = configSnapshot.data()?.voice_room_new_joins !== false;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(ref, {
      ...patch,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'voice-room-new-joins-flag-update',
      actorEmail: actor.email || '',
      actorUid,
      after: enabled,
      before,
      createdAt: timestamp,
      flag: 'voice_room_new_joins',
      kind: 'settings',
      note: reason,
      requestId,
      source: 'operations-cli',
      status: 'completed',
      targetUid: 'appConfig/voiceRoomFeatures',
    });
  });
  console.info(JSON.stringify({ applied: true, eventId: auditRef.id, path: ref.path }));
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
