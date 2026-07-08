import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

const projectId = 'demo-auth-rules-wave8';
const firestoreEmulatorPort = Number(process.env.FIRESTORE_RULES_TEST_PORT ?? 18081);
const now = Timestamp.fromDate(new Date('2026-07-06T00:00:00.000Z'));

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: firestoreEmulatorPort,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('firestore.rules auth waves', () => {
  it('allows owner profile reads and denies other users', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');

    await assertSucceeds(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'users', 'uid-1')));
    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'users', 'uid-1')));
  });

  it('allows owner account deletion requests and denies forged request identity', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');

    const db = userDb('uid-1', 'salem@example.com');
    const requestRef = doc(db, 'users', 'uid-1', 'accountDeletionRequests', 'request-1');

    await assertSucceeds(
      setDoc(requestRef, {
        uid: 'uid-1',
        email: 'salem@example.com',
        displayName: 'Salem',
        avatarLabel: 'S',
        status: 'requested',
        reason: 'Done for now',
        requestedAt: now,
        updatedAt: now,
      }),
    );
    await assertFails(
      setDoc(doc(db, 'users', 'uid-1', 'accountDeletionRequests', 'request-2'), {
        uid: 'uid-2',
        email: 'dana@example.com',
        displayName: 'Dana',
        avatarLabel: 'D',
        status: 'requested',
        requestedAt: now,
        updatedAt: now,
      }),
    );
  });

  it('lists public active rooms but hides private rooms from non-members', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('public-room', { visibility: 'public' });
    await seedRoom('private-room', { visibility: 'private', inviteCode: 'ABC123' });
    await seedMember('private-room', 'uid-1', 'Salem', 'S', 'listener', false);

    const ownerDb = userDb('uid-1', 'salem@example.com');
    const nonMemberDb = userDb('uid-2', 'dana@example.com');

    await assertSucceeds(
      getDocs(query(collection(ownerDb, 'rooms'), where('status', '==', 'active'), where('visibility', '==', 'public'))),
    );
    await assertSucceeds(getDoc(doc(ownerDb, 'rooms', 'private-room')));
    await assertFails(getDoc(doc(nonMemberDb, 'rooms', 'private-room')));
  });

  it('requires matching invite codes when creating private room membership', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('private-room', { visibility: 'private', inviteCode: 'ABC123' });

    const db = userDb('uid-2', 'dana@example.com');
    const memberRef = doc(db, 'rooms', 'private-room', 'members', 'uid-2');

    await assertFails(setDoc(memberRef, memberPayload('uid-2', 'Dana', 'D', 'listener', false, 'WRONG1')));
    await assertSucceeds(setDoc(memberRef, memberPayload('uid-2', 'Dana', 'D', 'listener', false, 'ABC123')));
  });

  it('allows valid owner presence writes and denies forged presence fields', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('public-room', { visibility: 'public' });
    await seedMember('public-room', 'uid-2', 'Dana', 'D', 'listener', false);

    const db = userDb('uid-2', 'dana@example.com');
    const presenceRef = doc(db, 'rooms', 'public-room', 'presence', 'uid-2');

    await assertSucceeds(
      setDoc(presenceRef, {
        uid: 'uid-2',
        displayName: 'Dana',
        avatarLabel: 'D',
        role: 'listener',
        status: 'online',
        canPublishAudio: false,
        joinedAt: now,
        lastSeenAt: now,
        updatedAt: now,
      }),
    );
    await assertFails(
      setDoc(presenceRef, {
        uid: 'uid-2',
        displayName: 'Dana',
        avatarLabel: 'D',
        role: 'speaker',
        status: 'online',
        canPublishAudio: true,
        joinedAt: now,
        lastSeenAt: now,
        updatedAt: now,
      }),
    );
  });

  it('denies client moderation event writes', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedRoom('public-room', { visibility: 'public' });
    await seedMember('public-room', 'uid-1', 'Salem', 'S', 'host', true);

    await assertFails(
      setDoc(doc(userDb('uid-1', 'salem@example.com'), 'rooms', 'public-room', 'moderationEvents', 'event-1'), {
        action: 'close-room',
        createdAt: now,
      }),
    );
  });
});

function userDb(uid, email, extraToken = {}) {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true,
    ...extraToken,
  }).firestore();
}

async function seedProfile(uid, email, displayName, avatarLabel) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      uid,
      email,
      displayName,
      avatarLabel,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedRoom(roomId, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rooms', roomId), {
      id: roomId,
      title: 'Room',
      type: 'voice',
      hostId: 'host-uid',
      hostDisplayName: 'Host',
      hostAvatarLabel: 'H',
      status: 'active',
      visibility: 'public',
      participantCount: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  });
}

async function seedMember(roomId, uid, displayName, avatarLabel, role, canPublishAudio, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rooms', roomId, 'members', uid), {
      uid,
      displayName,
      avatarLabel,
      role,
      status: 'active',
      canPublishAudio,
      joinedAt: now,
      updatedAt: now,
      ...extra,
    });
  });
}

function memberPayload(uid, displayName, avatarLabel, role, canPublishAudio, inviteCodeUsed) {
  return {
    uid,
    displayName,
    avatarLabel,
    role,
    status: 'active',
    canPublishAudio,
    ...(inviteCodeUsed ? { inviteCodeUsed } : {}),
    joinedAt: now,
    updatedAt: now,
  };
}
