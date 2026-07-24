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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
}, 30_000);

afterAll(async () => {
  await testEnv?.cleanup();
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

  it('allows authenticated non-blocked public profile reads and denies anonymous access', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });

    await assertSucceeds(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'publicProfiles', 'uid-1')));
  });

  it('denies direct public profile collection discovery during Wave 0', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });

    await assertFails(getDocs(query(
      collection(userDb('uid-2', 'dana@example.com'), 'publicProfiles'),
      where('moderationStatus', '==', 'active'),
    )));
  });

  it('denies public profile reads in either blocking direction', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedBlock('uid-1', 'uid-2');

    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'blocks', 'uid-1', 'blocked', 'uid-2'));
    });
    await seedBlock('uid-2', 'uid-1');
    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
  });

  it('denies other-profile reads to unprovisioned and suspended requesters', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });

    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
    await seedPublicProfile('uid-2', {
      displayName: 'Dana',
      moderationStatus: 'suspended',
      normalizedName: 'dana',
      publicId: '8765432',
    });
    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
  });

  it('allows safe owner presentation updates but protects identity, counters, and moderation', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    const profileRef = doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-1');

    await assertSucceeds(updateDoc(profileRef, { bio: 'نبذة قصيرة', countryCode: 'LB', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { countryCode: 'US', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { giftScore: 99, updatedAt: now }));
    await assertFails(updateDoc(profileRef, {
      representativeBadge: { active: true, updatedAt: now },
      updatedAt: now,
    }));
    await assertFails(updateDoc(profileRef, { specialId: '0000777', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { publicId: '8765432', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { moderationStatus: 'removed', updatedAt: now }));
  });

  it('denies direct public identity and reserved social collection writes', async () => {
    const db = userDb('uid-1', 'salem@example.com');

    await assertFails(setDoc(doc(db, 'publicProfiles', 'uid-1'), publicProfilePayload('uid-1')));
    await assertFails(setDoc(doc(db, 'publicIds', '1234567'), { uid: 'uid-1', createdAt: now }));
    await assertFails(setDoc(doc(db, 'specialIds', '0000777'), { uid: 'uid-1', createdAt: now }));
    await assertFails(setDoc(doc(db, 'specialIdCatalog', '0000777'), { price: 100, specialId: '0000777', status: 'available' }));
    await assertFails(setDoc(doc(db, 'walletSummaries', 'uid-1'), { balance: 100, uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'socialCommandRequests', 'uid-1', 'requests', 'request-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'socialRateLimits', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'socialFriendRateLimits', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'socialCoupleRateLimits', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'socialNotificationRateLimits', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'pushDevices', 'uid-1', 'tokens', 'token-1'), { token: 'secret' }));
    await assertFails(setDoc(doc(db, 'pushTokenOwners', 'token-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'notificationPreferences', 'uid-1'), { gifts: true }));
    await assertFails(setDoc(doc(db, 'notificationDeliveries', 'delivery-1'), { status: 'sent' }));
    await assertFails(setDoc(doc(db, 'adminUserSearch', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'friendships', 'friendship-1'), { userIds: ['uid-1', 'uid-2'] }));
    await assertFails(setDoc(doc(db, 'coupleRequests', 'couple-request-1'), { senderUid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'couples', 'couple-1'), { memberUids: ['uid-1', 'uid-2'] }));
    await assertFails(setDoc(doc(db, 'coupleMemberships', 'uid-1'), { partnerUid: 'uid-2' }));
    await assertFails(setDoc(doc(db, 'walletTransactions', 'tx-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'storeCatalog', 'royal-frame'), { itemId: 'royal-frame' }));
    await assertFails(setDoc(doc(db, 'storeCustomIds', '0000777'), { itemId: 'custom-id-0000777' }));
    await assertFails(setDoc(doc(db, 'storeOwnerships', 'uid-1', 'items', 'own-1'), { itemId: 'royal-frame' }));
    await assertFails(setDoc(doc(db, 'storeEquipment', 'uid-1'), { slots: { cars: 'gold-car' } }));
    await assertFails(setDoc(doc(db, 'storeTransactions', 'store-tx-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'storeGiftEvents', 'store-gift-1'), { itemId: 'gold-car' }));
    await assertFails(setDoc(doc(db, 'representativePrivileges', 'uid-1'), { active: true }));
    await assertFails(setDoc(doc(db, 'representativeTransfers', 'transfer-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'representativeTransferReversals', 'transfer-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'representativeTransferCommands', 'uid-1', 'requests', 'request-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'representativePublicReferences', 'RPT-0123456789ABCDEF'), { transferId: 'transfer-1' }));
    await assertFails(setDoc(doc(db, 'representativeTransferReceipts', 'uid-1', 'items', 'transfer-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'representativePortalBootstrapTickets', 'ticket-1'), { representativeUid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'representativePortalSessions', 'session-1'), { representativeUid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'representativePortalHistoryCursors', 'cursor-1'), { representativeUid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'representativeRecipientProofs', 'proof-1'), { representativeUid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'representativePortalRateLimits', 'uid-1'), { count: 1 }));
    await assertFails(setDoc(doc(db, 'representativePortalSecurityEvents', 'event-1'), { kind: 'invalid-recipient-lookup' }));
    await assertFails(setDoc(doc(db, 'representativeTransferPins', 'uid-1'), { hash: 'secret' }));
    await assertFails(setDoc(doc(db, 'representativeTransferCounters', 'uid-1', 'days', '2026-07-22'), { amounts: { coins: 1 } }));
    await assertFails(setDoc(doc(db, 'walletRechargeReceipts', 'uid-1', 'items', 'transfer-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'giftEvents', 'gift-1'), { recipientUid: 'uid-2' }));
    await assertFails(setDoc(doc(db, 'socialGiftRateLimits', 'uid-1'), { count: 1, uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'couples', 'couple-1'), { userIds: ['uid-1', 'uid-2'] }));
  });

  it('allows signed-in reads of social feature flags while denying client changes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'socialFeatures'), {
        usersDiscovery: false,
        friends: false,
        wallet: false,
        gifts: false,
        couples: false,
        pushNotifications: false,
        representativeTransfers: false,
        updatedAt: now,
      });
    });
    const signedInRef = doc(userDb('uid-1', 'salem@example.com'), 'appConfig', 'socialFeatures');

    await assertSucceeds(getDoc(signedInRef));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'appConfig', 'socialFeatures')));
    await assertFails(updateDoc(signedInRef, { friends: true }));
  });

  it('allows an unverified signed-in owner to create their onboarding profile', async () => {
    const db = userDb('uid-new', 'new@example.com', { email_verified: false });

    await assertSucceeds(
      setDoc(doc(db, 'users', 'uid-new'), {
        uid: 'uid-new',
        email: 'new@example.com',
        displayName: 'New Player',
        avatarLabel: 'N',
        createdAt: now,
        updatedAt: now,
      }),
    );

    await assertFails(
      setDoc(doc(db, 'users', 'uid-other'), {
        uid: 'uid-other',
        email: 'new@example.com',
        displayName: 'Other Player',
        avatarLabel: 'O',
        createdAt: now,
        updatedAt: now,
      }),
    );
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

  it('allows an owner to list their active public and private hosted rooms', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('owned-public-room', { hostId: 'uid-1', visibility: 'public' });
    await seedRoom('owned-private-room', {
      hostId: 'uid-1',
      visibility: 'private',
      inviteCode: 'ABC123',
    });

    const ownerQuery = query(
      collection(userDb('uid-1', 'salem@example.com'), 'rooms'),
      where('hostId', '==', 'uid-1'),
      where('status', '==', 'active'),
    );
    const otherUserQuery = query(
      collection(userDb('uid-2', 'dana@example.com'), 'rooms'),
      where('hostId', '==', 'uid-1'),
      where('status', '==', 'active'),
    );

    await assertSucceeds(getDocs(ownerQuery));
    await assertFails(getDocs(otherUserQuery));
  });

  it('accepts supported room countries and legacy rooms without a country', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    const db = userDb('uid-1', 'salem@example.com');

    const supportedCountries = [
      'IQ', 'SA', 'SY', 'LB', 'YE', 'DZ', 'EG', 'JO', 'PS', 'AE', 'KW',
      'QA', 'BH', 'OM', 'MA', 'TN', 'LY', 'SD', 'SO', 'DJ', 'MR', 'KM',
    ];

    for (const countryCode of supportedCountries) {
      await assertSucceeds(
        createRoomAndHost(db, 'uid-1', `room-${countryCode.toLowerCase()}`, countryCode),
      );
    }
    await assertSucceeds(createRoomAndHost(db, 'uid-1', 'room-legacy'));
  });

  it('denies unsupported room country codes', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    const db = userDb('uid-1', 'salem@example.com');

    await assertFails(createRoomAndHost(db, 'uid-1', 'room-invalid', 'US'));
  });

  it('accepts a strict v2 room while denying forged ownership and authority', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    const ownerDb = userDb('uid-1', 'salem@example.com');
    const memberDb = userDb('uid-2', 'dana@example.com');

    await assertSucceeds(createRoomAndHostV2(ownerDb, 'uid-1', 'room-v2'));
    await assertSucceeds(createRoomAndHostV2(ownerDb, 'uid-1', 'room-v2-settings', {
      announcement: 'أهلاً بكم',
      chatMode: 'everyone',
      effectsPolicy: 'full',
      historyVisibility: 'everyone',
      keywordFilterMode: 'standard',
      roomCustomizationSuspended: false,
      roomImageReviewStatus: 'none',
      themeId: 'royal',
      slowModeSeconds: 5,
      welcomeMessage: 'مرحباً',
    }));
    await assertFails(
      setDoc(doc(memberDb, 'rooms', 'forged-room'), v2RoomPayload('forged-room', 'uid-2', {
        ownerUid: 'uid-1',
      })),
    );
    await assertFails(
      updateDoc(doc(ownerDb, 'rooms', 'room-v2'), { ownerUid: 'uid-2', hostId: 'uid-2', revision: 2 }),
    );
    await assertFails(
      setDoc(doc(memberDb, 'rooms', 'room-v2', 'members', 'uid-2'), {
        ...memberPayload('uid-2', 'Dana', 'D', 'listener', false),
        schemaVersion: 2,
        authorityRole: 'moderator',
        seatId: null,
        privileges: { canManageMusic: false },
      }),
    );
  });

  it('denies direct seat claims, self-promotion, and banned joins', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('public-room', { visibility: 'public' });
    await seedMember('public-room', 'uid-2', 'Dana', 'D', 'listener', false);
    const db = userDb('uid-2', 'dana@example.com');

    await assertFails(updateDoc(doc(db, 'rooms', 'public-room', 'members', 'uid-2'), {
      role: 'speaker',
      canPublishAudio: true,
      updatedAt: now,
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'public-room', 'seats', '01'), {
      schemaVersion: 2,
      seatNumber: 1,
      state: 'occupied',
      occupantUid: 'uid-2',
      revision: 1,
      updatedAt: now,
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'public-room', 'seats', '02'), {
      schemaVersion: 2,
      seatNumber: 2,
      state: 'occupied',
      occupantUid: 'uid-2',
      revision: 1,
      updatedAt: now,
    }));

    await seedRoom('banned-room', { visibility: 'public' });
    await seedRoomBan('banned-room', 'uid-2');
    await assertFails(setDoc(
      doc(db, 'rooms', 'banned-room', 'members', 'uid-2'),
      memberPayload('uid-2', 'Dana', 'D', 'listener', false),
    ));

    await seedRoom('expired-ban-room', { visibility: 'public' });
    await seedRoomBan('expired-ban-room', 'uid-2', { expiresAt: Timestamp.fromMillis(now.toMillis() - 1) });
    await assertSucceeds(setDoc(
      doc(db, 'rooms', 'expired-ban-room', 'members', 'uid-2'),
      memberPayload('uid-2', 'Dana', 'D', 'listener', false),
    ));
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
        authorityRole: 'member',
        seatId: null,
        sessionId: 'presence-session-uid-2',
        leaseExpiresAt: now,
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
        authorityRole: 'member',
        seatId: null,
        sessionId: 'presence-session-uid-2',
        leaseExpiresAt: now,
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

  it('allows only owner and moderators to read bans and moderation history', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedProfile('mod-1', 'mod@example.com', 'Mod', 'M');
    await seedRoom('managed-room', { ownerUid: 'uid-1', hostId: 'uid-1' });
    await seedMember('managed-room', 'uid-1', 'Salem', 'S', 'host', true, {
      authorityRole: 'owner',
      privileges: { canManageMusic: false },
      schemaVersion: 2,
      seatId: null,
    });
    await seedMember('managed-room', 'mod-1', 'Mod', 'M', 'listener', false, {
      authorityRole: 'moderator',
      privileges: { canManageMusic: false },
      schemaVersion: 2,
      seatId: null,
    });
    await seedRoomBan('managed-room', 'uid-2');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rooms', 'managed-room', 'moderationEvents', 'event-1'), {
        action: 'ban-member',
        actorUid: 'uid-1',
        createdAt: now,
        targetUid: 'uid-2',
      });
    });

    for (const managerDb of [
      userDb('uid-1', 'salem@example.com'),
      userDb('mod-1', 'mod@example.com'),
    ]) {
      await assertSucceeds(getDoc(doc(managerDb, 'rooms', 'managed-room', 'bans', 'uid-2')));
      await assertSucceeds(getDoc(doc(managerDb, 'rooms', 'managed-room', 'moderationEvents', 'event-1')));
      await assertSucceeds(getDocs(collection(managerDb, 'rooms', 'managed-room', 'bans')));
      await assertSucceeds(getDocs(collection(managerDb, 'rooms', 'managed-room', 'moderationEvents')));
    }
    const memberDb = userDb('uid-2', 'dana@example.com');
    await assertFails(getDoc(doc(memberDb, 'rooms', 'managed-room', 'bans', 'uid-2')));
    await assertFails(getDoc(doc(memberDb, 'rooms', 'managed-room', 'moderationEvents', 'event-1')));
    await assertFails(updateDoc(doc(userDb('uid-1', 'salem@example.com'), 'rooms', 'managed-room', 'bans', 'uid-2'), {
      status: 'revoked',
      updatedAt: now,
    }));
  });

  it('allows scoped seat-offer reads but denies every client seat-offer write', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('seat-room', {
      schemaVersion: 2, ownerUid: 'owner-1', speakerCount: 0, seatMode: 'request', seatTargetCount: 10,
    });
    await seedMember('seat-room', 'uid-2', 'Dana', 'D', 'listener', false, {
      schemaVersion: 2, authorityRole: 'member', seatId: null, privileges: { canManageMusic: false },
    });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'rooms', 'seat-room', 'seatRequests', 'uid-2'), {
        requesterUid: 'uid-2', requestedSeatId: '01', status: 'pending', createdAt: now, expiresAt: now,
      });
      await setDoc(doc(db, 'rooms', 'seat-room', 'seatInvites', 'uid-2'), {
        targetUid: 'uid-2', seatId: '01', status: 'pending', createdAt: now, expiresAt: now,
      });
    });
    const db = userDb('uid-2', 'dana@example.com');
    await assertSucceeds(getDoc(doc(db, 'rooms', 'seat-room', 'seatRequests', 'uid-2')));
    await assertSucceeds(getDoc(doc(db, 'rooms', 'seat-room', 'seatInvites', 'uid-2')));
    await assertFails(setDoc(doc(db, 'rooms', 'seat-room', 'seatRequests', 'forged'), {
      requesterUid: 'uid-2', requestedSeatId: '02', status: 'pending', createdAt: now, expiresAt: now,
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'seat-room', 'seatInvites', 'uid-2'), {
      targetUid: 'uid-2', seatId: '02', status: 'pending', createdAt: now, expiresAt: now,
    }));
  });

  it('denies forged force-mute and command replay records while allowing immutable server fields to survive refresh', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('public-room', { visibility: 'public' });
    await seedMember('public-room', 'uid-2', 'Dana', 'D', 'speaker', false, {
      schemaVersion: 2,
      authorityRole: 'member',
      seatId: null,
      privileges: { canManageMusic: false },
      forceMuted: true,
      updatedBy: 'owner-1',
    });
    const db = userDb('uid-2', 'dana@example.com');
    const memberRef = doc(db, 'rooms', 'public-room', 'members', 'uid-2');

    await assertSucceeds(updateDoc(memberRef, {
      displayName: 'Dana',
      avatarLabel: 'D',
      updatedAt: now,
    }));
    await assertFails(updateDoc(memberRef, { forceMuted: false, canPublishAudio: true, updatedAt: now }));
    await assertFails(updateDoc(memberRef, {
      privileges: { canManageMusic: true },
      authorityRole: 'moderator',
      updatedAt: now,
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'public-room', 'commandRequests', 'room_request_0001'), {
      actorUid: 'uid-2',
      status: 'applied',
      createdAt: now,
    }));
  });

  it('allows gated room-message reads while denying every client chat write', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-2', {
      displayName: 'Dana',
      normalizedName: 'dana',
      publicId: '8765432',
    });
    await seedRoom('chat-room', { historyVisibility: 'everyone' });
    await seedMember('chat-room', 'uid-2', 'Dana', 'D', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), { voice_room_chat: true });
      await setDoc(doc(db, 'rooms', 'chat-room', 'messages', 'message-1'), {
        createdAt: now,
        evidenceHold: false,
        expireAt: Timestamp.fromMillis(now.toMillis() + 60_000),
        id: 'message-1',
        kind: 'chat',
        revision: 1,
        roomId: 'chat-room',
        schemaVersion: 2,
        senderUid: 'uid-1',
        status: 'active',
        text: 'hello',
        updatedAt: now,
      });
      await setDoc(doc(db, 'rooms', 'chat-room', 'chatState', 'current'), {
        pinnedMessageId: 'message-1',
      });
    });
    const db = userDb('uid-2', 'dana@example.com');

    await assertSucceeds(getDoc(doc(db, 'rooms', 'chat-room', 'messages', 'message-1')));
    await assertSucceeds(getDoc(doc(db, 'rooms', 'chat-room', 'chatState', 'current')));
    await assertFails(setDoc(doc(db, 'rooms', 'chat-room', 'messages', 'forged'), {
      createdAt: now,
      senderUid: 'uid-2',
      text: 'forged',
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'chat-room', 'chatRequests', 'chat_request_1'), {
      actorUid: 'uid-2',
    }));
    await assertFails(setDoc(doc(db, 'rooms', 'chat-room', 'chatRateLimits', 'uid-2'), {
      messageCount: 0,
    }));
    await assertFails(updateDoc(doc(db, 'rooms', 'chat-room', 'chatState', 'current'), {
      pinnedMessageId: '',
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomFeatures'), {
        voice_room_chat: false,
      });
    });
    await assertFails(getDoc(doc(db, 'rooms', 'chat-room', 'messages', 'message-1')));
  });

  it('enforces room message history boundaries', async () => {
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-2', {
      displayName: 'Dana',
      normalizedName: 'dana',
      publicId: '8765432',
    });
    await seedRoom('bounded-chat-room', { historyVisibility: 'after-join' });
    await seedMember('bounded-chat-room', 'uid-2', 'Dana', 'D', 'listener', false);
    const beforeJoin = Timestamp.fromMillis(now.toMillis() - 1);
    const afterJoin = Timestamp.fromMillis(now.toMillis() + 1);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), { voice_room_chat: true });
      for (const [id, createdAt] of [['old-message', beforeJoin], ['new-message', afterJoin]]) {
        await setDoc(doc(db, 'rooms', 'bounded-chat-room', 'messages', id), {
          createdAt,
          id,
          kind: 'chat',
          revision: 1,
          roomId: 'bounded-chat-room',
          schemaVersion: 2,
          senderUid: 'uid-1',
          status: 'active',
          text: id,
          updatedAt: createdAt,
        });
      }
    });
    const db = userDb('uid-2', 'dana@example.com');
    await assertFails(getDoc(doc(db, 'rooms', 'bounded-chat-room', 'messages', 'old-message')));
    await assertSucceeds(getDoc(doc(db, 'rooms', 'bounded-chat-room', 'messages', 'new-message')));
  });

  it('allows users to read only their own backend-managed block list', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', {
      displayName: 'Dana',
      normalizedName: 'dana',
      publicId: '8765432',
    });
    await seedBlock('uid-1', 'uid-2');
    const ownerDb = userDb('uid-1', 'salem@example.com');
    const otherDb = userDb('uid-2', 'dana@example.com');

    await assertSucceeds(getDoc(doc(ownerDb, 'blocks', 'uid-1', 'blocked', 'uid-2')));
    await assertSucceeds(getDocs(collection(ownerDb, 'blocks', 'uid-1', 'blocked')));
    await assertFails(getDoc(doc(otherDb, 'blocks', 'uid-1', 'blocked', 'uid-2')));
    await assertFails(deleteDoc(doc(ownerDb, 'blocks', 'uid-1', 'blocked', 'uid-2')));
    await assertFails(setDoc(doc(ownerDb, 'roomSafetyRateLimits', 'uid-1'), { reportCount: 0 }));
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

