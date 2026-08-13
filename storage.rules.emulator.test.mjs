import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Timestamp, doc, setDoc } from 'firebase/firestore';
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

describe('storage.rules room-theme assets', () => {
  it('allows catalog admins to create immutable bounded theme images', async () => {
    const asset = ref(adminStorage(), 'room-theme-assets/royal-theater/v1/background.webp');
    await assertSucceeds(uploadBytes(asset, new Uint8Array([1, 2, 3]), { contentType: 'image/webp' }));
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), 'room-theme-assets/royal-theater/v1/background.webp')));
    await assertFails(uploadBytes(asset, new Uint8Array([4]), { contentType: 'image/webp' }));
    await assertFails(deleteObject(asset));
    await assertFails(uploadBytes(
      ref(adminStorage(), 'room-theme-assets/royal-theater/latest/background.svg'),
      new Uint8Array([1]),
      { contentType: 'image/svg+xml' },
    ));
  }, 15_000);
});

describe('storage.rules Personal Chat Wave 1 protection', () => {
  it('keeps media, quarantine, and report evidence dark to users and staff', async () => {
    const user = userStorage('uid-1');
    const staff = testEnv.authenticatedContext('staff-1', {
      admin: true,
      adminRole: 'super-moderator',
      email_verified: true,
    }).storage();
    const paths = [
      'direct-chat-media/conversation-1/upload-1/source.webp',
      'direct-chat-quarantine/conversation-1/upload-1/source.webp',
      'direct-chat-evidence/report-1/message-1/source.webp',
    ];
    for (const path of paths) {
      await assertFails(uploadBytes(ref(user, path), new Uint8Array([1]), { contentType: 'image/webp' }));
      await assertFails(uploadBytes(ref(staff, path), new Uint8Array([1]), { contentType: 'image/webp' }));
      await assertFails(getBytes(ref(user, path)));
      await assertFails(getBytes(ref(staff, path)));
    }
  });
});

describe('storage.rules Personal Chat Wave 5 protected media', () => {
  it('accepts only the exact short-lived immutable quarantine authorization', async () => {
    const conversationId = 'a'.repeat(64);
    const otherConversationId = 'b'.repeat(64);
    const uploadId = `dmu_${'c'.repeat(40)}`;
    const path = `direct-chat-quarantine/${conversationId}/${uploadId}/source`;
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: true, directMessages: true });
    await setFirestoreDocument(`directConversations/${conversationId}`, { memberUids: ['uid-1', 'uid-2'] });
    await setFirestoreDocument(`directChatUploadAuthorizations/uid-1/uploads/${uploadId}`, {
      contentType: 'image/png',
      conversationId,
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      kind: 'image',
      sizeBytes: 3,
      state: 'active',
      storagePath: path,
      uid: 'uid-1',
      uploadId,
    });
    const exactMetadata = { contentType: 'image/png', customMetadata: { conversationId, kind: 'image', uploaderUid: 'uid-1', uploadId } };
    await assertSucceeds(uploadBytes(ref(userStorage('uid-1'), path), new Uint8Array([1, 2, 3]), exactMetadata));
    await assertFails(uploadBytes(ref(userStorage('uid-1'), path), new Uint8Array([1, 2, 3]), exactMetadata));
    await assertFails(getBytes(ref(userStorage('uid-1'), path)));

    const secondUploadId = `dmu_${'d'.repeat(40)}`;
    await setFirestoreDocument(`directChatUploadAuthorizations/uid-1/uploads/${secondUploadId}`, {
      contentType: 'image/png', conversationId, expiresAt: Timestamp.fromMillis(Date.now() + 60_000), kind: 'image', sizeBytes: 3,
      state: 'active', storagePath: `direct-chat-quarantine/${conversationId}/${secondUploadId}/source`, uid: 'uid-1', uploadId: secondUploadId,
    });
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), `direct-chat-quarantine/${otherConversationId}/${secondUploadId}/source`),
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/png', customMetadata: { conversationId: otherConversationId, kind: 'image', uploaderUid: 'uid-1', uploadId: secondUploadId } },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), `direct-chat-quarantine/${conversationId}/${secondUploadId}/source`),
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/jpeg', customMetadata: { conversationId, kind: 'image', uploaderUid: 'uid-1', uploadId: secondUploadId } },
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-2'), `direct-chat-quarantine/${conversationId}/${secondUploadId}/source`),
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/png', customMetadata: { conversationId, kind: 'image', uploaderUid: 'uid-2', uploadId: secondUploadId } },
    ));
  });

  it('lets only conversation members read the exact finalized derivative', async () => {
    const conversationId = 'e'.repeat(64);
    const uploadId = `dmu_${'f'.repeat(40)}`;
    const mediaPath = `direct-chat-media/${conversationId}/${uploadId}/image.webp`;
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: true, directMessages: true });
    await setFirestoreDocument(`directConversations/${conversationId}`, { memberUids: ['uid-1', 'uid-2'] });
    await setFirestoreDocument(`directChatUploads/${uploadId}`, { conversationId, mediaPath, state: 'finalized', uploadId });
    await testEnv.withSecurityRulesDisabled(async (context) => uploadBytes(ref(context.storage(), mediaPath), new Uint8Array([1, 2]), { contentType: 'image/webp' }));
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), mediaPath)));
    await assertSucceeds(getBytes(ref(userStorage('uid-2'), mediaPath)));
    await assertFails(getBytes(ref(userStorage('uid-3'), mediaPath)));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), mediaPath)));
    await assertFails(getBytes(ref(userStorage('uid-1'), `direct-chat-media/${conversationId}/${uploadId}/voice.m4a`)));
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: false, directMessages: true });
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), mediaPath)));
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: false, directMessages: false });
    await assertFails(getBytes(ref(userStorage('uid-1'), mediaPath)));
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: true, directMessages: true });
  });
});

