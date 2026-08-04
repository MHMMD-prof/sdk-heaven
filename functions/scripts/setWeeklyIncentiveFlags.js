const admin = require('firebase-admin');

const WEEKLY_INCENTIVE_FLAGS = Object.freeze({
  voice_room_attendance_device_attestation: false,
  voice_room_attendance_shadow: false,
  voice_room_owner_target_payouts: false,
  voice_room_owner_targets: false,
  voice_room_payroll_payouts: false,
  voice_room_payroll_tracking: false,
  voice_room_rocket_rewards: false,
  voice_room_supporter_rankings: false,
});

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const actorUid = readArgument('--actor-uid');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  console.info(JSON.stringify({ actorUid: actorUid || '', apply, patch: WEEKLY_INCENTIVE_FLAGS }));
  if (!apply) return;
  await db.doc('appConfig/voiceRoomFeatures').set({
    ...WEEKLY_INCENTIVE_FLAGS,
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

module.exports = { WEEKLY_INCENTIVE_FLAGS };
