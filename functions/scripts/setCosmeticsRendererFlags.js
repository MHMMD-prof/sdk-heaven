const admin = require('firebase-admin');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowedArguments = new Set(['--apply', '--actor-uid']);
  for (const argument of args) {
    if (argument.startsWith('--') && !allowedArguments.has(argument)) {
      throw new Error(
        'Cosmetics renderers are dark-only. This command cannot enable them.',
      );
    }
  }
  const apply = args.has('--apply');
  const actorUid = readArgument('--actor-uid');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');

  const patch = {
    cosmetics_animated_avatar_frames: false,
    cosmetics_asset_registry: false,
    cosmetics_effect_audio: false,
    cosmetics_profile_skins: false,
    cosmetics_chat_bubbles: false,
    cosmetics_nameplates: false,
    cosmetics_badges: false,
    cosmetics_seat_effects: false,
    cosmetics_lottie: false,
    room_entry_animations: false,
    room_entry_audio: false,
    room_entry_video: false,
    room_gift_animations: false,
    room_gift_audio: false,
    room_gift_global_effects: false,
    room_gift_video: false,
    cosmetics_shared_renderer: false,
    cosmetics_unified_avatar_frames: false,
    cosmetics_video: false,
  };
  console.info(JSON.stringify({ actorUid: actorUid || '', apply, patch }));
  if (!apply) return;

  const db = admin.firestore();
  await requirePlatformOwner(db, actorUid);
  await db.doc('appConfig/cosmeticsFeatures').set({
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