describe('storage.rules Personal Chat Wave 6A report evidence', () => {
  it('denies evidence copies even to the conversation members who may read the live derivative', async () => {
    const conversationId = '1'.repeat(64);
    const uploadId = `dmu_${'2'.repeat(40)}`;
    const reportId = `dmr_${'3'.repeat(40)}`;
    const mediaPath = `direct-chat-media/${conversationId}/${uploadId}/image.webp`;
    const evidencePath = `direct-chat-evidence/${reportId}/${uploadId}/image.webp`;
    await setFirestoreDocument('appConfig/socialFeatures', { directMessageMedia: true, directMessages: true });
    await setFirestoreDocument(`directConversations/${conversationId}`, { memberUids: ['uid-1', 'uid-2'] });
    await setFirestoreDocument(`directChatUploads/${uploadId}`, { conversationId, mediaPath, state: 'finalized', uploadId });
    await setFirestoreDocument(`directChatReports/${reportId}`, {
      accessPolicy: 'staff-only', conversationId, legalHold: false, reporterUid: 'uid-1', targetUid: 'uid-2',
    });
    await testEnv.withSecurityRulesDisabled(async (context) => Promise.all([
      uploadBytes(ref(context.storage(), mediaPath), new Uint8Array([1, 2]), { contentType: 'image/webp' }),
      uploadBytes(ref(context.storage(), evidencePath), new Uint8Array([1, 2]), { contentType: 'image/webp' }),
    ]));

    await assertSucceeds(getBytes(ref(userStorage('uid-1'), mediaPath)));
    const staff = testEnv.authenticatedContext('staff-1', { admin: true, adminRole: 'owner', email_verified: true }).storage();
    for (const storage of [userStorage('uid-1'), userStorage('uid-2'), userStorage('uid-3'), staff]) {
      await assertFails(getBytes(ref(storage, evidencePath)));
      await assertFails(uploadBytes(ref(storage, evidencePath), new Uint8Array([9]), { contentType: 'image/webp' }));
      await assertFails(deleteObject(ref(storage, evidencePath)));
    }
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), evidencePath)));
  });
});

describe('storage.rules Personal Chat Wave 6C isolated evidence media', () => {
  it('keeps the per-message evidence copy backend-only for every caller', async () => {
    const conversationId = '4'.repeat(64);
    const reportId = `dmr_${'5'.repeat(40)}`;
    const messageId = `dmm_${'6'.repeat(40)}`;
    const paths = [
      `direct-chat-evidence/${reportId}/${messageId}/image.webp`,
      `direct-chat-evidence/${reportId}/${messageId}/voice.m4a`,
    ];
    await setFirestoreDocument(`directChatReports/${reportId}`, {
      accessPolicy: 'staff-only', conversationId, legalHold: true, reporterUid: 'uid-1', targetUid: 'uid-2',
    });
    await testEnv.withSecurityRulesDisabled(async (context) => Promise.all(
      paths.map((path) => uploadBytes(ref(context.storage(), path), new Uint8Array([1, 2]), { contentType: 'image/webp' })),
    ));

    const owner = testEnv.authenticatedContext('staff-1', { admin: true, adminRole: 'owner', email_verified: true }).storage();
    const superModerator = testEnv.authenticatedContext('staff-2', { admin: true, adminRole: 'super-moderator', email_verified: true }).storage();
    for (const path of paths) {
      for (const storage of [userStorage('uid-1'), userStorage('uid-2'), owner, superModerator]) {
        await assertFails(getBytes(ref(storage, path)));
        await assertFails(uploadBytes(ref(storage, path), new Uint8Array([9]), { contentType: 'image/webp' }));
        await assertFails(deleteObject(ref(storage, path)));
      }
      await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), path)));
    }
  });
});

