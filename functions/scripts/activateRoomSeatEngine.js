const admin = require('firebase-admin');
const { planSeatEngineActivation } = require('../roomSeatCore');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  if (!options.dryRun) await requirePlatformOwner(db, options.actorUid);
  const roomDocuments = await scanRooms(db, options);
  const counts = { activated: 0, malformed: 0, ready: 0, scanned: 0, wouldActivate: 0 };
  for (const roomDocument of roomDocuments) {
    counts.scanned += 1;
    const plan = await inspectRoom(roomDocument);
    if (!plan.ok) {
      counts.malformed += 1;
      log({ code: plan.code, roomId: roomDocument.id, status: 'blocked' });
      continue;
    }
    if (plan.status === 'ready') {
      counts.ready += 1;
      log({ roomId: roomDocument.id, status: 'ready' });
      continue;
    }
    counts.wouldActivate += 1;
    log({ memberAssignments: plan.memberPatches.length, roomId: roomDocument.id, speakerCount: plan.speakerCount, status: options.dryRun ? 'would-activate' : 'activating' });
    if (options.dryRun) continue;
    await activateRoom(db, roomDocument.id, options.actorUid);
    counts.activated += 1;
  }
  if (!options.dryRun && counts.malformed > 0) {
    throw new Error('Some rooms were blocked. Resolve every reported contract error before completing rollout.');
  }
  log({ ...counts, checkpoint: roomDocuments.at(-1)?.id || options.startAfter || '', dryRun: options.dryRun });
}

async function inspectRoom(roomDocument) {
  const [members, seats] = await Promise.all([
    roomDocument.ref.collection('members').get(),
    roomDocument.ref.collection('seats').get(),
  ]);
  return planSeatEngineActivation(roomDocument.data(), members.docs.map((document) => document.data()), seats.docs.map((document) => document.data()));
}

async function activateRoom(db, roomId, actorUid) {
  const roomRef = db.doc(`rooms/${roomId}`);
  await db.runTransaction(async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) throw new Error(`Room disappeared during activation: ${roomId}`);
    const [members, seats] = await Promise.all([
      transaction.get(roomRef.collection('members')),
      transaction.get(roomRef.collection('seats')),
    ]);
    const plan = planSeatEngineActivation(roomSnapshot.data(), members.docs.map((document) => document.data()), seats.docs.map((document) => document.data()));
    if (!plan.ok) throw new Error(`Activation blocked for ${roomId}: ${plan.code}`);
    if (plan.status === 'ready') return;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    for (const assignment of plan.memberPatches) {
      transaction.update(roomRef.collection('members').doc(assignment.uid), { ...assignment.patch, updatedAt: timestamp, updatedBy: actorUid });
    }
    for (const assignment of plan.seatPatches) {
      transaction.update(roomRef.collection('seats').doc(assignment.seatId), { ...assignment.patch, updatedAt: timestamp, updatedBy: actorUid });
    }
    const room = roomSnapshot.data();
    transaction.update(roomRef, {
      revision: Number.isInteger(room.revision) ? room.revision + 1 : 1,
      seatEngineActivatedAt: timestamp,
      seatEngineActivatedBy: actorUid,
      seatEngineVersion: 1,
      speakerCount: plan.speakerCount,
      updatedAt: timestamp,
      updatedBy: actorUid,
    });
  });
}

async function scanRooms(db, options) {
  let query = db.collection('rooms').orderBy(admin.firestore.FieldPath.documentId()).limit(options.limit);
  if (options.startAfter) query = query.startAfter(options.startAfter);
  const snapshot = await query.get();
  return snapshot.docs;
}

async function requirePlatformOwner(db, actorUid) {
  if (!actorUid) throw new Error('--actor-uid is required with --apply.');
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function parseOptions(args) {
  const valueAfter = (name, fallback = '') => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || '').trim() : fallback;
  };
  const limit = Number.parseInt(valueAfter('--limit', '200'), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be between 1 and 1000.');
  return {
    actorUid: valueAfter('--actor-uid'),
    dryRun: !args.includes('--apply'),
    limit,
    startAfter: valueAfter('--start-after'),
  };
}

function log(value) {
  console.info(JSON.stringify(value));
}
