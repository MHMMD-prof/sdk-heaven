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
    || (enabled ? 'Enable shared room music' : 'Disable shared room music');
  const requestId = readArgument('--request-id')
    || `room_music_flag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  if (reason.length < 3) throw new Error('--reason must contain at least 3 characters.');

  const db = admin.firestore();
  const ref = db.doc('appConfig/voiceRoomFeatures');
  const snapshot = await ref.get();
  const patch = { voice_room_shared_music: enabled };

  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    current: snapshot.exists ? snapshot.data() : null,
    patch,
    reason,
    requestId,
  }));
  if (!apply) return;

  const actor = await requirePlatformOwner(db, actorUid);
  const auditRef = db.doc(`adminAuditEvents/voice_room_shared_music_${requestId}`);
  await db.runTransaction(async (transaction) => {
    const [configSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (
        previous.action === 'voice-room-shared-music-flag-update'
        && previous.actorUid === actorUid
        && previous.after === enabled
      ) return;
      throw new Error('The request ID conflicts with an existing audit event.');
    }
    const before = configSnapshot.data()?.voice_room_shared_music === true;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(ref, {
      ...patch,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'voice-room-shared-music-flag-update',
      actorEmail: actor.email || '',
      actorUid,
      after: enabled,
      before,
      createdAt: timestamp,
      flag: 'voice_room_shared_music',
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
