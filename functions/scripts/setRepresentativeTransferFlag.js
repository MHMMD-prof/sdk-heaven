const admin = require('firebase-admin');
const {
  isActivePlatformOwner,
  normalizeRepresentativeFlagCommand,
} = require('../representativeKillSwitchCore');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const command = normalizeRepresentativeFlagCommand(process.argv.slice(2));
  if (!command.ok) throw new Error(command.error);
  const { actorUid, apply, enable, reason } = command.value;

  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  const configRef = db.doc('appConfig/socialFeatures');
  const current = await configRef.get();
  console.info(JSON.stringify({
    actorUid,
    apply,
    before: current.exists ? current.data()?.representativeTransfers === true : false,
    requested: enable,
  }));
  if (!apply) return;

  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(configRef);
    const before = snapshot.exists ? snapshot.data()?.representativeTransfers === true : false;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(configRef, {
      representativeTransfers: enable,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: enable ? 'representative-emergency-enable' : 'representative-emergency-disable',
      actorUid,
      before: { representativeTransfers: before },
      after: { representativeTransfers: enable },
      createdAt: timestamp,
      kind: 'administrator-security',
      note: reason,
      source: 'server-credential-cli',
      status: 'completed',
      targetUid: 'representativeTransfers',
    });
  });
  console.info(JSON.stringify({ applied: true, auditId: auditRef.id, representativeTransfers: enable }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!isActivePlatformOwner(profile, actorUid)) {
    throw new Error('The actor must be an active Platform Owner.');
  }
}
