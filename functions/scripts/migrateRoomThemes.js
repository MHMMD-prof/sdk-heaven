const admin = require('firebase-admin');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUid = readArgument('--actor-uid');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  const snapshot = await db.collection('rooms').get();
  const changes = snapshot.docs.map((document) => {
    const previousThemeId = typeof document.data()?.themeId === 'string' ? document.data().themeId : '';
    const themeId = previousThemeId === 'royal'
      ? 'royal-theater'
      : ['midnight', 'ocean', 'emerald', ''].includes(previousThemeId)
        ? 'majlis-default'
        : previousThemeId;
    return previousThemeId === themeId ? undefined : { document, previousThemeId, themeId };
  }).filter(Boolean);
  console.info(JSON.stringify({
    apply,
    royalEntitlements: changes.filter((change) => change.themeId === 'royal-theater').length,
    roomsChanged: changes.length,
    roomsScanned: snapshot.size,
  }));
  changes.forEach((change) => console.info(JSON.stringify({
    from: change.previousThemeId,
    roomId: change.document.id,
    to: change.themeId,
  })));
  if (!apply) return;
  for (let offset = 0; offset < changes.length; offset += 200) {
    const batch = db.batch();
    for (const change of changes.slice(offset, offset + 200)) {
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      batch.update(change.document.ref, {
        revision: Number(change.document.data()?.revision || 0) + 1,
        themeId: change.themeId,
        themeUpdatedAt: timestamp,
        updatedAt: timestamp,
      });
      if (change.themeId === 'royal-theater') {
        batch.set(change.document.ref.collection('themeEntitlements').doc('royal-theater'), {
          acquiredAt: timestamp,
          acquiredByUid: actorUid,
          expiresAt: null,
          itemId: 'royal-theater',
          migrationSource: 'legacy-royal',
          roomId: change.document.id,
          state: 'active',
          themeId: 'royal-theater',
          updatedAt: timestamp,
        });
      }
    }
    await batch.commit();
  }
  console.info(JSON.stringify({ applied: true, roomsChanged: changes.length }));
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
