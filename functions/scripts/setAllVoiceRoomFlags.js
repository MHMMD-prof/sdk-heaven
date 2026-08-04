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
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');

  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  const ref = db.doc('appConfig/voiceRoomFeatures');
  const snapshot = await ref.get();
  const patch = {
    voice_room_v2_mutations: enabled,
    voice_room_v2_read: enabled,
    voice_room_seats: enabled,
    voice_room_command_center: enabled,
    voice_room_media: enabled,
    voice_room_chat: enabled,
    voice_room_safety: enabled,
    voice_room_ownership_transfer: enabled,
    voice_room_gifts: enabled,
    voice_room_entry_effects: enabled,
    voice_room_games: enabled,
    voice_room_shared_music: enabled,
    voice_room_super_moderation: enabled,
    // Keep recording off until product/legal confirms a real reason to capture audio.
    voice_room_safety_recording: false,
    // Kill switch: true/absent allows joins; keep true while testing.
    voice_room_new_joins: true,
    // Wave 16 is rolled out independently: rendering first, then purchases.
    voice_room_themes: false,
    voice_room_theme_purchases: false,
  };

  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    current: snapshot.exists ? snapshot.data() : null,
    patch,
    note: apply
      ? 'Voice-room flags updated for testing. Safety recording stays forced off.'
      : 'Dry run only. Re-run with --apply --actor-uid <platform-owner-uid>. Recording stays off.',
  }, null, 2));
  if (!apply) return;

  await ref.set({
    ...patch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  }, { merge: true });
  console.info(JSON.stringify({ applied: true, path: ref.path }));
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