describe('storage.rules room Rocket assets', () => {
  it('allows admins to create immutable versioned fallback, animation, and sound assets', async () => {
    const staticAsset = ref(adminStorage(), 'room-rockets/global-room-rocket/v1/static.webp');
    const animation = ref(adminStorage(), 'room-rockets/global-room-rocket/v1/animation.webp');
    const sound = ref(adminStorage(), 'room-rockets/global-room-rocket/v1/launch.mp3');
    await assertSucceeds(uploadBytes(staticAsset, new Uint8Array([1]), { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(animation, new Uint8Array([1]), { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(
      ref(adminStorage(), 'room-rockets/global-room-rocket/v1/animation.mp4'),
      new Uint8Array([1]),
      { contentType: 'video/mp4' },
    ));
    await assertSucceeds(uploadBytes(
      ref(adminStorage(), 'room-rockets/global-room-rocket/v1/animation.json'),
      new Uint8Array([123, 125]),
      { contentType: 'application/json' },
    ));
    await assertSucceeds(uploadBytes(sound, new Uint8Array([1]), { contentType: 'audio/mpeg' }));
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), 'room-rockets/global-room-rocket/v1/static.webp')));
    await assertFails(uploadBytes(animation, new Uint8Array([2]), { contentType: 'image/webp' }));
    await assertFails(deleteObject(sound));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'), 'room-rockets/global-room-rocket/v2/static.webp'),
      new Uint8Array([1]),
      { contentType: 'image/webp' },
    ));
    await assertFails(uploadBytes(
      ref(testEnv.authenticatedContext('auditor-1', {
        admin: true,
        adminRole: 'auditor',
        email_verified: true,
      }).storage(), 'room-rockets/global-room-rocket/v2/static.webp'),
      new Uint8Array([1]),
      { contentType: 'image/webp' },
    ));
    await assertFails(uploadBytes(
      ref(adminStorage(), 'room-rockets/global-room-rocket/latest/animation.gif'),
      new Uint8Array([1]),
      { contentType: 'image/gif' },
    ));
  }, 15_000);
});

