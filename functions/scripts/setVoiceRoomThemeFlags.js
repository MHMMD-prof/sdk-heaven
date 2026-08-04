const admin = require('firebase-admin');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const actorUid = readArgument('--actor-uid');
  const disable = args.has('--disable');
  const rendering = args.has('--rendering');
  const purchases = args.has('--purchases');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  if (purchases && !rendering && !disable) throw new Error('Enable rendering before purchases.');
  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  const patch = {
    voice_room_themes: disable ? false : rendering,
    voice_room_theme_purchases: disable ? false : purchases,
  };
  console.info(JSON.stringify({ actorUid: actorUid || '', apply, patch }));
  if (!apply) return;
  await db.doc('appConfig/voiceRoomFeatures').set({
    ...patch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  }, { merge: true });
  console.info(JSON.stringify({ applied: true }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
