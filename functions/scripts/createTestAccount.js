const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');

const { inspectPublicProfile, validatePrivateProfile } = require('../socialProfileCore');
const { provisionPublicProfile } = require('../socialProfileService');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!admin.apps.length) {
    const credentialPath = path.resolve(process.cwd(), options.credentialFile);
    const credential = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(credential), projectId: options.projectId });
  }
  const auth = admin.auth();
  let user;
  let created = false;

  try {
    user = await auth.getUserByEmail(options.email);
    user = await auth.updateUser(user.uid, {
      disabled: false,
      displayName: options.displayName,
      emailVerified: true,
      password: options.password,
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({
      disabled: false,
      displayName: options.displayName,
      email: options.email,
      emailVerified: true,
      password: options.password,
    });
    created = true;
  }

  await auth.setCustomUserClaims(user.uid, { testAccount: true });
  await auth.revokeRefreshTokens(user.uid);

  const db = admin.firestore();
  const privateRef = db.doc(`users/${user.uid}`);
  const privateSnapshot = await privateRef.get();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await privateRef.set({
    avatarLabel: options.avatarLabel,
    createdAt: privateSnapshot.exists && privateSnapshot.data()?.createdAt
      ? privateSnapshot.data().createdAt
      : timestamp,
    displayName: options.displayName,
    email: options.email,
    uid: user.uid,
    updatedAt: timestamp,
  }, { merge: true });

  const provisioned = await provisionPublicProfile({
    actorEmail: options.email,
    actorUid: user.uid,
    auditAction: 'create-test-account',
    bypassRateLimit: true,
    db,
    fieldValue: admin.firestore.FieldValue,
    requestId: `test_account_${Date.now().toString(36)}_provision`,
    uid: user.uid,
  });

  if (provisioned.errorCode || !provisioned.result?.provisioned) {
    throw new Error(`Test profile provisioning failed: ${provisioned.errorCode || 'UNKNOWN'}`);
  }

  const publicId = provisioned.result.publicId;
  const [verifiedUser, privateProfile, publicProfile, publicIdReservation] = await Promise.all([
    auth.getUser(user.uid),
    privateRef.get(),
    db.doc(`publicProfiles/${user.uid}`).get(),
    db.doc(`publicIds/${publicId}`).get(),
  ]);
  const privateProfileStatus = validatePrivateProfile(privateProfile.data(), user.uid);
  const publicProfileStatus = inspectPublicProfile(
    publicProfile.data(),
    publicIdReservation.data(),
    user.uid,
  );

  if (!privateProfileStatus.ok || !publicProfileStatus.ok) {
    throw new Error('Test account was created, but profile verification failed.');
  }
  if (verifiedUser.customClaims?.admin === true || verifiedUser.disabled || !verifiedUser.emailVerified) {
    throw new Error('Test account was created, but authentication verification failed.');
  }

  console.info(JSON.stringify({
    admin: false,
    created,
    displayName: options.displayName,
    email: options.email,
    emailVerified: true,
    profileReady: true,
    publicId,
    uid: user.uid,
  }));
}

function parseOptions(args) {
  const values = Object.fromEntries(args
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : '';
  const password = typeof values.password === 'string' ? values.password : '';
  const displayName = typeof values['display-name'] === 'string' ? values['display-name'].trim() : '';
  const avatarLabel = typeof values['avatar-label'] === 'string' ? values['avatar-label'].trim() : '';
  const projectId = typeof values['project-id'] === 'string' ? values['project-id'].trim() : '';
  const credentialFile = typeof values['credential-file'] === 'string' ? values['credential-file'].trim() : '';

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('--email must be valid.');
  if (password.length < 8 || password.length > 64) throw new Error('--password must contain 8 to 64 characters.');
  if (displayName.length < 2 || displayName.length > 32) throw new Error('--display-name must contain 2 to 32 characters.');
  if ([...avatarLabel].length !== 1) throw new Error('--avatar-label must be exactly one character.');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) throw new Error('--project-id must be valid.');
  if (!credentialFile || !fs.existsSync(path.resolve(process.cwd(), credentialFile))) {
    throw new Error('--credential-file must point to an existing service-account JSON file.');
  }

  return { avatarLabel, credentialFile, displayName, email, password, projectId };
}