describe('storage.rules canonical cosmetics assets', () => {
  it('allows only catalog managers/owners to create immutable bounded sources', async () => {
    const path = 'cosmetic-assets/platform/gold-frame/v1-aaaaaaaaaaaa/source.png';
    const source = ref(adminStorage(), path);
    await assertSucceeds(uploadBytes(source, new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
    }));
    await assertFails(uploadBytes(source, new Uint8Array([4]), {
      contentType: 'image/png',
    }));
    await assertFails(deleteObject(source));
    await assertFails(uploadBytes(
      ref(testEnv.authenticatedContext('auditor-1', {
        admin: true,
        adminRole: 'auditor',
        email_verified: true,
      }).storage(), 'cosmetic-assets/platform/silver-frame/v1-bbbbbbbbbbbb/source.png'),
      new Uint8Array([1]),
      { contentType: 'image/png' },
    ));
    await assertFails(uploadBytes(
      ref(adminStorage(), 'cosmetic-assets/platform/gold-frame/v2-bbbbbbbbbbbb/source.gif'),
      new Uint8Array([1]),
      { contentType: 'image/gif' },
    ));
  });

  it('keeps canonical bytes private until the exact version is published', async () => {
    const path = 'cosmetic-assets/platform/published-frame/v1-aaaaaaaaaaaa/source.png';
    await assertSucceeds(uploadBytes(ref(adminStorage(), path), new Uint8Array([1]), {
      contentType: 'image/png',
    }));
    await assertFails(getBytes(ref(userStorage('uid-1'), path)));
    await setFirestoreDocument('cosmeticAssets/published-frame', {
      assetId: 'published-frame',
      publicationStatus: 'published',
      publishedVersionId: 'v1-aaaaaaaaaaaa',
      renderingEnabled: true,
      schemaVersion: 1,
    });
    await setFirestoreDocument(
      'cosmeticAssets/published-frame/versions/v1-aaaaaaaaaaaa',
      {
        assetId: 'published-frame',
        assetVersionId: 'v1-aaaaaaaaaaaa',
        schemaVersion: 1,
      },
    );
    await assertSucceeds(getBytes(ref(userStorage('uid-1'), path)));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), path)));
  });

  it('does not grant pair authority or audit storage namespaces', async () => {
    const storage = userStorage('uid-1');
    for (const path of [
      'couple-effect-ownerships/rel_123/effect-1.json',
      'couple-effect-audit/event-1.json',
      'couple-entry-claims/room-1/claim-1.json',
    ]) {
      await assertFails(uploadBytes(ref(storage, path), new Uint8Array([1]), { contentType: 'application/json' }));
      await assertFails(getBytes(ref(storage, path)));
    }
  });

  it('allows only pre-authorized owners to create immutable private submissions', async () => {
    await setFirestoreDocument('cosmeticUploadAuthorizations/uid-1', {
      active: true,
      assetVersionId: 'v1-aaaaaaaaaaaa',
      contentType: 'application/json',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      maxBytes: 1024,
      submissionId: 'submission_12345678',
      uid: 'uid-1',
    });
    const path =
      'cosmetic-submissions/uid-1/submission_12345678/v1-aaaaaaaaaaaa/source.json';
    const source = ref(userStorage('uid-1'), path);
    const metadata = {
      contentType: 'application/json',
      customMetadata: { uploaderUid: 'uid-1' },
    };
    await assertSucceeds(uploadBytes(source, new Uint8Array([123, 125]), metadata));
    await assertSucceeds(getBytes(source));
    await assertSucceeds(getBytes(ref(adminStorage(), path)));
    await assertFails(getBytes(ref(userStorage('uid-2'), path)));
    await assertFails(uploadBytes(source, new Uint8Array([1]), metadata));
    await assertFails(deleteObject(source));
    await assertFails(uploadBytes(
      ref(userStorage('uid-1'),
        'cosmetic-submissions/uid-1/submission_87654321/v1-aaaaaaaaaaaa/source.json'),
      new Uint8Array([123, 125]),
      metadata,
    ));
    await assertFails(uploadBytes(
      ref(userStorage('uid-2'),
        'cosmetic-submissions/uid-2/submission_12345678/v1-aaaaaaaaaaaa/source.png'),
      new Uint8Array([1]),
      { contentType: 'image/png', customMetadata: { uploaderUid: 'uid-2' } },
    ));
  });

  it('rejects in-place overwrite of approved user cosmetic assets', async () => {
    const path = 'cosmetic-assets/users/uid-1/cu-pr-aaaaaaaaaaaaaaaaaaaa/v1-123456789abc/source.png';
    await assertSucceeds(uploadBytes(ref(adminStorage(), path), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
    }));
    await assertFails(uploadBytes(ref(adminStorage(), path), new Uint8Array([9]), {
      contentType: 'image/png',
    }));
    await assertFails(uploadBytes(ref(userStorage('uid-1'), path), new Uint8Array([1]), {
      contentType: 'image/png',
    }));
    await assertFails(deleteObject(ref(adminStorage(), path)));
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('storage.rules avatar protection', () => {
  it('accepts only the exact authorized quarantine object and keeps it private', async () => {
    const uploadId = `avu_${'a'.repeat(40)}`;
    const path = `avatar-quarantine/uid-1/${uploadId}/source.png`;
    const sha256 = 'b'.repeat(64);
    await setFirestoreDocument('avatarUploadAuthorizations/uid-1', {
      active: true,
      contentType: 'image/png',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      sha256,
      sizeBytes: 3,
      sourcePath: path,
      uid: 'uid-1',
      uploadId,
    });
    await assertSucceeds(uploadBytes(ref(userStorage('uid-1'), path), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      customMetadata: { sha256, uploaderUid: 'uid-1', uploadId },
    }));
    await assertFails(getBytes(ref(userStorage('uid-1'), path)));
    await assertFails(uploadBytes(ref(userStorage('uid-2'), path), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png', customMetadata: { sha256, uploaderUid: 'uid-2', uploadId },
    }));
  });

  it('routes avatar uploads through quarantine authorization', async () => {
    const ownerRef = ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg');
    await assertFails(uploadBytes(ownerRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' }));
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

  it('keeps avatar deletion backend-only', async () => {
    const ownerRef = ref(userStorage('uid-1'), 'avatars/uid-1/profile.jpg');
    await assertFails(deleteObject(ref(userStorage('uid-2'), 'avatars/uid-1/profile.jpg')));
    await assertFails(deleteObject(ownerRef));
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
  return testEnv.authenticatedContext('admin-1', {
    admin: true,
    adminRole: 'owner',
    email_verified: true,
  }).storage();
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
