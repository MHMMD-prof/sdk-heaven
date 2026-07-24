const admin = require('firebase-admin');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  let query = db.collection('representativePrivileges')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(options.batchSize);

  if (options.startAfter) query = query.startAfter(options.startAfter);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let cursor = options.startAfter;

  while (scanned < options.limit) {
    const remaining = options.limit - scanned;
    const snapshot = await query.limit(Math.min(options.batchSize, remaining)).get();
    if (snapshot.empty) break;

    const profileSnapshots = await Promise.all(
      snapshot.docs.map((privilege) => db.doc(`publicProfiles/${privilege.id}`).get()),
    );
    const batch = options.dryRun ? undefined : db.batch();
    let batchWrites = 0;

    snapshot.docs.forEach((privilege, index) => {
      cursor = privilege.id;
      scanned += 1;
      const profile = profileSnapshots[index];
      const active = privilege.data()?.active === true;

      if (!profile.exists) {
        skipped += 1;
        console.warn(JSON.stringify({ status: 'missing-public-profile', uid: privilege.id }));
        return;
      }

      const current = profile.data()?.representativeBadge;
      if (current?.active === active && current?.updatedAt) {
        skipped += 1;
        console.info(JSON.stringify({ active, status: 'already-projected', uid: privilege.id }));
        return;
      }

      updated += 1;
      console.info(JSON.stringify({
        active,
        status: options.dryRun ? 'would-project' : 'projected',
        uid: privilege.id,
      }));

      batch?.update(profile.ref, {
        representativeBadge: {
          active,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchWrites += 1;
    });

    if (batch && batchWrites > 0) await batch.commit();
    if (snapshot.size < Math.min(options.batchSize, remaining)) break;

    query = db.collection('representativePrivileges')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(cursor)
      .limit(options.batchSize);
  }

  console.info(JSON.stringify({
    cursor,
    dryRun: options.dryRun,
    scanned,
    skipped,
    updated,
  }));
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Choose either --apply or --dry-run, not both.');
  }

  const values = Object.fromEntries(args.filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split(/=(.*)/s, 2)));
  const limit = Number(values.limit || 10000);
  const batchSize = Number(values['batch-size'] || 200);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    throw new Error('--limit must be an integer from 1 to 100000.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400) {
    throw new Error('--batch-size must be an integer from 1 to 400.');
  }

  return {
    batchSize,
    dryRun: !args.includes('--apply'),
    limit,
    startAfter: values['start-after'] || '',
  };
}
