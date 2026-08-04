const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const serviceAccount = JSON.parse(fs.readFileSync(options.credentialFile, 'utf8'));
  if (serviceAccount.project_id !== options.projectId) {
    throw new Error('The service account does not belong to the requested Firebase project.');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: options.projectId,
  });

  const db = admin.firestore();
  const auth = admin.auth();
  const [actor, target, actorAuth] = await Promise.all([
    db.doc(`adminProfiles/${options.actorUid}`).get(),
    auth.getUser(options.targetUid),
    auth.getUser(options.actorUid),
  ]);
  requirePlatformOwner(actor, options.actorUid);
  if (!target.email) throw new Error('The target account has no email login.');

  console.info(JSON.stringify({
    apply: options.apply,
    disabled: target.disabled,
    email: target.email,
    emailVerified: target.emailVerified,
    targetUid: target.uid,
  }, null, 2));
  if (!options.apply) return;

  const temporaryPassword = options.password || createTemporaryPassword();
  await auth.updateUser(options.targetUid, {
    disabled: false,
    emailVerified: true,
    password: temporaryPassword,
  });
  await auth.revokeRefreshTokens(options.targetUid);

  const auditRef = db.collection('adminAuditEvents').doc();
  await auditRef.create({
    action: 'test-user-login-reset',
    actorEmail: actorAuth.email || actor.data()?.email || '',
    actorUid: options.actorUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    kind: 'administrator-security',
    note: 'Reset development test-user password and revoke existing sessions',
    source: 'server-credential-cli',
    status: 'completed',
    targetUid: options.targetUid,
  });

  const verified = await auth.getUser(options.targetUid);
  if (verified.disabled || !verified.emailVerified || verified.email !== target.email) {
    throw new Error('Login reset completed but verification failed.');
  }
  console.info(JSON.stringify({
    applied: true,
    auditId: auditRef.id,
    email: verified.email,
    temporaryPassword,
    uid: verified.uid,
  }, null, 2));
}

function createTemporaryPassword() {
  return `Yg!${crypto.randomBytes(12).toString('base64url')}7a`;
}

function requirePlatformOwner(snapshot, uid) {
  const profile = snapshot.data();
  if (!snapshot.exists || profile?.uid !== uid || profile?.role !== 'owner' || profile?.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function parseOptions(args) {
  const values = Object.fromEntries(args
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const credentialFile = path.resolve(String(values['credential-file'] || ''));
  const projectId = String(values['project-id'] || '').trim();
  const actorUid = String(values['actor-uid'] || '').trim();
  const targetUid = String(values['target-uid'] || '').trim();
  const password = String(values.password || '');
  if (!fs.existsSync(credentialFile)) throw new Error('--credential-file must point to the service-account JSON.');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) throw new Error('--project-id is invalid.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(actorUid)) throw new Error('--actor-uid is invalid.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(targetUid)) throw new Error('--target-uid is invalid.');
  if (password && (password.length < 8 || password.length > 64)) {
    throw new Error('--password must contain 8 to 64 characters.');
  }
  return {
    actorUid,
    apply: args.includes('--apply'),
    credentialFile,
    password,
    projectId,
    targetUid,
  };
}
