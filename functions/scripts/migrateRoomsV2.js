const admin = require('firebase-admin');
const {
  analyzeRoomMemberV2Document,
  analyzeRoomSeatV2Document,
  analyzeRoomV2Document,
  buildVacantRoomSeatV2Document,
} = require('../roomV2Core');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.dryRun) await requireAdminActor(options.actorUid);

  const db = admin.firestore();
  const roomDocuments = await scanRooms(db, options);
  const work = [];
  const counts = {
    roomsScanned: 0,
    roomsReady: 0,
    roomsToMigrate: 0,
    roomsMalformed: 0,
    membersScanned: 0,
    membersReady: 0,
    membersToMigrate: 0,
    membersMalformed: 0,
    seatsScanned: 0,
    seatsReady: 0,
    seatsToCreate: 0,
    seatsMalformed: 0,
  };

  for (const roomDocument of roomDocuments) {
    counts.roomsScanned += 1;
    const roomAnalysis = analyzeRoomV2Document(roomDocument.data(), roomDocument.id);
    if (!roomAnalysis.ok) {
      counts.roomsMalformed += 1;
      log({ code: roomAnalysis.code, roomId: roomDocument.id, status: 'malformed-room' });
      continue;
    }
    counts[roomAnalysis.status === 'ready' ? 'roomsReady' : 'roomsToMigrate'] += 1;
    work.push({ ref: roomDocument.ref, patch: roomAnalysis.patch, status: roomAnalysis.status, type: 'room' });

    const memberSnapshot = await roomDocument.ref.collection('members').get();
    for (const memberDocument of memberSnapshot.docs) {
      counts.membersScanned += 1;
      const memberAnalysis = analyzeRoomMemberV2Document(memberDocument.data(), memberDocument.id, roomAnalysis.ownerUid);
      if (!memberAnalysis.ok) {
        counts.membersMalformed += 1;
        log({ code: memberAnalysis.code, roomId: roomDocument.id, status: 'malformed-member', uid: memberDocument.id });
        continue;
      }
      counts[memberAnalysis.status === 'ready' ? 'membersReady' : 'membersToMigrate'] += 1;
      work.push({ ref: memberDocument.ref, patch: memberAnalysis.patch, status: memberAnalysis.status, type: 'member' });
    }

    const seatsSnapshot = await roomDocument.ref.collection('seats').get();
    const seatsById = new Map(seatsSnapshot.docs.map((document) => [document.id, document]));
    for (const seatDocument of seatsSnapshot.docs) {
      counts.seatsScanned += 1;
      if (!/^\d{2}$/.test(seatDocument.id)) {
        counts.seatsMalformed += 1;
        log({ code: 'unexpected-seat-id', path: seatDocument.ref.path, status: 'malformed-seat' });
      }
    }
    for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
      const seatId = String(seatNumber).padStart(2, '0');
      const seatDocument = seatsById.get(seatId);
      if (!seatDocument) {
        counts.seatsToCreate += 1;
        work.push({
          operation: 'create',
          ref: roomDocument.ref.collection('seats').doc(seatId),
          patch: buildVacantRoomSeatV2Document(seatNumber),
          status: 'migrate',
          type: 'seat',
        });
        continue;
      }
      const seatAnalysis = analyzeRoomSeatV2Document(seatDocument.data(), seatNumber);
      if (!seatAnalysis.ok) {
        counts.seatsMalformed += 1;
        log({ code: seatAnalysis.code, path: seatDocument.ref.path, status: 'malformed-seat' });
      } else {
        counts.seatsReady += 1;
      }
    }
  }

  if (!options.dryRun && (counts.roomsMalformed > 0 || counts.membersMalformed > 0 || counts.seatsMalformed > 0)) {
    throw new Error('Preflight failed. Resolve every malformed document before using --apply.');
  }

  if (!options.dryRun) await applyWork(db, work.filter((item) => item.status === 'migrate'));
  for (const item of work.filter((candidate) => candidate.status === 'migrate')) {
    log({ dryRun: options.dryRun, path: item.ref.path, status: options.dryRun ? 'would-migrate' : 'migrated' });
  }

  log({
    ...counts,
    checkpoint: roomDocuments.at(-1)?.id || options.startAfter || '',
    dryRun: options.dryRun,
  });
}

async function scanRooms(db, options) {
  const documents = [];
  let cursor = options.startAfter;
  while (documents.length < options.limit) {
    const pageSize = Math.min(options.batchSize, options.limit - documents.length);
    let query = db.collection('rooms').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    documents.push(...snapshot.docs);
    cursor = snapshot.docs.at(-1).id;
    log({ checkpoint: cursor, scannedThisPage: snapshot.size, status: 'page-scanned' });
    if (snapshot.size < pageSize) break;
  }
  return documents;
}

async function applyWork(db, work) {
  const writer = db.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 3);
  for (const item of work) {
    const data = { ...item.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (item.operation === 'create') writer.create(item.ref, data);
    else writer.set(item.ref, data, { merge: true });
  }
  await writer.close();
}

async function requireAdminActor(actorUid) {
  if (!actorUid) throw new Error('--actor-uid is required with --apply.');
  const actor = await admin.auth().getUser(actorUid);
  if (actor.customClaims?.admin !== true) throw new Error('The selected actor must have the admin custom claim.');
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run, not both.');
  const values = Object.fromEntries(args.filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const limit = Number(values.limit || 500);
  const batchSize = Number(values['batch-size'] || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit must be an integer from 1 to 10000.');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('--batch-size must be an integer from 1 to 100.');
  return {
    actorUid: values['actor-uid'] || '',
    batchSize,
    dryRun: !args.includes('--apply'),
    limit,
    startAfter: values['start-after'] || '',
  };
}

function log(value) {
  console.info(JSON.stringify(value));
}
