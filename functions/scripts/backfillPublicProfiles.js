const admin = require('firebase-admin');

const {
  inspectPublicProfile,
  isAdminUserSearchReady,
  isValidPublicId,
  isValidSpecialId,
  validatePrivateProfile,
} = require('../socialProfileCore');
const { provisionPublicProfile } = require('../socialProfileService');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (!options.actorUid) {
    throw new Error('--actor-uid is required.');
  }

  const actor = await admin.auth().getUser(options.actorUid);

  if (actor.customClaims?.admin !== true) {
    throw new Error('The selected actor must have the admin custom claim.');
  }

  const db = admin.firestore();
  const customIdAudit = await auditCustomIdNamespace(db, options.specialIdLimit);
  customIdAudit.issues.forEach((issue) => console.warn(JSON.stringify(issue)));
  console.info(JSON.stringify({
    catalogScanned: customIdAudit.catalogScanned,
    issueCount: customIdAudit.issues.length,
    reservationScanned: customIdAudit.reservationScanned,
    status: 'custom-id-preflight',
  }));

  if (!options.dryRun && customIdAudit.issues.length > 0) {
    throw new Error('Custom ID preflight failed. Resolve every reported issue before using --apply.');
  }

  let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(options.batchSize);

  if (options.startAfter) {
    query = query.startAfter(options.startAfter);
  }

  let scanned = 0;
  let provisioned = 0;
  let skipped = 0;
  let cursor = options.startAfter;

  while (scanned < options.limit) {
    const remaining = options.limit - scanned;
    const snapshot = await query.limit(Math.min(options.batchSize, remaining)).get();

    if (snapshot.empty) {
      break;
    }

    for (const userSnapshot of snapshot.docs) {
      cursor = userSnapshot.id;
      scanned += 1;
      const publicSnapshot = await db.doc(`publicProfiles/${userSnapshot.id}`).get();
      const publicProfile = publicSnapshot.exists ? publicSnapshot.data() : undefined;
      const privateValidation = validatePrivateProfile(userSnapshot.data(), userSnapshot.id);
      const reservationSnapshot = publicProfile && isValidPublicId(publicProfile.publicId)
        ? await db.doc(`publicIds/${publicProfile.publicId}`).get()
        : undefined;
      const searchSnapshot = await db.doc(`adminUserSearch/${userSnapshot.id}`).get();
      const isReady = privateValidation.ok
        && inspectPublicProfile(
          publicProfile,
          reservationSnapshot?.exists ? reservationSnapshot.data() : undefined,
          userSnapshot.id,
        ).ok
        && searchSnapshot.exists
        && isAdminUserSearchReady(searchSnapshot.data(), privateValidation.value);

      if (isReady) {
        skipped += 1;
        console.info(JSON.stringify({ status: 'ready', uid: userSnapshot.id }));
        continue;
      }

      if (options.dryRun) {
        provisioned += 1;
        console.info(JSON.stringify({
          currentPublicId: typeof publicProfile?.publicId === 'string' ? publicProfile.publicId : '',
          currentSpecialId: typeof publicProfile?.specialId === 'string' ? publicProfile.specialId : '',
          status: 'would-provision',
          uid: userSnapshot.id,
        }));
        continue;
      }

      const result = await provisionPublicProfile({
        actorEmail: actor.email || '',
        actorUid: actor.uid,
        auditAction: 'backfill-profile',
        bypassRateLimit: true,
        db,
        fieldValue: admin.firestore.FieldValue,
        requestId: createBackfillRequestId(userSnapshot.id),
        uid: userSnapshot.id,
      });

      if (result.errorCode) {
        console.warn(JSON.stringify({ code: result.errorCode, status: 'skipped-invalid', uid: userSnapshot.id }));
        skipped += 1;
      } else {
        provisioned += 1;
        console.info(JSON.stringify({ publicId: result.result.publicId, status: 'provisioned', uid: userSnapshot.id }));
      }
    }

    if (snapshot.size < Math.min(options.batchSize, remaining)) {
      break;
    }

    query = db.collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(cursor)
      .limit(options.batchSize);
  }

  console.info(JSON.stringify({
    cursor,
    dryRun: options.dryRun,
    provisioned,
    scanned,
    skipped,
  }));
}

async function auditCustomIdNamespace(db, limit) {
  const [catalogSnapshot, reservationSnapshot] = await Promise.all([
    db.collection('specialIdCatalog').limit(limit).get(),
    db.collection('specialIds').limit(limit).get(),
  ]);
  const ids = new Set([
    ...catalogSnapshot.docs.map((document) => document.id),
    ...reservationSnapshot.docs.map((document) => document.id),
  ]);
  const issues = [];

  for (const document of catalogSnapshot.docs) {
    if (document.data()?.specialId !== document.id) {
      issues.push({
        catalogSpecialId: typeof document.data()?.specialId === 'string' ? document.data().specialId : '',
        specialId: document.id,
        status: 'custom-id-catalog-key-mismatch',
      });
    }
  }

  if (catalogSnapshot.size === limit || reservationSnapshot.size === limit) {
    issues.push({ limit, status: 'custom-id-audit-limit-reached' });
  }

  for (const specialId of ids) {
    if (!isValidSpecialId(specialId)) {
      issues.push({ specialId, status: 'invalid-custom-id-format' });
      continue;
    }

    const publicIdSnapshot = await db.doc(`publicIds/${specialId}`).get();
    if (publicIdSnapshot.exists) {
      issues.push({ specialId, status: 'normal-custom-id-collision' });
    }
  }

  return {
    catalogScanned: catalogSnapshot.size,
    issues,
    reservationScanned: reservationSnapshot.size,
  };
}

function createBackfillRequestId(uid) {
  return `backfill_${Buffer.from(uid).toString('base64url').slice(0, 60)}`;
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Choose either --apply or --dry-run, not both.');
  }
  const values = Object.fromEntries(args.filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split(/=(.*)/s, 2)));
  const limit = Number(values.limit || 500);
  const batchSize = Number(values['batch-size'] || 25);
  const specialIdLimit = Number(values['special-id-limit'] || 1000);

  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error('--limit must be an integer from 1 to 10000.');
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('--batch-size must be an integer from 1 to 100.');
  }

  if (!Number.isInteger(specialIdLimit) || specialIdLimit < 1 || specialIdLimit > 10000) {
    throw new Error('--special-id-limit must be an integer from 1 to 10000.');
  }

  return {
    actorUid: values['actor-uid'] || '',
    batchSize,
    dryRun: !args.includes('--apply'),
    limit,
    specialIdLimit,
    startAfter: values['start-after'] || '',
  };
}
