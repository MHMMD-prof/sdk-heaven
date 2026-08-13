/**
 * Seeds a fixed mock peer for Direct Chat smoke tests.
 *
 * Creates Auth user + private/public profiles + friendship with --owner-uid.
 * Client can open this peer via DIRECT_CHAT_MOCK_PEER_UID in __DEV__.
 *
 * Usage (from functions/):
 *   node scripts/seedDirectChatMockPeer.js --owner-uid=YOUR_UID --apply
 *   node scripts/seedDirectChatMockPeer.js --owner-uid=YOUR_UID   # dry run
 */
const admin = require('firebase-admin');

const { createFriendshipId } = require('../socialFriendsCore');
const { provisionPublicProfile } = require('../socialProfileService');

const MOCK_PEER = Object.freeze({
  avatarLabel: 'ت',
  displayName: 'مستخدم تجريبي',
  email: 'directchat.mock.peer@yallgame.test',
  password: 'YallGame!MockPeer1',
  uid: 'directChatMockPeer001',
});

admin.initializeApp({
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'yallgame-ebd19',
});

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const auth = admin.auth();
  const db = admin.firestore();
  const fieldValue = admin.firestore.FieldValue;
  const timestamp = fieldValue.serverTimestamp();

  let ownerUid = options.ownerUid;
  let ownerAuth = null;
  if (ownerUid) {
    ownerAuth = await auth.getUser(ownerUid).catch(() => null);
    if (!ownerAuth) {
      console.warn(`Owner Auth user not found (${ownerUid}); seeding peer without friendship.`);
      ownerUid = '';
    }
  }

  const existingPeerAuth = await auth.getUser(MOCK_PEER.uid)
    .catch((error) => (error?.code === 'auth/user-not-found' ? null : Promise.reject(error)));

  console.info(JSON.stringify({
    apply: options.apply,
    mockPeer: {
      displayName: MOCK_PEER.displayName,
      email: MOCK_PEER.email,
      uid: MOCK_PEER.uid,
    },
    ownerUid: ownerUid || null,
    peerAuthExists: Boolean(existingPeerAuth),
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || admin.app().options.projectId || null,
  }, null, 2));

  if (!options.apply) {
    console.info('Dry run only. Re-run with --apply to create/update the mock peer.');
    return;
  }

  let peerAuth = existingPeerAuth;
  let createdAuth = false;
  if (!peerAuth) {
    peerAuth = await auth.createUser({
      disabled: false,
      displayName: MOCK_PEER.displayName,
      email: MOCK_PEER.email,
      emailVerified: true,
      password: MOCK_PEER.password,
      uid: MOCK_PEER.uid,
    });
    createdAuth = true;
  } else {
    peerAuth = await auth.updateUser(MOCK_PEER.uid, {
      disabled: false,
      displayName: MOCK_PEER.displayName,
      email: MOCK_PEER.email,
      emailVerified: true,
      password: MOCK_PEER.password,
    });
  }
  await auth.setCustomUserClaims(MOCK_PEER.uid, { testAccount: true, directChatMockPeer: true });

  const privateRef = db.doc(`users/${MOCK_PEER.uid}`);
  const privateSnapshot = await privateRef.get();
  await privateRef.set({
    avatarLabel: MOCK_PEER.avatarLabel,
    createdAt: privateSnapshot.exists && privateSnapshot.data()?.createdAt
      ? privateSnapshot.data().createdAt
      : timestamp,
    displayName: MOCK_PEER.displayName,
    email: MOCK_PEER.email,
    uid: MOCK_PEER.uid,
    updatedAt: timestamp,
  }, { merge: true });

  const provisioned = await provisionPublicProfile({
    actorEmail: MOCK_PEER.email,
    actorUid: MOCK_PEER.uid,
    auditAction: 'seed-direct-chat-mock-peer',
    bypassRateLimit: true,
    db,
    fieldValue,
    requestId: `direct_chat_mock_${Date.now().toString(36)}`,
    uid: MOCK_PEER.uid,
  });
  if (provisioned.errorCode || !provisioned.result?.provisioned) {
    throw new Error(`Mock peer profile provisioning failed: ${provisioned.errorCode || 'UNKNOWN'}`);
  }

  await db.doc(`publicProfiles/${MOCK_PEER.uid}`).set({
    avatarLabel: MOCK_PEER.avatarLabel,
    displayName: MOCK_PEER.displayName,
    moderationStatus: 'active',
    normalizedName: MOCK_PEER.displayName.toLocaleLowerCase('ar'),
    uid: MOCK_PEER.uid,
    updatedAt: timestamp,
  }, { merge: true });

  let friendshipId = null;
  let friendshipReady = false;
  if (ownerUid) {
    friendshipId = createFriendshipId(ownerUid, MOCK_PEER.uid);
    const friendshipRef = db.doc(`friendships/${friendshipId}`);
    const friendshipSnapshot = await friendshipRef.get();
    if (!friendshipSnapshot.exists) {
      await friendshipRef.create({
        createdAt: timestamp,
        memberUids: [ownerUid, MOCK_PEER.uid].sort(),
        updatedAt: timestamp,
      });
      await Promise.all([
        db.doc(`publicProfiles/${ownerUid}`).set({
          friendCount: fieldValue.increment(1),
          updatedAt: timestamp,
        }, { merge: true }),
        db.doc(`publicProfiles/${MOCK_PEER.uid}`).set({
          friendCount: fieldValue.increment(1),
          updatedAt: timestamp,
        }, { merge: true }),
      ]);
    }
    friendshipReady = (await friendshipRef.get()).exists;
  }

  const verified = await Promise.all([
    auth.getUser(MOCK_PEER.uid),
    db.doc(`publicProfiles/${MOCK_PEER.uid}`).get(),
  ]);

  console.info(JSON.stringify({
    applied: true,
    createdAuth,
    friendshipId,
    friendshipReady,
    mockPeer: {
      displayName: verified[1].data()?.displayName || MOCK_PEER.displayName,
      email: verified[0].email,
      publicId: verified[1].data()?.publicId || null,
      uid: MOCK_PEER.uid,
    },
    note: friendshipReady
      ? 'Mock peer is friends with owner — you can message directly.'
      : 'Mock peer seeded. Open المحادثات in a DEV build and tap مستخدم تجريبي (first message may send as a chat request).',
    ownerUid: ownerUid || null,
  }, null, 2));
}

function parseOptions(args) {
  const values = Object.fromEntries(args
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const flags = new Set(args.filter((argument) => argument.startsWith('--') && !argument.includes('=')));
  const ownerUid = typeof values['owner-uid'] === 'string' ? values['owner-uid'].trim() : '';
  if (ownerUid && (ownerUid.includes('/') || ownerUid.length > 128)) {
    throw new Error('--owner-uid must be a valid Firebase Auth UID when provided.');
  }
  return {
    apply: flags.has('--apply'),
    ownerUid,
  };
}