async function seedPublicProfile(uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'publicProfiles', uid), {
      ...publicProfilePayload(uid),
      ...overrides,
    });
  });
}

async function seedBlock(blockerUid, blockedUid) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'blocks', blockerUid, 'blocked', blockedUid), {
      blockedUid,
      blockerUid,
      createdAt: now,
    });
  });
}

function publicProfilePayload(uid) {
  return {
    uid,
    publicId: '1234567',
    displayName: 'Salem',
    normalizedName: 'salem',
    avatarUrl: '',
    countryCode: 'IQ',
    bio: '',
    giftScore: 0,
    friendCount: 0,
    coupleLevel: 0,
    moderationStatus: 'active',
    avatarModerationStatus: 'clear',
    createdAt: now,
    updatedAt: now,
  };
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

function createRoomAndHost(db, uid, roomId, countryCode) {
  const batch = writeBatch(db);

  batch.set(doc(db, 'rooms', roomId), {
    id: roomId,
    title: 'Room',
    type: 'voice',
    ...(countryCode ? { countryCode } : {}),
    hostId: uid,
    hostDisplayName: 'Salem',
    hostAvatarLabel: 'S',
    status: 'active',
    visibility: 'public',
    participantCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(doc(db, 'rooms', roomId, 'members', uid), memberPayload(uid, 'Salem', 'S', 'host', true));

  return batch.commit();
}

function v2RoomPayload(roomId, uid, overrides = {}) {
  return {
    id: roomId,
    title: 'Room v2',
    type: 'voice',
    countryCode: 'IQ',
    hostId: uid,
    ownerUid: uid,
    hostDisplayName: 'Salem',
    ownerDisplayName: 'Salem',
    hostAvatarLabel: 'S',
    ownerAvatarLabel: 'S',
    status: 'active',
    visibility: 'public',
    participantCount: 1,
    speakerCount: 0,
    schemaVersion: 2,
    revision: 1,
    availability: 'active',
    seatTargetCount: 10,
    seatMode: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createRoomAndHostV2(db, uid, roomId, overrides = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rooms', roomId), v2RoomPayload(roomId, uid, overrides));
  batch.set(doc(db, 'rooms', roomId, 'members', uid), {
    ...memberPayload(uid, 'Salem', 'S', 'host', true),
    schemaVersion: 2,
    authorityRole: 'owner',
    seatId: null,
    privileges: { canManageMusic: false },
  });
  for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
    batch.set(doc(db, 'rooms', roomId, 'seats', String(seatNumber).padStart(2, '0')), {
      schemaVersion: 2,
      seatNumber,
      state: 'open',
      revision: 1,
      updatedAt: now,
    });
  }
  return batch.commit();
}

async function seedRoomBan(roomId, uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rooms', roomId, 'bans', uid), {
      targetUid: uid,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  });
}
