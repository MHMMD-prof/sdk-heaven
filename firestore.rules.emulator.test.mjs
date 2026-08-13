import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomLaunch'), {
      allowedRegionCodes: [],
      allowedUids: [],
      audienceMode: 'public',
      broadReleaseReady: true,
      minimumClientVersion: '1.0.0',
      recordingDecision: 'rejected',
      stageId: 10,
      status: 'testing',
    });
  });
});

describe('firestore.rules auth waves', () => {
  it('restricts deletion-pending accounts to their lifecycle status', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountLifecycles', 'uid-1'), { state: 'deletion-pending', uid: 'uid-1' });
    });
    const pendingDb = userDb('uid-1', 'salem@example.com', { accountDeletionPending: true });
    await assertFails(getDoc(doc(pendingDb, 'users', 'uid-1')));
    await assertSucceeds(getDoc(doc(pendingDb, 'accountLifecycles', 'uid-1')));
    await assertFails(setDoc(doc(pendingDb, 'publicProfiles', 'uid-1'), publicProfilePayload('uid-1')));
  });

  it('allows owner profile reads and denies other users', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');

    await assertSucceeds(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'users', 'uid-1')));
    await assertFails(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'users', 'uid-1')));
  });

  it('routes private presentation changes through the server command', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await assertFails(updateDoc(doc(userDb('uid-1', 'salem@example.com'), 'users', 'uid-1'), {
      displayName: 'Changed',
      updatedAt: now,
    }));
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

  it('routes all public-profile updates through server commands', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    const profileRef = doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-1');

    await assertFails(updateDoc(profileRef, { bio: 'نبذة قصيرة', countryCode: 'LB', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { countryCode: 'US', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { giftScore: 99, updatedAt: now }));
    await assertFails(updateDoc(profileRef, {
      coupleEffect: {
        assetId: 'forged-pair',
        assetVersionId: 'v1-123456789abc',
        borderMode: 'static',
        coupleIdHash: 'a'.repeat(64),
        entranceMode: 'static',
        fallbackAssetId: 'forged-pair',
        fallbackAssetVersionId: 'v1-123456789abc',
        format: 'png',
        itemId: 'forged-pair',
        profileMode: 'static',
      },
      updatedAt: now,
    }));
    await assertFails(updateDoc(profileRef, {
      representativeBadge: { active: true, updatedAt: now },
      updatedAt: now,
    }));
    await assertFails(updateDoc(profileRef, { specialId: '0000777', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { publicId: '8765432', updatedAt: now }));
    await assertFails(updateDoc(profileRef, { moderationStatus: 'removed', updatedAt: now }));
  });

  it('accepts bounded Wave 6 projections but rejects unrecognized cosmetic authority fields', async () => {
    await seedPublicProfile('uid-1', {
      coupleEffect: {
        assetId: 'safe-pair',
        assetVersionId: 'v1-123456789abc',
        borderMode: 'looping',
        coupleIdHash: 'a'.repeat(64),
        entranceMode: 'one-shot',
        fallbackAssetId: 'safe-pair-static',
        fallbackAssetVersionId: 'v1-abcdef123456',
        format: 'lottie-json',
        itemId: 'safe-pair-item',
        profileMode: 'static',
      },
      equippedCosmetics: {
        chatBubble: { assetId: 'safe-bubble', assetVersionId: 'v1-123456789abc', itemId: 'safe-bubble-item' },
        seatEffect: { assetId: 'safe-seat', assetVersionId: 'v1-123456789abc', itemId: 'safe-seat-item' },
      },
    });
    await seedPublicProfile('uid-2', { publicId: '7654321' });
    await assertSucceeds(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-2')));
    await seedPublicProfile('uid-1', {
      equippedCosmetics: {
        staffBadge: { assetId: 'fake-staff', assetVersionId: 'v1-123456789abc', itemId: 'fake-staff-item' },
      },
    });
    await assertFails(getDoc(doc(userDb('uid-2', 'layla@example.com'), 'publicProfiles', 'uid-1')));
  });

  it('admits bounded legacy VIP and Wave 1 status projections on public profiles', async () => {
    await seedPublicProfile('uid-1', {
      vipTier: { accentColor: '#D4AF37', id: 'gold', nameAr: 'ذهبي', rank: 3 },
      statusPresentation: {
        schemaVersion: 1,
        visibility: 'public',
        vip: {
          accentColor: '#22A978',
          band: 'svip',
          catalogVersion: 'vip-2026-01',
          id: 'svip-1',
          level: 1,
          nameAr: 'SVIP 1',
          nameEn: 'SVIP 1',
          order: 11,
          assets: {},
        },
        aristocracy: {
          accentColor: '#D4AF37',
          catalogVersion: 'noble-2026-01',
          id: 'knight',
          nameAr: 'فارس',
          nameEn: 'Knight',
          order: 1,
          assets: {},
        },
      },
    });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await assertSucceeds(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
    await seedPublicProfile('uid-1', {
      statusPresentation: {
        schemaVersion: 1,
        visibility: 'public',
        vip: {
          accentColor: '#22A978', assets: { badge: { assetId: 'svip-badge', assetVersionId: 'v1-123456789abc' } },
          band: 'svip', catalogVersion: 'vip-2026-01', id: 'svip-1', level: 1,
          nameAr: 'SVIP 1', nameEn: 'SVIP 1', order: 11,
        },
      },
    });
    await assertSucceeds(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
    await seedPublicProfile('uid-1', { vipTier: null });
    await assertSucceeds(getDoc(doc(userDb('uid-2', 'dana@example.com'), 'publicProfiles', 'uid-1')));
  });

  it('rejects malformed or leaking Wave 1 public status projections', async () => {
    await seedPublicProfile('uid-1', {
      statusPresentation: {
        schemaVersion: 1,
        visibility: 'hidden',
        vip: {
          accentColor: '#22A978', band: 'svip', catalogVersion: 'vip-2026-01',
          id: 'svip-1', level: 1, nameAr: 'SVIP 1', nameEn: 'SVIP 1', order: 11, assets: {},
        },
      },
    });
    await assertFails(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-1')));
    await seedPublicProfile('uid-1', {
      statusPresentation: {
        schemaVersion: 1,
        visibility: 'public',
        aristocracy: {
          accentColor: '#D4AF37', catalogVersion: 'noble-2026-01', expiresAt: now,
          id: 'knight', nameAr: 'فارس', nameEn: 'Knight', order: 1,
        },
      },
    });
    await assertFails(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-1')));
    await seedPublicProfile('uid-1', {
      statusPresentation: {
        schemaVersion: 1,
        visibility: 'public',
        vip: {
          accentColor: '#22A978', band: 'vip', catalogVersion: 'vip-2026-01',
          id: 'svip-1', level: 1, nameAr: 'SVIP 1', nameEn: 'SVIP 1', order: 11, assets: {},
        },
      },
    });
    await assertFails(getDoc(doc(userDb('uid-1', 'salem@example.com'), 'publicProfiles', 'uid-1')));
  });

  it('keeps every Wave 1-3 status authority, economy, job, and command document server-only', async () => {
    const db = userDb('uid-1', 'salem@example.com');
    const paths = [
      ['vipTierCatalogVersions', 'vip-2026-01'],
      ['aristocracyCatalogVersions', 'noble-2026-01'],
      ['statusCatalogPointers', 'vip-svip'],
      ['vipAccounts', 'uid-1'],
      ['vipContributions', 'representative-transfer-1'],
      ['aristocracyEntitlements', 'uid-1'],
      ['aristocracyTransactions', 'transaction-1'],
      ['statusSourceOutbox', 'event-1'],
      ['statusPresentationJobs', 'job-1'],
      ['statusVisibility', 'uid-1'],
      ['statusAdminProposals', 'proposal-1'],
      ['statusOperations', 'reconciliation'],
      ['statusReconciliationRuns', 'run-1'],
      ['statusOpsAlerts', 'alert-1'],
    ];
    for (const segments of paths) {
      const reference = doc(db, ...segments);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { schemaVersion: 1, uid: 'uid-1' }));
    }
    await assertFails(getDoc(doc(db, 'vipTransitions', 'uid-1', 'items', 'transition-1')));
    await assertFails(getDoc(doc(db, 'aristocracyQuotes', 'uid-1', 'items', 'quote-1')));
    await assertFails(getDoc(doc(db, 'statusCommandRequests', 'uid-1', 'requests', 'request-1')));
    await assertFails(getDoc(doc(db, 'statusRateLimits', 'uid-1', 'hours', '2026-08-13T00')));
    await assertFails(setDoc(doc(db, 'statusRateLimits', 'uid-1', 'hours', '2026-08-13T00'), { aristocracyQuotes: 0 }));
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
    await assertFails(setDoc(doc(db, 'coupleEffectOwnerships', 'rel_123', 'items', 'effect-1'), { itemId: 'effect-1' }));
    await assertFails(setDoc(doc(db, 'coupleEffectEquipment', 'rel_123'), { itemId: 'effect-1' }));
    await assertFails(setDoc(doc(db, 'coupleEffectTransactions', 'tx-1'), { itemId: 'effect-1' }));
    await assertFails(setDoc(doc(db, 'coupleEffectAuditEvents', 'event-1'), { action: 'equip' }));
    await assertFails(getDoc(doc(db, 'coupleEffectOwnerships', 'rel_123', 'items', 'effect-1')));
    await assertFails(getDoc(doc(db, 'coupleEffectEquipment', 'rel_123')));
    await assertFails(getDoc(doc(db, 'coupleEffectTransactions', 'tx-1')));
    await assertFails(getDoc(doc(db, 'coupleEffectAuditEvents', 'event-1')));
    await assertFails(setDoc(doc(db, 'rooms', 'room-1', 'coupleEntryClaims', 'claim-1'), { eventId: 'claim-1' }));
    await assertFails(getDoc(doc(db, 'rooms', 'room-1', 'coupleEntryClaims', 'claim-1')));
    await assertFails(setDoc(doc(db, 'walletTransactions', 'tx-1'), { amount: 100 }));
    await assertFails(setDoc(doc(db, 'dailyLoginCampaign', 'current'), { activeRevision: 1 }));
    await assertFails(setDoc(doc(db, 'dailyLoginStates', 'uid-1'), { streakPosition: 1, uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'dailyLoginClaims', 'uid-1', 'days', 'day_2026-07-31_asia-baghdad'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'dailyLoginCommands', 'uid-1', 'requests', 'request-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'dailyLoginRateLimits', 'uid-1'), { count: 1, uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'dailyLoginAdminCommands', 'request-1'), { operation: 'publish' }));
    await assertFails(setDoc(doc(db, 'dailyLoginFailureMetrics', '2026-07-31_RATE_LIMITED_1'), { count: 1 }));
    await assertFails(setDoc(doc(db, 'economyRestrictions', 'uid-1'), { status: 'restricted' }));
    await assertFails(getDoc(doc(db, 'dailyLoginStates', 'uid-1')));
    await assertFails(getDoc(doc(db, 'dailyLoginClaims', 'uid-2', 'days', 'day_2026-07-31_asia-baghdad')));
    await assertFails(setDoc(doc(db, 'weeklyIncentiveCycles', 'cycle-1'), { state: 'active' }));
    await assertFails(setDoc(doc(db, 'canonicalRoomGiftFacts', 'gift-1'), { supportPoints: 100 }));
    await assertFails(setDoc(doc(db, 'roomAttendanceEventReceipts', 'event-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'roomAttendanceSessions', 'session-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'roomAttendanceIntervals', 'interval-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'attendanceOutageWindows', 'outage-1'), { reason: 'test' }));
    await assertFails(setDoc(doc(db, 'attendanceOutageCommands', 'request-1'), { operation: 'create' }));
    await assertFails(setDoc(doc(db, 'attendanceDeviceEnrollments', 'uid-1'), { state: 'active' }));
    await assertFails(setDoc(doc(db, 'payrollPlans', 'female-hosts'), { planId: 'female-hosts' }));
    await assertFails(setDoc(doc(db, 'payrollEnrollments', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'payrollCycles', 'cycle-1'), { state: 'active' }));
    await assertFails(setDoc(doc(db, 'payrollCycles', 'cycle-1', 'enrollments', 'uid-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'payrollOutcomes', 'outcome-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'payrollExceptions', 'exception-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(db, 'payrollAdminCommands', 'command-1'), { uid: 'uid-1' }));
    await assertFails(getDoc(doc(db, 'payrollEnrollments', 'uid-1')));
    await assertFails(getDoc(doc(db, 'payrollOutcomes', 'outcome-1')));
    await assertFails(getDoc(doc(db, 'roomAttendanceIntervals', 'interval-1')));
    await assertFails(setDoc(doc(db, 'roomSupportPeriods', 'period-1'), { roomId: 'room-1' }));
    await assertFails(setDoc(doc(db, 'roomSupportLeaderboardRefreshes', 'refresh-1'), { state: 'queued' }));
    await assertFails(setDoc(doc(db, 'rewardSettlements', 'settlement-1'), { state: 'paid' }));
    await assertFails(setDoc(doc(db, 'rewardSettlementJobs', 'settlement-1'), { state: 'eligible' }));
    await assertFails(setDoc(doc(db, 'rewardEntitlementTransactions', 'settlement-1_item-1'), { outcome: 'granted' }));
    await assertFails(getDoc(doc(db, 'rewardSettlements', 'settlement-1')));
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

  it('keeps every Personal Chat Wave 1 path dark to users and staff', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'directConversations', 'conversation-1'), { memberUids: ['uid-1', 'uid-2'] });
      await setDoc(doc(db, 'directConversations', 'conversation-1', 'messages', 'message-1'), { senderUid: 'uid-1' });
      await setDoc(doc(db, 'directConversationMembers', 'uid-1', 'items', 'conversation-1'), { peerUid: 'uid-2' });
      await setDoc(doc(db, 'directMessageRequests', 'conversation-1'), { recipientUid: 'uid-2', senderUid: 'uid-1' });
      await setDoc(doc(db, 'directChatRestrictions', 'uid-1'), { state: 'restricted', uid: 'uid-1' });
      await setDoc(doc(db, 'directChatReports', 'report-1'), { reporterUid: 'uid-1', targetUid: 'uid-2' });
      await setDoc(doc(db, 'directChatReports', 'report-1', 'evidence', 'message-1'), { messageId: 'message-1' });
    });

    const ownerDb = userDb('uid-1', 'salem@example.com');
    const peerDb = userDb('uid-2', 'dana@example.com');
    const staffDb = testEnv.authenticatedContext('staff-1', {
      admin: true,
      adminRole: 'super-moderator',
      email: 'staff@example.com',
      email_verified: true,
    }).firestore();
    for (const db of [ownerDb, peerDb, staffDb]) {
      await assertFails(getDoc(doc(db, 'directConversations', 'conversation-1')));
      await assertFails(getDoc(doc(db, 'directConversations', 'conversation-1', 'messages', 'message-1')));
      await assertFails(getDoc(doc(db, 'directConversationMembers', 'uid-1', 'items', 'conversation-1')));
      await assertFails(getDoc(doc(db, 'directMessageRequests', 'conversation-1')));
      await assertFails(getDoc(doc(db, 'directChatRestrictions', 'uid-1')));
      await assertFails(getDoc(doc(db, 'directChatReports', 'report-1')));
      await assertFails(getDoc(doc(db, 'directChatReports', 'report-1', 'evidence', 'message-1')));
    }
    await assertFails(setDoc(doc(ownerDb, 'directConversations', 'forged'), { memberUids: ['uid-1', 'uid-2'] }));
    await assertFails(setDoc(doc(ownerDb, 'directConversations', 'conversation-1', 'messages', 'forged-message'), { senderUid: 'uid-1' }));
    await assertFails(setDoc(doc(ownerDb, 'directChatCommands', 'uid-1', 'requests', 'request-1'), { action: 'send-direct-message' }));
    await assertFails(setDoc(doc(ownerDb, 'directChatRateLimits', 'uid-1'), { count: 0 }));
    await assertFails(setDoc(doc(ownerDb, 'directChatPresence', 'conversation-1', 'members', 'uid-1'), { typing: true }));
    await assertFails(setDoc(doc(ownerDb, 'directChatUploadAuthorizations', 'uid-1', 'uploads', 'upload-1'), { active: true }));
    await assertFails(setDoc(doc(ownerDb, 'directChatUploads', 'upload-1'), { state: 'approved' }));
    await assertFails(setDoc(doc(ownerDb, 'directChatRetention', 'current'), { retentionDays: 90 }));
  });

  it('keeps Personal Chat Wave 6A report cases and evidence unreachable from any client', async () => {
    await seedDirectChatWave3();
    const reportId = `dmr_${'a'.repeat(40)}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'reports', reportId), {
        category: 'threat',
        createdAt: now,
        reporterUid: 'uid-1',
        source: 'direct-chat-safety-v1',
        status: 'open',
        subjectType: 'direct-message',
        targetUid: 'uid-2',
        updatedAt: now,
      });
      await setDoc(doc(db, 'directChatReports', reportId), {
        accessPolicy: 'staff-only',
        conversationId: 'conversation-1',
        legalHold: false,
        reporterUid: 'uid-1',
        targetUid: 'uid-2',
      });
      await setDoc(doc(db, 'directChatReports', reportId, 'evidence', 'message-1'), {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        selected: true,
        senderUid: 'uid-1',
        text: 'hello',
      });
    });

    const reporterDb = userDb('uid-1', 'salem@example.com');
    const reportedDb = userDb('uid-2', 'dana@example.com');
    const staffDb = userDb('staff-1', 'staff@example.com', { admin: true, adminRole: 'super-moderator' });

    // The reporter can still read their own conversation, but never the captured case or evidence.
    await assertSucceeds(getDoc(doc(reporterDb, 'directConversations', 'conversation-1', 'messages', 'message-1')));
    for (const db of [reporterDb, reportedDb, staffDb]) {
      await assertFails(getDoc(doc(db, 'reports', reportId)));
      await assertFails(getDocs(query(collection(db, 'reports'), where('reporterUid', '==', 'uid-1'))));
      await assertFails(getDoc(doc(db, 'directChatReports', reportId)));
      await assertFails(getDocs(query(collection(db, 'directChatReports'), where('status', '==', 'open'))));
      await assertFails(getDoc(doc(db, 'directChatReports', reportId, 'evidence', 'message-1')));
      await assertFails(getDocs(collection(db, 'directChatReports', reportId, 'evidence')));
    }

    // A client cannot author its own evidence, forge a case, or clear a legal hold.
    await assertFails(setDoc(doc(reporterDb, 'reports', `dmr_${'b'.repeat(40)}`), { reporterUid: 'uid-1', targetUid: 'uid-2' }));
    await assertFails(setDoc(doc(reporterDb, 'directChatReports', `dmr_${'c'.repeat(40)}`), { reporterUid: 'uid-1', targetUid: 'uid-2' }));
    await assertFails(setDoc(doc(reporterDb, 'directChatReports', reportId, 'evidence', 'forged'), { messageId: 'forged', text: 'planted' }));
    await assertFails(updateDoc(doc(reporterDb, 'directChatReports', reportId), { legalHold: true }));
    await assertFails(updateDoc(doc(staffDb, 'directChatReports', reportId), { legalHold: false }));
    await assertFails(deleteDoc(doc(reporterDb, 'directChatReports', reportId, 'evidence', 'message-1')));
    await assertFails(setDoc(doc(reporterDb, 'directChatRateLimits', 'uid-1'), { reportCount: 0 }));
  });

  it('keeps Personal Chat Wave 6B restrictions backend-only and lets a bounded restriction expire', async () => {
    await seedDirectChatWave3();
    const restrictedUntil = Timestamp.fromMillis(Date.now() + (72 * 60 * 60 * 1_000));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'directChatRestrictions', 'uid-1'), {
        actorUid: 'platform-owner',
        endsAt: restrictedUntil,
        reason: 'Confirmed harassment',
        reportId: `dmr_${'a'.repeat(40)}`,
        startsAt: Timestamp.fromMillis(Date.now() - 1_000),
        state: 'restricted',
        uid: 'uid-1',
      });
    });

    const restrictedDb = userDb('uid-1', 'salem@example.com');
    const peerDb = userDb('uid-2', 'dana@example.com');
    const staffDb = userDb('staff-1', 'staff@example.com', { admin: true, adminRole: 'owner' });

    // A production writer now exists, so confirm it did not open the collection to anyone.
    for (const db of [restrictedDb, peerDb, staffDb]) {
      await assertFails(getDoc(doc(db, 'directChatRestrictions', 'uid-1')));
      await assertFails(getDocs(query(collection(db, 'directChatRestrictions'), where('state', '==', 'restricted'))));
    }
    await assertFails(setDoc(doc(restrictedDb, 'directChatRestrictions', 'uid-1'), { state: 'cleared', uid: 'uid-1' }));
    await assertFails(updateDoc(doc(restrictedDb, 'directChatRestrictions', 'uid-1'), { state: 'cleared' }));
    await assertFails(deleteDoc(doc(restrictedDb, 'directChatRestrictions', 'uid-1')));
    await assertFails(setDoc(doc(staffDb, 'directChatRestrictions', 'uid-2'), { state: 'restricted', uid: 'uid-2' }));

    // The restriction blocks the client surfaces the rules gate, here typing presence.
    const presence = directChatPresencePayload('typing', 'uid-1', true, Timestamp.fromMillis(Date.now() + 60_000));
    const typingRef = doc(restrictedDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-1');
    await assertFails(setDoc(typingRef, presence));

    // endsAt must be stored as a Timestamp: the rules compare it to request.time, so a raw millis
    // number would make an expired restriction evaluate as an error and never lift.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'directChatRestrictions', 'uid-1'), {
        actorUid: 'platform-owner',
        endsAt: Timestamp.fromMillis(Date.now() - 1_000),
        reason: 'Confirmed harassment',
        startsAt: Timestamp.fromMillis(Date.now() - (60 * 60 * 1_000)),
        state: 'restricted',
        uid: 'uid-1',
      });
    });
    await assertSucceeds(setDoc(typingRef, presence));
  });

  it('keeps the Personal Chat Wave 6C retention policy and sweep cursor backend-only', async () => {
    await seedDirectChatWave3();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'directChatRetention', 'current'), {
        evidenceRetentionDays: 90,
        legalHoldRetentionDays: 180,
        messageRetentionDays: 365,
        policyVersion: 1,
        updatedBy: 'platform-owner',
      });
      await setDoc(doc(db, 'directChatRetention', 'sweepState'), { cursor: 'conversation-1', scanned: 1, wrapped: false });
    });

    const memberDb = userDb('uid-1', 'salem@example.com');
    const ownerDb = userDb('staff-1', 'staff@example.com', { admin: true, adminRole: 'owner' });
    for (const db of [memberDb, ownerDb]) {
      for (const documentId of ['current', 'sweepState']) {
        await assertFails(getDoc(doc(db, 'directChatRetention', documentId)));
        await assertFails(updateDoc(doc(db, 'directChatRetention', documentId), { messageRetentionDays: 1 }));
        await assertFails(deleteDoc(doc(db, 'directChatRetention', documentId)));
      }
      await assertFails(getDocs(collection(db, 'directChatRetention')));
      await assertFails(setDoc(doc(db, 'directChatRetention', 'forged'), { messageRetentionDays: 1 }));
    }
    // Raising retention past the platform cap has to be impossible from the client, not just clamped.
    await assertFails(setDoc(doc(memberDb, 'directChatRetention', 'current'), { messageRetentionDays: 100_000 }));

    // The watermark the client reads from its own projection stays read-only.
    await assertSucceeds(getDoc(doc(memberDb, 'directConversationMembers', 'uid-1', 'items', 'conversation-1')));
    await assertFails(updateDoc(
      doc(memberDb, 'directConversationMembers', 'uid-1', 'items', 'conversation-1'),
      { retentionPurgedThroughSequence: 0 },
    ));
    await assertFails(updateDoc(doc(memberDb, 'directConversations', 'conversation-1'), { retentionPurgedThroughSequence: 0 }));
  });

  it('exposes Personal Chat Wave 3 reads only to participants and keeps persistent writes backend-only', async () => {
    await seedDirectChatWave3();
    const firstDb = userDb('uid-1', 'salem@example.com');
    const secondDb = userDb('uid-2', 'dana@example.com');
    const outsiderDb = userDb('uid-3', 'rana@example.com');

    await assertSucceeds(getDoc(doc(firstDb, 'directConversations', 'conversation-1')));
    await assertSucceeds(getDoc(doc(secondDb, 'directConversations', 'conversation-1', 'messages', 'message-1')));
    await assertSucceeds(getDoc(doc(firstDb, 'directConversationMembers', 'uid-1', 'items', 'conversation-1')));
    await assertSucceeds(getDoc(doc(secondDb, 'directMessageRequests', 'conversation-1')));
    await assertSucceeds(getDoc(doc(firstDb, 'directChatInboxSummaries', 'uid-1')));
    await assertSucceeds(getDoc(doc(firstDb, 'directConversations', 'conversation-1', 'receipts', 'uid-2')));

    await assertFails(getDoc(doc(firstDb, 'directConversationMembers', 'uid-2', 'items', 'conversation-1')));
    await assertFails(getDoc(doc(firstDb, 'directChatInboxSummaries', 'uid-2')));
    await assertFails(getDoc(doc(outsiderDb, 'directConversations', 'conversation-1', 'receipts', 'uid-2')));
    await assertFails(getDoc(doc(outsiderDb, 'directConversations', 'conversation-1')));
    await assertFails(getDoc(doc(outsiderDb, 'directConversations', 'conversation-1', 'messages', 'message-1')));
    await assertFails(getDoc(doc(outsiderDb, 'directMessageRequests', 'conversation-1')));
    await assertFails(updateDoc(doc(firstDb, 'directConversationMembers', 'uid-1', 'items', 'conversation-1'), { unreadCount: 0 }));
    await assertFails(updateDoc(doc(firstDb, 'directChatInboxSummaries', 'uid-1'), { totalUnreadCount: 0 }));
    await assertFails(setDoc(doc(firstDb, 'directConversations', 'conversation-1', 'receipts', 'uid-1'), { lastReadSequence: 1 }));
    await assertFails(setDoc(doc(firstDb, 'directConversations', 'conversation-1', 'messages', 'forged'), { senderUid: 'uid-1' }));
  });

  it('allows bounded self presence only for accepted participants and friend-only online state', async () => {
    await seedDirectChatWave3();
    const firstDb = userDb('uid-1', 'salem@example.com');
    const secondDb = userDb('uid-2', 'dana@example.com');
    const outsiderDb = userDb('uid-3', 'rana@example.com');
    const future = Timestamp.fromMillis(Date.now() + 60_000);
    const tooFar = Timestamp.fromMillis(Date.now() + 5 * 60_000);
    const typingRef = doc(firstDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-1');
    const onlineRef = doc(firstDb, 'directChatPresence', 'conversation-1', 'online', 'uid-1');

    await assertSucceeds(setDoc(typingRef, directChatPresencePayload('typing', 'uid-1', true, future)));
    await assertSucceeds(getDoc(doc(secondDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-1')));
    await assertFails(getDoc(doc(outsiderDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-1')));
    await assertFails(setDoc(
      doc(firstDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-2'),
      directChatPresencePayload('typing', 'uid-2', true, future),
    ));
    await assertFails(setDoc(typingRef, directChatPresencePayload('typing', 'uid-1', true, tooFar)));

    await assertSucceeds(setDoc(onlineRef, directChatPresencePayload('online', 'uid-1', 'online', future)));
    await assertSucceeds(getDoc(doc(secondDb, 'directChatPresence', 'conversation-1', 'online', 'uid-1')));
    await seedBlock('uid-2', 'uid-1');
    await assertFails(getDoc(doc(secondDb, 'directChatPresence', 'conversation-1', 'typing', 'uid-1')));
    await assertFails(getDoc(doc(secondDb, 'directChatPresence', 'conversation-1', 'online', 'uid-1')));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'blocks', 'uid-2', 'blocked', 'uid-1'));
      await deleteDoc(doc(context.firestore(), 'friendships', 'uid-1_uid-2'));
    });
    await assertFails(getDoc(doc(secondDb, 'directChatPresence', 'conversation-1', 'online', 'uid-1')));
    await assertFails(setDoc(onlineRef, directChatPresencePayload('online', 'uid-1', 'online', future)));
  });

  it('exposes only published room-theme manifests and keeps room entitlements backend-only', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'roomThemes', 'majlis-default'), {
        manifestVersion: 1,
        publicationStatus: 'published',
        themeId: 'majlis-default',
      });
      await setDoc(doc(db, 'roomThemes', 'draft-theme'), {
        manifestVersion: 1,
        publicationStatus: 'draft',
        themeId: 'draft-theme',
      });
      await setDoc(doc(db, 'roomThemes', 'animated-theme'), {
        manifestVersion: 2,
        publicationStatus: 'published',
        themeId: 'animated-theme',
      });
      await setDoc(doc(db, 'rooms', 'theme-room', 'themeEntitlements', 'royal-theater'), {
        roomId: 'theme-room',
        state: 'active',
        themeId: 'royal-theater',
      });
    });
    const db = userDb('uid-1', 'salem@example.com');
    await assertSucceeds(getDoc(doc(db, 'roomThemes', 'majlis-default')));
    await assertSucceeds(getDoc(doc(db, 'roomThemes', 'animated-theme')));
    await assertFails(getDoc(doc(db, 'roomThemes', 'draft-theme')));
    await assertFails(setDoc(doc(db, 'roomThemes', 'new-theme'), {
      manifestVersion: 1,
      publicationStatus: 'published',
      themeId: 'new-theme',
    }));
    await assertFails(getDoc(doc(db, 'rooms', 'theme-room', 'themeEntitlements', 'royal-theater')));
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
      await setDoc(doc(context.firestore(), 'appConfig', 'personalChatsFrontendRollout'), {
        percentage: 0,
        salt: '',
        schemaVersion: 1,
        stage: 'off',
      });
      await setDoc(doc(context.firestore(), 'appConfig', 'cosmeticsFeatures'), {
        cosmetics_animated_avatar_frames: false,
        cosmetics_asset_registry: false,
        cosmetics_effect_audio: false,
        cosmetics_lottie: false,
        cosmetics_shared_renderer: false,
        cosmetics_unified_avatar_frames: false,
        cosmetics_video: false,
      });
    });
    const signedInRef = doc(userDb('uid-1', 'salem@example.com'), 'appConfig', 'socialFeatures');
    const rolloutRef = doc(userDb('uid-1', 'salem@example.com'), 'appConfig', 'personalChatsFrontendRollout');
    const cosmeticsRef = doc(userDb('uid-1', 'salem@example.com'), 'appConfig', 'cosmeticsFeatures');

    await assertSucceeds(getDoc(signedInRef));
    await assertSucceeds(getDoc(rolloutRef));
    await assertSucceeds(getDoc(cosmeticsRef));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'appConfig', 'socialFeatures')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'appConfig', 'personalChatsFrontendRollout')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'appConfig', 'cosmeticsFeatures')));
    await assertFails(updateDoc(signedInRef, { friends: true }));
    await assertFails(updateDoc(rolloutRef, { stage: 'global' }));
    await assertFails(updateDoc(cosmeticsRef, { cosmetics_shared_renderer: true }));
  });

  it('enforces Wave 8 gift receipts, presence reads, and backend-only economy writes', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedProfile('uid-3', 'omar@example.com', 'Omar', 'O');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedPublicProfile('uid-3', { displayName: 'Omar', normalizedName: 'omar', publicId: '7654321' });
    await seedRoom('gift-room', { availability: 'active' });
    await seedMember('gift-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await seedMember('gift-room', 'uid-2', 'Dana', 'D', 'listener', false);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'roomGiftReceipts', 'uid-1', 'items', 'event-1'), {
        recipientUid: 'uid-2',
        senderUid: 'uid-1',
      });
      await setDoc(doc(db, 'rooms', 'gift-room', 'giftEvents', 'event-1'), {
        recipientUid: 'uid-2',
        roomId: 'gift-room',
        senderUid: 'uid-1',
      });
      await setDoc(doc(db, 'rooms', 'gift-room', 'giftContributions', 'uid-1'), {
        totalSpentCoins: 100,
        uid: 'uid-1',
      });
      await setDoc(doc(db, 'globalRoomEffects', 'event-global-1'), {
        kind: 'room-gift',
        status: 'ready',
      });
      await setDoc(doc(db, 'giftPresentationApprovalReceipts', 'receipt-1'), {
        status: 'passed',
      });
      await setDoc(doc(db, 'entryPresentationApprovalReceipts', 'entry-receipt-1'), {
        status: 'passed',
      });
    });

    const senderDb = userDb('uid-1', 'salem@example.com');
    const recipientDb = userDb('uid-2', 'dana@example.com');
    const outsiderDb = userDb('uid-3', 'omar@example.com');
    await assertSucceeds(getDoc(doc(senderDb, 'roomGiftReceipts', 'uid-1', 'items', 'event-1')));
    await assertFails(getDoc(doc(recipientDb, 'roomGiftReceipts', 'uid-1', 'items', 'event-1')));
    await assertFails(getDoc(doc(senderDb, 'rooms', 'gift-room', 'giftEvents', 'event-1')));
    await assertFails(getDoc(doc(recipientDb, 'rooms', 'gift-room', 'giftContributions', 'uid-1')));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'gift-room', 'giftEvents', 'event-1')));
    await assertSucceeds(getDoc(doc(outsiderDb, 'globalRoomEffects', 'event-global-1')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'globalRoomEffects', 'event-global-1')));
    await assertFails(getDoc(doc(senderDb, 'giftPresentationApprovalReceipts', 'receipt-1')));
    await assertFails(getDoc(doc(senderDb, 'entryPresentationApprovalReceipts', 'entry-receipt-1')));

    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftCommandRequests', 'request-1'), { actorUid: 'uid-1' }));
    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftQuotes', 'quote-1'), { senderUid: 'uid-1' }));
    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftEvents', 'event-2'), { senderUid: 'uid-1' }));
    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftContributions', 'uid-1'), { totalSpentCoins: 1 }));
    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftRateLimits', 'uid-1'), { count: 1 }));
    await assertFails(setDoc(doc(senderDb, 'rooms', 'gift-room', 'giftCombos', 'combo-1'), { comboCount: 1 }));
    await assertFails(setDoc(doc(senderDb, 'globalRoomEffects', 'event-global-2'), { kind: 'room-gift', status: 'ready' }));
    await assertFails(setDoc(doc(senderDb, 'platformEconomyAccounts', 'room-gifts'), { balanceCoins: 1 }));
    await assertFails(setDoc(doc(senderDb, 'platformEconomyTransactions', 'tx-1'), { amount: 1 }));
    await assertFails(getDoc(doc(senderDb, 'platformEconomyAccounts', 'room-gifts')));
    await assertFails(getDoc(doc(senderDb, 'roomGiftCommissionPolicyVersions', 'v_00000001')));
  });

  it('exposes only compact support leaderboards to active members while rankings are enabled', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedRoom('support-room', { visibility: 'public' });
    await seedMember('support-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), {
        voice_room_supporter_rankings: true,
      });
      await setDoc(doc(db, 'appConfig', 'roomRocketPublic'), {
        renderingEnabled: false,
        revision: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, 'rooms', 'support-room', 'supportLeaderboards', 'day_2026-07-06_asia-baghdad'), {
        entries: [],
        periodId: 'day_2026-07-06_asia-baghdad',
        roomId: 'support-room',
      });
      await setDoc(doc(db, 'rooms', 'support-room', 'supportPeriods', 'day_2026-07-06_asia-baghdad', 'supporters', 'uid-1'), {
        eligibleSpendCoins: 100,
        uid: 'uid-1',
      });
    });
    const memberDb = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    const leaderboardRef = doc(memberDb, 'rooms', 'support-room', 'supportLeaderboards', 'day_2026-07-06_asia-baghdad');

    await assertSucceeds(getDoc(leaderboardRef));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'support-room', 'supportLeaderboards', 'day_2026-07-06_asia-baghdad')));
    await assertFails(getDoc(doc(memberDb, 'rooms', 'support-room', 'supportPeriods', 'day_2026-07-06_asia-baghdad', 'supporters', 'uid-1')));
    await assertFails(setDoc(leaderboardRef, { entries: [] }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomFeatures'), {
        voice_room_supporter_rankings: false,
      });
    });
    await assertFails(getDoc(leaderboardRef));
  });

  it('exposes room Rocket cycle results only to active members while keeping campaign internals private', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedRoom('rocket-room', { visibility: 'public' });
    await seedMember('rocket-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), {
        voice_room_supporter_rankings: true,
      });
      await setDoc(doc(db, 'rooms', 'rocket-room', 'rocketCycles', 'weekly_2026-07-06_asia-baghdad'), {
        cycleId: 'weekly_2026-07-06_asia-baghdad',
        roomId: 'rocket-room',
        state: 'settled',
      });
      await setDoc(doc(db, 'roomRocketCampaign', 'current'), { revision: 1 });
      await setDoc(doc(db, 'roomRocketPublicVersions', 'v1'), {
        effectiveFromCycleId: 'weekly_2026-07-06_asia-baghdad',
        revision: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, 'roomRocketProjectionReceipts', 'receipt-1'), { roomId: 'rocket-room' });
      await setDoc(doc(db, 'roomRocketRewardNotifications', 'notification-1'), { state: 'queued' });
      await setDoc(doc(db, 'weeklyIncentiveHolds', 'uid-1'), { active: true });
    });
    const memberDb = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    const cycleRef = doc(memberDb, 'rooms', 'rocket-room', 'rocketCycles', 'weekly_2026-07-06_asia-baghdad');
    await assertSucceeds(getDoc(cycleRef));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'rocket-room', 'rocketCycles', 'weekly_2026-07-06_asia-baghdad')));
    await assertFails(setDoc(cycleRef, { state: 'settled' }));
    await assertFails(getDoc(doc(memberDb, 'roomRocketCampaign', 'current')));
    await assertFails(getDoc(doc(memberDb, 'roomRocketProjectionReceipts', 'receipt-1')));
    await assertFails(getDoc(doc(memberDb, 'roomRocketRewardNotifications', 'notification-1')));
    await assertFails(getDoc(doc(memberDb, 'weeklyIncentiveHolds', 'uid-1')));
    await assertSucceeds(getDoc(doc(memberDb, 'roomRocketPublicVersions', 'v1')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'roomRocketPublicVersions', 'v1')));
    await assertFails(setDoc(doc(memberDb, 'roomRocketPublicVersions', 'forged'), { revision: 2 }));
    await assertSucceeds(getDoc(doc(memberDb, 'appConfig', 'roomRocketPublic')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'appConfig', 'roomRocketPublic')));
  });

  it('keeps Room Target finance, roster, projection, and settlement state backend-only', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { publicId: '7654321' });
    await seedRoom('target-room', { visibility: 'public' });
    await seedMember('target-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'roomTargetCampaign', 'current'), { revision: 1 });
      await setDoc(doc(db, 'roomTargetPublicVersions', 'v1'), {
        effectiveFromCycleId: 'weekly_2026-07-06_asia-baghdad',
        revision: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, 'roomTargetProjectionReceipts', 'receipt-1'), { roomId: 'target-room' });
      await setDoc(doc(db, 'roomTargetRosterNotifications', 'notification-1'), { state: 'queued' });
      await setDoc(doc(db, 'weeklyIncentiveRiskAssessments', 'assessment-1'), { reviewState: 'pending' });
      await setDoc(doc(db, 'weeklyIncentiveIntegrityAlerts', 'alert-1'), { state: 'open' });
      await setDoc(doc(db, 'incentiveReconciliationReports', 'report-1'), { balanced: false });
      await setDoc(doc(db, 'roomGiftIntegrityEvents', 'integrity-1'), { cycleId: 'weekly_2026-07-06_asia-baghdad', uid: 'uid-1' });
      await setDoc(doc(db, 'roomTargetRosterChurn', 'churn-1'), { changeCount: 4 });
      await setDoc(doc(db, 'roomTargetCommandRequests', 'uid-1', 'requests', 'request-1'), { roomId: 'target-room' });
      await setDoc(doc(db, 'rooms', 'target-room', 'targetRosterDrafts', 'weekly_2026-07-06_asia-baghdad'), {
        ownerUidAtPreparation: 'uid-1',
      });
      await setDoc(doc(db, 'rooms', 'target-room', 'targetCycles', 'weekly_2026-07-06_asia-baghdad'), {
        cycleId: 'weekly_2026-07-06_asia-baghdad',
        riskSnapshot: { marginCoins: 100 },
        roomId: 'target-room',
      });
      await setDoc(doc(db, 'rooms', 'target-room', 'targetCycles', 'weekly_2026-07-06_asia-baghdad', 'members', 'uid-1'), {
        eligibleSpendCoins: 100,
        uid: 'uid-1',
      });
      await setDoc(doc(db, 'rooms', 'target-room', 'targetPublicCycles', 'weekly_2026-07-06_asia-baghdad'), {
        cycleId: 'weekly_2026-07-06_asia-baghdad',
        roomId: 'target-room',
        roster: [],
      });
      await setDoc(doc(db, 'rooms', 'target-room', 'targetRosterPreviews', 'weekly_2026-07-13_asia-baghdad'), {
        cycleId: 'weekly_2026-07-13_asia-baghdad',
        ownerUid: 'uid-1',
        roomId: 'target-room',
        roster: [],
      });
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), {
        voice_room_owner_targets: true,
      }, { merge: true });
    });
    const db = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    await assertSucceeds(getDoc(doc(db, 'roomTargetPublicVersions', 'v1')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'roomTargetPublicVersions', 'v1')));
    await assertFails(getDoc(doc(db, 'roomTargetCampaign', 'current')));
    await assertFails(getDoc(doc(db, 'roomTargetProjectionReceipts', 'receipt-1')));
    await assertFails(getDoc(doc(db, 'roomTargetRosterNotifications', 'notification-1')));
    await assertFails(getDoc(doc(db, 'weeklyIncentiveRiskAssessments', 'assessment-1')));
    await assertFails(getDoc(doc(db, 'weeklyIncentiveIntegrityAlerts', 'alert-1')));
    await assertFails(getDoc(doc(db, 'incentiveReconciliationReports', 'report-1')));
    await assertFails(getDoc(doc(db, 'roomGiftIntegrityEvents', 'integrity-1')));
    await assertFails(getDoc(doc(db, 'roomTargetRosterChurn', 'churn-1')));
    await assertFails(setDoc(doc(db, 'weeklyIncentiveRiskAssessments', 'forged'), { reviewState: 'approved' }));
    await assertFails(getDoc(doc(db, 'roomTargetCommandRequests', 'uid-1', 'requests', 'request-1')));
    await assertFails(getDoc(doc(db, 'rooms', 'target-room', 'targetRosterDrafts', 'weekly_2026-07-06_asia-baghdad')));
    await assertFails(getDoc(doc(db, 'rooms', 'target-room', 'targetCycles', 'weekly_2026-07-06_asia-baghdad')));
    await assertFails(getDoc(doc(db, 'rooms', 'target-room', 'targetCycles', 'weekly_2026-07-06_asia-baghdad', 'members', 'uid-1')));
    await assertSucceeds(getDoc(doc(db, 'rooms', 'target-room', 'targetPublicCycles', 'weekly_2026-07-06_asia-baghdad')));
    await assertSucceeds(getDoc(doc(db, 'rooms', 'target-room', 'targetRosterPreviews', 'weekly_2026-07-13_asia-baghdad')));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'target-room', 'targetPublicCycles', 'weekly_2026-07-06_asia-baghdad')));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'target-room', 'targetRosterPreviews', 'weekly_2026-07-13_asia-baghdad')));
    await assertFails(setDoc(doc(db, 'roomTargetPublicVersions', 'forged'), { revision: 2 }));
  });

  it('allows active room members to read Wave 9 effects but keeps all effect writes backend-only', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedProfile('uid-3', 'omar@example.com', 'Omar', 'O');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedPublicProfile('uid-3', { displayName: 'Omar', normalizedName: 'omar', publicId: '7654321' });
    await seedRoom('effects-room', { availability: 'active' });
    await seedMember('effects-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await seedMember('effects-room', 'uid-2', 'Dana', 'D', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rooms', 'effects-room', 'events', 'entry-1'), {
        createdAt: now,
        kind: 'room-entry',
        roomId: 'effects-room',
        status: 'ready',
      });
    });

    const memberDb = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-3', 'omar@example.com');
    await assertSucceeds(getDoc(doc(memberDb, 'rooms', 'effects-room', 'events', 'entry-1')));
    await assertFails(getDoc(doc(outsiderDb, 'rooms', 'effects-room', 'events', 'entry-1')));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'events', 'entry-2'), { status: 'ready' }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'entryEffectRequests', 'request-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'entryEffectClaims', 'claim-1'), { uid: 'uid-1' }));
    await assertFails(getDoc(doc(memberDb, 'rooms', 'effects-room', 'coupleEntryClaims', 'pair-claim-1')));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'coupleEntryClaims', 'pair-claim-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'entryEffectRateLimits', 'uid-1'), { count: 1 }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'reactionRequests', 'request-1'), { uid: 'uid-1' }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'reactionRateLimits', 'uid-1'), { count: 1 }));
    await assertFails(setDoc(doc(memberDb, 'rooms', 'effects-room', 'reactionRoomRateLimits', 'default'), { count: 1 }));
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

  it('routes account deletion requests through the lifecycle command', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');

    const db = userDb('uid-1', 'salem@example.com');
    const requestRef = doc(db, 'users', 'uid-1', 'accountDeletionRequests', 'request-1');

    await assertFails(
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

  it('enforces the new-joins freeze in rules while allowing only a live reconnect', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('frozen-room', { visibility: 'public' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomFeatures'), {
        voice_room_new_joins: false,
      });
    });
    const ownerDb = userDb('uid-1', 'salem@example.com');
    const memberDb = userDb('uid-2', 'dana@example.com');

    await assertFails(createRoomAndHost(ownerDb, 'uid-1', 'blocked-room'));
    await assertFails(setDoc(
      doc(memberDb, 'rooms', 'frozen-room', 'members', 'uid-2'),
      memberPayload('uid-2', 'Dana', 'D', 'listener', false),
    ));

    await seedMember('frozen-room', 'uid-2', 'Dana', 'D', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rooms', 'frozen-room', 'presence', 'uid-2'), {
        uid: 'uid-2',
        status: 'reconnecting',
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      });
    });
    await assertSucceeds(updateDoc(
      doc(memberDb, 'rooms', 'frozen-room', 'members', 'uid-2'),
      { displayName: 'Dana', avatarLabel: 'D', updatedAt: now },
    ));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'rooms', 'frozen-room', 'presence', 'uid-2'), {
        status: 'stale',
      });
    });
    await assertFails(updateDoc(
      doc(memberDb, 'rooms', 'frozen-room', 'members', 'uid-2'),
      { displayName: 'Dana', avatarLabel: 'D', updatedAt: now },
    ));
  });

  it('enforces the Wave 15 allowlist for room discovery, creation, and joining', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('launch-room', { visibility: 'public' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomLaunch'), {
        allowedRegionCodes: [],
        allowedUids: ['uid-1'],
        audienceMode: 'allowlist',
        minimumClientVersion: '1.0.0',
        recordingDecision: 'rejected',
        stageId: 8,
        status: 'testing',
      });
    });
    const allowedDb = userDb('uid-1', 'salem@example.com');
    const deniedDb = userDb('uid-2', 'dana@example.com');

    await assertSucceeds(getDoc(doc(allowedDb, 'rooms', 'launch-room')));
    await assertFails(getDoc(doc(deniedDb, 'rooms', 'launch-room')));
    await assertSucceeds(createRoomAndHost(allowedDb, 'uid-1', 'allowed-launch-room'));
    await assertFails(createRoomAndHost(deniedDb, 'uid-2', 'denied-launch-room'));
    await assertFails(setDoc(
      doc(deniedDb, 'rooms', 'launch-room', 'members', 'uid-2'),
      memberPayload('uid-2', 'Dana', 'D', 'listener', false),
    ));
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

  it('authorizes cross-room PK reads to either room membership, including closed-room results', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedProfile('uid-3', 'omar@example.com', 'Omar', 'O');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedPublicProfile('uid-3', { displayName: 'Omar', normalizedName: 'omar', publicId: '3456789' });
    await seedRoom('pk-red', { status: 'closed' });
    await seedRoom('pk-blue', { status: 'active' });
    await seedMember('pk-red', 'uid-1', 'Salem', 'S', 'listener', false);
    await seedMember('pk-blue', 'uid-2', 'Dana', 'D', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'roomPkSessions', 'pk-v2'), {
        blueRoomId: 'pk-blue', mode: 'cross-room', redRoomId: 'pk-red', roomId: 'pk-red',
        roomIds: ['pk-red', 'pk-blue'], schemaVersion: 2, status: 'ended',
      });
      await setDoc(doc(db, 'roomPkSessions', 'pk-v2', 'scoreShards', 'red_00'), {
        pkId: 'pk-v2', score: 10, shard: 0, side: 'red',
      });
      await setDoc(doc(db, 'roomPkChallenges', 'challenge-v1'), {
        challengerRoomId: 'pk-red', mode: 'cross-room', opponentRoomId: 'pk-blue',
        schemaVersion: 1, status: 'accepted',
      });
    });

    for (const db of [userDb('uid-1', 'salem@example.com'), userDb('uid-2', 'dana@example.com')]) {
      await assertSucceeds(getDoc(doc(db, 'roomPkSessions', 'pk-v2')));
      await assertSucceeds(getDoc(doc(db, 'roomPkSessions', 'pk-v2', 'scoreShards', 'red_00')));
      await assertSucceeds(getDoc(doc(db, 'roomPkChallenges', 'challenge-v1')));
    }
    const outsider = userDb('uid-3', 'omar@example.com');
    await assertFails(getDoc(doc(outsider, 'roomPkSessions', 'pk-v2')));
    await assertFails(getDoc(doc(outsider, 'roomPkSessions', 'pk-v2', 'scoreShards', 'red_00')));
    await assertFails(getDoc(doc(outsider, 'roomPkChallenges', 'challenge-v1')));
  });

  it('denies every client write to cross-room PK authority paths and fails closed on malformed V2', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedRoom('pk-red');
    await seedMember('pk-red', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'roomPkSessions', 'pk-malformed'), {
        blueRoomId: 'pk-red', mode: 'cross-room', redRoomId: 'pk-red', roomId: 'pk-red',
        roomIds: ['pk-red', 'pk-red'], schemaVersion: 2, status: 'active',
      });
      await setDoc(doc(context.firestore(), 'roomPkSessions', 'pk-malformed', 'scoreShards', 'red_00'), {
        pkId: 'pk-malformed', score: 1, shard: 0, side: 'red',
      });
    });
    const db = userDb('uid-1', 'salem@example.com');
    await assertFails(getDoc(doc(db, 'roomPkSessions', 'pk-malformed')));
    await assertFails(getDoc(doc(db, 'roomPkSessions', 'pk-malformed', 'scoreShards', 'red_00')));
    for (const path of [
      ['roomPkSessions', 'forged'],
      ['roomPkSessions', 'forged', 'scoreShards', 'red_00'],
      ['roomPkSessions', 'forged', 'gifters', 'red_uid-1'],
      ['roomPkChallenges', 'forged'],
      ['roomPkGiftFacts', 'forged'],
      ['roomPkReconciliations', 'forged'],
      ['roomPkReconciliations', 'forged', 'gifters', 'red_uid-1'],
      ['crossRoomPkRoomRateLimits', 'pk-red'],
      ['crossRoomPkPairCooldowns', 'pair-1'],
      ['roomPkAuditEvents', 'event-1'],
    ]) {
      await assertFails(setDoc(doc(db, ...path), { forged: true }));
    }
  });

  it('exposes ownership offers only to the owner and selected recipient', async () => {
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
    await seedPublicProfile('uid-3', { displayName: 'Omar', normalizedName: 'omar', publicId: '3456789' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'rooms', 'room-v2', 'ownershipTransfers', 'transfer-1'), {
        createdAt: now,
        expiresAt: now,
        fromOwnershipRevision: 1,
        fromUid: 'uid-1',
        id: 'transfer-1',
        roomId: 'room-v2',
        status: 'pending',
        toUid: 'uid-2',
        updatedAt: now,
      });
      await setDoc(doc(db, 'roomOwnershipNotifications', 'uid-2', 'items', 'notice-1'), {
        actorUid: 'uid-1',
        createdAt: now,
        kind: 'room-ownership-offered',
        readAt: null,
        recipientUid: 'uid-2',
        roomId: 'room-v2',
        transferId: 'transfer-1',
      });
    });

    await assertSucceeds(getDoc(doc(
      userDb('uid-1', 'salem@example.com'),
      'rooms',
      'room-v2',
      'ownershipTransfers',
      'transfer-1',
    )));
    await assertSucceeds(getDoc(doc(
      userDb('uid-2', 'dana@example.com'),
      'rooms',
      'room-v2',
      'ownershipTransfers',
      'transfer-1',
    )));
    await assertFails(getDoc(doc(
      userDb('uid-3', 'omar@example.com'),
      'rooms',
      'room-v2',
      'ownershipTransfers',
      'transfer-1',
    )));
    const recipientDb = userDb('uid-2', 'dana@example.com');
    const noticeRef = doc(recipientDb, 'roomOwnershipNotifications', 'uid-2', 'items', 'notice-1');
    await assertSucceeds(getDoc(noticeRef));
    await assertSucceeds(updateDoc(noticeRef, { readAt: now }));
    await assertFails(updateDoc(noticeRef, { kind: 'forged' }));
    await assertFails(setDoc(
      doc(recipientDb, 'rooms', 'room-v2', 'ownershipTransfers', 'forged'),
      { fromUid: 'uid-2', roomId: 'room-v2', status: 'pending', toUid: 'uid-3' },
    ));
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

  it('denies client reads and writes for follow graph edges', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'following', 'uid-1', 'items', 'uid-2'), {
        createdAt: now,
        targetUid: 'uid-2',
      });
      await setDoc(doc(context.firestore(), 'followers', 'uid-1', 'items', 'uid-2'), {
        createdAt: now,
        followerUid: 'uid-2',
      });
    });
    const ownerDb = userDb('uid-1', 'salem@example.com');
    await assertFails(getDoc(doc(ownerDb, 'following', 'uid-1', 'items', 'uid-2')));
    await assertFails(getDoc(doc(ownerDb, 'followers', 'uid-1', 'items', 'uid-2')));
    await assertFails(setDoc(doc(ownerDb, 'following', 'uid-1', 'items', 'uid-3'), {
      createdAt: now,
      targetUid: 'uid-3',
    }));
    await assertFails(deleteDoc(doc(ownerDb, 'followers', 'uid-1', 'items', 'uid-2')));
  });


  it('denies client reads and writes for soft-match collections', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'softMatchQueue', 'uid-1'), { status: 'waiting', expiresAtMs: Date.now() + 60_000 });
      await setDoc(doc(db, 'softMatchSessions', 'sms_test'), { status: 'active', expiresAtMs: Date.now() + 60_000 });
      await setDoc(doc(db, 'softMatchRequests', 'softmatch_abcdefghijk1'), { uid: 'uid-1' });
      await setDoc(doc(db, 'softMatchRateLimits', 'uid-1'), { count: 1 });
    });
    const db = userDb('uid-1', 'salem@example.com');
    await assertFails(getDoc(doc(db, 'softMatchQueue', 'uid-1')));
    await assertFails(setDoc(doc(db, 'softMatchQueue', 'uid-1'), { status: 'waiting' }));
    await assertFails(getDoc(doc(db, 'softMatchSessions', 'sms_test')));
    await assertFails(getDoc(doc(db, 'softMatchRequests', 'softmatch_abcdefghijk1')));
    await assertFails(getDoc(doc(db, 'softMatchRateLimits', 'uid-1')));
  });

  it('denies client member create on soft-match rooms', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedRoom('soft-match-room', {
      softMatch: true,
      visibility: 'private',
      inviteCode: 'ABCD12',
      schemaVersion: 2,
      revision: 1,
      availability: 'active',
      ownerUid: 'uid-1',
      seatMode: 'locked',
      seatTargetCount: 5,
    });
    await seedMember('soft-match-room', 'uid-1', 'Salem', 'S', 'host', true, {
      schemaVersion: 2,
      authorityRole: 'owner',
      seatId: null,
      privileges: { canManageMusic: false },
    });
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    await assertFails(setDoc(doc(outsiderDb, 'rooms', 'soft-match-room', 'members', 'uid-2'), {
      ...memberPayload('uid-2', 'Dana', 'D', 'listener', false, 'ABCD12'),
      schemaVersion: 2,
      authorityRole: 'member',
      seatId: null,
      privileges: { canManageMusic: false },
    }));
  });

  it('gates room game sessions to active members and denies all operational writes', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { publicId: '8765432' });
    await seedRoom('game-room', {
      activeGameSessionId: 'rgs_session_000000000001',
      currentGameId: 'drawing-guess',
    });
    await seedMember('game-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), { voice_room_games: true });
      await setDoc(doc(db, 'rooms', 'game-room', 'gameSessions', 'rgs_session_000000000001'), {
        expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
        playerUids: ['uid-1'],
        roomId: 'game-room',
        sessionId: 'rgs_session_000000000001',
        status: 'active',
      });
      await setDoc(doc(db, 'rooms', 'game-room', 'gameCommandRequests', 'request-1'), {
        actorUid: 'uid-1',
      });
      await setDoc(doc(db, 'roomGameRateLimits', 'uid-1'), { count: 1, uid: 'uid-1' });
    });

    const memberDb = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    const sessionRef = doc(memberDb, 'rooms', 'game-room', 'gameSessions', 'rgs_session_000000000001');
    await assertSucceeds(getDoc(sessionRef));
    await assertFails(getDoc(doc(
      outsiderDb,
      'rooms',
      'game-room',
      'gameSessions',
      'rgs_session_000000000001',
    )));
    await assertFails(updateDoc(sessionRef, { status: 'ended' }));
    await assertFails(setDoc(doc(
      memberDb,
      'rooms',
      'game-room',
      'gameCommandRequests',
      'forged',
    ), { actorUid: 'uid-1' }));
    await assertFails(getDoc(doc(memberDb, 'roomGameRateLimits', 'uid-1')));
    await assertFails(setDoc(doc(memberDb, 'roomGameRateLimits', 'uid-1'), { count: 0 }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomFeatures'), {
        voice_room_games: false,
      });
    });
    await assertFails(getDoc(sessionRef));
  });

  it('gates room music leases behind the feature flag and denies operational writes', async () => {
    await seedProfile('uid-1', 'salem@example.com', 'Salem', 'S');
    await seedProfile('uid-2', 'dana@example.com', 'Dana', 'D');
    await seedPublicProfile('uid-1', { publicId: '1234567' });
    await seedPublicProfile('uid-2', { publicId: '8765432' });
    await seedRoom('music-room', {
      activeDjUid: 'uid-1',
      activeMusicLeaseId: 'rml_lease_000000000001',
    });
    await seedMember('music-room', 'uid-1', 'Salem', 'S', 'listener', false);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'appConfig', 'voiceRoomFeatures'), {
        voice_room_shared_music: true,
      });
      await setDoc(doc(db, 'rooms', 'music-room', 'musicLeases', 'rml_lease_000000000001'), {
        djUid: 'uid-1',
        expiresAt: Timestamp.fromMillis(now.toMillis() + 45_000),
        leaseId: 'rml_lease_000000000001',
        roomId: 'music-room',
        status: 'active',
      });
      await setDoc(doc(db, 'rooms', 'music-room', 'musicCommandRequests', 'request-1'), {
        actorUid: 'uid-1',
      });
      await setDoc(doc(db, 'roomMusicRateLimits', 'uid-1'), {
        count: 1,
        uid: 'uid-1',
      });
    });

    const memberDb = userDb('uid-1', 'salem@example.com');
    const outsiderDb = userDb('uid-2', 'dana@example.com');
    const leaseRef = doc(
      memberDb,
      'rooms',
      'music-room',
      'musicLeases',
      'rml_lease_000000000001',
    );
    await assertSucceeds(getDoc(leaseRef));
    await assertFails(getDoc(doc(
      outsiderDb,
      'rooms',
      'music-room',
      'musicLeases',
      'rml_lease_000000000001',
    )));
    await assertFails(updateDoc(leaseRef, { status: 'stopped' }));
    await assertFails(setDoc(doc(
      memberDb,
      'rooms',
      'music-room',
      'musicCommandRequests',
      'forged',
    ), { actorUid: 'uid-1' }));
    await assertFails(getDoc(doc(memberDb, 'roomMusicRateLimits', 'uid-1')));
    await assertFails(setDoc(doc(memberDb, 'roomMusicRateLimits', 'uid-1'), { count: 0 }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'appConfig', 'voiceRoomFeatures'), {
        voice_room_shared_music: false,
      });
    });
    await assertFails(getDoc(leaseRef));
  });

  describe('canonical cosmetic registry', () => {
    it('exposes only the exact published asset summary and version', async () => {
      await seedPublicProfile('uid-1', { publicId: '1234567' });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'cosmeticAssets/gold-frame'), {
          assetId: 'gold-frame',
          publicationStatus: 'published',
          publishedVersionId: 'v1-aaaaaaaaaaaa',
          renderingEnabled: true,
          schemaVersion: 1,
        });
        await setDoc(
          doc(context.firestore(), 'cosmeticAssets/gold-frame/versions/v1-aaaaaaaaaaaa'),
          {
            assetId: 'gold-frame',
            assetVersionId: 'v1-aaaaaaaaaaaa',
            schemaVersion: 1,
          },
        );
        await setDoc(
          doc(context.firestore(), 'cosmeticAssets/gold-frame/versions/v2-bbbbbbbbbbbb'),
          {
            assetId: 'gold-frame',
            assetVersionId: 'v2-bbbbbbbbbbbb',
            schemaVersion: 1,
          },
        );
      });
      const db = userDb('uid-1', 'salem@example.com');
      await assertSucceeds(getDoc(doc(db, 'cosmeticAssets/gold-frame')));
      await assertSucceeds(getDoc(
        doc(db, 'cosmeticAssets/gold-frame/versions/v1-aaaaaaaaaaaa'),
      ));
      await assertFails(getDoc(
        doc(db, 'cosmeticAssets/gold-frame/versions/v2-bbbbbbbbbbbb'),
      ));
      await assertFails(getDoc(
        doc(testEnv.unauthenticatedContext().firestore(), 'cosmeticAssets/gold-frame'),
      ));
    });

    it('allows get of owner-bound published customs but excludes them from catalog lists', async () => {
      await seedPublicProfile('uid-1', { publicId: '1234567' });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'cosmeticAssets/cu-pr-aaaaaaaaaaaaaaaaaaaa'), {
          assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
          ownerType: 'user',
          ownerUid: 'uid-2',
          publicationStatus: 'published',
          publishedVersionId: 'v1-123456789abc',
          renderingEnabled: true,
          schemaVersion: 1,
          visibility: 'owner-bound',
        });
        await setDoc(
          doc(context.firestore(), 'cosmeticAssets/cu-pr-aaaaaaaaaaaaaaaaaaaa/versions/v1-123456789abc'),
          {
            assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
            assetVersionId: 'v1-123456789abc',
            schemaVersion: 1,
          },
        );
      });
      const db = userDb('uid-1', 'salem@example.com');
      await assertSucceeds(getDoc(doc(db, 'cosmeticAssets/cu-pr-aaaaaaaaaaaaaaaaaaaa')));
      await assertSucceeds(getDoc(
        doc(db, 'cosmeticAssets/cu-pr-aaaaaaaaaaaaaaaaaaaa/versions/v1-123456789abc'),
      ));
      // Query is fully constrained to owner-bound published assets, which list rules deny.
      await assertFails(getDocs(query(
        collection(db, 'cosmeticAssets'),
        where('publicationStatus', '==', 'published'),
        where('renderingEnabled', '==', true),
        where('visibility', '==', 'owner-bound'),
      )));
    });

    it('denies client approval, receipt, publication, and registry writes', async () => {
      await seedPublicProfile('uid-1', { publicId: '1234567' });
      const db = userDb('uid-1', 'salem@example.com');
      await assertFails(setDoc(doc(db, 'cosmeticAssets/forged-frame'), {
        assetId: 'forged-frame',
        publicationStatus: 'published',
        publishedVersionId: 'v1-aaaaaaaaaaaa',
        renderingEnabled: true,
        schemaVersion: 1,
      }));
      await assertFails(setDoc(
        doc(db, 'cosmeticAssets/forged-frame/versions/v1-aaaaaaaaaaaa'),
        { assetId: 'forged-frame', assetVersionId: 'v1-aaaaaaaaaaaa', schemaVersion: 1 },
      ));
      await assertFails(setDoc(doc(db, 'cosmeticAssetApprovals/forged'), {
        decision: 'approved',
      }));
      await assertFails(setDoc(doc(db, 'cosmeticAssetValidationReceipts/forged'), {
        status: 'passed',
      }));
      await assertFails(setDoc(doc(db, 'entryPresentationApprovalReceipts/forged'), {
        status: 'passed',
      }));
      await assertFails(setDoc(doc(db, 'cosmeticUploadAuthorizations/uid-1'), {
        active: true,
      }));
    });

    it('keeps submission metadata private to its owner and server', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'cosmeticSubmissions/submission-1'), {
          ownerUid: 'uid-1',
          status: 'pending',
        });
      });
      await assertSucceeds(getDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticSubmissions/submission-1'),
      ));
      await assertFails(getDoc(
        doc(userDb('uid-2', 'dana@example.com'), 'cosmeticSubmissions/submission-1'),
      ));
      await assertFails(setDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticSubmissions/forged'),
        { ownerUid: 'uid-1', status: 'approved' },
      ));
    });

    it('keeps custom eligibility and ownership server-owned', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'cosmeticCustomEligibility/uid-1'), {
          active: true,
          uid: 'uid-1',
        });
        await setDoc(doc(context.firestore(), 'cosmeticCustomOwnerships/uid-1/items/cu-pr-aaaaaaaaaaaaaaaaaaaa'), {
          assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
          state: 'active',
          uid: 'uid-1',
        });
      });
      await assertSucceeds(getDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticCustomEligibility/uid-1'),
      ));
      await assertFails(getDoc(
        doc(userDb('uid-2', 'dana@example.com'), 'cosmeticCustomEligibility/uid-1'),
      ));
      await assertFails(setDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticCustomEligibility/uid-1'),
        { active: true, uid: 'uid-1' },
      ));
      await assertSucceeds(getDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticCustomOwnerships/uid-1/items/cu-pr-aaaaaaaaaaaaaaaaaaaa'),
      ));
      await assertFails(setDoc(
        doc(userDb('uid-1', 'salem@example.com'), 'cosmeticCustomOwnerships/uid-1/items/forged'),
        { assetId: 'forged', state: 'active', uid: 'uid-1' },
      ));
    });
  });
});

function userDb(uid, email, extraToken = {}) {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true,
    ...extraToken,
  }).firestore();
}

async function seedDirectChatWave3() {
  await seedPublicProfile('uid-1', { publicId: '1234567' });
  await seedPublicProfile('uid-2', { displayName: 'Dana', normalizedName: 'dana', publicId: '8765432' });
  await seedPublicProfile('uid-3', { displayName: 'Rana', normalizedName: 'rana', publicId: '7654321' });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'appConfig', 'socialFeatures'), { directMessages: true });
    await setDoc(doc(db, 'friendships', 'uid-1_uid-2'), {
      friendshipId: 'uid-1_uid-2',
      userIds: ['uid-1', 'uid-2'],
    });
    await setDoc(doc(db, 'directConversations', 'conversation-1'), {
      conversationId: 'conversation-1',
      friendshipId: 'uid-1_uid-2',
      lifecycleState: 'active',
      memberUids: ['uid-1', 'uid-2'],
      requestState: 'accepted',
      updatedAt: now,
    });
    await setDoc(doc(db, 'directConversations', 'conversation-1', 'messages', 'message-1'), {
      conversationId: 'conversation-1',
      createdAt: now,
      id: 'message-1',
      kind: 'text',
      senderUid: 'uid-1',
      sequence: 1,
      text: 'hello',
      visibilityState: 'visible',
    });
    await setDoc(doc(db, 'directConversations', 'conversation-1', 'receipts', 'uid-2'), {
      conversationId: 'conversation-1',
      lastReadSequence: 1,
      uid: 'uid-2',
      updatedAt: now,
    });
    for (const [ownerUid, peerUid] of [['uid-1', 'uid-2'], ['uid-2', 'uid-1']]) {
      await setDoc(doc(db, 'directConversationMembers', ownerUid, 'items', 'conversation-1'), {
        archived: false,
        conversationId: 'conversation-1',
        ownerUid,
        peerUid,
        unreadCount: ownerUid === 'uid-2' ? 1 : 0,
        updatedAt: now,
      });
      await setDoc(doc(db, 'directChatInboxSummaries', ownerUid), {
        totalUnreadCount: ownerUid === 'uid-2' ? 1 : 0,
        uid: ownerUid,
        updatedAt: now,
      });
    }
    await setDoc(doc(db, 'directMessageRequests', 'conversation-1'), {
      conversationId: 'conversation-1',
      memberUids: ['uid-1', 'uid-2'],
      recipientUid: 'uid-2',
      senderUid: 'uid-1',
      status: 'accepted',
    });
  });
}

function directChatPresencePayload(kind, uid, value, expiresAt) {
  return {
    conversationId: 'conversation-1',
    expiresAt,
    kind,
    uid,
    updatedAt: Timestamp.fromMillis(Date.now()),
    value,
  };
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
