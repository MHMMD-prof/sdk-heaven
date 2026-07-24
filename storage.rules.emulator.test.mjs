import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-auth-rules-wave8';
const firestoreEmulatorPort = Number(process.env.FIRESTORE_RULES_TEST_PORT ?? 18081);
const storageEmulatorPort = Number(process.env.STORAGE_RULES_TEST_PORT ?? 19199);
let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: firestoreEmulatorPort,
    },
    projectId,
    storage: {
      rules: fs.readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: storageEmulatorPort,
    },
  });
}, 30_000);

describe('storage.rules store asset protection', () => {
  it('allows only admins to write the two bounded catalog images', async () => {
    const thumbnail = ref(adminStorage(), 'store-assets/gold-car/thumbnail');
    const versionedThumbnail = ref(adminStorage(), 'store-assets/gold-car/thumbnail/12345678-1234-1234-1234-123456789012');
    await assertSucceeds(uploadBytes(thumbnail, new Uint8Array([1, 2]), { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(versionedThumbnail, new Uint8Array([1, 2]), { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(ref(adminStorage(), 'store-assets/gold-car/preview'), new Uint8Array([1]), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(userStorage('uid-1'), 'store-assets/gold-car/thumbnail'), new Uint8Array([1]), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(userStorage('uid-1'), 'store-assets/gold-car/thumbnail/12345678-1234-1234-1234-123456789012'), new Uint8Array([1]), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(adminStorage(), 'store-assets/gold-car/other'), new Uint8Array([1]), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(adminStorage(), 'store-assets/gold-car/preview'), new Uint8Array([1]), { contentType: 'text/plain' }));
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), 'store-assets/gold-car/thumbnail')));
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), 'store-assets/gold-car/thumbnail/12345678-1234-1234-1234-123456789012')));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), 'store-assets/gold-car/thumbnail')));
    await assertSucceeds(deleteObject(thumbnail));
    await assertSucceeds(deleteObject(versionedThumbnail));
  }, 15_000);
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('storage.rules avatar protection', () => {
  it('allows the owner to upload a bounded JPEG and authenticated users to read it', async () => {
    const ownerRef = ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg');
    await assertSucceeds(uploadBytes(ownerRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(userStorage('uid-2'), 'avatars/uid-1/profile.jpg')));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), 'avatars/uid-1/profile.jpg')));
  });

  it('denies other owners, unsupported types, oversized images, and alternate paths', async () => {
    await assertFails(uploadBytes(
      ref(userStorage('uid-2'), 'avatars/uid-1/profile.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/png' },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg'),
      new Uint8Array(2 * 1024 * 1024 + 1),
      { contentType: 'image/jpeg' },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), 'avatars/uid-1/other.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ));
  });

  it('allows only the owner to delete an avatar', async () => {
    const ownerRef = ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg');
    await assertSucceeds(uploadBytes(ownerRef, new Uint8Array([1]), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(ref(userStorage('uid-2'), 'avatars/uid-1/profile.jpg')));
    await assertSucceeds(deleteObject(ownerRef));
  });
});

describe('storage.rules room media protection', () => {
  it('allows only the verified room owner to create one bounded immutable source', async () => {
    const mediaId = 'media_owner_upload_0001';
    await seedRoomMediaState({ mediaId, roomId: 'room-media-1' });
    const source = ref(userStorage('owner-1'), `room-media/room-media-1/${mediaId}/source`);
    await assertSucceeds(uploadBytes(source, new Uint8Array([1, 2, 3]), {
      contentType: 'image/webp',
      customMetadata: { uploaderUid: 'owner-1' },
    }));
    await assertFails(uploadBytes(
      ref(userStorage('other-1'), `room-media/room-media-1/media_other_upload_01/source`),
      new Uint8Array([1]),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'other-1' } },
    ));
    await assertFails(uploadBytes(source, new Uint8Array([4]), {
      contentType: 'image/webp',
      customMetadata: { uploaderUid: 'owner-1' },
    }));
    await assertFails(deleteObject(source));
  });

  it('rejects disabled, malformed, unsupported, oversized, and spoofed uploads', async () => {
    await seedRoomMediaState({ enabled: false, mediaId: 'media_disabled_000001', roomId: 'room-media-2' });
    await assertFails(uploadBytes(
      ref(userStorage('owner-1'), 'room-media/room-media-2/media_disabled_000001/source'),
      new Uint8Array([1]),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'owner-1' } },
    ));
    await seedRoomMediaState({ mediaId: 'media_validation_0001', roomId: 'room-media-3' });
    await assertFails(uploadBytes(
      ref(userStorage('owner-1'), 'room-media/room-media-3/media_validation_0001/source'),
      new Uint8Array([1]),
      { contentType: 'text/plain', customMetadata: { uploaderUid: 'owner-1' } },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('owner-1'), 'room-media/room-media-3/media_validation_0001/source'),
      new Uint8Array(4 * 1024 * 1024 + 1),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'owner-1' } },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('owner-1'), 'room-media/room-media-3/media_validation_0001/source'),
      new Uint8Array([1]),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'spoofed-owner' } },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('owner-1'), 'room-media/room-media-3/short/source'),
      new Uint8Array([1]),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'owner-1' } },
    ));
  });

  it('keeps pending media private and exposes approved media to signed-in members', async () => {
    const mediaId = 'media_review_flow_0001';
    const roomId = 'room-media-4';
    await seedRoomMediaState({ mediaId, roomId });
    const path = `room-media/${roomId}/${mediaId}/source`;
    await assertSucceeds(uploadBytes(ref(userStorage('owner-1'), path), new Uint8Array([1]), {
      contentType: 'image/jpeg',
      customMetadata: { uploaderUid: 'owner-1' },
    }));
    await assertSucceeds(getBytes(ref(userStorage('owner-1'), path)));
    await assertSucceeds(getBytes(ref(adminStorage(), path)));
    await assertFails(getBytes(ref(userStorage('member-1'), path)));
    await setFirestoreDocument(`rooms/${roomId}/media/${mediaId}`, { status: 'approved' });
    await assertSucceeds(getBytes(ref(userStorage('member-1'), path)));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), path)));
  });
});

function userStorage(uid) {
  return testEnv.authenticatedContext(uid, { email_verified: true }).storage();
}

function adminStorage() {
  return testEnv.authenticatedContext('admin-1', { admin: true, email_verified: true }).storage();
}

async function seedRoomMediaState({ enabled = true, mediaId, roomId }) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), `rooms/${roomId}`), { ownerUid: 'owner-1' }),
      setDoc(doc(context.firestore(), 'appConfig/voiceRoomFeatures'), {
        voice_room_command_center: enabled,
        voice_room_media: enabled,
      }),
      setDoc(doc(context.firestore(), `rooms/${roomId}/media/${mediaId}`), { status: 'pending' }),
    ]);
  });
}

async function setFirestoreDocument(path, value) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), value);
  });
}
