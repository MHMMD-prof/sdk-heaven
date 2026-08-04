const admin = require('firebase-admin');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
} = require('livekit-server-sdk');

const {
  createAdminOverviewPayload,
  filterAdminEconomyRows,
  filterAdminGiftRows,
  filterAdminAuditEventRows,
  filterAdminReportRows,
  filterAdminRoomRows,
  filterAdminSpecialIdRows,
  filterAdminStoreRows,
  filterAdminUserRows,
  filterRowsByOperatorScope,
  mapAdminAuditEventDocument,
  mapAdminReportDocument,
  mapAdminRoomDocument,
  mapAdminUserProfileDocument,
  mapAdminStoreCatalogDocument,
  mapAdminGiftCatalogDocument,
  mapAdminSpecialIdDocument,
  mapAdminWalletTransactionDocument,
  normalizeAdminAuditQuery,
  normalizeAdminAuditLookup,
  normalizeAdminClientError,
  normalizeAdminFeatureFlagUpdate,
  normalizeRoomGiftPolicyUpdate,
  normalizeAdministratorAction,
  normalizeAdminSettingsUpdate,
  normalizeAdminCoupleDissolve,
  normalizeAdminReportAction,
  normalizeAdminReportLookup,
  normalizeAdminReportsQuery,
  normalizeAdminRoomAction,
  normalizeAdminRoomLookup,
  normalizeAdminRoomsQuery,
  normalizeAdminUserAction,
  normalizeAdminUserHistoryQuery,
  normalizeAdminUserLookup,
  normalizeAdminUserNote,
  normalizeAdminUsersQuery,
  normalizeAdminStoreCatalogQuery,
  normalizeAdminEconomyQuery,
  normalizeAdminEconomyExport,
  normalizeAdminStoreItemLookup,
  assertAdminTargetHierarchy,
  assertFreshAdminAuth,
  assertRoomInOperatorScope,
  assertUserInOperatorScope,
  resolveAdminDashboardRequest,
  resolveOperatorRegionScope,
} = require('./adminDashboardCore');
const {
  MAX_ECONOMY_EXPORT_ROWS,
  MAX_STORE_ITEM_AUDIT_EVENTS,
  MAX_STORE_ITEM_OWNERSHIPS,
  MAX_STORE_ITEM_TRANSACTIONS,
  buildEconomyCsv,
  buildStoreItemInsights,
  mapStoreOwnership,
  mapStoreTransaction,
} = require('./adminStoreInsightsCore');
const {
  ADMIN_USER_BLOCK_SCAN_LIMIT,
  ADMIN_USER_CONTEXT_LIMIT,
  mapUserGiftEvent,
  mapUserOwnership,
  mapUserRelationship,
  mapUserRoomModeration,
  mapUserTransferReceipt,
  sortRecent,
  summarizeUserReports,
} = require('./adminUserContextCore');
const {
  ADMIN_USER_HISTORY_LIMIT,
  decodeAdminUserHistoryCursor,
  mergeAdminUserHistoryEntries,
} = require('./adminUserHistoryCore');
const { ADMIN_ROLES, createAdminClaims, getAdminPermissions, resolveAdminRole } = require('./adminClaimsCore');
const { executeAdminStoreCatalogUpsert } = require('./adminStoreService');
const {
  normalizeAdminRoomThemeLookup,
  normalizeAdminRoomThemeMutation,
} = require('./adminRoomThemeCore');
const { getAdminRoomTheme, mutateAdminRoomTheme } = require('./adminRoomThemeService');
const {
  normalizeAdminCosmeticsAssetMutation,
  normalizeAdminCosmeticsAssetQuery,
} = require('./adminCosmeticsAssetCore');
const {
  cleanupExpiredCosmeticSubmissions,
  getAdminCosmeticsAssets,
  mutateAdminCosmeticsAsset,
} = require('./adminCosmeticsAssetService');
const { normalizeAdminRoomRocketMutation } = require('./adminRoomRocketCore');
const {
  getAdminRoomRocketCampaign,
  mutateAdminRoomRocketCampaign,
} = require('./adminRoomRocketService');
const { normalizeAdminStoreCatalogInput } = require('./storeCore');
const {
  extractBearerToken,
  isValidRoomId,
  resolveGameTransportTokenRequest,
  resolveTokenRequest,
} = require('./livekitTokenCore');
const { executeAdminWalletAdjustment, executeAdminWalletCredit } = require('./adminWalletService');
const { normalizeRoomCommandBody } = require('./roomCommandCore');
const { normalizeRoomChatBody } = require('./roomChatCore');
const { normalizeDirectChatCommand } = require('./directChatCore');
const { normalizeRoomMediaCommandBody } = require('./roomMediaCore');
const { normalizeRoomOwnershipBody } = require('./roomOwnershipCore');
const { normalizeRoomGiftBody } = require('./roomGiftCore');
const { inspectApprovedGiftPresentation } = require('./roomGiftPresentationCore');
const { normalizeRoomEntryEffectBody } = require('./roomEntryEffectCore');
const { normalizeRoomGameBody } = require('./roomGameCore');
const { normalizeRoomMusicBody } = require('./roomMusicCore');
const { isValidRoomSeatCommandAction } = require('./roomSeatCore');
const {
  executeRoomCommand,
  retryPendingRoomLiveKitSync,
  synchronizeRoomCommandLiveKit,
} = require('./roomCommandService');
const { cleanupOrphanedRoomMedia, executeRoomMediaCommand } = require('./roomMediaService');
const { finalizeRemovedRooms } = require('./roomLifecycleService');
const {
  executeRoomOwnershipCommand,
  expireRoomOwnershipTransfers,
} = require('./roomOwnershipService');
const { executeRoomGiftCommand } = require('./roomGiftService');
const { resolveRoomGiftPolicy, updateRoomGiftPolicy } = require('./roomGiftPolicyService');
const {
  processRoomSupportLeaderboardRefreshes,
  projectCommittedRoomGift,
  reconcileRoomGiftProjectionBatch,
  reconcileRoomSupportPeriodsBatch,
} = require('./roomSupportProjectionService');
const {
  processRoomRocketCycles,
  processRoomRocketRewardNotifications,
  projectRoomRocketGiftFact,
} = require('./roomRocketService');
const {
  prepareNextRoomTargetRoster,
  searchRoomTargetRosterUsers,
  processRoomTargetCycles,
  processRoomTargetCycleStarts,
  processRoomTargetRosterNotifications,
  projectRoomTargetGiftFact,
} = require('./roomTargetService');
const {
  normalizeAdminRoomTargetMemberHold,
  normalizeAdminRoomTargetMutation,
} = require('./adminRoomTargetCore');
const {
  getAdminRoomTargetCampaign,
  mutateAdminRoomTargetCampaign,
  mutateAdminRoomTargetMemberHold,
} = require('./adminRoomTargetService');
const {
  cleanupExpiredRoomEntryEffectRecords,
  executeRoomEntryEffectCommand,
} = require('./roomEntryEffectService');
const {
  cleanupExpiredRoomGameRecords,
  executeRoomGameCommand,
  expireRoomGameSessions,
} = require('./roomGameService');
const {
  applyRoomMusicLiveKit,
  cleanupExpiredRoomMusicRecords,
  executeRoomMusicCommand,
  expireRoomMusicLeases,
} = require('./roomMusicService');
const {
  cleanupExpiredRoomEvidence,
  cleanupUnreportedRecordingSegments,
} = require('./roomRecordingService');
const { cleanupExpiredRoomChatMessages, executeRoomChatCommand } = require('./roomChatService');
const {
  cleanupDirectChatCommands,
  executeDirectChatCommand,
  expirePendingDirectMessageRequests,
} = require('./directChatService');
const { cleanupDirectChatUploads } = require('./directChatMediaService');
const { createGoogleVisionSafetyAdapter } = require('./directChatMediaSafetyAdapter');
const {
  cleanupVoiceRoomHardeningArtifacts,
  consumeVoiceRoomHttpRateLimit,
} = require('./voiceRoomHardeningService');
const {
  evaluateVoiceRoomLaunchAccess,
  summarizeLaunchReadiness,
} = require('./voiceRoomLaunchCore');
const {
  executeRoomSeatCommand,
  expireRoomSeatOffers,
  reconcileRoomPresenceCounts,
  recoverExpiredRoomSeats,
  recoverStaleRoomPresence,
} = require('./roomSeatService');
const {
  normalizeAttendanceOutageMutation,
  normalizeLiveKitWebhookEvent,
} = require('./roomAttendanceCore');
const {
  getAttendanceShadowReport,
  ingestLiveKitAttendanceEvent,
  ingestSeatMembershipChange,
  mutateAttendanceOutageWindow,
  reconcileLiveKitAttendance,
  verifyAndIngestMicrophoneHint,
} = require('./roomAttendanceService');
const { normalizePayrollAdminMutation } = require('./payrollCore');
const {
  getAdminPayroll,
  getPayrollProgress,
  mutateAdminPayroll,
  processPayrollCycles,
} = require('./payrollService');
const { processWeeklyIncentiveSettlementBatch } = require('./weeklyIncentiveService');
const {
  getAdminWeeklyIncentiveIntegrity,
  mutateAdminWeeklyIncentiveIntegrity,
  processWeeklyIncentiveReconciliationBatch,
  processWeeklyIncentiveRetention,
} = require('./weeklyIncentiveIntegrityService');
const { normalizeDailyLoginCommandBody } = require('./dailyLoginCore');
const {
  claimDailyLoginReward,
  getDailyLoginStatus,
  recordDailyLoginClaimFailure,
} = require('./dailyLoginService');
const { normalizeAdminDailyLoginMutation } = require('./adminDailyLoginCore');
const {
  activateScheduledDailyLoginCampaign,
  getAdminDailyLoginCampaign,
  mutateAdminDailyLoginCampaign,
} = require('./adminDailyLoginService');
const {
  normalizeAdminWeeklyIncentiveIntegrityMutation,
  normalizeAdminWeeklyIncentiveReconciliation,
} = require('./adminWeeklyIncentiveIntegrityCore');
const { discoverUsers } = require('./socialDiscoveryService');
const { getCoupleOverview, getCoupleStatus, mutateCouple } = require('./socialCouplesService');
const { normalizeAdminGiftCatalogInput } = require('./socialGiftsCore');
const { getGiftCenter, sendGift } = require('./socialGiftsService');
const {
  deliverNotificationForCommand,
  deliverSocialNotification,
  getNotificationSettings,
  mutateNotificationSettings,
  processPendingNotificationReceipts,
} = require('./socialNotificationsService');
const {
  buildRepresentativeReversalNotificationCommands,
  mapNotificationPreferences,
} = require('./socialNotificationsCore');
const {
  getFriendsOverview,
  getFriendshipStatus,
  mutateFriendship,
} = require('./socialFriendsService');
const { mutateUserBlock } = require('./socialBlocksService');
const {
  isTimestampLike,
  isValidPublicId,
  normalizeSearchName,
  resolveSocialCommandRequest,
  socialError,
  validatePrivateProfile,
} = require('./socialProfileCore');
const { mergeSocialFeatureFlags } = require('./socialProfileCore');
const { getProfileReadiness, provisionPublicProfile } = require('./socialProfileService');
const { getWalletStore, purchaseSpecialId } = require('./socialWalletService');
const { equipStoreItem, expireStoreOwnerships, getMyStoreItems, getStoreCatalog, giftStoreItem, purchaseStoreItem } = require('./storeService');
const { clearSuspendedAvatarFrameProjection, reconcileAvatarFrameProjections } = require('./avatarFrameProjectionService');
const { clearSuspendedEquipmentCosmetics, reconcileEquipmentCosmeticProjections } = require('./equipmentCosmeticsService');
const { normalizeRoomThemeBody } = require('./roomThemeCore');
const { executeRoomThemeCommand, expireRoomThemeEntitlements } = require('./roomThemeService');
const {
  executeAdminRepresentativeUpdate,
  getRepresentativeStatus,
  reconcileRepresentativeBadges,
  reverseRepresentativeTransfer,
} = require('./representativeService');
const {
  normalizeAdminRepresentativeInput,
  normalizeAdminRepresentativeReversalInput,
} = require('./representativeCore');
const {
  normalizeAdminRepresentativeOverrideInput,
  normalizeAdminRepresentativePinResetInput,
  normalizeAdminRepresentativePolicyInput,
  normalizeRepresentativeOperationsQuery,
  mapRepresentativeOverrideLimits,
} = require('./representativeAdminCore');
const {
  executeRepresentativeOverrideUpdate,
  executeRepresentativePinReset,
  executeRepresentativePolicyUpdate,
  resolveRepresentativeOperations,
} = require('./representativeAdminService');
const { normalizeRepresentativePortalOrigin, normalizeRepresentativePortalRequest } = require('./representativePortalCore');
const {
  createRepresentativePortalTicket,
  exchangeRepresentativePortalTicket,
  getRepresentativeHistory,
  getRepresentativePortalStatus,
  lookupRepresentativeReceipt,
  mapRepresentativePortalTransferResult,
  previewRepresentativeRecipient,
  setupRepresentativeTransferPin,
  transferRepresentativePortalFunds,
} = require('./representativePortalService');
const {
  normalizeAdminSpecialIdInput,
  normalizeAdminWalletAdjustmentInput,
  normalizeAdminWalletCreditInput,
} = require('./socialWalletCore');

admin.initializeApp();
const directChatMediaSafetyAdapter = createGoogleVisionSafetyAdapter({ credential: admin.app().options.credential });

const liveKitUrl = defineSecret('LIVEKIT_URL');
const liveKitApiKey = defineSecret('LIVEKIT_API_KEY');
const liveKitApiSecret = defineSecret('LIVEKIT_API_SECRET');
const representativePortalOrigin = defineString('REPRESENTATIVE_PORTAL_ORIGIN', {
  default: 'https://disabled.invalid',
  description: 'Exact HTTPS origin for the representative portal; disabled.invalid keeps the portal fail-closed.',
});
const roomMediaRegion = 'us-central1';
const roomChatRegion = 'us-central1';

exports.processNotificationReceipts = onSchedule(
  { region: 'us-central1', schedule: 'every 15 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await processPendingNotificationReceipts({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.processNotificationReceipts] complete', result);
  },
);

exports.expireStoreOwnerships = onSchedule(
  { region: 'us-central1', schedule: 'every 30 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await expireStoreOwnerships({
      clock: { nowMillis: () => Date.now(), timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value) },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.expireStoreOwnerships] complete', result);
  },
);

exports.reconcileAvatarFrameProjections = onSchedule(
  { region: 'us-central1', schedule: 'every 30 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await reconcileAvatarFrameProjections({
      clock: { nowMillis: () => Date.now() },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.reconcileAvatarFrameProjections] complete', result);
  },
);

exports.reconcileEquipmentCosmeticProjections = onSchedule(
  { region: 'us-central1', schedule: 'every 30 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await reconcileEquipmentCosmeticProjections({
      clock: { nowMillis: () => Date.now() },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.reconcileEquipmentCosmeticProjections] complete', result);
  },
);

exports.clearSuspendedAvatarFrameProjection = onDocumentWritten(
  { document: 'publicProfiles/{uid}', region: 'us-central1' },
  async (event) => {
    const beforeStatus = event.data?.before.data()?.moderationStatus;
    const afterStatus = event.data?.after.data()?.moderationStatus;
    if (beforeStatus === afterStatus || afterStatus === 'active') return;
    await clearSuspendedAvatarFrameProjection({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      uid: event.params.uid,
    });
    await clearSuspendedEquipmentCosmetics({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      uid: event.params.uid,
    });
  },
);

exports.expireRoomThemeEntitlements = onSchedule(
  { region: 'us-central1', schedule: 'every 30 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await expireRoomThemeEntitlements({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.expireRoomThemeEntitlements] complete', result);
  },
);

exports.projectRepresentativeBadge = onSchedule(
  { region: 'us-central1', schedule: 'every 5 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await reconcileRepresentativeBadges({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.projectRepresentativeBadge] complete', result);
  },
);

exports.projectRoomGiftSupport = onDocumentCreated(
  {
    document: 'rooms/{roomId}/giftEvents/{eventId}',
    region: 'us-central1',
    retry: true,
  },
  async (event) => {
    if (!event.data) return;
    const result = await projectCommittedRoomGift({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      event: event.data.data(),
      fieldValue: admin.firestore.FieldValue,
      roomId: event.params.roomId,
    });
    const rocket = result.fact
      ? await projectRoomRocketGiftFact({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          fact: result.fact,
          fieldValue: admin.firestore.FieldValue,
        })
      : { skipped: true };
    const target = result.fact
      ? await projectRoomTargetGiftFact({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          fact: result.fact,
          fieldValue: admin.firestore.FieldValue,
        })
      : { skipped: true };
    console.info('[functions.projectRoomGiftSupport] complete', {
      eventId: event.params.eventId,
      replayed: result.replayed === true,
      rocketReplayed: rocket.replayed === true,
      skipped: result.skipped === true,
      targetExcluded: target.excluded === true,
      targetReplayed: target.replayed === true,
    });
    if (result.errorCode) throw new Error(`Room support projection failed: ${result.errorCode}`);
    if (rocket.errorCode) throw new Error(`Room Rocket projection failed: ${rocket.errorCode}`);
    if (target.errorCode) throw new Error(`Room Target projection failed: ${target.errorCode}`);
  },
);

exports.processRoomRocketCycles = onSchedule(
  { region: 'us-central1', schedule: 'every 10 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await processRoomRocketCycles({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.processRoomRocketCycles] complete', result);
  },
);

exports.processRoomRocketRewardNotifications = onSchedule(
  { region: 'us-central1', schedule: 'every 10 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const db = admin.firestore();
    const result = await processRoomRocketRewardNotifications({
      db,
      deliver: (input) => deliverSocialNotification({
        ...input,
        db,
        fieldValue: admin.firestore.FieldValue,
      }),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.processRoomRocketRewardNotifications] complete', result);
  },
);

exports.startRoomTargetCycles = onSchedule(
  { region: 'us-central1', schedule: 'every 10 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await processRoomTargetCycleStarts({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.startRoomTargetCycles] complete', result);
  },
);

exports.processRoomTargetCycles = onSchedule(
  { region: 'us-central1', schedule: 'every 10 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const result = await processRoomTargetCycles({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.processRoomTargetCycles] complete', result);
  },
);

exports.processRoomTargetRosterNotifications = onSchedule(
  { region: 'us-central1', schedule: 'every 10 minutes', timeZone: 'Asia/Baghdad' },
  async () => {
    const db = admin.firestore();
    const result = await processRoomTargetRosterNotifications({
      db,
      deliver: (input) => deliverSocialNotification({
        ...input,
        db,
        fieldValue: admin.firestore.FieldValue,
      }),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.processRoomTargetRosterNotifications] complete', result);
  },
);

exports.refreshRoomSupportLeaderboards = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await processRoomSupportLeaderboardRefreshes({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.refreshRoomSupportLeaderboards] complete', result);
  },
);

exports.reconcileRoomSupportProjections = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 10 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const db = admin.firestore();
    const eventCursorRef = db.doc('appRuntime/roomSupportGiftReconciler');
    const periodCursorRef = db.doc('appRuntime/roomSupportPeriodReconciler');
    const [eventCursor, periodCursor] = await Promise.all([eventCursorRef.get(), periodCursorRef.get()]);
    const dependencies = {
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db,
      fieldValue: admin.firestore.FieldValue,
    };
    const gifts = await reconcileRoomGiftProjectionBatch({
      ...dependencies,
      cursor: eventCursor.data()?.cursor || '',
      documentIdField: admin.firestore.FieldPath.documentId(),
      projectFact: async (fact) => {
        const [rocket, target] = await Promise.all([
          projectRoomRocketGiftFact({ ...dependencies, fact }),
          projectRoomTargetGiftFact({ ...dependencies, fact }),
        ]);
        return {
          ...(rocket.errorCode ? { errorCode: `ROCKET_${rocket.errorCode}` } : {}),
          ...(target.errorCode ? { errorCode: `TARGET_${target.errorCode}` } : {}),
        };
      },
    });
    const periods = await reconcileRoomSupportPeriodsBatch({
      ...dependencies,
      cursor: periodCursor.data()?.cursor || '',
    });
    await Promise.all([
      eventCursorRef.set({
        cursor: gifts.nextCursor,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        projected: gifts.projected,
        replayed: gifts.replayed,
        scanned: gifts.scanned,
        skipped: gifts.results.filter((result) => result.skipped === true).length,
      }, { merge: true }),
      periodCursorRef.set({
        cursor: periods.nextCursor,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        repaired: periods.reports.filter((report) => report.repaired === true).length,
        scanned: periods.scanned,
        unbalanced: periods.reports.filter((report) => report.balanced === false).length,
      }, { merge: true }),
    ]);
    console.info('[functions.reconcileRoomSupportProjections] complete', {
      giftProjection: { projected: gifts.projected, replayed: gifts.replayed, scanned: gifts.scanned },
      periodProjection: { scanned: periods.scanned },
    });
  },
);

exports.socialCommand = onCall(
  {
    cors: true,
    region: 'us-central1',
  },
  async (request) => {
    const command = resolveSocialCommandRequest({
      auth: request.auth,
      data: request.data,
    });

    if (!command.ok) {
      throwSocialCommandError(command.code);
    }

    try {
      if (command.value.action === 'get-readiness') {
        const result = await getProfileReadiness(admin.firestore(), command.value.uid);
        return { ok: true, result };
      }

      if (command.value.action === 'search-users') {
        const discovery = await discoverUsers({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });

        if (discovery.errorCode) {
          throwSocialCommandError(discovery.errorCode);
        }

        return { ok: true, result: discovery.result };
      }

      if (command.value.action === 'get-friends') {
        const overview = await getFriendsOverview({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });

        if (overview.errorCode) {
          throwSocialCommandError(overview.errorCode);
        }

        return { ok: true, result: overview.result };
      }

      if (command.value.action === 'get-friendship-status') {
        const relationship = await getFriendshipStatus({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });

        if (relationship.errorCode) {
          throwSocialCommandError(relationship.errorCode);
        }

        return { ok: true, result: relationship.result };
      }

      if (command.value.action === 'get-couples') {
        const overview = await getCoupleOverview({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });
        if (overview.errorCode) throwSocialCommandError(overview.errorCode);
        return { ok: true, result: overview.result };
      }

      if (command.value.action === 'get-couple-status') {
        const relationship = await getCoupleStatus({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });
        if (relationship.errorCode) throwSocialCommandError(relationship.errorCode);
        return { ok: true, result: relationship.result };
      }

      if (command.value.action === 'get-notification-settings') {
        const settings = await getNotificationSettings({ db: admin.firestore(), input: command.value.payload, uid: command.value.uid });
        if (settings.errorCode) throwSocialCommandError(settings.errorCode);
        return { ok: true, result: settings.result };
      }

      if (['register-push-device', 'unregister-push-device', 'update-notification-preferences'].includes(command.value.action)) {
        const settings = await mutateNotificationSettings({
          action: command.value.action,
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });
        if (settings.errorCode) throwSocialCommandError(settings.errorCode);
        return { ok: true, result: settings.result };
      }

      if (command.value.action === 'get-wallet-store') {
        const store = await getWalletStore({ db: admin.firestore(), input: command.value.payload, uid: command.value.uid });
        if (store.errorCode) throwSocialCommandError(store.errorCode);
        return { ok: true, result: store.result };
      }

      if (command.value.action === 'purchase-special-id') {
        const purchase = await purchaseSpecialId({
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });
        if (purchase.errorCode) throwSocialCommandError(purchase.errorCode);
        return { ok: true, result: purchase.result };
      }

      if (command.value.action === 'get-store-catalog') {
        const store = await getStoreCatalog({ db: admin.firestore(), input: command.value.payload, uid: command.value.uid });
        if (store.errorCode) throwSocialCommandError(store.errorCode);
        return { ok: true, result: store.result };
      }

      if (command.value.action === 'purchase-store-item') {
        const purchase = await purchaseStoreItem({
          clock: { nowMillis: () => Date.now(), timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value) },
          db: admin.firestore(), fieldValue: admin.firestore.FieldValue, input: command.value.payload,
          requestId: command.value.requestId, uid: command.value.uid,
        });
        if (purchase.errorCode) throwSocialCommandError(purchase.errorCode);
        return { ok: true, result: purchase.result };
      }

      if (command.value.action === 'get-my-store-items') {
        const inventory = await getMyStoreItems({ db: admin.firestore(), input: command.value.payload, uid: command.value.uid });
        if (inventory.errorCode) throwSocialCommandError(inventory.errorCode);
        return { ok: true, result: inventory.result };
      }

      if (command.value.action === 'equip-store-item') {
        const equipped = await equipStoreItem({
          clock: { nowMillis: () => Date.now() }, db: admin.firestore(), fieldValue: admin.firestore.FieldValue,
          input: command.value.payload, requestId: command.value.requestId, uid: command.value.uid,
        });
        if (equipped.errorCode) throwSocialCommandError(equipped.errorCode);
        return { ok: true, result: equipped.result };
      }

      if (command.value.action === 'gift-store-item') {
        const gift = await giftStoreItem({
          clock: { nowMillis: () => Date.now(), timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value) },
          db: admin.firestore(), fieldValue: admin.firestore.FieldValue, input: command.value.payload,
          requestId: command.value.requestId, uid: command.value.uid,
        });
        if (gift.errorCode) throwSocialCommandError(gift.errorCode);
        await deliverStoreGiftNotificationsSafely(command.value, gift.result);
        return { ok: true, result: gift.result };
      }

      if (command.value.action === 'get-representative-status') {
        const status = await getRepresentativeStatus({
          clock: { nowMillis: () => Date.now() }, db: admin.firestore(), input: command.value.payload,
          portalOrigin: representativePortalOrigin.value(), uid: command.value.uid,
        });
        if (status.errorCode) throwSocialCommandError(status.errorCode);
        return { ok: true, result: status.result };
      }

      if (command.value.action === 'create-representative-portal-ticket') {
        const ticket = await createRepresentativePortalTicket({
          authTimeMillis: Number(request.auth?.token?.auth_time) * 1000,
          clock: { nowMillis: () => Date.now(), timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value) },
          db: admin.firestore(), input: command.value.payload, portalOrigin: representativePortalOrigin.value(), uid: command.value.uid,
        });
        if (ticket.errorCode) throwSocialCommandError(ticket.errorCode);
        return { ok: true, result: ticket.result };
      }

      if (command.value.action === 'get-gift-center') {
        const center = await getGiftCenter({
          db: admin.firestore(),
          input: command.value.payload,
          uid: command.value.uid,
        });
        if (center.errorCode) throwSocialCommandError(center.errorCode);
        return { ok: true, result: center.result };
      }

      if (command.value.action === 'send-gift') {
        const gift = await sendGift({
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });
        if (gift.errorCode) throwSocialCommandError(gift.errorCode);
        await deliverSocialNotificationSafely(command.value);
        return { ok: true, result: gift.result };
      }

      if ([
        'send-friend-request',
        'accept-friend-request',
        'decline-friend-request',
        'cancel-friend-request',
        'remove-friend',
      ].includes(command.value.action)) {
        const mutation = await mutateFriendship({
          action: command.value.action,
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });

        if (mutation.errorCode) {
          throwSocialCommandError(mutation.errorCode);
        }

        await deliverSocialNotificationSafely(command.value);
        return { ok: true, result: mutation.result };
      }

      if (['block-user', 'unblock-user'].includes(command.value.action)) {
        const mutation = await mutateUserBlock({
          action: command.value.action,
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });
        if (mutation.errorCode) throwSocialCommandError(mutation.errorCode);
        return { ok: true, result: mutation.result };
      }

      if ([
        'send-couple-request',
        'accept-couple-request',
        'decline-couple-request',
        'cancel-couple-request',
        'dissolve-couple',
      ].includes(command.value.action)) {
        const mutation = await mutateCouple({
          action: command.value.action,
          db: admin.firestore(),
          fieldValue: admin.firestore.FieldValue,
          input: command.value.payload,
          requestId: command.value.requestId,
          uid: command.value.uid,
        });
        if (mutation.errorCode) throwSocialCommandError(mutation.errorCode);
        await deliverSocialNotificationSafely(command.value);
        return { ok: true, result: mutation.result };
      }

      const provisioned = await provisionPublicProfile({
        actorEmail: request.auth?.token?.email || '',
        actorUid: command.value.uid,
        db: admin.firestore(),
        fieldValue: admin.firestore.FieldValue,
        requestId: command.value.requestId,
        uid: command.value.uid,
      });

      if (provisioned.errorCode) {
        throwSocialCommandError(provisioned.errorCode);
      }

      return { ok: true, result: provisioned.result };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      console.error('[functions.socialCommand] request:error', {
        action: command.value.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : typeof error,
        uid: command.value.uid,
      });
      throwSocialCommandError('INTERNAL');
    }
  },
);

function throwSocialCommandError(code) {
  const error = socialError(code);
  throw new HttpsError(error.httpsCode, error.message, {
    code: error.code,
    messageAr: error.messageAr,
  });
}

async function deliverSocialNotificationSafely(command) {
  try {
    await deliverNotificationForCommand({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      requestId: command.requestId,
      uid: command.uid,
    });
  } catch (error) {
    console.error('[functions.socialCommand] notification:error', {
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId: command.requestId,
      uid: command.uid,
    });
  }
}

async function deliverStoreGiftNotificationsSafely(command, result) {
  try {
    await Promise.all([
      deliverSocialNotification({
        actorUid: command.uid, db: admin.firestore(), fieldValue: admin.firestore.FieldValue,
        kind: 'store-gift-received', recipientUid: result.recipientUid, requestId: `received_${command.requestId}`,
      }),
      deliverSocialNotification({
        actorUid: result.recipientUid, db: admin.firestore(), fieldValue: admin.firestore.FieldValue,
        kind: 'store-gift-sent', recipientUid: command.uid, requestId: `sent_${command.uid}_${command.requestId}`,
      }),
    ]);
  } catch (error) {
    console.error('[functions.socialCommand] store-gift-notification:error', { requestId: command.requestId, uid: command.uid, errorMessage: error instanceof Error ? error.message : String(error) });
  }
}

async function deliverRepresentativeTransferNotificationsSafely(command, result) {
  try {
    await Promise.all([
      deliverSocialNotification({ actorUid: command.uid, db: admin.firestore(), fieldValue: admin.firestore.FieldValue, kind: 'representative-transfer-received', recipientUid: result.recipientUid, requestId: `representative_received_${command.requestId}` }),
      deliverSocialNotification({ actorUid: result.recipientUid, db: admin.firestore(), fieldValue: admin.firestore.FieldValue, kind: 'representative-transfer-sent', recipientUid: command.uid, requestId: `representative_sent_${command.requestId}` }),
    ]);
  } catch (error) {
    console.error('[functions.socialCommand] representative-notification:error', { requestId: command.requestId, uid: command.uid, errorMessage: error instanceof Error ? error.message : String(error) });
  }
}

exports.representativePortal = onRequest(
  {
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    const configuredOrigin = normalizeRepresentativePortalOrigin(representativePortalOrigin.value());
    const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin.trim() : '';
    const normalizedRequestOrigin = normalizeRepresentativePortalOrigin(requestOrigin);
    response.set('Cache-Control', 'no-store, max-age=0');
    response.set('Pragma', 'no-cache');
    response.set('Referrer-Policy', 'no-referrer');
    response.set('Vary', 'Origin');
    response.set('X-Content-Type-Options', 'nosniff');

    if (!configuredOrigin.ok) {
      sendRepresentativePortalError(response, 'FEATURE_DISABLED');
      return;
    }
    if (!normalizedRequestOrigin.ok || normalizedRequestOrigin.value !== configuredOrigin.value) {
      sendRepresentativePortalError(response, 'PORTAL_ORIGIN_DENIED');
      return;
    }

    response.set('Access-Control-Allow-Origin', configuredOrigin.value);
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', messageAr: 'استخدم طلب POST.' } });
      return;
    }
    if (!request.is('application/json')) {
      response.status(415).json({ ok: false, error: { code: 'INVALID_REQUEST', messageAr: 'يجب إرسال بيانات JSON صالحة.' } });
      return;
    }

    const portalRequest = normalizeRepresentativePortalRequest(request.body);
    if (!portalRequest.ok) {
      sendRepresentativePortalError(response, portalRequest.code);
      return;
    }

    const clock = {
      nowMillis: () => Date.now(),
      timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
    };
    try {
      let operation;
      if (portalRequest.value.action === 'exchange') {
        operation = await exchangeRepresentativePortalTicket({
          clock, db: admin.firestore(), portalOrigin: configuredOrigin.value, requestOrigin,
          ticket: portalRequest.value.ticket,
        });
      } else {
        const sessionToken = extractBearerToken(request.headers);
        if (!sessionToken) {
          sendRepresentativePortalError(response, 'PORTAL_SESSION_INVALID');
          return;
        }
        if (portalRequest.value.action === 'status') {
          operation = await getRepresentativePortalStatus({ clock, db: admin.firestore(), portalOrigin: configuredOrigin.value, requestOrigin, sessionToken });
        } else if (portalRequest.value.action === 'history') {
          operation = await getRepresentativeHistory({
            clock,
            db: admin.firestore(),
            input: portalRequest.value,
            portalOrigin: configuredOrigin.value,
            requestOrigin,
            sessionToken,
          });
        } else if (portalRequest.value.action === 'receipt-lookup') {
          operation = await lookupRepresentativeReceipt({
            clock,
            db: admin.firestore(),
            portalOrigin: configuredOrigin.value,
            publicReference: portalRequest.value.publicReference,
            requestOrigin,
            sessionToken,
          });
        } else if (portalRequest.value.action === 'recipient-preview') {
          operation = await previewRepresentativeRecipient({
            clock, db: admin.firestore(), portalOrigin: configuredOrigin.value,
            recipientPublicId: portalRequest.value.recipientPublicId, requestOrigin, sessionToken,
          });
        } else if (portalRequest.value.action === 'pin-setup') {
          operation = await setupRepresentativeTransferPin({
            clock, db: admin.firestore(), pin: portalRequest.value.pin,
            portalOrigin: configuredOrigin.value, requestOrigin, sessionToken,
          });
        } else {
          operation = await transferRepresentativePortalFunds({
            clock, db: admin.firestore(), fieldValue: admin.firestore.FieldValue, input: portalRequest.value,
            portalOrigin: configuredOrigin.value, requestOrigin, sessionToken,
          });
        }
      }
      if (operation.errorCode) {
        sendRepresentativePortalError(response, operation.errorCode);
        return;
      }
      if (portalRequest.value.action === 'transfer') {
        await deliverRepresentativeTransferNotificationsSafely(
          { requestId: portalRequest.value.requestId, uid: operation.result.representativeUid }, operation.result,
        );
        response.json({ ok: true, result: mapRepresentativePortalTransferResult(operation.result) });
        return;
      }
      response.json({ ok: true, result: operation.result });
    } catch (error) {
      console.error('[functions.representativePortal] request:error', {
        action: portalRequest.value.action,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      sendRepresentativePortalError(response, 'INTERNAL');
    }
  },
);

function sendRepresentativePortalError(response, code) {
  const errors = {
    FRESH_AUTH_REQUIRED: { status: 401, messageAr: 'يلزم تسجيل دخول حديث لإعداد رمز التحويل.' },
    CURSOR_INVALID: { status: 409, messageAr: 'انتهت صفحة السجل. حدّث السجل وحاول مجدداً.' },
    INSUFFICIENT_FUNDS: { status: 409, messageAr: 'الرصيد غير كافٍ لإتمام التحويل.' },
    PERMISSION_DENIED: { status: 403, messageAr: 'غير مسموح للوكيل بتحويل هذه العملة.' },
    PIN_ALREADY_CONFIGURED: { status: 409, messageAr: 'رمز التحويل معد مسبقاً.' },
    PIN_CHANGED: { status: 409, messageAr: 'تغير رمز التحويل. حاول مجدداً.' },
    PIN_INVALID: { status: 403, messageAr: 'رمز التحويل غير صحيح.' },
    PIN_LOCKED: { status: 423, messageAr: 'تم قفل رمز التحويل مؤقتاً.' },
    PIN_NOT_CONFIGURED: { status: 409, messageAr: 'يجب إعداد رمز التحويل أولاً.' },
    PIN_RESET_REQUIRED: { status: 409, messageAr: 'يجب إعادة إعداد رمز التحويل.' },
    PROOF_INVALID: { status: 409, messageAr: 'انتهى التحقق من المستلم. تحقق منه مجدداً.' },
    TRANSFER_LIMIT_EXCEEDED: { status: 409, messageAr: 'يتجاوز التحويل الحد المسموح.' },
    TRANSFER_RATE_LIMITED: { status: 429, messageAr: 'تم بلوغ عدد التحويلات المسموح في الساعة.' },
    FEATURE_DISABLED: { status: 503, messageAr: 'خدمة الوكيل غير متاحة حالياً.' },
    INTERNAL: { status: 500, messageAr: 'تعذر تنفيذ طلب الوكيل.' },
    INVALID_RECIPIENT: { status: 404, messageAr: 'تعذر العثور على مستلم صالح بهذا المعرّف.' },
    INVALID_REQUEST: { status: 400, messageAr: 'طلب بوابة الوكيل غير صالح.' },
    PORTAL_ORIGIN_DENIED: { status: 403, messageAr: 'مصدر بوابة الوكيل غير مسموح.' },
    PORTAL_SESSION_INVALID: { status: 401, messageAr: 'انتهت جلسة بوابة الوكيل أو أصبحت غير صالحة.' },
    PROFILE_INCOMPLETE: { status: 403, messageAr: 'يجب إكمال الملف الشخصي أولاً.' },
    RATE_LIMITED: { status: 429, messageAr: 'طلبات كثيرة جداً. حاول لاحقاً.' },
    RECEIPT_NOT_FOUND: { status: 404, messageAr: 'تعذر العثور على إيصال صالح بهذا المرجع.' },
    REPRESENTATIVE_REQUIRED: { status: 403, messageAr: 'يلزم حساب وكيل نشط.' },
    REQUEST_CONFLICT: { status: 409, messageAr: 'تعارض الطلب مع عملية موجودة.' },
  };
  const error = errors[code] || errors.INTERNAL;
  response.status(error.status).json({ ok: false, error: { code: errors[code] ? code : 'INTERNAL', messageAr: error.messageAr } });
}

async function resolveVoiceRoomHttpLaunchAccess(db, decodedToken, request) {
  try {
    const [launchSnapshot, publicProfileSnapshot] = await Promise.all([
      db.doc('appConfig/voiceRoomLaunch').get(),
      db.doc(`publicProfiles/${decodedToken.uid}`).get(),
    ]);
    const headerVersion = request.headers['x-client-version'];
    const clientVersion = typeof request.body?.clientVersion === 'string'
      ? request.body.clientVersion.trim()
      : typeof headerVersion === 'string'
        ? headerVersion.trim()
        : '';
    return evaluateVoiceRoomLaunchAccess({
      clientVersion,
      countryCode: publicProfileSnapshot.exists ? publicProfileSnapshot.data()?.countryCode : '',
      decodedToken,
      policy: launchSnapshot.exists ? launchSnapshot.data() : undefined,
      requireClientVersion: Boolean(clientVersion),
    });
  } catch (error) {
    console.error('[functions.voiceRoomLaunch] access:error', {
      errorMessage: error instanceof Error ? error.message : String(error),
      uid: decodedToken?.uid || '',
    });
    return {
      code: 'LAUNCH_POLICY_UNAVAILABLE',
      error: 'Voice-room launch policy is temporarily unavailable.',
      ok: false,
      status: 503,
    };
  }
}

function sendVoiceRoomLaunchDenial(response, access) {
  if (access.ok) return true;
  response.status(access.status).json({ code: access.code, error: access.error });
  return false;
}

exports.livekitAttendanceWebhook = onRequest(
  {
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Use POST.');
      return;
    }
    try {
      const receiver = new WebhookReceiver(liveKitApiKey.value(), liveKitApiSecret.value());
      const rawBody = Buffer.isBuffer(request.rawBody)
        ? request.rawBody.toString('utf8')
        : '';
      if (!rawBody) {
        response.status(400).send('Raw webhook body is required.');
        return;
      }
      const webhook = await receiver.receive(rawBody, request.headers.authorization);
      const normalized = normalizeLiveKitWebhookEvent(webhook);
      if (!normalized.ok) {
        response.status(normalized.code === 'UNSUPPORTED_EVENT' ? 202 : 400).json({
          accepted: normalized.code === 'UNSUPPORTED_EVENT',
          code: normalized.code,
        });
        return;
      }
      const result = await ingestLiveKitAttendanceEvent({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        event: normalized.value,
        fieldValue: admin.firestore.FieldValue,
      });
      if (result.errorCode) throw new Error(result.errorCode);
      response.status(200).json({ accepted: true, replayed: result.replayed === true });
    } catch (error) {
      const unauthorized = /authorization|token|signature|sha256|jwt/i.test(
        error instanceof Error ? error.message : String(error),
      );
      console.error('[functions.livekitAttendanceWebhook] rejected', {
        error: error instanceof Error ? error.message : String(error),
      });
      response.status(unauthorized ? 401 : 500).json({
        error: unauthorized ? 'Webhook signature is invalid.' : 'Attendance webhook processing failed.',
      });
    }
  },
);

exports.projectRoomAttendanceSeatState = onDocumentWritten(
  {
    document: 'rooms/{roomId}/members/{uid}',
    region: 'us-central1',
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (
      before?.seatId === after?.seatId
      && before?.status === after?.status
      && before?.canPublishAudio === after?.canPublishAudio
    ) return;
    const result = await ingestSeatMembershipChange({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      eventId: event.id,
      fieldValue: admin.firestore.FieldValue,
      roomId: event.params.roomId,
      uid: event.params.uid,
    });
    console.info('[functions.projectRoomAttendanceSeatState] complete', result);
  },
);

exports.reconcileLiveKitAttendance = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const runtimeRef = admin.firestore().doc('appRuntime/liveKitAttendanceReconciler');
    const result = await reconcileLiveKitAttendance({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      roomService: new RoomServiceClient(
        liveKitUrl.value(),
        liveKitApiKey.value(),
        liveKitApiSecret.value(),
      ),
    });
    console.info('[functions.reconcileLiveKitAttendance] complete', {
      processed: result.processed,
      scanned: result.scanned,
    });
    await runtimeRef.set({
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: result.processed || 0,
      scanned: result.scanned || 0,
      status: 'ok',
    }, { merge: true });
  },
);

exports.processPayrollCycles = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await processPayrollCycles({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      limit: 100,
    });
    console.info('[functions.processPayrollCycles] complete', result);
  },
);

exports.processWeeklyIncentiveSettlements = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const runtimeRef = admin.firestore().doc('appRuntime/weeklyIncentiveSettlementWorker');
    const result = await processWeeklyIncentiveSettlementBatch({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      options: {
        dryRun: false,
        leaseMillis: 5 * 60 * 1000,
        limit: 100,
        workerId: `scheduled-${process.env.K_REVISION || 'local'}`,
      },
    });
    console.info('[functions.processWeeklyIncentiveSettlements] complete', {
      processed: result.processed,
      scanned: result.scanned,
    });
    await runtimeRef.set({
      failed: result.failed || 0,
      held: result.held || 0,
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: result.processed || 0,
      scanned: result.scanned || 0,
      status: (result.failed || 0) > 0 ? 'degraded' : 'ok',
    }, { merge: true });
  },
);

exports.monitorWeeklyIncentiveIntegrity = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const db = admin.firestore();
    const runtimeRef = db.doc('appRuntime/weeklyIncentiveIntegrityMonitor');
    const previous = await runtimeRef.get();
    const result = await processWeeklyIncentiveReconciliationBatch({
      apply: true,
      db,
      documentIdField: admin.firestore.FieldPath.documentId(),
      fieldValue: admin.firestore.FieldValue,
      giftCursor: previous.data()?.giftCursor || '',
      limit: 100,
      settlementCursor: previous.data()?.settlementCursor || '',
    });
    await runtimeRef.set({
      balanced: result.summary.balanced,
      giftCursor: result.nextGiftCursor,
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      scanned: result.summary.scanned,
      settlementCursor: result.nextSettlementCursor,
      status: result.summary.unbalanced > 0 ? 'degraded' : 'ok',
      unbalanced: result.summary.unbalanced,
    }, { merge: true });
    console.info('[functions.monitorWeeklyIncentiveIntegrity] complete', result.summary);
  },
);

exports.enforceWeeklyIncentiveRetention = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 24 hours',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await processWeeklyIncentiveRetention({
      actorUid: 'system:weekly-incentive-retention',
      apply: true,
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      limit: 100,
    });
    console.info('[functions.enforceWeeklyIncentiveRetention] complete', {
      deleted: result.deleted,
    });
  },
);

exports.roomAttendanceCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch {
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }
    const action = typeof request.body?.action === 'string' ? request.body.action.trim() : '';
    const roomId = typeof request.body?.roomId === 'string' ? request.body.roomId.trim() : '';
    const requestId = typeof request.body?.requestId === 'string' ? request.body.requestId.trim() : '';
    if (
      action !== 'verify-microphone-state'
      || !isValidRoomId(roomId)
      || !/^[A-Za-z0-9_-]{12,100}$/.test(requestId)
    ) {
      response.status(400).json({ error: 'A valid attendance command is required.' });
      return;
    }
    try {
      const rateLimit = await consumeVoiceRoomHttpRateLimit({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        fieldValue: admin.firestore.FieldValue,
        requestId,
        surface: 'room-attendance',
        uid: decodedToken.uid,
      });
      if (!rateLimit.ok) {
        response.status(rateLimit.status).json({ code: rateLimit.code, error: rateLimit.error });
        return;
      }
      const result = await verifyAndIngestMicrophoneHint({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        fieldValue: admin.firestore.FieldValue,
        requestId,
        roomId,
        roomService: new RoomServiceClient(
          liveKitUrl.value(),
          liveKitApiKey.value(),
          liveKitApiSecret.value(),
        ),
        uid: decodedToken.uid,
      });
      if (result.errorCode === 'PARTICIPANT_NOT_FOUND') {
        response.status(409).json({ error: 'The LiveKit participant is not connected.' });
        return;
      }
      if (result.errorCode) throw new Error(result.errorCode);
      response.json({ ok: true, reportOnly: true, verified: !result.skipped });
    } catch (error) {
      console.error('[functions.roomAttendanceCommand] failed', error);
      response.status(500).json({ error: 'Microphone state verification failed.' });
    }
  },
);

exports.payrollProgress = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    response.set('Cache-Control', 'no-store, max-age=0');
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch {
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }
    try {
      const result = await getPayrollProgress({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        uid: decodedToken.uid,
      });
      if (result.errorCode) {
        response.status(result.errorCode === 'PLAN_NOT_FOUND' ? 409 : 500).json({ error: result.errorCode });
        return;
      }
      response.json({ ok: true, payroll: result });
    } catch (error) {
      console.error('[functions.payrollProgress] failed', error);
      response.status(500).json({ error: 'Payroll progress could not be loaded.' });
    }
  },
);

exports.activateDailyLoginCampaign = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await activateScheduledDailyLoginCampaign({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.activateDailyLoginCampaign] complete', result);
  },
);

exports.dailyLoginCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    response.set('Cache-Control', 'no-store, max-age=0');
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch {
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }
    const command = normalizeDailyLoginCommandBody(request.body);
    if (!command.ok) {
      response.status(400).json({ code: command.code, error: 'The daily reward request is invalid.' });
      return;
    }
    const dependencies = {
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      input: request.body,
      uid: decodedToken.uid,
    };
    try {
      const result = command.value.action === 'get-daily-login-status'
        ? await getDailyLoginStatus(dependencies)
        : await claimDailyLoginReward({
          ...dependencies,
          fieldValue: admin.firestore.FieldValue,
        });
      if (result.ok === false) {
        if (command.value.action === 'claim-daily-login-reward') {
          try {
            await recordDailyLoginClaimFailure({
              clock: dependencies.clock,
              code: result.code,
              db: dependencies.db,
              fieldValue: admin.firestore.FieldValue,
              uid: decodedToken.uid,
            });
          } catch (metricError) {
            console.warn('[functions.dailyLoginCommand] failure-metric:error', {
              code: result.code,
              errorMessage: metricError instanceof Error ? metricError.message : String(metricError),
            });
          }
        }
        response.status(result.status).json({
          code: result.code,
          ...(result.details ? { details: result.details } : {}),
          error: result.error,
        });
        return;
      }
      response.json({
        ok: true,
        replayed: result.replayed === true,
        result: result.result,
      });
    } catch (error) {
      console.error('[functions.dailyLoginCommand] request:error', {
        action: command.value.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'DAILY_LOGIN_FAILED', error: 'The daily reward command failed.' });
    }
  },
);

exports.livekitToken = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    try {
      const requestedRoomId = typeof request.body?.roomId === 'string' ? request.body.roomId.trim() : '';
      const requestedGameSessionId = typeof request.body?.gameSessionId === 'string'
        ? request.body.gameSessionId.trim()
        : '';
      if (!isValidRoomId(requestedRoomId)) {
        response.status(400).json({ error: 'roomId is required.' });
        return;
      }
      if (
        requestedGameSessionId
        && !/^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/.test(requestedGameSessionId)
      ) {
        response.status(400).json({ error: 'A valid gameSessionId is required.' });
        return;
      }
      const db = admin.firestore();
      console.info('[functions.livekitToken] request:start', {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        emailVerified: decodedToken.email_verified === true,
        requestedRoomId,
        requestedCanPublishAudio: request.body?.canPublishAudio,
        requestedGameSessionId,
      });
      const [
        profileSnapshot,
        publicProfileSnapshot,
        restrictionSnapshot,
        roomSnapshot,
        membershipSnapshot,
        banSnapshot,
        gameSessionSnapshot,
        featureSnapshot,
        launchSnapshot,
      ] = await Promise.all([
        db.doc(`users/${decodedToken.uid}`).get(),
        db.doc(`publicProfiles/${decodedToken.uid}`).get(),
        db.doc(`adminUserRestrictions/${decodedToken.uid}`).get(),
        requestedRoomId ? db.doc(`rooms/${requestedRoomId}`).get() : Promise.resolve(undefined),
        requestedRoomId ? db.doc(`rooms/${requestedRoomId}/members/${decodedToken.uid}`).get() : Promise.resolve(undefined),
        requestedRoomId ? db.doc(`rooms/${requestedRoomId}/bans/${decodedToken.uid}`).get() : Promise.resolve(undefined),
        requestedRoomId && requestedGameSessionId
          ? db.doc(`rooms/${requestedRoomId}/gameSessions/${requestedGameSessionId}`).get()
          : Promise.resolve(undefined),
        requestedGameSessionId
          ? db.doc('appConfig/voiceRoomFeatures').get()
          : Promise.resolve(undefined),
        db.doc('appConfig/voiceRoomLaunch').get(),
      ]);
      if (!publicProfileSnapshot.exists || publicProfileSnapshot.data()?.moderationStatus !== 'active') {
        response.status(403).json({ error: 'This account is not allowed to join voice rooms.' });
        return;
      }
      const launchAccess = evaluateVoiceRoomLaunchAccess({
        clientVersion: typeof request.body?.clientVersion === 'string' ? request.body.clientVersion.trim() : '',
        countryCode: publicProfileSnapshot.data()?.countryCode,
        decodedToken,
        policy: launchSnapshot.exists ? launchSnapshot.data() : undefined,
        requireClientVersion: true,
      });
      if (!launchAccess.ok) {
        response.status(launchAccess.status).json({
          code: launchAccess.code,
          error: launchAccess.error,
        });
        return;
      }
      const membership = membershipSnapshot?.exists ? membershipSnapshot.data() : undefined;
      const seatId = typeof membership?.seatId === 'string' && /^\d{2}$/.test(membership.seatId)
        ? membership.seatId
        : '';
      const seatSnapshot = seatId
        ? await db.doc(`rooms/${requestedRoomId}/seats/${seatId}`).get()
        : undefined;
      const tokenRequest = requestedGameSessionId
        ? resolveGameTransportTokenRequest({
            ban: banSnapshot?.exists ? banSnapshot.data() : undefined,
            body: request.body,
            decodedToken,
            featureFlags: featureSnapshot?.exists ? featureSnapshot.data() : undefined,
            gameSession: gameSessionSnapshot?.exists ? gameSessionSnapshot.data() : undefined,
            membership,
            profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
            room: roomSnapshot?.exists ? roomSnapshot.data() : undefined,
          })
        : resolveTokenRequest({
            ban: banSnapshot?.exists ? banSnapshot.data() : undefined,
            body: request.body,
            decodedToken,
            membership,
            profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
            room: roomSnapshot?.exists ? roomSnapshot.data() : undefined,
            seat: seatSnapshot?.exists ? seatSnapshot.data() : undefined,
          });

      if (!tokenRequest.ok) {
        console.info('[functions.livekitToken] request:denied', {
          uid: decodedToken.uid,
          requestedRoomId,
          status: tokenRequest.status,
          error: tokenRequest.error,
          hasProfile: profileSnapshot.exists,
          hasRoom: roomSnapshot?.exists === true,
          hasMembership: membershipSnapshot?.exists === true,
          membershipRole: membershipSnapshot?.exists ? membershipSnapshot.data()?.role : '',
          membershipStatus: membershipSnapshot?.exists ? membershipSnapshot.data()?.status : '',
          membershipCanPublishAudio: membershipSnapshot?.exists ? membershipSnapshot.data()?.canPublishAudio : undefined,
        });
        response.status(tokenRequest.status).json({ error: tokenRequest.error });
        return;
      }

      const {
        avatarLabel,
        authorityRole,
        canPublish: membershipCanPublish,
        displayName,
        participantId,
        role,
        roomId,
        seatId: resolvedSeatId,
        gameSessionId,
        sourceRoomId,
        transport,
      } = tokenRequest.value;
      const mutedUntil = restrictionSnapshot.exists ? restrictionSnapshot.data()?.mutedUntil : undefined;
      const isMuted = mutedUntil && typeof mutedUntil.toMillis === 'function' && mutedUntil.toMillis() > Date.now();
      const canPublish = membershipCanPublish && !isMuted;
      const token = new AccessToken(liveKitApiKey.value(), liveKitApiSecret.value(), {
        identity: participantId,
        name: displayName,
        ttl: '1h',
        metadata: JSON.stringify({
          avatarLabel,
          displayName,
          authorityRole,
          role,
          seatId: resolvedSeatId,
          uid: participantId,
          ...(gameSessionId ? { gameSessionId, sourceRoomId, transport } : {}),
        }),
      });

      token.addGrant({
        room: roomId,
        roomJoin: true,
        canSubscribe: true,
        canPublish,
        canPublishData: true,
        canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
      });

      console.info('[functions.livekitToken] request:success', {
        uid: decodedToken.uid,
        roomId,
        role,
        canPublish,
      });
      response.json({
        serverUrl: liveKitUrl.value(),
        token: await token.toJwt(),
        canPublishAudio: canPublish,
        participantId,
        ...(gameSessionId ? { gameSessionId, transportRoomId: roomId } : {}),
      });
    } catch (error) {
      console.error('[functions.livekitToken] request:error', {
        uid: decodedToken?.uid,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(500).json({ error: 'Failed to create LiveKit token.' });
    }
  },
);

exports.roomCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomCommandLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomCommandLaunchAccess)) return;
    const commandBody = normalizeRoomCommandBody(request.body);
    try {
      const db = admin.firestore();
      const httpRateLimit = await consumeVoiceRoomHttpRateLimit({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db,
        fieldValue: admin.firestore.FieldValue,
        requestId: commandBody.requestId,
        surface: 'room-command',
        uid: decodedToken.uid,
      });
      if (!httpRateLimit.ok) {
        response.status(httpRateLimit.status).json({
          code: httpRateLimit.code,
          error: httpRateLimit.error,
          ...(httpRateLimit.details ? { details: httpRateLimit.details } : {}),
        });
        return;
      }
      const result = isValidRoomSeatCommandAction(commandBody.action)
        ? await executeRoomSeatCommand({
          body: request.body,
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db,
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
        })
        : await executeRoomCommand({
          body: request.body,
          db,
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
        });

      if (!result.ok) {
        console.info('[functions.roomCommand] request:denied', {
          action: commandBody.action,
          code: result.code,
          replayed: result.replayed === true,
          roomId: commandBody.roomId,
          targetUid: commandBody.targetUid,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }

      let liveKitSyncStatus = result.result.liveKitSyncStatus;
      if (result.liveKit?.type !== 'none') {
        const roomService = new RoomServiceClient(liveKitUrl.value(), liveKitApiKey.value(), liveKitApiSecret.value());
        try {
          liveKitSyncStatus = await synchronizeRoomCommandLiveKit({
            db,
            fieldValue: admin.firestore.FieldValue,
            liveKit: result.liveKit,
            requestId: result.result.requestId,
            roomId: result.result.roomId,
            roomService,
          });
        } catch (error) {
          console.error('[functions.roomCommand] livekit-sync:pending', {
            action: commandBody.action,
            requestId: result.result.requestId,
            roomId: result.result.roomId,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      console.info('[functions.roomCommand] request:success', {
        action: result.result.action,
        liveKitSyncStatus,
        replayed: result.replayed,
        requestId: result.result.requestId,
        revision: result.result.revision,
        roomId: result.result.roomId,
        uid: decodedToken.uid,
      });
      response.json({
        ok: true,
        replayed: result.replayed,
        result: { ...result.result, liveKitSyncStatus },
      });
    } catch (error) {
      console.error('[functions.roomCommand] request:error', {
        uid: decodedToken?.uid,
        roomId: commandBody.roomId,
        action: commandBody.action,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(500).json({ code: 'COMMAND_FAILED', error: 'Failed to execute room command.' });
    }
  },
);

exports.roomThemeCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomThemeCommand] invalid-token', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }
    const command = normalizeRoomThemeBody(request.body);
    try {
      const result = await executeRoomThemeCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      response.json({ ok: true, replayed: result.replayed === true, result: result.result });
    } catch (error) {
      console.error('[functions.roomThemeCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'ROOM_THEME_FAILED', error: 'Failed to execute room-theme command.' });
    }
  },
);

exports.roomTargetCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomTargetCommand] invalid-token', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }
    try {
      const result = request.body?.action === 'search-roster-users'
        ? await searchRoomTargetRosterUsers({
            db: admin.firestore(),
            decodedToken,
            discoverUsers,
            input: request.body,
          })
        : await prepareNextRoomTargetRoster({
            clock: {
              nowMillis: () => Date.now(),
              timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
            },
            db: admin.firestore(),
            decodedToken,
            fieldValue: admin.firestore.FieldValue,
            input: request.body,
          });
      if (!result.ok) {
        response.status(result.status || 400).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      response.json({ ok: true, replayed: result.replayed === true, result: result.result });
    } catch (error) {
      console.error('[functions.roomTargetCommand] request:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: request.body?.roomId,
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'ROOM_TARGET_FAILED', error: 'Failed to update the Room Target roster.' });
    }
  },
);

exports.roomMediaCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: roomMediaRegion,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomMediaCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomMediaLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomMediaLaunchAccess)) return;
    const command = normalizeRoomMediaCommandBody(request.body);
    try {
      const result = await executeRoomMediaCommand({
        body: request.body,
        bucket: admin.storage().bucket(),
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomMediaCommand] request:denied', {
          action: command.action,
          code: result.code,
          mediaId: command.mediaId,
          roomId: command.roomId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomMediaCommand] request:success', {
        action: result.result.action,
        mediaId: result.result.mediaId,
        replayed: result.replayed,
        requestId: result.result.requestId,
        revision: result.result.revision,
        roomId: result.result.roomId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomMediaCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        mediaId: command.mediaId,
        roomId: command.roomId,
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'ROOM_MEDIA_FAILED', error: 'Failed to execute room media command.' });
    }
  },
);

exports.directChatCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication is required.' });
      return;
    }
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.directChatCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication is invalid.' });
      return;
    }
    const normalized = normalizeDirectChatCommand(request.body, decodedToken.uid);
    try {
      const result = await executeDirectChatCommand({
        body: request.body,
        bucket: admin.storage().bucket(),
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        safetyAdapter: directChatMediaSafetyAdapter,
      });
      if (!result.ok) {
        console.info('[functions.directChatCommand] request:denied', {
          action: normalized.ok ? normalized.value.action : 'invalid',
          code: result.code,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({ code: result.code, error: result.error, messageAr: result.messageAr });
        return;
      }
      console.info('[functions.directChatCommand] request:success', {
        action: result.result.action,
        replayed: result.replayed === true,
        requestId: result.result.requestId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.directChatCommand] request:error', {
        action: normalized.ok ? normalized.value.action : 'invalid',
        errorMessage: error instanceof Error ? error.message : String(error),
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'INTERNAL', error: 'The personal chat request failed.' });
    }
  },
);

exports.roomChatCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: roomChatRegion,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomChatCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomChatLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomChatLaunchAccess)) return;
    const command = normalizeRoomChatBody(request.body);
    try {
      const result = await executeRoomChatCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomChatCommand] request:denied', {
          action: command.action,
          code: result.code,
          messageId: command.messageId,
          roomId: command.roomId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomChatCommand] request:success', {
        action: result.result.action,
        messageId: result.result.messageId,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomChatCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken.uid,
      });
      response.status(500).json({ code: 'ROOM_CHAT_FAILED', error: 'Failed to execute room chat command.' });
    }
  },
);

exports.roomOwnershipCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomOwnershipCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomOwnershipLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomOwnershipLaunchAccess)) return;
    const command = normalizeRoomOwnershipBody(request.body);
    try {
      const result = await executeRoomOwnershipCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomOwnershipCommand] request:denied', {
          action: command.action,
          code: result.code,
          roomId: command.roomId,
          transferId: command.transferId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomOwnershipCommand] request:success', {
        action: result.result.action,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        status: result.result.status,
        transferId: result.result.transferId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomOwnershipCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken?.uid,
      });
      response.status(500).json({
        code: 'ROOM_OWNERSHIP_FAILED',
        error: 'Failed to execute room ownership command.',
      });
    }
  },
);

exports.roomGiftCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomGiftCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomGiftLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomGiftLaunchAccess)) return;
    const command = normalizeRoomGiftBody(request.body);
    try {
      const db = admin.firestore();
      const httpRateLimit = await consumeVoiceRoomHttpRateLimit({
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db,
        fieldValue: admin.firestore.FieldValue,
        requestId: command.requestId,
        surface: 'room-gift',
        uid: decodedToken.uid,
      });
      if (!httpRateLimit.ok) {
        response.status(httpRateLimit.status).json({
          code: httpRateLimit.code,
          error: httpRateLimit.error,
          ...(httpRateLimit.details ? { details: httpRateLimit.details } : {}),
        });
        return;
      }
      const result = await executeRoomGiftCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db,
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomGiftCommand] request:denied', {
          action: command.action,
          code: result.code,
          giftId: command.giftId,
          roomId: command.roomId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomGiftCommand] request:success', {
        action: result.result.action,
        eventId: result.result.eventId,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomGiftCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken?.uid,
      });
      response.status(500).json({
        code: 'ROOM_GIFT_FAILED',
        error: 'Failed to execute room gift command.',
      });
    }
  },
);

exports.roomEntryEffectCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomEntryEffectCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomEntryEffectLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomEntryEffectLaunchAccess)) return;
    const command = normalizeRoomEntryEffectBody(request.body);
    try {
      const result = await executeRoomEntryEffectCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomEntryEffectCommand] request:denied', {
          action: command.action,
          code: result.code,
          roomId: command.roomId,
          sessionId: command.sessionId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomEntryEffectCommand] request:success', {
        action: result.result.action,
        announced: result.result.announced,
        eventId: result.result.eventId,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        skipped: result.result.skipped,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomEntryEffectCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken?.uid,
      });
      response.status(500).json({
        code: 'ROOM_ENTRY_EFFECT_FAILED',
        error: 'Failed to execute room entry-effect command.',
      });
    }
  },
);

exports.roomGameCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomGameCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomGameLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomGameLaunchAccess)) return;
    const command = normalizeRoomGameBody(request.body);
    try {
      const result = await executeRoomGameCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomGameCommand] request:denied', {
          action: command.action,
          code: result.code,
          gameId: command.gameId,
          roomId: command.roomId,
          sessionId: command.sessionId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }
      console.info('[functions.roomGameCommand] request:success', {
        action: result.result.action,
        gameId: result.result.session?.gameId || command.gameId,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        sessionId: result.result.sessionId,
        uid: decodedToken.uid,
      });
      response.json(result);
    } catch (error) {
      console.error('[functions.roomGameCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken?.uid,
      });
      response.status(500).json({
        code: 'ROOM_GAME_FAILED',
        error: 'Failed to execute room game command.',
      });
    }
  },
);

exports.roomMusicCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomMusicCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const roomMusicLaunchAccess = await resolveVoiceRoomHttpLaunchAccess(
      admin.firestore(), decodedToken, request);
    if (!sendVoiceRoomLaunchDenial(response, roomMusicLaunchAccess)) return;
    const command = normalizeRoomMusicBody(request.body);
    try {
      const result = await executeRoomMusicCommand({
        body: request.body,
        clock: {
          nowMillis: () => Date.now(),
          timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
        },
        db: admin.firestore(),
        decodedToken,
        fieldValue: admin.firestore.FieldValue,
      });
      if (!result.ok) {
        console.info('[functions.roomMusicCommand] request:denied', {
          action: command.action,
          code: result.code,
          leaseId: command.leaseId,
          roomId: command.roomId,
          trackId: command.trackId,
          uid: decodedToken.uid,
        });
        response.status(result.status).json({
          code: result.code,
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        });
        return;
      }

      let liveKitSyncStatus = 'not-required';
      if (result.liveKit && result.liveKit.type !== 'none') {
        try {
          const roomService = new RoomServiceClient(
            liveKitUrl.value(),
            liveKitApiKey.value(),
            liveKitApiSecret.value(),
          );
          const sync = await applyRoomMusicLiveKit(roomService, command.roomId, result.liveKit);
          liveKitSyncStatus = sync.status;
        } catch (error) {
          liveKitSyncStatus = 'failed';
          console.error('[functions.roomMusicCommand] livekit-sync:failed', {
            errorMessage: error instanceof Error ? error.message : String(error),
            roomId: command.roomId,
            uid: decodedToken.uid,
          });
        }
      }

      console.info('[functions.roomMusicCommand] request:success', {
        action: result.result.action,
        leaseId: result.result.leaseId || command.leaseId,
        liveKitSyncStatus,
        replayed: result.replayed,
        requestId: result.result.requestId,
        roomId: result.result.roomId,
        uid: decodedToken.uid,
      });
      response.json({ ...result, liveKitSyncStatus });
    } catch (error) {
      console.error('[functions.roomMusicCommand] request:error', {
        action: command.action,
        errorMessage: error instanceof Error ? error.message : String(error),
        roomId: command.roomId,
        uid: decodedToken?.uid,
      });
      response.status(500).json({
        code: 'ROOM_MUSIC_FAILED',
        error: 'Failed to execute room music command.',
      });
    }
  },
);

exports.roomRecordingCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }
    const idToken = extractBearerToken(request.headers);
    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('[functions.roomRecordingCommand] authentication:error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    response.status(410).json({
      code: 'RECORDING_REJECTED',
      error: 'Room recording was rejected and is unavailable.',
    });
  },
);

exports.retryRoomLiveKitSync = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await retryPendingRoomLiveKitSync({
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      roomService: new RoomServiceClient(liveKitUrl.value(), liveKitApiKey.value(), liveKitApiSecret.value()),
    });
    console.info('[functions.retryRoomLiveKitSync] complete', result);
  },
);

exports.cleanupRoomMediaUploads = onSchedule(
  {
    region: roomMediaRegion,
    schedule: 'every 6 hours',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupOrphanedRoomMedia({
      bucket: admin.storage().bucket(),
      db: admin.firestore(),
    });
    console.info('[functions.cleanupRoomMediaUploads] complete', result);
  },
);

exports.cleanupCosmeticSubmissions = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 24 hours',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    );
    const purged = await cleanupExpiredCosmeticSubmissions({
      bucket: admin.storage().bucket(),
      cutoff,
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.cleanupCosmeticSubmissions] complete', {
      purged: purged.length,
    });
  },
);

exports.cleanupRoomChatMessages = onSchedule(
  {
    region: roomChatRegion,
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupExpiredRoomChatMessages({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupRoomChatMessages] complete', result);
  },
);

exports.expireDirectMessageRequests = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await expirePendingDirectMessageRequests({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.expireDirectMessageRequests] complete', result);
  },
);

exports.cleanupDirectChatCommands = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 24 hours',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupDirectChatCommands({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupDirectChatCommands] complete', result);
  },
);

exports.cleanupDirectChatUploads = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupDirectChatUploads({
      bucket: admin.storage().bucket(),
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupDirectChatUploads] complete', result);
  },
);

exports.cleanupRoomEntryEffects = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupExpiredRoomEntryEffectRecords({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupRoomEntryEffects] complete', result);
  },
);

exports.cleanupRoomGames = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 5 minutes',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const expired = await expireRoomGameSessions({ db });
    const cleaned = await cleanupExpiredRoomGameRecords({ db });
    console.info('[functions.cleanupRoomGames] complete', { cleaned, expired });
  },
);

exports.cleanupRoomMusic = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const expired = await expireRoomMusicLeases({ db });
    const cleaned = await cleanupExpiredRoomMusicRecords({ db });
    console.info('[functions.cleanupRoomMusic] complete', { cleaned, expired });
  },
);

exports.cleanupRoomRecordingEvidence = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const evidence = await cleanupExpiredRoomEvidence({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    const segments = await cleanupUnreportedRecordingSegments({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupRoomRecordingEvidence] complete', { evidence, segments });
  },
);

exports.cleanupVoiceRoomHardening = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await cleanupVoiceRoomHardeningArtifacts({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
    });
    console.info('[functions.cleanupVoiceRoomHardening] complete', result);
  },
);

exports.expireRoomOwnershipOffers = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await expireRoomOwnershipTransfers({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.expireRoomOwnershipOffers] complete', result);
  },
);

exports.finalizeRemovedRooms = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 24 hours',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const result = await finalizeRemovedRooms({
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    });
    console.info('[functions.finalizeRemovedRooms] complete', result);
  },
);

exports.recoverVoiceRoomSeats = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Baghdad',
  },
  async () => {
    const featureSnapshot = await admin.firestore().doc('appConfig/voiceRoomFeatures').get();
    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : {};
    if (
      featureFlags?.voice_room_v2_mutations !== true ||
      featureFlags?.voice_room_seats !== true
    ) {
      console.info('[functions.recoverVoiceRoomSeats] skipped', { reason: 'feature-disabled' });
      return;
    }
    const dependencies = {
      clock: {
        nowMillis: () => Date.now(),
        timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
      },
      db: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
    };
    const stalePresence = await recoverStaleRoomPresence(dependencies);
    const expiredSeats = await recoverExpiredRoomSeats(dependencies);
    const expiredOffers = await expireRoomSeatOffers(dependencies);
    const counts = await reconcileRoomPresenceCounts(dependencies);
    console.info('[functions.recoverVoiceRoomSeats] complete', { counts, expiredOffers, expiredSeats, stalePresence });
  },
);

exports.adminDashboard = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    const requestStartedAt = Date.now();
    const requestedAction = typeof request.body?.action === 'string' ? request.body.action.trim().slice(0, 80) : '';
    const rawRequestId = request.headers['x-admin-request-id'];
    const requestId = typeof rawRequestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(rawRequestId) ? rawRequestId : 'server-unassigned';
    let decodedToken;
    response.set('Cache-Control', 'no-store, max-age=0');
    response.set('Pragma', 'no-cache');
    response.set('Referrer-Policy', 'no-referrer');
    response.set('X-Admin-Request-Id', requestId);
    response.set('X-Content-Type-Options', 'nosniff');
    response.on('finish', () => {
      const log = {
        action: requestedAction || 'unknown',
        actorUid: decodedToken?.uid || '',
        durationMs: Date.now() - requestStartedAt,
        requestId,
        status: response.statusCode,
      };
      if (response.statusCode >= 500) console.error('[functions.adminDashboard] request:failed', log);
      else console.info('[functions.adminDashboard] request:complete', log);
    });
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken, true);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const dashboardRequest = resolveAdminDashboardRequest({
      body: request.body,
      decodedToken,
    });

    if (!dashboardRequest.ok) {
      response.status(dashboardRequest.status).json({ error: dashboardRequest.error });
      return;
    }

    const dashboardDb = admin.firestore();
    let operatorScope = {
      ok: true,
      regionCodes: null,
      role: dashboardRequest.value.role,
    };
    if (dashboardRequest.value.role === 'super-moderator') {
      const [operatorProfileSnapshot, featureFlagsSnapshot] = await Promise.all([
        dashboardDb.doc(`adminProfiles/${decodedToken.uid}`).get(),
        dashboardDb.doc('appConfig/voiceRoomFeatures').get(),
      ]);
      if (featureFlagsSnapshot.data()?.voice_room_super_moderation !== true) {
        response.status(503).json({
          code: 'FEATURE_DISABLED',
          error: 'Super Moderator operations are not enabled.',
        });
        return;
      }
      operatorScope = resolveOperatorRegionScope(
        decodedToken,
        operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
      );
      if (!operatorScope.ok) {
        response.status(operatorScope.status).json({ error: operatorScope.error });
        return;
      }
    }

    if (dashboardRequest.value.action === 'voice-room-launch-status') {
      try {
        const [featureSnapshot, launchSnapshot] = await Promise.all([
          dashboardDb.doc('appConfig/voiceRoomFeatures').get(),
          dashboardDb.doc('appConfig/voiceRoomLaunch').get(),
        ]);
        response.json({
          action: dashboardRequest.value.action,
          ok: true,
          readiness: summarizeLaunchReadiness(
            featureSnapshot.exists ? featureSnapshot.data() : {},
            { policy: launchSnapshot.exists ? launchSnapshot.data() : {} },
          ),
        });
      } catch (error) {
        console.error('Failed to resolve voice-room launch status:', error);
        response.status(500).json({ error: 'Failed to resolve voice-room launch status.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'overview') {
      try {
        const overview = await resolveAdminOverview(dashboardDb, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          overview,
        });
      } catch (error) {
        console.error('Failed to resolve admin overview:', error);
        response.status(500).json({ error: 'Failed to resolve admin overview.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'audit-events') {
      try {
        const auditPage = await resolveAdminAuditEvents(dashboardDb, request.body, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          auditEvents: auditPage.items,
          pageInfo: auditPage.pageInfo,
        });
      } catch (error) {
        console.error('Failed to resolve admin audit events:', error);
        response.status(500).json({ error: 'Failed to resolve admin audit events.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'audit-summary') {
      try {
        response.json({ ok: true, action: dashboardRequest.value.action, summary: await resolveAdminAuditSummary(dashboardDb, operatorScope) });
      } catch (error) {
        console.error('Failed to resolve audit summary:', error);
        response.status(500).json({ error: 'Failed to resolve audit summary.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'audit-detail') {
      const lookup = normalizeAdminAuditLookup(request.body);
      if (!lookup.ok) { response.status(lookup.status).json({ error: lookup.error }); return; }
      try {
        response.json({ ok: true, action: dashboardRequest.value.action, detail: await resolveAdminAuditDetail(dashboardDb, lookup.value.eventId, operatorScope) });
      } catch (error) {
        const status = error?.status || 500;
        response.status(status).json({ error: status >= 500 ? 'Failed to resolve audit detail.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'audit-export') {
      try {
        response.json({ ok: true, action: dashboardRequest.value.action, export: await resolveAdminAuditExport(dashboardDb, request.body, operatorScope) });
      } catch (error) {
        console.error('Failed to export audit events:', error);
        response.status(500).json({ error: 'Failed to export audit events.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'admin-settings') {
      try {
        const settings = await resolveAdminSettings(admin.firestore(), admin.auth(), decodedToken);
        response.json({ ok: true, action: dashboardRequest.value.action, settings });
      } catch (error) {
        console.error('Failed to resolve administrator settings:', error);
        response.status(500).json({ error: 'Failed to resolve administrator settings.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'client-error') {
      const clientError = normalizeAdminClientError(request.body);
      if (!clientError.ok) { response.status(clientError.status).json({ error: clientError.error }); return; }
      try {
        const eventId = await recordAdminClientError(admin.firestore(), decodedToken, clientError.value);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        const status = error?.status || 500;
        response.status(status).json({ error: status >= 500 ? 'Failed to record the dashboard failure.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'admin-settings-update') {
      const settingsUpdate = normalizeAdminSettingsUpdate(request.body);
      if (!settingsUpdate.ok) { response.status(settingsUpdate.status).json({ error: settingsUpdate.error }); return; }
      try {
        const eventId = await executeAdminSettingsUpdate(admin.firestore(), decodedToken, settingsUpdate.value);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        const status = error?.status || 500;
        response.status(status).json({ error: status >= 500 ? 'Failed to update administrator settings.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'administrator-action') {
      const administratorAction = normalizeAdministratorAction(request.body);
      if (!administratorAction.ok) { response.status(administratorAction.status).json({ error: administratorAction.error }); return; }
      try {
        const result = await executeAdministratorAction(admin.firestore(), admin.auth(), decodedToken, administratorAction.value);
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error?.status || 500;
        if (status >= 500) console.error('Failed to execute administrator action:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to execute administrator action.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'feature-flag-update') {
      const flagUpdate = normalizeAdminFeatureFlagUpdate(request.body);
      if (!flagUpdate.ok) { response.status(flagUpdate.status).json({ error: flagUpdate.error }); return; }
      try {
        const result = await executeAdminFeatureFlagUpdate(admin.firestore(), decodedToken, flagUpdate.value);
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error?.status || 500;
        response.status(status).json({ error: status >= 500 ? 'Failed to update feature flag.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-gift-policy-update') {
      const policyUpdate = normalizeRoomGiftPolicyUpdate(request.body);
      if (!policyUpdate.ok) {
        response.status(policyUpdate.status).json({ error: policyUpdate.error });
        return;
      }
      try {
        const result = await updateRoomGiftPolicy({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: policyUpdate.value,
        });
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          eventId: result.eventId,
        });
      } catch (error) {
        const status = error?.status || 500;
        response.status(status).json({
          error: status >= 500 ? 'Failed to update the room gift commission.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'users') {
      try {
        const userPage = await resolveAdminUsers(dashboardDb, request.body, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          pageInfo: userPage.pageInfo,
          users: userPage.items,
        });
      } catch (error) {
        console.error('Failed to resolve admin users:', error);
        response.status(500).json({ error: 'Failed to resolve admin users.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-summary') {
      try {
        const summary = await resolveAdminUserSummary(dashboardDb, operatorScope);
        response.json({ ok: true, action: dashboardRequest.value.action, summary });
      } catch (error) {
        console.error('Failed to resolve admin user summary:', error);
        response.status(500).json({ error: 'Failed to resolve admin user summary.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-detail') {
      const lookup = normalizeAdminUserLookup(request.body);
      if (!lookup.ok) { response.status(lookup.status).json({ error: lookup.error }); return; }
      try {
        const detail = await resolveAdminUserDetail(dashboardDb, admin.auth(), lookup.value.targetUid);
        const scopeCheck = assertUserInOperatorScope(operatorScope, detail.profile);
        if (!scopeCheck.ok) {
          response.status(scopeCheck.status).json({ error: scopeCheck.error, code: scopeCheck.code });
          return;
        }
        response.json({ ok: true, action: dashboardRequest.value.action, detail });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to resolve admin user detail:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to resolve admin user detail.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-history') {
      const historyQuery = normalizeAdminUserHistoryQuery(request.body);
      if (!historyQuery.ok) { response.status(historyQuery.status).json({ error: historyQuery.error }); return; }
      try {
        await assertUserTargetAccess(dashboardDb, operatorScope, historyQuery.value.targetUid);
        const page = await resolveAdminUserHistoryPage(dashboardDb, historyQuery.value);
        response.json({ ok: true, action: dashboardRequest.value.action, items: page.items, pageInfo: page.pageInfo, section: historyQuery.value.section });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to resolve admin user history:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to resolve admin user history.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-action') {
      const userAction = normalizeAdminUserAction(request.body);
      if (!userAction.ok) { response.status(userAction.status).json({ error: userAction.error }); return; }
      try {
        const eventId = await executeAdminUserAction(dashboardDb, admin.auth(), decodedToken, userAction.value, operatorScope);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to execute admin user action:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to execute admin user action.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'rooms') {
      try {
        const roomPage = await resolveAdminRooms(dashboardDb, request.body, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          pageInfo: roomPage.pageInfo,
          rooms: roomPage.items,
        });
      } catch (error) {
        console.error('Failed to resolve admin rooms:', error);
        response.status(500).json({ error: 'Failed to resolve admin rooms.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-summary') {
      try {
        const summary = await resolveAdminRoomSummary(dashboardDb, operatorScope);
        response.json({ ok: true, action: dashboardRequest.value.action, summary });
      } catch (error) {
        console.error('Failed to resolve admin room summary:', error);
        response.status(500).json({ error: 'Failed to resolve admin room summary.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-detail') {
      const lookup = normalizeAdminRoomLookup(request.body);
      if (!lookup.ok) { response.status(lookup.status).json({ error: lookup.error }); return; }
      try {
        const detail = await resolveAdminRoomDetail(dashboardDb, lookup.value.roomId);
        const scopeCheck = assertRoomInOperatorScope(operatorScope, detail.room);
        if (!scopeCheck.ok) {
          response.status(scopeCheck.status).json({ error: scopeCheck.error, code: scopeCheck.code });
          return;
        }
        response.json({ ok: true, action: dashboardRequest.value.action, detail });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to resolve admin room detail:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to resolve admin room detail.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'reports') {
      try {
        const reportPage = await resolveAdminReports(dashboardDb, request.body, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          pageInfo: reportPage.pageInfo,
          reports: reportPage.items,
        });
      } catch (error) {
        console.error('Failed to resolve admin reports:', error);
        response.status(500).json({ error: 'Failed to resolve admin reports.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'report-summary') {
      try {
        const summary = await resolveAdminReportSummary(dashboardDb, operatorScope);
        response.json({ ok: true, action: dashboardRequest.value.action, summary });
      } catch (error) {
        console.error('Failed to resolve admin report summary:', error);
        response.status(500).json({ error: 'Failed to resolve admin report summary.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'report-detail') {
      const reportLookup = normalizeAdminReportLookup(request.body);
      if (!reportLookup.ok) {
        response.status(reportLookup.status).json({ error: reportLookup.error });
        return;
      }
      try {
        const detail = await resolveAdminReportDetail(dashboardDb, reportLookup.value.reportId, operatorScope, decodedToken);
        response.json({ ok: true, action: dashboardRequest.value.action, detail });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to resolve admin report detail:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to resolve admin report detail.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'administrators') {
      try {
        const administrators = await resolveAdminAdministrators(admin.auth(), admin.firestore());
        response.json({ ok: true, action: dashboardRequest.value.action, administrators });
      } catch (error) {
        console.error('Failed to resolve administrators:', error);
        response.status(500).json({ error: 'Failed to resolve administrators.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'store-catalog') {
      try {
        const page = await resolveAdminStoreCatalog(admin.firestore(), request.body);
        response.json({ ok: true, action: dashboardRequest.value.action, storeCatalog: page.items, pageInfo: page.pageInfo });
      } catch (error) {
        console.error('Failed to resolve admin store catalog:', error);
        response.status(500).json({ error: 'Failed to resolve admin store catalog.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'gift-catalog') {
      try {
        const page = await resolveAdminGiftCatalog(admin.firestore(), request.body);
        response.json({ ok: true, action: dashboardRequest.value.action, gifts: page.items, pageInfo: page.pageInfo });
      } catch (error) {
        console.error('Failed to resolve admin gift catalog:', error);
        response.status(500).json({ error: 'Failed to resolve gift catalog.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'special-id-catalog') {
      try {
        const page = await resolveAdminSpecialIdCatalog(admin.firestore(), request.body);
        response.json({ ok: true, action: dashboardRequest.value.action, specialIds: page.items, pageInfo: page.pageInfo });
      } catch (error) {
        console.error('Failed to resolve admin special ID catalog:', error);
        response.status(500).json({ error: 'Failed to resolve special ID catalog.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'economy-history') {
      try {
        const page = await resolveAdminEconomyHistory(admin.firestore(), request.body);
        response.json({ ok: true, action: dashboardRequest.value.action, transactions: page.items, pageInfo: page.pageInfo });
      } catch (error) {
        console.error('Failed to resolve economy history:', error);
        response.status(500).json({ error: 'Failed to resolve economy history.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'economy-export') {
      const exportInput = normalizeAdminEconomyExport(request.body);
      if (!exportInput.ok) {
        response.status(exportInput.status).json({ error: exportInput.error });
        return;
      }
      try {
        const exportResult = await resolveAdminEconomyExport(admin.firestore(), decodedToken, exportInput.value);
        response.json({ ok: true, action: dashboardRequest.value.action, export: exportResult });
      } catch (error) {
        console.error('Failed to export economy history:', error);
        response.status(500).json({ error: 'Failed to export economy history.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'store-item-detail') {
      const lookup = normalizeAdminStoreItemLookup(request.body);
      if (!lookup.ok) {
        response.status(lookup.status).json({ error: lookup.error });
        return;
      }
      try {
        const detail = await resolveAdminStoreItemDetail(admin.firestore(), lookup.value.itemId);
        if (!detail) response.status(404).json({ error: 'Store item was not found.' });
        else response.json({ ok: true, action: dashboardRequest.value.action, detail });
      } catch (error) {
        console.error('Failed to resolve store item detail:', error);
        response.status(500).json({ error: 'Failed to resolve store item detail.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'store-summary') {
      try {
        response.json({ ok: true, action: dashboardRequest.value.action, summary: await resolveAdminStoreSummary(admin.firestore()) });
      } catch (error) {
        console.error('Failed to resolve store summary:', error);
        response.status(500).json({ error: 'Failed to resolve store summary.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'store-catalog-upsert') {
      const catalogInput = normalizeAdminStoreCatalogInput(request.body);
      if (!catalogInput.ok) {
        response.status(catalogInput.status).json({ error: catalogInput.error });
        return;
      }
      try {
        const result = await executeAdminStoreCatalogUpsert({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: catalogInput.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to update admin store catalog:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to update store catalog.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'cosmetic-assets') {
      const query = normalizeAdminCosmeticsAssetQuery(request.body);
      if (!query.ok) {
        response.status(query.status).json({ error: query.error });
        return;
      }
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          registry: await getAdminCosmeticsAssets({
            db: admin.firestore(),
            input: query.value,
          }),
        });
      } catch (error) {
        console.error('Failed to load cosmetics asset registry:', error);
        response.status(500).json({ error: 'Failed to load cosmetics asset registry.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'cosmetic-assets-mutate') {
      const mutation = normalizeAdminCosmeticsAssetMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminCosmeticsAsset({
          bucket: admin.storage().bucket(),
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to mutate cosmetics asset:', error);
        response.status(status).json({
          error: status >= 500 ? 'Failed to mutate cosmetics asset.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-theme') {
      const lookup = normalizeAdminRoomThemeLookup(request.body);
      if (!lookup.ok) {
        response.status(lookup.status).json({ error: lookup.error });
        return;
      }
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          theme: await getAdminRoomTheme({ db: admin.firestore(), themeId: lookup.value.themeId }),
        });
      } catch (error) {
        console.error('Failed to load room theme:', error);
        response.status(500).json({ error: 'Failed to load room theme.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-theme-mutate') {
      const mutation = normalizeAdminRoomThemeMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminRoomTheme({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to mutate room theme:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to mutate room theme.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'daily-login-campaign') {
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          dailyLoginCampaign: await getAdminDailyLoginCampaign({
            clock: { nowMillis: () => Date.now() },
            db: admin.firestore(),
          }),
        });
      } catch (error) {
        console.error('Failed to load Daily Login campaign:', error);
        response.status(500).json({ error: 'Failed to load Daily Login campaign.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'daily-login-campaign-mutate') {
      const mutation = normalizeAdminDailyLoginMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminDailyLoginCampaign({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to mutate Daily Login campaign:', error);
        response.status(status).json({
          error: status >= 500 ? 'Failed to mutate Daily Login campaign.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'rocket-campaign') {
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          rocketCampaign: await getAdminRoomRocketCampaign({ db: admin.firestore() }),
        });
      } catch (error) {
        console.error('Failed to load Rocket campaign:', error);
        response.status(500).json({ error: 'Failed to load Rocket campaign.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'weekly-incentive-integrity') {
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          integrity: await getAdminWeeklyIncentiveIntegrity({
            clock: { nowMillis: () => Date.now() },
            db: admin.firestore(),
          }),
        });
      } catch (error) {
        console.error('Failed to load weekly incentive integrity:', error);
        response.status(500).json({ error: 'Failed to load incentive integrity.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'weekly-incentive-integrity-mutate') {
      const mutation = normalizeAdminWeeklyIncentiveIntegrityMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminWeeklyIncentiveIntegrity({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to review incentive integrity:', error);
        response.status(status).json({ error: status >= 500 ? 'Failed to review incentive integrity.' : error.message });
      }
      return;
    }

    if (dashboardRequest.value.action === 'weekly-incentive-reconcile') {
      const reconciliation = normalizeAdminWeeklyIncentiveReconciliation(request.body);
      if (!reconciliation.ok) {
        response.status(reconciliation.status).json({ error: reconciliation.error });
        return;
      }
      try {
        const result = await processWeeklyIncentiveReconciliationBatch({
          ...reconciliation.value,
          db: admin.firestore(),
          documentIdField: admin.firestore.FieldPath.documentId(),
          fieldValue: admin.firestore.FieldValue,
        });
        if (reconciliation.value.apply) {
          await admin.firestore().doc(`adminAuditEvents/integrity_reconcile_${reconciliation.value.requestId}`).set({
            action: 'weekly-incentive-reconcile-apply',
            actorEmail: decodedToken.email || '',
            actorRole: decodedToken.adminRole || '',
            actorUid: decodedToken.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            entityId: reconciliation.value.requestId,
            entityType: 'system',
            id: `integrity_reconcile_${reconciliation.value.requestId}`,
            kind: 'weekly-incentive-integrity',
            note: reconciliation.value.reason,
            status: 'completed',
            summary: result.summary,
          }, { merge: false });
        }
        response.json({ ok: true, action: dashboardRequest.value.action, reconciliation: result });
      } catch (error) {
        console.error('Failed to reconcile weekly incentives:', error);
        response.status(500).json({ error: 'Failed to reconcile weekly incentives.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-target-campaign') {
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          roomTargetCampaign: await getAdminRoomTargetCampaign({ db: admin.firestore() }),
        });
      } catch (error) {
        console.error('Failed to load Room Target campaign:', error);
        response.status(500).json({ error: 'Failed to load Room Target campaign.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'attendance-shadow') {
      const targetUid = typeof request.body?.targetUid === 'string'
        ? request.body.targetUid.trim()
        : '';
      if (!targetUid || targetUid.length > 128 || targetUid.includes('/')) {
        response.status(400).json({ error: 'A valid targetUid is required.' });
        return;
      }
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          attendance: await getAttendanceShadowReport({
            clock: {
              nowMillis: () => Date.now(),
              timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
            },
            db: admin.firestore(),
            uid: targetUid,
          }),
        });
      } catch (error) {
        console.error('Failed to load attendance shadow report:', error);
        response.status(500).json({ error: 'Failed to load attendance shadow report.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'payroll-overview') {
      try {
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          payroll: await getAdminPayroll({
            clock: {
              nowMillis: () => Date.now(),
              timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
            },
            db: admin.firestore(),
          }),
        });
      } catch (error) {
        console.error('Failed to load payroll overview:', error);
        response.status(500).json({ error: 'Failed to load payroll overview.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'payroll-mutate') {
      const mutation = normalizePayrollAdminMutation(request.body);
      if (!mutation.ok) {
        response.status(400).json({ error: `Invalid payroll operation (${mutation.code}).` });
        return;
      }
      try {
        const result = await mutateAdminPayroll({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        const conflicts = ['NEXT_CYCLE_REQUIRED', 'REVISION_CONFLICT', 'REQUEST_ID_CONFLICT'];
        const missing = ['ENROLLMENT_NOT_FOUND', 'PLAN_NOT_FOUND', 'PROFILE_NOT_FOUND'];
        if (result.errorCode) {
          response.status(conflicts.includes(result.errorCode) ? 409 : missing.includes(result.errorCode) ? 404 : 400)
            .json({ code: result.errorCode, error: result.errorCode });
          return;
        }
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        console.error('Failed to mutate payroll:', error);
        response.status(500).json({ error: 'Failed to update payroll.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'attendance-outage-mutate') {
      const mutation = normalizeAttendanceOutageMutation(request.body);
      if (!mutation.ok) {
        response.status(400).json({ error: 'A valid outage window and audit reason are required.' });
        return;
      }
      try {
        const result = await mutateAttendanceOutageWindow({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        if (result.errorCode === 'OUTAGE_NOT_FOUND') {
          response.status(404).json({ error: 'Attendance outage window was not found.' });
          return;
        }
        if (result.errorCode) throw new Error(result.errorCode);
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        console.error('Failed to mutate attendance outage window:', error);
        response.status(500).json({ error: 'Failed to update attendance outage window.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'rocket-campaign-mutate') {
      const mutation = normalizeAdminRoomRocketMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminRoomRocketCampaign({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to mutate Rocket campaign:', error);
        response.status(status).json({
          error: status >= 500 ? 'Failed to mutate Rocket campaign.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-target-campaign-mutate') {
      const mutation = normalizeAdminRoomTargetMutation(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminRoomTargetCampaign({
          clock: {
            nowMillis: () => Date.now(),
            timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
          },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to mutate Room Target campaign:', error);
        response.status(status).json({
          error: status >= 500 ? 'Failed to mutate Room Target campaign.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-target-member-hold') {
      const mutation = normalizeAdminRoomTargetMemberHold(request.body);
      if (!mutation.ok) {
        response.status(mutation.status).json({ error: mutation.error });
        return;
      }
      try {
        const result = await mutateAdminRoomTargetMemberHold({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: mutation.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, ...result });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error('Failed to update Room Target member hold:', error);
        response.status(status).json({
          error: status >= 500 ? 'Failed to update Room Target member hold.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'report-action') {
      const reportAction = normalizeAdminReportAction(request.body);

      if (!reportAction.ok) {
        response.status(reportAction.status).json({ error: reportAction.error });
        return;
      }

      try {
        const eventId = await executeAdminReportAction(dashboardDb, decodedToken, reportAction.value, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          eventId,
        });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;

        if (status >= 500) {
          console.error('Failed to execute admin report action:', error);
        }

        response.status(status).json({
          error: status >= 500 ? 'Failed to execute admin report action.' : error.message,
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'room-action') {
      const roomAction = normalizeAdminRoomAction(request.body);

      if (!roomAction.ok) {
        response.status(roomAction.status).json({ error: roomAction.error });
        return;
      }

      try {
        const eventId = await executeAdminRoomAction(dashboardDb, decodedToken, roomAction.value, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          eventId,
        });
      } catch (error) {
        const status = error && Number.isInteger(error.status) ? error.status : 500;

        if (status >= 500) {
          console.error('Failed to execute admin room action:', error);
        }

        response.status(status).json({
          error: status >= 500 ? 'Failed to execute admin room action.' : error.message,
          ...(error && error.code ? { code: error.code } : {}),
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-note') {
      const note = normalizeAdminUserNote(request.body);

      if (!note.ok) {
        response.status(note.status).json({ error: note.error });
        return;
      }

      try {
        await assertUserTargetAccess(dashboardDb, operatorScope, note.value.targetUid);
        const noteId = await createAdminUserNote(dashboardDb, decodedToken, note.value, operatorScope);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          noteId,
        });
      } catch (error) {
        console.error('Failed to create admin user note:', error);
        response.status(500).json({ error: 'Failed to create admin user note.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'couple-dissolve') {
      const dissolution = normalizeAdminCoupleDissolve(request.body);
      if (!dissolution.ok) { response.status(dissolution.status).json({ error: dissolution.error }); return; }
      try {
        await assertUserTargetAccess(dashboardDb, operatorScope, dissolution.value.targetUid);
        const eventId = await executeAdminCoupleDissolve(dashboardDb, decodedToken, dissolution.value, operatorScope);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to dissolve couple.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'wallet-credit') {
      const credit = normalizeAdminWalletCreditInput(request.body);
      if (!credit.ok) { response.status(400).json({ error: credit.error }); return; }
      try {
        const eventId = await executeAdminWalletCredit({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: credit.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to credit wallet.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'wallet-adjust') {
      const adjustment = normalizeAdminWalletAdjustmentInput(request.body);
      if (!adjustment.ok) { response.status(400).json({ error: adjustment.error }); return; }
      try {
        const eventId = await executeAdminWalletAdjustment({
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: adjustment.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to adjust wallet.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-update') {
      const representative = normalizeAdminRepresentativeInput(request.body);
      if (!representative.ok) { response.status(400).json({ error: representative.error }); return; }
      try {
        const eventId = await executeAdminRepresentativeUpdate({ db: admin.firestore(), decodedToken, fieldValue: admin.firestore.FieldValue, input: representative.value });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to update representative permissions.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-operations') {
      const query = normalizeRepresentativeOperationsQuery(request.body);
      if (!query.ok) { response.status(400).json({ error: query.error }); return; }
      try {
        const operations = await resolveRepresentativeOperations({
          db: admin.firestore(),
          publicReference: query.value.publicReference,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, operations });
      } catch (error) {
        console.error('[functions.adminDashboard] representative-operations:error', error);
        response.status(500).json({ error: 'Failed to load representative operations.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-policy-update') {
      const policy = normalizeAdminRepresentativePolicyInput(request.body);
      if (!policy.ok) { response.status(400).json({ error: policy.error }); return; }
      try {
        const eventId = await executeRepresentativePolicyUpdate({
          db: admin.firestore(), decodedToken, fieldValue: admin.firestore.FieldValue, input: policy.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to update representative policy.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-override-update') {
      const override = normalizeAdminRepresentativeOverrideInput(request.body);
      if (!override.ok) { response.status(400).json({ error: override.error }); return; }
      try {
        const eventId = await executeRepresentativeOverrideUpdate({
          db: admin.firestore(), decodedToken, fieldValue: admin.firestore.FieldValue, input: override.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to update representative limits.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-pin-reset') {
      const pinReset = normalizeAdminRepresentativePinResetInput(request.body);
      if (!pinReset.ok) { response.status(400).json({ error: pinReset.error }); return; }
      try {
        const eventId = await executeRepresentativePinReset({
          db: admin.firestore(), decodedToken, fieldValue: admin.firestore.FieldValue, input: pinReset.value,
        });
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to require a representative PIN reset.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'representative-reversal') {
      const reversal = normalizeAdminRepresentativeReversalInput(request.body);
      if (!reversal.ok) { response.status(400).json({ error: reversal.error }); return; }
      try {
        const result = await reverseRepresentativeTransfer({
          clock: { nowMillis: () => Date.now() },
          db: admin.firestore(),
          decodedToken,
          fieldValue: admin.firestore.FieldValue,
          input: reversal.value,
        });
        const notifications = await Promise.allSettled(
          buildRepresentativeReversalNotificationCommands(result, reversal.value.requestId)
            .map((command) => deliverSocialNotification({
              ...command,
              db: admin.firestore(),
              fieldValue: admin.firestore.FieldValue,
            })),
        );
        notifications.forEach((notification, index) => {
          if (notification.status === 'rejected') {
            console.error('[functions.adminDashboard] representative-reversal-notification:error', {
              index,
              publicReference: result.publicReference,
              requestId: reversal.value.requestId,
            });
          }
        });
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          eventId: result.eventId,
          publicReference: result.publicReference,
          status: result.status,
        });
      } catch (error) {
        response.status(error?.status || 500).json({
          code: error?.code || 'INTERNAL',
          error: error?.message || 'Failed to reverse representative transfer.',
        });
      }
      return;
    }

    if (dashboardRequest.value.action === 'special-id-upsert') {
      const item = normalizeAdminSpecialIdInput(request.body);
      if (!item.ok) { response.status(400).json({ error: item.error }); return; }
      try {
        const eventId = await executeAdminSpecialIdUpsert(admin.firestore(), decodedToken, item.value);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to update special ID catalog.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'gift-catalog-upsert') {
      const gift = normalizeAdminGiftCatalogInput(request.body);
      if (!gift.ok) { response.status(400).json({ error: gift.error }); return; }
      try {
        const eventId = await executeAdminGiftCatalogUpsert(admin.firestore(), decodedToken, gift.value);
        response.json({ ok: true, action: dashboardRequest.value.action, eventId });
      } catch (error) {
        response.status(error?.status || 500).json({ error: error?.message || 'Failed to update gift catalog.' });
      }
      return;
    }

    response.json({
      ok: true,
      action: dashboardRequest.value.action,
      admin: true,
      email: dashboardRequest.value.email,
      permissions: dashboardRequest.value.permissions,
      role: dashboardRequest.value.role,
      uid: dashboardRequest.value.uid,
    });
  },
);

async function executeAdminCoupleDissolve(
  db,
  decodedToken,
  input,
  scope = { ok: true, regionCodes: null },
) {
  return db.runTransaction(async (transaction) => {
    const auditRef = db.doc(`adminAuditEvents/couple_${input.requestId}`);
    const membershipRef = db.doc(`coupleMemberships/${input.targetUid}`);
    const targetProfileRef = db.doc(`publicProfiles/${input.targetUid}`);
    const [auditSnapshot, membershipSnapshot, targetProfileSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(membershipRef),
      transaction.get(targetProfileRef),
    ]);

    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action === 'couple-dissolve' && previous.actorUid === decodedToken.uid && previous.targetUid === input.targetUid) {
        return auditRef.id;
      }
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }

    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : undefined;
    const coupleId = typeof membership?.coupleId === 'string' ? membership.coupleId : '';
    const partnerUid = typeof membership?.partnerUid === 'string' ? membership.partnerUid : '';
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    if (coupleId && partnerUid) {
      const coupleRef = db.doc(`couples/${coupleId}`);
      const partnerMembershipRef = db.doc(`coupleMemberships/${partnerUid}`);
      const actorProfileRef = db.doc(`publicProfiles/${input.targetUid}`);
      const partnerProfileRef = db.doc(`publicProfiles/${partnerUid}`);
      const [coupleSnapshot, partnerMembership, actorProfile, partnerProfile] = await Promise.all([
        transaction.get(coupleRef),
        transaction.get(partnerMembershipRef),
        transaction.get(actorProfileRef),
        transaction.get(partnerProfileRef),
      ]);

      if (
        !coupleSnapshot.exists
        || partnerMembership.data()?.coupleId !== coupleId
        || !Array.isArray(coupleSnapshot.data().memberUids)
        || !coupleSnapshot.data().memberUids.includes(input.targetUid)
        || !coupleSnapshot.data().memberUids.includes(partnerUid)
      ) {
        throw Object.assign(new Error('Couple records are inconsistent and require manual review.'), { status: 409 });
      }

      transaction.delete(coupleRef);
      transaction.delete(membershipRef);
      transaction.delete(partnerMembershipRef);
      if (actorProfile.exists) transaction.update(actorProfileRef, { coupleLevel: 0, updatedAt: timestamp });
      if (partnerProfile.exists) transaction.update(partnerProfileRef, { coupleLevel: 0, updatedAt: timestamp });
    }

    transaction.create(auditRef, {
      action: 'couple-dissolve',
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: { coupleId: '', partnerUid: '' },
      before: { coupleId, partnerUid },
      coupleId,
      countryCode: String(targetProfileSnapshot.data()?.countryCode || '').trim().toUpperCase(),
      createdAt: timestamp,
      kind: 'moderation',
      partnerUid,
      reason: input.reason,
      requestId: input.requestId,
      status: coupleId ? 'completed' : 'no-op',
      targetUid: input.targetUid,
    });
    return auditRef.id;
  });
}

async function executeAdminSpecialIdUpsert(db, decodedToken, input) {
  return db.runTransaction(async (transaction) => {
    const catalogRef = db.doc(`specialIdCatalog/${input.specialId}`);
    const publicIdRef = db.doc(`publicIds/${input.specialId}`);
    const reservationRef = db.doc(`specialIds/${input.specialId}`);
    const auditRef = db.doc(`adminAuditEvents/catalog_${input.requestId}`);
    const [catalogSnapshot, publicIdSnapshot, reservationSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(catalogRef),
      transaction.get(publicIdRef),
      transaction.get(reservationRef),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action === 'special-id-upsert' && previous.actorUid === decodedToken.uid && previous.specialId === input.specialId) {
        return auditRef.id;
      }
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    if (publicIdSnapshot.exists) throw Object.assign(new Error('This ID is already reserved as a normal account ID.'), { status: 409 });
    if (reservationSnapshot.exists || catalogSnapshot.data()?.status === 'sold') throw Object.assign(new Error('A sold special ID cannot be changed.'), { status: 409 });
    if (catalogSnapshot.exists && input.expectedUpdatedAt && readAdminTimestampIso(catalogSnapshot.data()?.updatedAt) !== input.expectedUpdatedAt) {
      throw Object.assign(new Error('Special ID changed after it was opened. Refresh before saving.'), { status: 409 });
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(catalogRef, {
      createdAt: catalogSnapshot.exists && isTimestampLike(catalogSnapshot.data().createdAt)
        ? catalogSnapshot.data().createdAt
        : timestamp,
      price: input.price,
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      specialId: input.specialId,
      status: input.status,
      updatedAt: timestamp,
    });
    transaction.create(auditRef, { action: 'special-id-upsert', actorEmail: decodedToken.email || '', actorUid: decodedToken.uid, createdAt: timestamp, kind: 'economy', price: input.price, reason: input.reason, specialId: input.specialId, status: input.status });
    return auditRef.id;
  });
}

async function executeAdminGiftCatalogUpsert(db, decodedToken, input) {
  return db.runTransaction(async (transaction) => {
    const catalogRef = db.doc(`giftCatalog/${input.giftId}`);
    const auditRef = db.doc(`adminAuditEvents/gift_${input.requestId}`);
    const presentationReferences = input.presentation.animationEnabled
      ? [
        ['visual', input.presentation.visualAsset],
        ['fallback', input.presentation.fallbackAsset],
        ...(input.presentation.audioAsset ? [['audio', input.presentation.audioAsset]] : []),
      ]
      : [];
    const presentationRefs = presentationReferences.flatMap(([, reference]) => [
      db.doc(`cosmeticAssets/${reference.assetId}`),
      db.doc(`cosmeticAssets/${reference.assetId}/versions/${reference.assetVersionId}`),
      db.doc(`cosmeticAssetApprovals/${reference.assetId}__${reference.assetVersionId}`),
    ]);
    const physicalReceiptRef = input.presentation.animationEnabled
      ? db.doc(`giftPresentationApprovalReceipts/${input.presentation.physicalApprovalReceiptId}`)
      : null;
    const [catalogSnapshot, auditSnapshot, ...presentationSnapshots] = await Promise.all([
      transaction.get(catalogRef),
      transaction.get(auditRef),
      ...presentationRefs.map((reference) => transaction.get(reference)),
      ...(physicalReceiptRef ? [transaction.get(physicalReceiptRef)] : []),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action === 'gift-catalog-upsert' && previous.actorUid === decodedToken.uid && previous.giftId === input.giftId) {
        return auditRef.id;
      }
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    if (catalogSnapshot.exists && input.expectedUpdatedAt && readAdminTimestampIso(catalogSnapshot.data()?.updatedAt) !== input.expectedUpdatedAt) {
      throw Object.assign(new Error('Gift changed after it was opened. Refresh before saving.'), { status: 409 });
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    if (input.presentation.animationEnabled) {
      const records = {};
      let offset = 0;
      for (const [key] of presentationReferences) {
        const [summary, version, approval] = presentationSnapshots.slice(offset, offset + 3);
        records[key] = {
          approval: approval?.exists ? approval.data() : undefined,
          summary: summary?.exists ? summary.data() : undefined,
          version: version?.exists ? version.data() : undefined,
        };
        offset += 3;
      }
      const existingReceipt = presentationSnapshots[offset];
      if (!existingReceipt?.exists && !input.physicalApproval) {
        throw Object.assign(new Error('A new Android and iOS physical approval receipt is required.'), { status: 409 });
      }
      const proposedReceipt = existingReceipt?.exists ? existingReceipt.data() : {
        androidPassed: true,
        androidDevice: input.physicalApproval.androidDevice,
        audioAssetId: input.presentation.audioAsset?.assetId || '',
        audioAssetVersionId: input.presentation.audioAsset?.assetVersionId || '',
        audioChecksum: records.audio?.version?.sha256 || '',
        createdAt: timestamp,
        durationMs: input.presentation.durationMs,
        fallbackAssetId: input.presentation.fallbackAsset.assetId,
        fallbackAssetVersionId: input.presentation.fallbackAsset.assetVersionId,
        fallbackChecksum: records.fallback?.version?.sha256 || '',
        giftId: input.giftId,
        id: input.presentation.physicalApprovalReceiptId,
        hapticPolicy: input.presentation.hapticPolicy,
        iosPassed: true,
        iosDevice: input.physicalApproval.iosDevice,
        notes: input.physicalApproval.notes,
        minimumClientVersion: input.presentation.minimumClientVersion,
        performanceTier: input.presentation.performanceTier,
        reviewerEmail: decodedToken.email || '',
        reviewerUid: decodedToken.uid,
        status: 'passed',
        soundPolicy: input.presentation.soundPolicy,
        testedClientVersion: input.physicalApproval.testedClientVersion,
        tier: input.presentation.tier,
        visualAssetId: input.presentation.visualAsset.assetId,
        visualAssetVersionId: input.presentation.visualAsset.assetVersionId,
        visualChecksum: records.visual?.version?.sha256 || '',
      };
      records.physicalReceipt = proposedReceipt;
      const inspected = inspectApprovedGiftPresentation({
        presentation: input.presentation,
        records,
      });
      if (!inspected.ok) {
        throw Object.assign(new Error(`Gift presentation approval failed: ${inspected.code}.`), { status: 409 });
      }
      if (!existingReceipt?.exists) transaction.create(physicalReceiptRef, proposedReceipt);
    }
    transaction.set(catalogRef, {
      createdAt: catalogSnapshot.exists && isTimestampLike(catalogSnapshot.data().createdAt)
        ? catalogSnapshot.data().createdAt
        : timestamp,
      giftId: input.giftId,
      iconKey: input.iconKey,
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      nameAr: input.nameAr,
      price: input.price,
      presentation: input.presentation,
      scoreValue: input.scoreValue,
      status: input.status,
      updatedAt: timestamp,
    });
    transaction.create(auditRef, {
      action: 'gift-catalog-upsert',
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      giftId: input.giftId,
      kind: 'economy',
      price: input.price,
      presentation: input.presentation,
      physicalApprovalReceiptId: input.presentation.physicalApprovalReceiptId || '',
      reason: input.reason,
      scoreValue: input.scoreValue,
      status: input.status,
    });
    return auditRef.id;
  });
}

async function resolveAdminOverview(db, scope = { ok: true, regionCodes: null }) {
  if (scope.regionCodes) {
    const [users, rooms, moderationEvents, reports, auditEvents] = await Promise.all([
      db.collection('publicProfiles').where('countryCode', 'in', scope.regionCodes).limit(1000).get(),
      db.collection('rooms').where('countryCode', 'in', scope.regionCodes).limit(1000).get(),
      db.collectionGroup('moderationEvents').where('regionCode', 'in', scope.regionCodes).limit(1000).get(),
      db.collection('reports').where('countryCode', 'in', scope.regionCodes).limit(1000).get(),
      db.collection('adminAuditEvents').where('countryCode', 'in', scope.regionCodes).limit(1000).get(),
    ]);
    const roomRows = rooms.docs.map((doc) => doc.data());
    return createAdminOverviewPayload({
      activeRooms: roomRows.filter((room) => room.status === 'active').length,
      adminAuditEvents: auditEvents.size,
      gameRooms: roomRows.filter((room) => room.type === 'game').length,
      moderationEvents: moderationEvents.size,
      privateRooms: roomRows.filter((room) => room.visibility === 'private').length,
      reports: reports.size,
      users: users.size,
    });
  }
  const [
    usersSnapshot,
    activeRoomsSnapshot,
    gameRoomsSnapshot,
    privateRoomsSnapshot,
    moderationEventsSnapshot,
    reportsSnapshot,
    auditEventsSnapshot,
  ] = await Promise.all([
    getCollectionCount(db.collection('users')),
    getCollectionCount(db.collection('rooms').where('status', '==', 'active')),
    getCollectionCount(db.collection('rooms').where('type', '==', 'game')),
    getCollectionCount(db.collection('rooms').where('visibility', '==', 'private')),
    getCollectionGroupCount(db.collectionGroup('moderationEvents')),
    getCollectionCount(db.collection('reports')),
    getCollectionCount(db.collection('adminAuditEvents')),
  ]);

  return createAdminOverviewPayload({
    activeRooms: activeRoomsSnapshot,
    adminAuditEvents: auditEventsSnapshot,
    gameRooms: gameRoomsSnapshot,
    moderationEvents: moderationEventsSnapshot,
    privateRooms: privateRoomsSnapshot,
    reports: reportsSnapshot,
    users: usersSnapshot,
  });
}

async function resolveAdminUsers(db, body, scope = { ok: true, regionCodes: null }) {
  const query = normalizeAdminUsersQuery(body);
  const privateProfiles = new Map();
  const publicProfiles = new Map();
  const discoveredUids = new Set();
  let hasNextPage = false;
  let nextCursor = null;

  if (!query.search) {
    let usersQuery = db.collection('users')
      .orderBy('displayName')
      .orderBy(admin.firestore.FieldPath.documentId());
    const cursor = decodeAdminUserCursor(query.cursor);
    if (cursor) usersQuery = usersQuery.startAfter(cursor.displayName, cursor.uid);
    const snapshot = await usersQuery.limit(query.readLimit).get();
    snapshot.docs.forEach((doc) => {
      discoveredUids.add(doc.id);
      privateProfiles.set(doc.id, doc.data());
    });
    hasNextPage = snapshot.size === query.readLimit;
    const lastDocument = snapshot.docs.at(-1);
    if (hasNextPage && lastDocument) {
      nextCursor = encodeAdminUserCursor({ displayName: typeof lastDocument.data().displayName === 'string' ? lastDocument.data().displayName : '', uid: lastDocument.id });
    }
  } else {
    const normalizedSearch = normalizeSearchName(query.search);
    const searches = [
      db.collection('users').where('email', '==', query.search).limit(query.limit).get(),
    ];

    if (/^[A-Za-z0-9_-]{1,128}$/.test(query.exactSearch)) {
      searches.push(db.doc(`users/${query.exactSearch}`).get());
    }

    if (/^[1-9][0-9]{6}$/.test(query.search)) {
      searches.push(db.collection('publicProfiles').where('publicId', '==', query.search).limit(query.limit).get());
    }

    if (/^[0-9]{7}$/.test(query.search)) {
      searches.push(db.collection('publicProfiles').where('specialId', '==', query.search).limit(query.limit).get());
    }

    if (normalizedSearch) {
      searches.push(
        db.collection('publicProfiles')
          .orderBy('normalizedName')
          .startAt(normalizedSearch)
          .endAt(`${normalizedSearch}\uf8ff`)
          .limit(query.limit)
          .get(),
      );
    }

    const snapshots = await Promise.all(searches);
    snapshots.forEach((snapshot) => addAdminSearchSnapshot(
      snapshot,
      discoveredUids,
      privateProfiles,
      publicProfiles,
    ));
  }

  privateProfiles.forEach((_value, uid) => discoveredUids.add(uid));
  publicProfiles.forEach((_value, uid) => discoveredUids.add(uid));
  const missingPrivateRefs = [...discoveredUids]
    .filter((uid) => !privateProfiles.has(uid))
    .map((uid) => db.doc(`users/${uid}`));
  const missingPublicRefs = [...discoveredUids]
    .filter((uid) => !publicProfiles.has(uid))
    .map((uid) => db.doc(`publicProfiles/${uid}`));

  if (missingPrivateRefs.length > 0) {
    const snapshots = await db.getAll(...missingPrivateRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => privateProfiles.set(snapshot.id, snapshot.data()));
  }

  if (missingPublicRefs.length > 0) {
    const snapshots = await db.getAll(...missingPublicRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => publicProfiles.set(snapshot.id, snapshot.data()));
  }

  const reservations = new Map();
  const notificationPreferences = new Map();
  const wallets = new Map();
  const reservationRefs = [...new Map(
    [...publicProfiles.values()]
      .filter((profile) => isValidPublicId(profile?.publicId))
      .map((profile) => [profile.publicId, db.doc(`publicIds/${profile.publicId}`)]),
  ).values()];

  if (reservationRefs.length > 0) {
    const snapshots = await db.getAll(...reservationRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      reservations.set(snapshot.id, snapshot.data());
    });
  }

  const preferenceRefs = [...privateProfiles.keys()].map((uid) => db.doc(`notificationPreferences/${uid}`));
  if (preferenceRefs.length > 0) {
    const snapshots = await db.getAll(...preferenceRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => notificationPreferences.set(snapshot.id, snapshot.data()));
  }

  const walletRefs = [...privateProfiles.keys()].map((uid) => db.doc(`walletSummaries/${uid}`));
  if (walletRefs.length > 0) {
    const snapshots = await db.getAll(...walletRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => wallets.set(snapshot.id, snapshot.data()));
  }

  const rows = filterRowsByOperatorScope(
    [...privateProfiles.entries()]
      .map(([uid, profile]) => {
        const publicProfile = publicProfiles.get(uid);
        return mapAdminUserProfileDocument(
          uid,
          profile,
          publicProfile,
          reservations.get(publicProfile?.publicId),
          notificationPreferences.get(uid),
          wallets.get(uid),
        );
      })
      .filter(Boolean),
    scope,
  );

  const items = filterAdminUserRows(rows, query).slice(0, query.limit);
  return {
    items,
    pageInfo: { hasNextPage, limit: query.limit, nextCursor, returned: items.length },
  };
}

function encodeAdminUserCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeAdminUserCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed && typeof parsed.displayName === 'string' && typeof parsed.uid === 'string' && parsed.uid
      ? { displayName: parsed.displayName, uid: parsed.uid }
      : null;
  } catch {
    return null;
  }
}

function addAdminSearchSnapshot(snapshot, discoveredUids, privateProfiles, publicProfiles) {
  const documents = Array.isArray(snapshot.docs)
    ? snapshot.docs
    : snapshot.exists
      ? [snapshot]
      : [];

  documents.forEach((document) => {
    discoveredUids.add(document.id);

    if (document.ref?.parent?.id === 'publicProfiles') {
      publicProfiles.set(document.id, document.data());
    } else if (document.ref?.parent?.id === 'users') {
      privateProfiles.set(document.id, document.data());
    }
  });
}

async function resolveAdminUserSummary(db, scope = { ok: true, regionCodes: null }) {
  if (scope.regionCodes) {
    const snapshot = await db.collection('publicProfiles')
      .where('countryCode', 'in', scope.regionCodes)
      .limit(1000)
      .get();
    const profiles = snapshot.docs.map((doc) => doc.data());
    return {
      active: profiles.filter((profile) => profile.moderationStatus === 'active').length,
      pendingAvatars: profiles.filter((profile) => profile.avatarModerationStatus === 'pending').length,
      removed: profiles.filter((profile) => profile.moderationStatus === 'removed').length,
      suspended: profiles.filter((profile) => profile.moderationStatus === 'suspended').length,
      total: profiles.length,
    };
  }
  const [total, active, suspended, removed, pendingAvatars] = await Promise.all([
    getCollectionCount(db.collection('users')),
    getCollectionCount(db.collection('publicProfiles').where('moderationStatus', '==', 'active')),
    getCollectionCount(db.collection('publicProfiles').where('moderationStatus', '==', 'suspended')),
    getCollectionCount(db.collection('publicProfiles').where('moderationStatus', '==', 'removed')),
    getCollectionCount(db.collection('publicProfiles').where('avatarModerationStatus', '==', 'pending')),
  ]);
  return { active, pendingAvatars, removed, suspended, total };
}

async function resolveAdminUserDetail(db, auth, targetUid) {
  const optionalErrors = {};
  const safeDetailQuery = async (section, promise) => {
    try { return await promise; }
    catch (error) {
      console.error('Failed to resolve optional admin user detail section:', { message: error?.message || 'unknown', section, targetUid });
      optionalErrors[section] = 'تعذّر تحميل هذا الجزء من الملف. بقية بيانات المستخدم ما زالت متاحة ويمكنك المحاولة مجددًا.';
      return { docs: [], size: 0 };
    }
  };
  const refs = {
    couple: db.doc(`coupleMemberships/${targetUid}`),
    preferences: db.doc(`notificationPreferences/${targetUid}`),
    privateProfile: db.doc(`users/${targetUid}`),
    publicProfile: db.doc(`publicProfiles/${targetUid}`),
    restrictions: db.doc(`adminUserRestrictions/${targetUid}`),
    representative: db.doc(`representativePrivileges/${targetUid}`),
    representativePin: db.doc(`representativeTransferPins/${targetUid}`),
    wallet: db.doc(`walletSummaries/${targetUid}`),
  };
  const [privateSnapshot, publicSnapshot, walletSnapshot, coupleSnapshot, restrictionsSnapshot, preferencesSnapshot, representativeSnapshot, pinSnapshot, authUser, notesSnapshot, auditSnapshot, walletEventsSnapshot, devicesSnapshot, context] = await Promise.all([
    refs.privateProfile.get(),
    refs.publicProfile.get(),
    refs.wallet.get(),
    refs.couple.get(),
    refs.restrictions.get(),
    refs.preferences.get(),
    refs.representative.get(),
    refs.representativePin.get(),
    auth.getUser(targetUid),
    safeDetailQuery('notes', db.collection('adminUserNotes').where('targetUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeDetailQuery('activity', db.collection('adminAuditEvents').where('targetUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeDetailQuery('economy', db.collection('walletTransactions').where('uid', '==', targetUid).orderBy('createdAt', 'desc').limit(50).get()),
    safeDetailQuery('notifications', db.collection(`pushDevices/${targetUid}/tokens`).where('active', '==', true).limit(20).get()),
    resolveAdminUserOperationalContext(db, targetUid),
  ]);
  context.errors = { ...context.errors, ...optionalErrors };
  if (!privateSnapshot.exists) throw createHttpError(404, 'User was not found.');
  const privateProfile = privateSnapshot.data();
  const publicProfile = publicSnapshot.exists ? publicSnapshot.data() : undefined;
  const reservationSnapshot = publicProfile?.publicId ? await db.doc(`publicIds/${publicProfile.publicId}`).get() : undefined;
  const profile = mapAdminUserProfileDocument(targetUid, privateProfile, publicProfile, reservationSnapshot?.exists ? reservationSnapshot.data() : undefined, preferencesSnapshot.exists ? preferencesSnapshot.data() : undefined, walletSnapshot.exists ? walletSnapshot.data() : undefined);
  const couple = coupleSnapshot.exists ? coupleSnapshot.data() : undefined;
  let partner = null;
  if (typeof couple?.partnerUid === 'string' && couple.partnerUid) {
    const partnerSnapshot = await db.doc(`publicProfiles/${couple.partnerUid}`).get();
    const partnerData = partnerSnapshot.exists ? partnerSnapshot.data() : {};
    partner = {
      displayName: typeof partnerData.displayName === 'string' ? partnerData.displayName.trim() : '',
      publicId: typeof partnerData.publicId === 'string' ? partnerData.publicId.trim() : '',
      uid: couple.partnerUid,
    };
  }
  const wallet = walletSnapshot.exists ? walletSnapshot.data() : {};
  const restrictions = restrictionsSnapshot.exists ? restrictionsSnapshot.data() : {};
  return {
    account: {
      createdAt: authUser.metadata?.creationTime ? new Date(authUser.metadata.creationTime).toISOString() : '',
      disabled: authUser.disabled,
      emailVerified: authUser.emailVerified,
      lastSignInAt: authUser.metadata?.lastSignInTime ? new Date(authUser.metadata.lastSignInTime).toISOString() : '',
      tokensValidAfterAt: authUser.tokensValidAfterTime ? new Date(authUser.tokensValidAfterTime).toISOString() : '',
    },
    activity: auditSnapshot.docs.map((doc) => mapAdminAuditEventDocument(doc.id, doc.data())).filter(Boolean),
    couple: {
      coupleId: typeof couple?.coupleId === 'string' ? couple.coupleId : '',
      partner,
    },
    context,
    notifications: {
      configured: preferencesSnapshot.exists,
      preferences: mapNotificationPreferences(preferencesSnapshot.exists ? preferencesSnapshot.data() : undefined),
      registeredDeviceCount: devicesSnapshot.size ?? devicesSnapshot.docs.length,
    },
    notes: notesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return { actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '', actorUid: typeof data.actorUid === 'string' ? data.actorUid : '', createdAt: readAdminTimestampIso(data.createdAt), id: doc.id, note: typeof data.note === 'string' ? data.note : '' };
    }),
    profile,
    representative: {
      active: representativeSnapshot.data()?.active === true,
      currencies: { coins: representativeSnapshot.data()?.currencies?.coins === true, diamonds: representativeSnapshot.data()?.currencies?.diamonds === true },
      limits: mapRepresentativeOverrideLimits(representativeSnapshot.data()?.limits),
      pin: {
        configured: pinSnapshot.exists,
        resetRequired: pinSnapshot.data()?.resetRequired === true,
        updatedAt: pinSnapshot.exists ? readAdminTimestampIso(pinSnapshot.data()?.updatedAt) || 'missing' : 'missing',
      },
      updatedAt: representativeSnapshot.exists ? readAdminTimestampIso(representativeSnapshot.data()?.updatedAt) || 'missing' : 'missing',
    },
    restrictions: {
      mutedUntil: readAdminTimestampIso(restrictions.mutedUntil),
      reason: typeof restrictions.reason === 'string' ? restrictions.reason : '',
    },
    wallet: {
      balances: { coins: readAdminAmount(wallet.balances?.coins ?? wallet.balance), diamonds: readAdminAmount(wallet.balances?.diamonds) },
      lifetimeCredit: { coins: readAdminAmount(wallet.lifetimeCredit?.coins ?? wallet.lifetimeCredit), diamonds: readAdminAmount(wallet.lifetimeCredit?.diamonds) },
      lifetimeDebit: { coins: readAdminAmount(wallet.lifetimeDebit?.coins ?? wallet.lifetimeDebit), diamonds: readAdminAmount(wallet.lifetimeDebit?.diamonds) },
      transactions: walletEventsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return { amount: readAdminAmount(data.amount), balanceAfter: readAdminAmount(data.balanceAfter), createdAt: readAdminTimestampIso(data.createdAt), currency: typeof data.currency === 'string' ? data.currency : '', id: doc.id, note: typeof data.note === 'string' ? data.note : '', referenceId: typeof data.referenceId === 'string' ? data.referenceId : '', source: typeof data.source === 'string' ? data.source : '', type: typeof data.type === 'string' ? data.type : '', uid: targetUid };
      }),
      updatedAt: readAdminTimestampIso(wallet.updatedAt),
    },
  };
}

async function resolveAdminUserOperationalContext(db, targetUid) {
  const errors = {};
  const safeQuery = async (section, promise, fallback = { docs: [], size: 0 }) => {
    try { return await promise; }
    catch (error) { console.error('Failed to resolve optional admin user context section:', { message: error?.message || 'unknown', section, targetUid }); errors[section] = 'تعذّر تحميل هذا السياق التشغيلي. يمكنك متابعة بقية الملف والمحاولة مجددًا.'; return fallback; }
  };
  const [reportedBySnapshot, reportedAgainstSnapshot, hostedRoomsSnapshot, membershipsSnapshot, roomModerationSnapshot, friendshipsSnapshot, incomingFriendSnapshot, outgoingFriendSnapshot, incomingCoupleSnapshot, outgoingCoupleSnapshot, outgoingBlocksSnapshot, blockScanSnapshot, giftsSentSnapshot, giftsReceivedSnapshot, ownershipsSnapshot, storeGiftsSentSnapshot, storeGiftsReceivedSnapshot, transfersSentSnapshot, rechargesReceivedSnapshot] = await Promise.all([
    safeQuery('reports', db.collection('reports').where('reporterUid', '==', targetUid).orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('reports', db.collection('reports').where('targetUid', '==', targetUid).orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('rooms', db.collection('rooms').where('hostId', '==', targetUid).orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('rooms', db.collectionGroup('members').where('uid', '==', targetUid).orderBy('joinedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('rooms', db.collectionGroup('moderationEvents').where('targetUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('friendships').where('memberUids', 'array-contains', targetUid).orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('friendRequests').where('recipientUid', '==', targetUid).where('status', '==', 'pending').orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('friendRequests').where('senderUid', '==', targetUid).where('status', '==', 'pending').orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('coupleRequests').where('recipientUid', '==', targetUid).where('status', '==', 'pending').orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('coupleRequests').where('senderUid', '==', targetUid).where('status', '==', 'pending').orderBy('updatedAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection(`blocks/${targetUid}/blocked`).limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collectionGroup('blocked').limit(ADMIN_USER_BLOCK_SCAN_LIMIT).get()),
    safeQuery('social', db.collection('giftEvents').where('senderUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('social', db.collection('giftEvents').where('recipientUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('store', db.collection(`storeOwnerships/${targetUid}/items`).orderBy('acquiredAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('store', db.collection('storeGiftEvents').where('senderUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('store', db.collection('storeGiftEvents').where('recipientUid', '==', targetUid).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('transfers', db.collection(`representativeTransferReceipts/${targetUid}/items`).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
    safeQuery('transfers', db.collection(`walletRechargeReceipts/${targetUid}/items`).orderBy('createdAt', 'desc').limit(ADMIN_USER_CONTEXT_LIMIT).get()),
  ]);

  const reportMap = new Map([...reportedBySnapshot.docs, ...reportedAgainstSnapshot.docs].map((doc) => [doc.id, mapAdminReportDocument(doc.id, doc.data())]));
  const reports = sortRecent([...reportMap.values()].filter(Boolean));
  const membershipByRoom = new Map(membershipsSnapshot.docs.map((doc) => {
    const roomId = doc.ref?.parent?.parent?.id || '';
    const data = doc.data();
    return [roomId, { joinedAt: readAdminTimestampIso(data.joinedAt), role: typeof data.role === 'string' ? data.role : '', status: typeof data.status === 'string' ? data.status : '' }];
  }).filter(([roomId]) => roomId));
  const roomRefs = [...new Set(membershipByRoom.keys())].map((roomId) => db.doc(`rooms/${roomId}`));
  const membershipRoomSnapshots = roomRefs.length ? await safeQuery('rooms', db.getAll(...roomRefs), []) : [];
  const roomMap = new Map();
  [...hostedRoomsSnapshot.docs, ...membershipRoomSnapshots].forEach((doc) => {
    if (!doc.exists) return;
    const room = mapAdminRoomDocument(doc.id, doc.data());
    if (!room) return;
    const membership = membershipByRoom.get(doc.id) || {};
    roomMap.set(doc.id, { ...room, joinedAt: membership.joinedAt || '', relation: room.hostId === targetUid ? 'host' : 'member', role: membership.role || (room.hostId === targetUid ? 'host' : ''), memberStatus: membership.status || '' });
  });
  const rooms = sortRecent([...roomMap.values()]);
  const roomModeration = sortRecent(roomModerationSnapshot.docs.map((doc) => mapUserRoomModeration(doc.id, doc.data())));

  const relationships = sortRecent([
    ...friendshipsSnapshot.docs.map((doc) => mapUserRelationship(doc.id, doc.data(), targetUid, 'friend')),
    ...incomingFriendSnapshot.docs.map((doc) => mapUserRelationship(doc.id, doc.data(), targetUid, 'friend-request-incoming')),
    ...outgoingFriendSnapshot.docs.map((doc) => mapUserRelationship(doc.id, doc.data(), targetUid, 'friend-request-outgoing')),
    ...incomingCoupleSnapshot.docs.map((doc) => mapUserRelationship(doc.id, doc.data(), targetUid, 'couple-request-incoming')),
    ...outgoingCoupleSnapshot.docs.map((doc) => mapUserRelationship(doc.id, doc.data(), targetUid, 'couple-request-outgoing')),
  ]);
  const outgoingBlocks = outgoingBlocksSnapshot.docs.map((doc) => ({ createdAt: readAdminTimestampIso(doc.data().createdAt), direction: 'outgoing', id: `${targetUid}_${doc.id}`, peerUid: doc.id }));
  const incomingBlocks = blockScanSnapshot.docs.filter((doc) => doc.id === targetUid).map((doc) => ({ createdAt: readAdminTimestampIso(doc.data().createdAt), direction: 'incoming', id: `${doc.ref?.parent?.parent?.id || 'unknown'}_${targetUid}`, peerUid: doc.ref?.parent?.parent?.id || '' })).filter((item) => item.peerUid);
  const blocks = sortRecent([...outgoingBlocks, ...incomingBlocks]);
  const socialGifts = sortRecent([
    ...giftsSentSnapshot.docs.map((doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, 'social')),
    ...giftsReceivedSnapshot.docs.map((doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, 'social')),
  ]);
  const storeGifts = sortRecent([
    ...storeGiftsSentSnapshot.docs.map((doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, 'store')),
    ...storeGiftsReceivedSnapshot.docs.map((doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, 'store')),
  ]);
  const peerUids = [...new Set([...relationships.map((item) => item.peerUid), ...blocks.map((item) => item.peerUid), ...socialGifts.map((item) => item.peerUid), ...storeGifts.map((item) => item.peerUid)].filter(Boolean))];
  const peerSnapshots = peerUids.length ? await safeQuery('social', db.getAll(...peerUids.map((uid) => db.doc(`publicProfiles/${uid}`))), []) : [];
  const peers = new Map(peerSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  const decoratePeer = (item) => {
    const peer = peers.get(item.peerUid) || {};
    return { ...item, peerDisplayName: typeof peer.displayName === 'string' ? peer.displayName : '', peerPublicId: typeof peer.publicId === 'string' ? peer.publicId : item.peerPublicId || '' };
  };

  const giftedItemIds = new Set(storeGifts.filter((gift) => gift.direction === 'received').map((gift) => gift.itemId));
  const catalogRefs = [...new Set(ownershipsSnapshot.docs.map((doc) => typeof doc.data()?.itemId === 'string' ? doc.data().itemId : doc.id))].map((itemId) => db.doc(`storeCatalog/${itemId}`));
  const catalogSnapshots = catalogRefs.length ? await safeQuery('store', db.getAll(...catalogRefs), []) : [];
  const catalog = new Map(catalogSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  const ownerships = sortRecent(ownershipsSnapshot.docs.map((doc) => {
    const itemId = typeof doc.data()?.itemId === 'string' ? doc.data().itemId : doc.id;
    return mapUserOwnership(doc.id, doc.data(), catalog.get(itemId), giftedItemIds.has(itemId) ? 'gift' : 'purchase');
  }));
  const transfers = sortRecent([
    ...transfersSentSnapshot.docs.map((doc) => mapUserTransferReceipt(doc.id, doc.data(), 'sent')),
    ...rechargesReceivedSnapshot.docs.map((doc) => mapUserTransferReceipt(doc.id, doc.data(), 'received')),
  ]).map(decoratePeer);

  return {
    errors,
    limits: { blocksScanned: ADMIN_USER_BLOCK_SCAN_LIMIT, perSection: ADMIN_USER_CONTEXT_LIMIT },
    reports: { items: reports, sampled: reportedBySnapshot.size >= ADMIN_USER_CONTEXT_LIMIT || reportedAgainstSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT, summary: summarizeUserReports(reports) },
    rooms: { items: rooms, moderation: roomModeration, sampled: hostedRoomsSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT || membershipsSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT || roomModerationSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT },
    social: {
      blocks: blocks.map(decoratePeer),
      gifts: socialGifts.map(decoratePeer),
      relationships: relationships.map(decoratePeer),
      sampled: blockScanSnapshot.size >= ADMIN_USER_BLOCK_SCAN_LIMIT || relationships.length >= ADMIN_USER_CONTEXT_LIMIT || socialGifts.length >= ADMIN_USER_CONTEXT_LIMIT,
    },
    store: { gifts: storeGifts.map(decoratePeer), ownerships, sampled: ownershipsSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT || storeGifts.length >= ADMIN_USER_CONTEXT_LIMIT },
    transfers: { items: transfers, sampled: transfersSentSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT || rechargesReceivedSnapshot.size >= ADMIN_USER_CONTEXT_LIMIT },
  };
}

async function resolveAdminUserHistoryPage(db, input) {
  const cursor = decodeAdminUserHistoryCursor(input.cursor, input.section);
  if (!cursor) throw createHttpError(400, 'The user history cursor is invalid or belongs to another section.');
  const common = { cursor, db, limit: input.limit || ADMIN_USER_HISTORY_LIMIT, targetUid: input.targetUid };
  if (input.section === 'notes') return resolveSingleUserHistorySource({ ...common, collection: db.collection('adminUserNotes').where('targetUid', '==', input.targetUid), dateField: 'createdAt', map: (doc) => { const data = doc.data(); return { actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '', actorUid: typeof data.actorUid === 'string' ? data.actorUid : '', createdAt: readAdminTimestampIso(data.createdAt), id: doc.id, note: typeof data.note === 'string' ? data.note : '' }; }, section: input.section, source: 'notes' });
  if (input.section === 'activity') return resolveSingleUserHistorySource({ ...common, collection: db.collection('adminAuditEvents').where('targetUid', '==', input.targetUid), dateField: 'createdAt', map: (doc) => mapAdminAuditEventDocument(doc.id, doc.data()), section: input.section, source: 'activity' });
  if (input.section === 'room-moderation') return resolveSingleUserHistorySource({ ...common, collection: db.collectionGroup('moderationEvents').where('targetUid', '==', input.targetUid), dateField: 'createdAt', documentPath: true, map: (doc) => mapUserRoomModeration(doc.id, doc.data()), section: input.section, source: 'moderation' });
  if (input.section === 'ownerships') return resolveAdminUserOwnershipHistory(common);
  if (input.section === 'reports') return resolveAdminUserReportHistory(common);
  if (input.section === 'rooms') return resolveAdminUserRoomHistory(common);
  if (input.section === 'social-gifts') return resolveAdminUserGiftHistory(common, 'giftEvents', 'social');
  if (input.section === 'store-gifts') return resolveAdminUserGiftHistory(common, 'storeGiftEvents', 'store');
  if (input.section === 'transfers') return resolveAdminUserTransferHistory(common);
  throw createHttpError(400, 'Unsupported user history section.');
}

async function resolveSingleUserHistorySource({ collection, cursor, dateField, documentPath = false, limit, map, section, source }) {
  const result = await readAdminUserHistorySource(collection, { cursor: cursor.sources[source], dateField, documentPath, limit, map, source });
  return mergeAdminUserHistoryEntries({ entries: result.entries, incomingSources: cursor.sources, limit, section, sourceHasMore: { [source]: result.hasMore } });
}

async function resolveAdminUserReportHistory({ cursor, db, limit, targetUid }) {
  const [reporter, target] = await Promise.all([
    readAdminUserHistorySource(db.collection('reports').where('reporterUid', '==', targetUid), { cursor: cursor.sources.reporter, dateField: 'updatedAt', limit, map: (doc) => mapAdminReportDocument(doc.id, doc.data()), source: 'reporter' }),
    readAdminUserHistorySource(db.collection('reports').where('targetUid', '==', targetUid), { cursor: cursor.sources.target, dateField: 'updatedAt', limit, map: (doc) => mapAdminReportDocument(doc.id, doc.data()), source: 'target' }),
  ]);
  const entries = [...reporter.entries, ...target.entries].map((entry) => ({ ...entry, key: `report:${entry.value.id}` }));
  return mergeAdminUserHistoryEntries({ entries, incomingSources: cursor.sources, limit, section: 'reports', sourceHasMore: { reporter: reporter.hasMore, target: target.hasMore } });
}

async function resolveAdminUserRoomHistory({ cursor, db, limit, targetUid }) {
  const [hosted, memberships] = await Promise.all([
    readAdminUserHistorySource(db.collection('rooms').where('hostId', '==', targetUid), { cursor: cursor.sources.hosted, dateField: 'updatedAt', limit, map: (doc) => ({ document: doc, joinedAt: '', memberStatus: '', role: 'host' }), source: 'hosted' }),
    readAdminUserHistorySource(db.collectionGroup('members').where('uid', '==', targetUid), { cursor: cursor.sources.memberships, dateField: 'joinedAt', documentPath: true, limit, map: (doc) => { const data = doc.data(); return { document: doc, joinedAt: readAdminTimestampIso(data.joinedAt), memberStatus: typeof data.status === 'string' ? data.status : '', role: typeof data.role === 'string' ? data.role : '' }; }, source: 'memberships' }),
  ]);
  const membershipEntries = memberships.entries;
  const membershipRoomIds = [...new Set(membershipEntries.map((entry) => entry.value.document.ref?.parent?.parent?.id || '').filter(Boolean))];
  const membershipRoomSnapshots = membershipRoomIds.length ? await db.getAll(...membershipRoomIds.map((id) => db.doc(`rooms/${id}`))) : [];
  const membershipRooms = new Map(membershipRoomSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot]));
  const entries = [
    ...hosted.entries.map((entry) => { const room = mapAdminRoomDocument(entry.value.document.id, entry.value.document.data()); return room ? { ...entry, key: `room:${room.id}`, value: { ...room, joinedAt: '', memberStatus: '', relation: 'host', role: 'host' } } : null; }),
    ...membershipEntries.map((entry) => { const roomId = entry.value.document.ref?.parent?.parent?.id || ''; const snapshot = membershipRooms.get(roomId); const room = snapshot ? mapAdminRoomDocument(snapshot.id, snapshot.data()) : null; return room ? { ...entry, key: `room:${room.id}`, value: { ...room, joinedAt: entry.value.joinedAt, memberStatus: entry.value.memberStatus, relation: room.hostId === targetUid ? 'host' : 'member', role: entry.value.role || (room.hostId === targetUid ? 'host' : '') } } : null; }),
  ].filter(Boolean);
  return mergeAdminUserHistoryEntries({ entries, incomingSources: cursor.sources, limit, section: 'rooms', sourceHasMore: { hosted: hosted.hasMore, memberships: memberships.hasMore } });
}

async function resolveAdminUserOwnershipHistory({ cursor, db, limit, targetUid }) {
  const source = await readAdminUserHistorySource(db.collection(`storeOwnerships/${targetUid}/items`), { cursor: cursor.sources.ownerships, dateField: 'acquiredAt', limit, map: (doc) => ({ document: doc, itemId: typeof doc.data()?.itemId === 'string' ? doc.data().itemId : doc.id }), source: 'ownerships' });
  const itemIds = [...new Set(source.entries.map((entry) => entry.value.itemId).filter(Boolean))];
  const [catalogSnapshots, ...giftSnapshots] = await Promise.all([
    itemIds.length ? db.getAll(...itemIds.map((itemId) => db.doc(`storeCatalog/${itemId}`))) : Promise.resolve([]),
    ...chunkValues(itemIds, 10).map((items) => db.collection('storeGiftEvents').where('recipientUid', '==', targetUid).where('itemId', 'in', items).limit(50).get()),
  ]);
  const catalog = new Map(catalogSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  const gifted = new Set(giftSnapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data()?.itemId)).filter(Boolean));
  const entries = source.entries.map((entry) => ({ ...entry, key: `ownership:${entry.value.itemId}`, value: mapUserOwnership(entry.value.document.id, entry.value.document.data(), catalog.get(entry.value.itemId), gifted.has(entry.value.itemId) ? 'gift' : 'purchase') })).filter((entry) => entry.value);
  return mergeAdminUserHistoryEntries({ entries, incomingSources: cursor.sources, limit, section: 'ownerships', sourceHasMore: { ownerships: source.hasMore } });
}

async function resolveAdminUserGiftHistory({ cursor, db, limit, targetUid }, collectionName, channel) {
  const [sent, received] = await Promise.all([
    readAdminUserHistorySource(db.collection(collectionName).where('senderUid', '==', targetUid), { cursor: cursor.sources.sent, dateField: 'createdAt', limit, map: (doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, channel), source: 'sent' }),
    readAdminUserHistorySource(db.collection(collectionName).where('recipientUid', '==', targetUid), { cursor: cursor.sources.received, dateField: 'createdAt', limit, map: (doc) => mapUserGiftEvent(doc.id, doc.data(), targetUid, channel), source: 'received' }),
  ]);
  const entries = (await decorateAdminUserHistoryPeers(db, [...sent.entries, ...received.entries])).map((entry) => ({ ...entry, key: `gift:${entry.value.id}` }));
  return mergeAdminUserHistoryEntries({ entries, incomingSources: cursor.sources, limit, section: `${channel}-gifts`, sourceHasMore: { received: received.hasMore, sent: sent.hasMore } });
}

async function resolveAdminUserTransferHistory({ cursor, db, limit, targetUid }) {
  const [sent, received] = await Promise.all([
    readAdminUserHistorySource(db.collection(`representativeTransferReceipts/${targetUid}/items`), { cursor: cursor.sources.sent, dateField: 'createdAt', limit, map: (doc) => mapUserTransferReceipt(doc.id, doc.data(), 'sent'), source: 'sent' }),
    readAdminUserHistorySource(db.collection(`walletRechargeReceipts/${targetUid}/items`), { cursor: cursor.sources.received, dateField: 'createdAt', limit, map: (doc) => mapUserTransferReceipt(doc.id, doc.data(), 'received'), source: 'received' }),
  ]);
  const entries = await decorateAdminUserHistoryPeers(db, [...sent.entries, ...received.entries]);
  return mergeAdminUserHistoryEntries({ entries, incomingSources: cursor.sources, limit, section: 'transfers', sourceHasMore: { received: received.hasMore, sent: sent.hasMore } });
}

async function readAdminUserHistorySource(collection, { cursor, dateField, documentPath = false, limit, map, source }) {
  let query = collection.orderBy(dateField, 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  if (cursor) query = query.startAfter(admin.firestore.Timestamp.fromDate(new Date(cursor.at)), cursor.id);
  const snapshot = await query.limit(limit + 1).get();
  const entries = snapshot.docs.map((doc) => {
    const at = readAdminTimestampIso(doc.data()?.[dateField]);
    const value = at ? map(doc) : null;
    const cursorId = documentPath ? doc.ref?.path || doc.id : doc.id;
    return value ? { key: `${source}:${doc.id}`, marks: [{ at, id: cursorId, source }], sortAt: at, sortKey: cursorId, value } : null;
  }).filter(Boolean);
  return { entries, hasMore: snapshot.size > limit };
}

async function decorateAdminUserHistoryPeers(db, entries) {
  const peerUids = [...new Set(entries.map((entry) => entry.value?.peerUid).filter(Boolean))];
  const peerSnapshots = peerUids.length ? await db.getAll(...peerUids.map((uid) => db.doc(`publicProfiles/${uid}`))) : [];
  const peers = new Map(peerSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  return entries.map((entry) => { const peer = peers.get(entry.value.peerUid) || {}; return { ...entry, value: { ...entry.value, peerDisplayName: typeof peer.displayName === 'string' ? peer.displayName : '', peerPublicId: typeof peer.publicId === 'string' ? peer.publicId : entry.value.peerPublicId || '' } }; });
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function assertUserTargetAccess(db, scope, targetUid) {
  if (!scope.regionCodes) return;
  const profileSnapshot = await db.doc(`publicProfiles/${targetUid}`).get();
  const scopeCheck = assertUserInOperatorScope(
    scope,
    profileSnapshot.exists ? profileSnapshot.data() : undefined,
  );
  if (!scopeCheck.ok) {
    throw Object.assign(new Error(scopeCheck.error), {
      code: scopeCheck.code,
      status: scopeCheck.status,
    });
  }
}

async function executeAdminUserAction(db, auth, decodedToken, action, scope = { ok: true, regionCodes: null }) {
  if (['ban', 'force-sign-out', 'suspend', 'unban', 'unsuspend'].includes(action.action)) {
    const freshness = assertFreshAdminAuth(decodedToken);
    if (!freshness.ok) {
      throw Object.assign(new Error(freshness.error), {
        code: freshness.code,
        status: freshness.status,
      });
    }
  }
  const eventId = await db.runTransaction(async (transaction) => {
    const auditRef = db.doc(`adminAuditEvents/user_${action.requestId}`);
    const userRef = db.doc(`users/${action.targetUid}`);
    const profileRef = db.doc(`publicProfiles/${action.targetUid}`);
    const restrictionRef = db.doc(`adminUserRestrictions/${action.targetUid}`);
    const noteRef = db.doc(`adminUserNotes/${action.requestId}`);
    const targetOperatorRef = db.doc(`adminProfiles/${action.targetUid}`);
    const [auditSnapshot, userSnapshot, profileSnapshot, restrictionSnapshot, targetOperatorSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(userRef),
      transaction.get(profileRef),
      transaction.get(restrictionRef),
      transaction.get(targetOperatorRef),
    ]);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.actorUid === decodedToken.uid && previous.targetUid === action.targetUid && previous.action === `user-${action.action}`) return auditRef.id;
      throw createHttpError(409, 'This request identifier was already used.');
    }
    if (!userSnapshot.exists) throw createHttpError(404, 'Target user was not found.');
    const profileRequiredActions = ['avatar-approve', 'avatar-reject', 'ban', 'mute', 'suspend', 'unban', 'unmute', 'unsuspend'];
    if (!profileSnapshot.exists && profileRequiredActions.includes(action.action)) throw createHttpError(409, 'Target public profile is missing and must be repaired before this action.');
    const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
    const scopeCheck = assertUserInOperatorScope(scope, profile);
    if (!scopeCheck.ok) {
      throw Object.assign(createHttpError(scopeCheck.status, scopeCheck.error), { code: scopeCheck.code });
    }
    const hierarchyCheck = assertAdminTargetHierarchy(
      resolveAdminRole(decodedToken),
      targetOperatorSnapshot.exists ? targetOperatorSnapshot.data() : undefined,
      action.targetUid,
    );
    if (!hierarchyCheck.ok) {
      throw Object.assign(createHttpError(hierarchyCheck.status, hierarchyCheck.error), {
        code: hierarchyCheck.code,
      });
    }
    const currentUpdatedAt = readAdminTimestampIso(profile.updatedAt);
    if (action.expectedUpdatedAt && action.expectedUpdatedAt !== currentUpdatedAt) throw createHttpError(409, 'This user changed since the profile was opened. Refresh before continuing.');
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const update = { updatedAt: timestamp };
    if (action.action === 'suspend') {
      if (profile.moderationStatus !== 'active') throw createHttpError(409, 'Only active users can be suspended.');
      update.moderationStatus = 'suspended';
    } else if (action.action === 'unsuspend') {
      if (profile.moderationStatus !== 'suspended') throw createHttpError(409, 'Only suspended users can be restored.');
      update.moderationStatus = 'active';
    } else if (action.action === 'ban') {
      if (profile.moderationStatus === 'removed') throw createHttpError(409, 'User is already banned.');
      update.moderationStatus = 'removed';
    } else if (action.action === 'unban') {
      if (profile.moderationStatus !== 'removed') throw createHttpError(409, 'Only banned users can be restored.');
      update.moderationStatus = 'active';
    } else if (action.action === 'avatar-approve') {
      update.avatarModerationStatus = 'clear';
    } else if (action.action === 'avatar-reject') {
      update.avatarModerationStatus = 'removed';
    }
    if (Object.keys(update).length > 1) transaction.update(profileRef, update);
    if (action.action === 'mute') {
      transaction.update(profileRef, { updatedAt: timestamp });
      transaction.set(restrictionRef, {
        mutedAt: timestamp,
        mutedBy: decodedToken.uid,
        mutedUntil: admin.firestore.Timestamp.fromMillis(Date.now() + action.durationHours * 60 * 60 * 1000),
        reason: action.reason,
        uid: action.targetUid,
        updatedAt: timestamp,
      }, { merge: true });
    } else if (action.action === 'unmute') {
      const mutedUntil = restrictionSnapshot.exists ? restrictionSnapshot.data()?.mutedUntil : undefined;
      if (!mutedUntil || typeof mutedUntil.toMillis !== 'function' || mutedUntil.toMillis() <= Date.now()) {
        throw createHttpError(409, 'User does not have an active voice mute.');
      }
      transaction.update(profileRef, { updatedAt: timestamp });
      transaction.set(restrictionRef, {
        mutedAt: admin.firestore.FieldValue.delete(),
        mutedBy: admin.firestore.FieldValue.delete(),
        mutedUntil: admin.firestore.FieldValue.delete(),
        reason: action.reason,
        uid: action.targetUid,
        updatedAt: timestamp,
      }, { merge: true });
    }
    if (action.action === 'note') {
      transaction.create(noteRef, { actorEmail: decodedToken.email || '', actorUid: decodedToken.uid, createdAt: timestamp, note: action.reason, targetUid: action.targetUid });
    }
    transaction.create(auditRef, {
      action: `user-${action.action}`,
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: {
        avatarModerationStatus: update.avatarModerationStatus ?? profile.avatarModerationStatus ?? '',
        moderationStatus: update.moderationStatus ?? profile.moderationStatus ?? '',
        muted: action.action === 'mute'
          ? true
          : action.action === 'unmute'
            ? false
            : Boolean(restrictionSnapshot.data()?.mutedUntil),
      },
      before: {
        avatarModerationStatus: profile.avatarModerationStatus || '',
        moderationStatus: profile.moderationStatus || '',
        muted: Boolean(restrictionSnapshot.data()?.mutedUntil),
      },
      countryCode: typeof profile.countryCode === 'string' ? profile.countryCode.trim().toUpperCase() : '',
      createdAt: timestamp,
      durationHours: action.durationHours,
      kind: 'user-moderation',
      note: action.reason,
      requestId: action.requestId,
      status: update.moderationStatus || profile.moderationStatus || '',
      targetUid: action.targetUid,
    });
    return auditRef.id;
  });
  if (action.action === 'ban') {
    await auth.updateUser(action.targetUid, { disabled: true });
    await auth.revokeRefreshTokens(action.targetUid);
  } else if (action.action === 'unban') {
    await auth.updateUser(action.targetUid, { disabled: false });
  } else if (['force-sign-out', 'suspend'].includes(action.action)) {
    await auth.revokeRefreshTokens(action.targetUid);
  }
  return eventId;
}

function readAdminTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return '';
}

function readAdminAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function filterOperationalRowsByScope(db, rows, scope) {
  if (!scope.regionCodes) return rows;
  const roomIds = [...new Set(rows.map((row) => row.roomId).filter(Boolean))];
  const targetUids = [...new Set(rows
    .filter((row) => !row.roomId)
    .map((row) => row.targetUid || row.reporterUid)
    .filter(Boolean))];
  const [roomSnapshots, profileSnapshots] = await Promise.all([
    roomIds.length ? db.getAll(...roomIds.map((roomId) => db.doc(`rooms/${roomId}`))) : [],
    targetUids.length ? db.getAll(...targetUids.map((uid) => db.doc(`publicProfiles/${uid}`))) : [],
  ]);
  const roomCountries = new Map(roomSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, String(snapshot.data()?.countryCode || '').trim().toUpperCase()]));
  const userCountries = new Map(profileSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, String(snapshot.data()?.countryCode || '').trim().toUpperCase()]));
  return rows.filter((row) => {
    const countryCode = String(
      roomCountries.get(row.roomId)
      || userCountries.get(row.targetUid || row.reporterUid)
      || row.countryCode
      || '',
    ).trim().toUpperCase();
    return scope.regionCodes.includes(countryCode);
  }).map((row) => ({
    ...row,
    countryCode: String(
      roomCountries.get(row.roomId)
      || userCountries.get(row.targetUid || row.reporterUid)
      || row.countryCode
      || '',
    ).trim().toUpperCase(),
  }));
}

async function assertReportInOperatorScope(db, scope, report) {
  const rows = await filterOperationalRowsByScope(db, [report], scope);
  if (rows.length === 0) {
    throw Object.assign(createHttpError(403, 'This report is outside the operator region scope.'), {
      code: 'REGION_SCOPE_DENIED',
    });
  }
  return rows[0];
}

async function resolveAdminAuditEvents(db, body, scope = { ok: true, regionCodes: null }) {
  const normalized = normalizeAdminAuditQuery(body);
  const identityUids = normalized.search ? await resolveAdminIdentityUids(db, normalized.search, 20) : [];
  const query = { ...normalized, identityUids };
  let auditQuery = db.collection('adminAuditEvents').orderBy('createdAt', 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  const cursor = decodeAdminAuditCursor(query.cursor);
  if (cursor) auditQuery = auditQuery.startAfter(admin.firestore.Timestamp.fromDate(new Date(cursor.createdAt)), cursor.id);
  const snapshot = await auditQuery.limit(query.readLimit).get();
  const mappedRows = snapshot.docs
    .map((doc) => mapAdminAuditEventDocument(doc.id, doc.data()))
    .filter(Boolean);
  const rows = await filterOperationalRowsByScope(db, mappedRows, scope);
  const items = filterAdminAuditEventRows(rows, query).slice(0, query.limit);
  const hasNextPage = snapshot.size === query.readLimit;
  const cursorRow = mappedRows.at(-1);
  return {
    items,
    pageInfo: {
      hasNextPage,
      limit: query.limit,
      nextCursor: hasNextPage && cursorRow ? encodeAdminAuditCursor(cursorRow) : null,
      returned: items.length,
    },
  };
}

function encodeAdminAuditCursor(event) {
  return Buffer.from(JSON.stringify({ createdAt: event.createdAt, id: event.id }), 'utf8').toString('base64url');
}

function decodeAdminAuditCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id || typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function resolveAdminAuditSummary(db, scope = { ok: true, regionCodes: null }) {
  const [total, recentSnapshot] = await Promise.all([
    getCollectionCount(db.collection('adminAuditEvents')),
    db.collection('adminAuditEvents').orderBy('createdAt', 'desc').limit(500).get(),
  ]);
  const rows = await filterOperationalRowsByScope(
    db,
    recentSnapshot.docs.map((doc) => mapAdminAuditEventDocument(doc.id, doc.data())).filter(Boolean),
    scope,
  );
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  return {
    activeAdministrators: new Set(rows.filter((row) => row.createdAt >= todayIso).map((row) => row.actorUid).filter(Boolean)).size,
    economy: rows.filter((row) => row.entityType === 'economy' || row.kind.includes('economy')).length,
    failed: rows.filter((row) => ['failed', 'error', 'denied', 'rejected'].includes(row.status.toLowerCase())).length,
    retentionDays: 365,
    security: rows.filter((row) => /ban|suspend|mute|sign-out|security/.test(`${row.action} ${row.kind}`.toLowerCase())).length,
    today: rows.filter((row) => row.createdAt >= todayIso).length,
    total: scope.regionCodes ? rows.length : total,
  };
}

async function resolveAdminAuditDetail(db, eventId, scope = { ok: true, regionCodes: null }) {
  const snapshot = await db.collection('adminAuditEvents').doc(eventId).get();
  if (!snapshot.exists) throw createHttpError(404, 'Audit event was not found.');
  const data = snapshot.data() || {};
  const event = mapAdminAuditEventDocument(snapshot.id, data);
  if (!event) throw createHttpError(404, 'Audit event was not found.');
  if ((await filterOperationalRowsByScope(db, [event], scope)).length === 0) {
    throw Object.assign(createHttpError(403, 'This audit event is outside the operator region scope.'), {
      code: 'REGION_SCOPE_DENIED',
    });
  }
  const before = sanitizeAdminAuditValue(data.before || data.previous || {});
  let after = sanitizeAdminAuditValue(data.after || data.next || {});
  if (!after || Object.keys(after).length === 0) {
    after = sanitizeAdminAuditValue(pickAdminAuditChangeFields(data));
  }
  return {
    after,
    before,
    event,
    metadata: sanitizeAdminAuditValue(data),
    policy: {
      redactedFields: ['authorization', 'inviteCode', 'password', 'secret', 'token'],
      retentionDays: 365,
    },
  };
}

function pickAdminAuditChangeFields(data) {
  const allowed = ['amount', 'assignedTo', 'availability', 'category', 'currency', 'durationHours', 'featured', 'giftId', 'itemId', 'mutationType', 'partnerUid', 'price', 'purchasingEnabled', 'reportAction', 'roomAction', 'scoreValue', 'specialId', 'status', 'transactionId', 'userAction'];
  return Object.fromEntries(allowed.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
}

function sanitizeAdminAuditValue(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value === 'string' ? value.slice(0, 1000) : value;
  const timestamp = readAdminTimestampIso(value);
  if (timestamp) return timestamp;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAdminAuditValue(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value || '');
  const entries = Object.entries(value).slice(0, 80).map(([key, child]) => {
    const redacted = /authorization|invite.?code|password|secret|token/i.test(key);
    return [key.slice(0, 100), redacted ? '[redacted]' : sanitizeAdminAuditValue(child, depth + 1)];
  });
  return Object.fromEntries(entries);
}

async function resolveAdminAuditExport(db, body, scope = { ok: true, regionCodes: null }) {
  const normalized = normalizeAdminAuditQuery(body);
  const identityUids = normalized.search ? await resolveAdminIdentityUids(db, normalized.search, 20) : [];
  const query = { ...normalized, identityUids };
  const snapshot = await db.collection('adminAuditEvents').orderBy('createdAt', 'desc').limit(1000).get();
  const scopedRows = await filterOperationalRowsByScope(
    db,
    snapshot.docs.map((doc) => mapAdminAuditEventDocument(doc.id, doc.data())).filter(Boolean),
    scope,
  );
  const rows = filterAdminAuditEventRows(scopedRows, query).slice(0, 1000);
  const headers = ['timestamp', 'administrator', 'administrator_email', 'action', 'entity_type', 'entity_id', 'target', 'status', 'source', 'event_id', 'note'];
  const csvRows = rows.map((row) => [row.createdAt, row.actorUid, row.actorEmail, row.action, row.entityType, row.entityId, row.targetUid, row.status, row.source, row.id, row.note]);
  const csv = [headers, ...csvRows].map((row) => row.map(escapeAdminCsvCell).join(',')).join('\r\n');
  return { count: rows.length, csv, filename: `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`, truncated: rows.length >= 1000 };
}

function escapeAdminCsvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function resolveAdminStoreCatalog(db, body) {
  const query = normalizeAdminStoreCatalogQuery(body);
  let storeQuery = db.collection('storeCatalog').orderBy(admin.firestore.FieldPath.documentId());
  const cursor = decodeAdminDocumentCursor(query.cursor);
  if (cursor) storeQuery = storeQuery.startAfter(cursor.id);
  const [snapshot, storefrontSnapshot] = await Promise.all([
    storeQuery.limit(query.readLimit).get(),
    db.doc('appConfig/storefront').get(),
  ]);
  const featuredItemId = typeof storefrontSnapshot.data()?.featuredItemId === 'string'
    ? storefrontSnapshot.data().featuredItemId
    : '';
  const rows = snapshot.docs
    .map((doc) => mapAdminStoreCatalogDocument(doc.id, doc.data()))
    .filter(Boolean)
    .map((item) => ({ ...item, featured: item.itemId === featuredItemId }));
  const items = filterAdminStoreRows(rows, query).slice(0, query.limit);
  return createAdminDocumentPage(snapshot, items, query.limit, query.readLimit);
}

async function resolveAdminGiftCatalog(db, body) {
  const query = normalizeAdminStoreCatalogQuery(body);
  let catalogQuery = db.collection('giftCatalog').orderBy(admin.firestore.FieldPath.documentId());
  const cursor = decodeAdminDocumentCursor(query.cursor);
  if (cursor) catalogQuery = catalogQuery.startAfter(cursor.id);
  const snapshot = await catalogQuery.limit(query.readLimit).get();
  const rows = snapshot.docs.map((doc) => mapAdminGiftCatalogDocument(doc.id, doc.data())).filter(Boolean);
  const items = filterAdminGiftRows(rows, query).slice(0, query.limit);
  return createAdminDocumentPage(snapshot, items, query.limit, query.readLimit);
}

async function resolveAdminSpecialIdCatalog(db, body) {
  const query = normalizeAdminStoreCatalogQuery(body);
  let catalogQuery = db.collection('specialIdCatalog').orderBy(admin.firestore.FieldPath.documentId());
  const cursor = decodeAdminDocumentCursor(query.cursor);
  if (cursor) catalogQuery = catalogQuery.startAfter(cursor.id);
  const snapshot = await catalogQuery.limit(query.readLimit).get();
  const rows = snapshot.docs.map((doc) => mapAdminSpecialIdDocument(doc.id, doc.data())).filter(Boolean);
  const items = filterAdminSpecialIdRows(rows, query).slice(0, query.limit);
  return createAdminDocumentPage(snapshot, items, query.limit, query.readLimit);
}

async function resolveAdminEconomyHistory(db, body) {
  const query = normalizeAdminEconomyQuery(body);
  const targetUid = await resolveAdminEconomyTargetUid(db, query.targetUid || query.search);
  let ledgerQuery = db.collection('walletTransactions');
  if (targetUid) ledgerQuery = ledgerQuery.where('uid', '==', targetUid);
  ledgerQuery = ledgerQuery.orderBy('createdAt', 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  const cursor = decodeAdminEconomyCursor(query.cursor);
  if (cursor) ledgerQuery = ledgerQuery.startAfter(admin.firestore.Timestamp.fromDate(new Date(cursor.createdAt)), cursor.id);
  const snapshot = await ledgerQuery.limit(query.readLimit).get();
  const rows = snapshot.docs.map((doc) => mapAdminWalletTransactionDocument(doc.id, doc.data())).filter(Boolean);
  const items = filterAdminEconomyRows(rows, query).slice(0, query.limit);
  const profileUids = [...new Set(items.map((item) => item.uid))];
  const profiles = profileUids.length ? await db.getAll(...profileUids.map((uid) => db.doc(`publicProfiles/${uid}`))) : [];
  const identities = new Map(profiles.filter((profile) => profile.exists).map((profile) => [profile.id, profile.data()]));
  const decorated = items.map((item) => {
    const profile = identities.get(item.uid) || {};
    return {
      ...item,
      displayName: typeof profile.displayName === 'string' ? profile.displayName.trim().slice(0, 80) : '',
      publicId: typeof profile.publicId === 'string' ? profile.publicId.trim() : '',
      specialId: typeof profile.specialId === 'string' ? profile.specialId.trim() : '',
    };
  });
  const hasNextPage = snapshot.size === query.readLimit;
  const last = snapshot.docs.at(-1);
  return {
    items: decorated,
    pageInfo: {
      hasNextPage,
      limit: query.limit,
      nextCursor: hasNextPage && last ? encodeAdminEconomyCursor(last.id, readAdminTimestampIso(last.data()?.createdAt)) : null,
      returned: decorated.length,
    },
  };
}

async function decorateAdminEconomyRows(db, items) {
  const profileUids = [...new Set(items.map((item) => item.uid).filter(Boolean))];
  const profiles = profileUids.length ? await db.getAll(...profileUids.map((uid) => db.doc(`publicProfiles/${uid}`))) : [];
  const identities = new Map(profiles.filter((profile) => profile.exists).map((profile) => [profile.id, profile.data()]));
  return items.map((item) => {
    const profile = identities.get(item.uid) || {};
    return {
      ...item,
      displayName: typeof profile.displayName === 'string' ? profile.displayName.trim().slice(0, 80) : '',
      publicId: typeof profile.publicId === 'string' ? profile.publicId.trim() : '',
      specialId: typeof profile.specialId === 'string' ? profile.specialId.trim() : '',
    };
  });
}

async function resolveAdminEconomyExport(db, decodedToken, query) {
  const targetUid = await resolveAdminEconomyTargetUid(db, query.targetUid || query.search);
  let rows = [];
  let scanned = 0;
  if (!query.search || targetUid) {
    let ledgerQuery = db.collection('walletTransactions');
    if (targetUid) ledgerQuery = ledgerQuery.where('uid', '==', targetUid);
    const snapshot = await ledgerQuery.orderBy('createdAt', 'desc').limit(MAX_ECONOMY_EXPORT_ROWS).get();
    scanned = snapshot.size;
    rows = filterAdminEconomyRows(snapshot.docs.map((doc) => mapAdminWalletTransactionDocument(doc.id, doc.data())).filter(Boolean), query);
  }
  const decorated = await decorateAdminEconomyRows(db, rows);
  const exported = buildEconomyCsv(decorated);
  exported.truncated = scanned >= MAX_ECONOMY_EXPORT_ROWS;
  const eventId = `economy_export_${query.requestId}`;
  const event = {
    action: 'economy-export',
    actorEmail: typeof decodedToken.email === 'string' ? decodedToken.email.trim().slice(0, 160) : '',
    actorUid: decodedToken.uid,
    count: exported.count,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    entityType: 'economy',
    filters: { createdFrom: query.createdFrom, createdTo: query.createdTo, currency: query.currency, search: query.search, source: query.source, type: query.type },
    id: eventId,
    kind: 'economy-export',
    source: 'admin-dashboard',
    status: 'completed',
    truncated: exported.truncated,
  };
  await db.doc(`adminAuditEvents/${eventId}`).set(event);
  return exported;
}

async function resolveAdminStoreItemDetail(db, itemId) {
  const [catalogDoc, transactionsSnapshot, ownershipsSnapshot, auditSnapshot] = await Promise.all([
    db.doc(`storeCatalog/${itemId}`).get(),
    db.collection('storeTransactions').where('itemId', '==', itemId).limit(MAX_STORE_ITEM_TRANSACTIONS).get(),
    db.collectionGroup('items').where('itemId', '==', itemId).limit(MAX_STORE_ITEM_OWNERSHIPS).get(),
    db.collection('adminAuditEvents').where('itemId', '==', itemId).limit(MAX_STORE_ITEM_AUDIT_EVENTS).get(),
  ]);
  if (!catalogDoc.exists) return null;
  const item = mapAdminStoreCatalogDocument(catalogDoc.id, catalogDoc.data());
  if (!item) return null;
  const transactions = transactionsSnapshot.docs.map((doc) => mapStoreTransaction(doc.id, doc.data())).filter(Boolean);
  const ownerships = ownershipsSnapshot.docs.map((doc) => mapStoreOwnership(doc.id, doc.data())).filter((ownership) => ownership && ownership.itemId === itemId);
  const auditEvents = auditSnapshot.docs.map((doc) => mapAdminAuditEventDocument(doc.id, doc.data())).filter(Boolean);
  return { item, ...buildStoreItemInsights({ auditEvents, ownerships, transactions }) };
}

async function resolveAdminStoreSummary(db) {
  const [catalogItems, activeCatalogItems, gifts, activeGifts, specialIds, availableSpecialIds, transactions, catalogSnapshot, recentTransactionsSnapshot] = await Promise.all([
    getCollectionCount(db.collection('storeCatalog')),
    getCollectionCount(db.collection('storeCatalog').where('availability', '==', 'available')),
    getCollectionCount(db.collection('giftCatalog')),
    getCollectionCount(db.collection('giftCatalog').where('status', '==', 'available')),
    getCollectionCount(db.collection('specialIdCatalog')),
    getCollectionCount(db.collection('specialIdCatalog').where('status', '==', 'available')),
    getCollectionCount(db.collection('walletTransactions')),
    db.collection('storeCatalog').limit(1000).get(),
    db.collection('walletTransactions').orderBy('createdAt', 'desc').limit(1000).get(),
  ]);
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentTransactions = recentTransactionsSnapshot.docs
    .map((doc) => mapAdminWalletTransactionDocument(doc.id, doc.data()))
    .filter((item) => item && Date.parse(item.createdAt) >= dayAgo);
  const purchases = recentTransactions.filter((item) => item.type === 'purchase');
  const revenue = purchases.reduce((total, item) => {
    total[item.currency] += item.amount;
    return total;
  }, { coins: 0, diamonds: 0 });
  const soldOutItems = catalogSnapshot.docs.filter((doc) => {
    const stock = doc.data()?.stock;
    return stock?.kind === 'limited' && stock.remaining === 0;
  }).length;
  return {
    activeCatalogItems,
    activeGifts,
    availableSpecialIds,
    catalogItems,
    giftedItems24h: recentTransactions.filter((item) => item.source === 'store-gift').length,
    gifts,
    purchases24h: purchases.length,
    revenueCoins24h: revenue.coins,
    revenueDiamonds24h: revenue.diamonds,
    sampled24h: recentTransactionsSnapshot.size === 1000,
    soldOutItems,
    specialIds,
    transactions,
  };
}

function createAdminDocumentPage(snapshot, items, limit, readLimit) {
  const hasNextPage = snapshot.size === readLimit;
  const last = snapshot.docs.at(-1);
  return {
    items,
    pageInfo: {
      hasNextPage,
      limit,
      nextCursor: hasNextPage && last ? encodeAdminDocumentCursor(last.id) : null,
      returned: items.length,
    },
  };
}

function encodeAdminDocumentCursor(id) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

function decodeAdminDocumentCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed && typeof parsed.id === 'string' && parsed.id ? { id: parsed.id } : null;
  } catch {
    return null;
  }
}

function encodeAdminEconomyCursor(id, createdAt) {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeAdminEconomyCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id || typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function resolveAdminEconomyTargetUid(db, search) {
  if (!search) return '';
  const [direct, publicId, specialId] = await Promise.all([
    db.doc(`publicProfiles/${search}`).get(),
    db.collection('publicProfiles').where('publicId', '==', search).limit(1).get(),
    db.collection('publicProfiles').where('specialId', '==', search).limit(1).get(),
  ]);
  if (direct.exists) return direct.id;
  return publicId.docs[0]?.id || specialId.docs[0]?.id || search;
}

async function resolveAdminRooms(db, body, scope = { ok: true, regionCodes: null }) {
  const query = normalizeAdminRoomsQuery(body);
  let roomsQuery = db
    .collection('rooms')
    .orderBy('updatedAt', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  const cursor = decodeAdminRoomCursor(query.cursor);
  if (cursor) roomsQuery = roomsQuery.startAfter(admin.firestore.Timestamp.fromDate(new Date(cursor.updatedAt)), cursor.id);
  const [snapshot, activeReportsSnapshot] = await Promise.all([
    roomsQuery.limit(query.readLimit).get(),
    db.collection('reports').where('status', 'in', ['open', 'triage']).limit(500).get(),
  ]);
  const reportCounts = new Map();
  activeReportsSnapshot.docs.forEach((doc) => {
    const roomId = typeof doc.data()?.roomId === 'string' ? doc.data().roomId : '';
    if (roomId) reportCounts.set(roomId, (reportCounts.get(roomId) || 0) + 1);
  });
  const mappedRooms = snapshot.docs
    .map((doc) => mapAdminRoomDocument(doc.id, doc.data()))
    .filter(Boolean)
    .map((room) => ({ ...room, openReportCount: reportCounts.get(room.id) || 0 }));
  const rows = filterRowsByOperatorScope(mappedRooms, scope);
  const items = filterAdminRoomRows(rows, query).slice(0, query.limit);
  const scannedAllAvailableRows = snapshot.size < query.readLimit;
  const lastScannedRow = mappedRooms.at(-1) || null;

  return {
    items,
    pageInfo: {
      hasNextPage: !scannedAllAvailableRows,
      limit: query.limit,
      nextCursor: !scannedAllAvailableRows && lastScannedRow ? encodeAdminRoomCursor(lastScannedRow) : null,
      returned: items.length,
    },
  };
}

function encodeAdminRoomCursor(room) {
  return Buffer.from(JSON.stringify({ id: room.id, updatedAt: room.updatedAt }), 'utf8').toString('base64url');
}

function decodeAdminRoomCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id || typeof parsed.updatedAt !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt))) return null;
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

async function resolveAdminRoomSummary(db, scope = { ok: true, regionCodes: null }) {
  const [roomsSnapshot, activeReportsSnapshot] = await Promise.all([
    db.collection('rooms').limit(500).get(),
    db.collection('reports').where('status', 'in', ['open', 'triage']).limit(500).get(),
  ]);
  const rooms = filterRowsByOperatorScope(
    roomsSnapshot.docs.map((doc) => mapAdminRoomDocument(doc.id, doc.data())).filter(Boolean),
    scope,
  );
  const flaggedRoomIds = new Set(activeReportsSnapshot.docs.map((doc) => doc.data()?.roomId).filter((value) => typeof value === 'string' && value));
  const activeRooms = rooms.filter((room) => room.status === 'active');
  return {
    active: activeRooms.length,
    flagged: activeRooms.filter((room) => flaggedRoomIds.has(room.id)).length,
    games: activeRooms.filter((room) => room.type === 'game').length,
    participants: activeRooms.reduce((total, room) => total + room.participantCount, 0),
    privateRooms: activeRooms.filter((room) => room.visibility === 'private').length,
    sampled: roomsSnapshot.size === 500 || activeReportsSnapshot.size === 500,
    total: rooms.length,
  };
}

async function resolveAdminRoomDetail(db, roomId) {
  const roomRef = db.doc(`rooms/${roomId}`);
  const [roomSnapshot, membersSnapshot, presenceSnapshot, moderationSnapshot, reportsSnapshot, mediaSnapshot] = await Promise.all([
    roomRef.get(),
    roomRef.collection('members').limit(200).get(),
    roomRef.collection('presence').limit(200).get(),
    roomRef.collection('moderationEvents').orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('reports').where('roomId', '==', roomId).orderBy('updatedAt', 'desc').limit(100).get(),
    roomRef.collection('media').orderBy('createdAt', 'desc').limit(20).get(),
  ]);
  if (!roomSnapshot.exists) throw createHttpError(404, 'Room was not found.');
  const room = mapAdminRoomDocument(roomSnapshot.id, roomSnapshot.data());
  const profileRefs = membersSnapshot.docs.map((doc) => db.doc(`publicProfiles/${doc.id}`));
  const profiles = new Map();
  if (profileRefs.length) {
    const snapshots = await db.getAll(...profileRefs);
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => profiles.set(snapshot.id, snapshot.data()));
  }
  const presence = new Map(presenceSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const now = Date.now();
  const members = membersSnapshot.docs.map((doc) => {
    const data = doc.data();
    const live = presence.get(doc.id) || {};
    const profile = profiles.get(doc.id) || {};
    const lastSeenAt = readAdminTimestampIso(live.lastSeenAt);
    return {
      avatarLabel: typeof data.avatarLabel === 'string' ? data.avatarLabel.trim().slice(0, 2) : '',
      canPublishAudio: data.canPublishAudio === true,
      displayName: typeof data.displayName === 'string' ? data.displayName.trim() : '',
      joinedAt: readAdminTimestampIso(data.joinedAt),
      lastSeenAt,
      muted: Boolean(data.mutedAt),
      online: Boolean(lastSeenAt && now - Date.parse(lastSeenAt) <= 120000 && live.status === 'online'),
      publicId: typeof profile.publicId === 'string' ? profile.publicId.trim() : '',
      role: typeof data.role === 'string' ? data.role : '',
      status: typeof data.status === 'string' ? data.status : '',
      uid: doc.id,
    };
  });
  const reports = reportsSnapshot.docs.map((doc) => mapAdminReportDocument(doc.id, doc.data())).filter(Boolean);
  const moderation = moderationSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      action: typeof data.action === 'string' ? data.action : '',
      actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : '',
      actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
      createdAt: readAdminTimestampIso(data.createdAt),
      id: doc.id,
      reason: typeof data.reason === 'string' ? data.reason : '',
      targetUid: typeof data.targetUid === 'string' ? data.targetUid : '',
    };
  });
  const media = mediaSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      bytes: Number.isFinite(Number(data.bytes)) ? Number(data.bytes) : 0,
      contentType: typeof data.contentType === 'string' ? data.contentType : '',
      createdAt: readAdminTimestampIso(data.createdAt),
      height: Number.isFinite(Number(data.height)) ? Number(data.height) : 0,
      id: doc.id,
      moderationReason: typeof data.moderationReason === 'string' ? data.moderationReason : '',
      ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
      path: typeof data.path === 'string' ? data.path : '',
      status: typeof data.status === 'string' ? data.status : '',
      updatedAt: readAdminTimestampIso(data.updatedAt),
      width: Number.isFinite(Number(data.width)) ? Number(data.width) : 0,
    };
  });
  return {
    game: { currentGameId: room.currentGameId, status: room.currentGameId ? 'configured' : 'none' },
    members,
    media,
    metrics: {
      activeMembers: members.filter((member) => member.status === 'active').length,
      listeners: members.filter((member) => member.status === 'active' && member.role === 'listener').length,
      online: members.filter((member) => member.online).length,
      speakers: members.filter((member) => member.status === 'active' && ['host', 'speaker'].includes(member.role)).length,
    },
    moderation,
    reports,
    room: { ...room, openReportCount: reports.filter((report) => report.status !== 'resolved').length },
  };
}

async function resolveAdminReports(db, body, scope = { ok: true, regionCodes: null }) {
  const query = normalizeAdminReportsQuery(body);
  const identityUids = await resolveAdminReportIdentityUids(db, query.search);
  let reportsQuery = db
    .collection('reports')
    .orderBy('updatedAt', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  const cursor = decodeAdminReportCursor(query.cursor);
  if (cursor) {
    reportsQuery = reportsQuery.startAfter(admin.firestore.Timestamp.fromDate(new Date(cursor.updatedAt)), cursor.id);
  }
  const snapshot = await reportsQuery.limit(query.readLimit).get();
  const mappedRows = snapshot.docs
    .map((doc) => mapAdminReportDocument(doc.id, doc.data()))
    .filter(Boolean);
  const rows = await filterOperationalRowsByScope(db, mappedRows, scope);
  const items = filterAdminReportRows(rows, { ...query, identityUids }).slice(0, query.limit);
  const scannedAllAvailableRows = snapshot.size < query.readLimit;
  const lastScannedRow = mappedRows.at(-1) || null;

  return {
    items,
    pageInfo: {
      hasNextPage: !scannedAllAvailableRows,
      limit: query.limit,
      nextCursor: !scannedAllAvailableRows && lastScannedRow ? encodeAdminReportCursor(lastScannedRow) : null,
      returned: items.length,
    },
  };
}

async function resolveAdminReportIdentityUids(db, search) {
  if (!search || search.length > 40) return [];
  const [publicIdSnapshot, specialIdSnapshot] = await Promise.all([
    db.collection('publicProfiles').where('publicId', '==', search).limit(5).get(),
    db.collection('publicProfiles').where('specialId', '==', search).limit(5).get(),
  ]);
  return [...new Set([...publicIdSnapshot.docs, ...specialIdSnapshot.docs].map((doc) => doc.id))];
}

function encodeAdminReportCursor(report) {
  return Buffer.from(JSON.stringify({ id: report.id, updatedAt: report.updatedAt }), 'utf8').toString('base64url');
}

function decodeAdminReportCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'string') return null;
    const updatedAt = new Date(parsed.updatedAt);
    if (!parsed.id || Number.isNaN(updatedAt.getTime())) return null;
    return { id: parsed.id, updatedAt: updatedAt.toISOString() };
  } catch {
    return null;
  }
}

async function resolveAdminReportSummary(db, scope = { ok: true, regionCodes: null }) {
  const snapshot = await db.collection('reports').orderBy('updatedAt', 'desc').limit(500).get();
  const mappedReports = snapshot.docs
    .map((doc) => mapAdminReportDocument(doc.id, doc.data()))
    .filter(Boolean);
  const reports = await filterOperationalRowsByScope(db, mappedReports, scope);
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const today = new Date().toISOString().slice(0, 10);
  const active = reports.filter((report) => report.status !== 'resolved');
  return {
    open: reports.filter((report) => report.status === 'open').length,
    overdue: active.filter((report) => report.createdAt && new Date(report.createdAt).getTime() < dayAgo).length,
    resolvedToday: reports.filter((report) => report.status === 'resolved' && report.resolvedAt.startsWith(today)).length,
    sampled: snapshot.size === 500,
    triage: reports.filter((report) => report.status === 'triage').length,
    unassigned: active.filter((report) => !report.assignedTo).length,
    urgent: active.filter((report) => ['high', 'critical'].includes(report.severity)).length,
  };
}

async function resolveAdminReportDetail(
  db,
  reportId,
  scope = { ok: true, regionCodes: null },
  decodedToken = {},
) {
  const reportRef = db.collection('reports').doc(reportId);
  const reportSnapshot = await reportRef.get();
  if (!reportSnapshot.exists) {
    throw createHttpError(404, 'Report was not found.');
  }
  const report = mapAdminReportDocument(reportSnapshot.id, reportSnapshot.data());
  const scopedReport = await assertReportInOperatorScope(db, scope, report);
  if (scopedReport.evidence.length > 0) {
    const freshness = assertFreshAdminAuth(decodedToken);
    if (!freshness.ok) {
      throw Object.assign(createHttpError(freshness.status, freshness.error), {
        code: freshness.code,
      });
    }
  }
  const identityRefs = [report.reporterUid, report.targetUid]
    .filter(Boolean)
    .map((uid) => db.collection('publicProfiles').doc(uid));
  const [historySnapshot, ...identitySnapshots] = await Promise.all([
    db.collection('adminAuditEvents')
      .where('reportId', '==', reportId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
    ...identityRefs.map((ref) => ref.get()),
  ]);
  const identitiesByUid = Object.fromEntries(identitySnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => {
      const data = snapshot.data();
      return [snapshot.id, {
        displayName: typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 100) : '',
        publicId: typeof data.publicId === 'string' ? data.publicId.trim() : '',
        specialId: typeof data.specialId === 'string' ? data.specialId.trim() : '',
        uid: snapshot.id,
      }];
    }));
  return {
    history: historySnapshot.docs
      .map((doc) => mapAdminAuditEventDocument(doc.id, doc.data()))
      .filter(Boolean),
    identities: {
      reporter: identitiesByUid[report.reporterUid] || { displayName: '', publicId: report.reporterPublicId, specialId: '', uid: report.reporterUid },
      target: identitiesByUid[report.targetUid] || { displayName: '', publicId: report.targetPublicId, specialId: '', uid: report.targetUid },
    },
    report: scopedReport,
  };
}

async function recordAdminClientError(db, decodedToken, input) {
  const auditRef = db.doc(`adminAuditEvents/client_${input.requestId}`);
  const snapshot = await auditRef.get();
  if (snapshot.exists) {
    if (snapshot.data()?.actorUid === decodedToken.uid && snapshot.data()?.action === 'dashboard-client-error') return auditRef.id;
    throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
  }
  const payload = {
    action: 'dashboard-client-error', actorEmail: decodedToken.email || '', actorUid: decodedToken.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), kind: 'operational-failure', message: input.message, note: input.message,
    route: input.route, source: input.source || 'error-boundary', stack: input.stack, status: 'failed', targetUid: decodedToken.uid,
  };
  console.error('[functions.adminDashboard] client:error', { actorUid: decodedToken.uid, message: input.message, requestId: input.requestId, route: input.route, source: payload.source });
  await auditRef.create(payload);
  return auditRef.id;
}

async function resolveAdminSettings(db, auth, decodedToken) {
  const [user, preferencesSnapshot, featuresSnapshot, historySnapshot, roomGiftPolicy] = await Promise.all([
    auth.getUser(decodedToken.uid),
    db.doc(`adminPreferences/${decodedToken.uid}`).get(),
    db.doc('appConfig/socialFeatures').get(),
    db.collection('adminAuditEvents').where('kind', '==', 'administrator-security').orderBy('createdAt', 'desc').limit(20).get(),
    resolveRoomGiftPolicy(db),
  ]);
  const saved = preferencesSnapshot.exists ? preferencesSnapshot.data() : {};
  return {
    featureFlags: mergeSocialFeatureFlags(featuresSnapshot.exists ? featuresSnapshot.data() : {}),
    featureFlagsUpdatedAt: featuresSnapshot.exists ? readAdminTimestampIso(featuresSnapshot.data()?.updatedAt) || 'missing' : 'missing',
    history: historySnapshot.docs.map((doc) => mapAdminAuditEventDocument(doc.id, doc.data())).filter(Boolean),
    preferences: {
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      notifications: {
        flaggedRooms: saved.notifications?.flaggedRooms !== false,
        operationalFailures: saved.notifications?.operationalFailures !== false,
        urgentReports: saved.notifications?.urgentReports !== false,
      },
      reduceMotion: saved.reduceMotion === true,
      updatedAt: readAdminTimestampIso(saved.updatedAt),
    },
    roleDefinitions: ADMIN_ROLES.map((role) => ({ permissions: getAdminPermissions(role), role })),
    roomGiftPolicy,
    session: {
      createdAt: user.metadata.creationTime || '',
      disabled: user.disabled === true,
      emailVerified: user.emailVerified === true,
      lastSignInAt: user.metadata.lastSignInTime || '',
      tokensValidAfterAt: user.tokensValidAfterTime || '',
    },
  };
}

async function executeAdminSettingsUpdate(db, decodedToken, input) {
  const preferencesRef = db.doc(`adminPreferences/${decodedToken.uid}`);
  const auditRef = db.doc(`adminAuditEvents/settings_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [preferencesSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(preferencesRef),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) {
      if (auditSnapshot.data()?.actorUid === decodedToken.uid && auditSnapshot.data()?.action === 'admin-settings-update') return auditRef.id;
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    const before = preferencesSnapshot.exists ? preferencesSnapshot.data() : {};
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const after = { density: input.density, notifications: input.notifications, reduceMotion: input.reduceMotion };
    transaction.set(preferencesRef, { ...after, updatedAt: timestamp, updatedBy: decodedToken.uid }, { merge: true });
    transaction.create(auditRef, {
      action: 'admin-settings-update', actorEmail: decodedToken.email || '', actorUid: decodedToken.uid,
      before: { density: before.density || 'comfortable', notifications: before.notifications || {}, reduceMotion: before.reduceMotion === true },
      createdAt: timestamp, kind: 'administrator-security', status: 'completed', targetUid: decodedToken.uid, after,
    });
    return auditRef.id;
  });
}

async function executeAdminFeatureFlagUpdate(db, decodedToken, input) {
  const configRef = db.doc('appConfig/socialFeatures');
  const auditRef = db.doc(`adminAuditEvents/flag_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [configSnapshot, auditSnapshot] = await Promise.all([transaction.get(configRef), transaction.get(auditRef)]);
    if (auditSnapshot.exists) {
      const existing = auditSnapshot.data();
      if (existing?.actorUid === decodedToken.uid && existing?.flag === input.flag) return { eventId: auditRef.id, flags: existing.after || {} };
      throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
    }
    const before = mergeSocialFeatureFlags(configSnapshot.exists ? configSnapshot.data() : {});
    const currentUpdatedAt = configSnapshot.exists ? readAdminTimestampIso(configSnapshot.data()?.updatedAt) || 'missing' : 'missing';
    if (currentUpdatedAt !== input.expectedUpdatedAt) {
      throw Object.assign(new Error('Feature flags changed since they were loaded. Refresh before continuing.'), { status: 409 });
    }
    const after = mergeSocialFeatureFlags(before, { [input.flag]: input.enabled });
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(configRef, { ...after, updatedAt: timestamp, updatedBy: decodedToken.uid }, { merge: true });
    transaction.create(auditRef, {
      action: 'feature-flag-update', actorEmail: decodedToken.email || '', actorUid: decodedToken.uid,
      after, before, createdAt: timestamp, flag: input.flag, kind: 'administrator-security', note: input.reason,
      source: 'admin-dashboard', status: 'completed', targetUid: input.flag,
    });
    return { eventId: auditRef.id, flags: after };
  });
}

async function executeAdministratorAction(db, auth, decodedToken, input) {
  const actorRole = resolveAdminRole(decodedToken);
  if (actorRole !== 'owner' && !(input.action === 'revoke-sessions' && input.targetUid === decodedToken.uid)) {
    throw Object.assign(new Error('Only an owner can manage other administrator accounts.'), { status: 403 });
  }
  const auditRef = db.doc(`adminAuditEvents/admin_${input.requestId}`);
  const auditSnapshot = await auditRef.get();
  if (auditSnapshot.exists) {
    const existing = auditSnapshot.data();
    if (existing?.actorUid === decodedToken.uid && existing?.administratorAction === input.action) {
      return { eventId: auditRef.id, targetUid: existing.targetUid || '' };
    }
    throw Object.assign(new Error('Admin request ID conflicts with an existing operation.'), { status: 409 });
  }

  if (input.action === 'set-region-scope') {
    let target;
    try {
      target = await auth.getUser(input.targetUid);
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        throw Object.assign(new Error('The Firebase account was not found.'), { status: 404 });
      }
      throw error;
    }
    const targetRole = resolveAdminRole({ ...(target.customClaims || {}), admin: target.customClaims?.admin });
    if (targetRole !== 'super-moderator') {
      throw Object.assign(new Error('Region scope can only be assigned to Super Moderators.'), { status: 409 });
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const operatorProfileRef = db.doc(`adminProfiles/${target.uid}`);
    const existing = await operatorProfileRef.get();
    const beforeCodes = existing.exists && Array.isArray(existing.data()?.regionCodes)
      ? existing.data().regionCodes
      : [];
    await db.batch()
      .set(operatorProfileRef, {
        regionCodes: input.regionCodes,
        role: 'super-moderator',
        status: input.regionCodes.length > 0 ? 'active' : 'pending',
        uid: target.uid,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true })
      .create(auditRef, {
        action: 'super-moderator-scope-update',
        administratorAction: input.action,
        actorEmail: decodedToken.email || '',
        actorUid: decodedToken.uid,
        after: { regionCodes: input.regionCodes, status: input.regionCodes.length > 0 ? 'active' : 'pending' },
        before: { regionCodes: beforeCodes },
        createdAt: timestamp,
        kind: 'administrator-security',
        note: input.reason,
        source: 'admin-dashboard',
        status: 'completed',
        targetEmail: target.email || '',
        targetUid: target.uid,
      })
      .commit();
    return { eventId: auditRef.id, targetUid: target.uid };
  }

  let target;
  try {
    target = input.action === 'grant-role' ? await auth.getUserByEmail(input.email) : await auth.getUser(input.targetUid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') throw Object.assign(new Error('The Firebase account was not found.'), { status: 404 });
    throw error;
  }
  if (!target.emailVerified && input.action === 'grant-role') throw Object.assign(new Error('The account email must be verified before granting administrator access.'), { status: 409 });

  const oldRole = resolveAdminRole({ ...(target.customClaims || {}), admin: target.customClaims?.admin });
  if (input.action === 'grant-role' && oldRole) throw Object.assign(new Error('This account is already an administrator. Change its role instead.'), { status: 409 });
  if (input.action !== 'grant-role' && !oldRole) throw Object.assign(new Error('This account is not an active administrator.'), { status: 409 });
  if (target.uid === decodedToken.uid && ['change-role', 'remove-admin'].includes(input.action)) {
    throw Object.assign(new Error('You cannot demote or remove your own administrator account.'), { status: 409 });
  }

  if (oldRole === 'owner' && ['change-role', 'remove-admin'].includes(input.action)) {
    const administrators = await resolveAdminAdministrators(auth, db);
    if (administrators.filter((item) => item.role === 'owner').length <= 1) throw Object.assign(new Error('The final owner cannot be demoted or removed.'), { status: 409 });
  }

  const newRole = input.action === 'remove-admin' ? '' : input.action === 'revoke-sessions' ? oldRole : input.role;
  if (input.action !== 'revoke-sessions') {
    const nextClaims = createAdminClaims(target.customClaims || {}, input.action !== 'remove-admin', newRole || 'owner');
    await auth.setCustomUserClaims(target.uid, nextClaims);
  }
  await auth.revokeRefreshTokens(target.uid);

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.create(auditRef, {
    action: `administrator-${input.action}`, administratorAction: input.action, actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid, before: { role: oldRole || 'none' }, after: { role: newRole || 'none' },
    createdAt: timestamp, kind: 'administrator-security', note: input.reason, source: 'admin-dashboard', status: 'completed',
    targetEmail: target.email || '', targetUid: target.uid,
  });
  if (input.action !== 'revoke-sessions' && (oldRole === 'super-moderator' || newRole === 'super-moderator')) {
    const operatorProfileRef = db.doc(`adminProfiles/${target.uid}`);
    const existingOperatorProfile = await operatorProfileRef.get();
    const existingRegionCodes = existingOperatorProfile.exists && Array.isArray(existingOperatorProfile.data()?.regionCodes)
      ? existingOperatorProfile.data().regionCodes
      : [];
    const isSuperModerator = newRole === 'super-moderator';
    batch.set(operatorProfileRef, {
      regionCodes: isSuperModerator ? existingRegionCodes : [],
      role: isSuperModerator ? 'super-moderator' : newRole || 'none',
      status: isSuperModerator && existingRegionCodes.length > 0 ? 'active' : isSuperModerator ? 'pending' : 'revoked',
      uid: target.uid,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    }, { merge: true });
  }
  await batch.commit();
  return { eventId: auditRef.id, targetUid: target.uid };
}

async function resolveAdminAdministrators(auth, db = null) {
  const administrators = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    administrators.push(...page.users
      .filter((user) => user.customClaims && user.customClaims.admin === true && Boolean(resolveAdminRole(user.customClaims)))
      .map((user) => ({
        createdAt: user.metadata.creationTime || '',
        disabled: user.disabled === true,
        displayName: user.displayName || '',
        email: user.email || '',
        lastSignInAt: user.metadata.lastSignInTime || '',
        regionCodes: [],
        role: resolveAdminRole(user.customClaims),
        scopeStatus: '',
        tokensValidAfterAt: user.tokensValidAfterTime || '',
        uid: user.uid,
      })));
    pageToken = page.pageToken;
  } while (pageToken);
  if (db) {
    await Promise.all(administrators.map(async (administrator) => {
      if (administrator.role !== 'super-moderator') return;
      const snapshot = await db.doc(`adminProfiles/${administrator.uid}`).get();
      if (!snapshot.exists) {
        administrator.scopeStatus = 'pending';
        return;
      }
      const data = snapshot.data();
      administrator.regionCodes = Array.isArray(data.regionCodes) ? data.regionCodes : [];
      administrator.scopeStatus = typeof data.status === 'string' ? data.status : '';
    }));
  }
  return administrators.sort((left, right) => (left.displayName || left.email || left.uid).localeCompare(right.displayName || right.email || right.uid));
}

async function executeAdminReportAction(
  db,
  decodedToken,
  action,
  scope = { ok: true, regionCodes: null },
) {
  const preflightSnapshot = await db.collection('reports').doc(action.reportId).get();
  if (!preflightSnapshot.exists) {
    throw createHttpError(404, 'Admin report action requires an existing report.');
  }
  const scopedReport = await assertReportInOperatorScope(
    db,
    scope,
    mapAdminReportDocument(preflightSnapshot.id, preflightSnapshot.data()),
  );
  if (['escalate', 'reopen', 'resolve'].includes(action.action)) {
    const freshness = assertFreshAdminAuth(decodedToken);
    if (!freshness.ok) {
      throw Object.assign(createHttpError(freshness.status, freshness.error), {
        code: freshness.code,
      });
    }
  }
  return db.runTransaction(async (transaction) => {
    const reportRef = db.collection('reports').doc(action.reportId);
    const auditRef = db.collection('adminAuditEvents').doc(`report_${action.requestId}`);
    const [auditSnapshot, reportSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(reportRef),
    ]);

    if (auditSnapshot.exists) {
      const prior = auditSnapshot.data();
      if (prior.actorUid !== decodedToken.uid || prior.reportId !== action.reportId) {
        throw createHttpError(409, 'This request identifier was already used.');
      }
      return auditRef.id;
    }

    if (!reportSnapshot.exists) {
      throw createHttpError(404, 'Admin report action requires an existing report.');
    }

    const report = reportSnapshot.data();
    const currentReport = mapAdminReportDocument(reportSnapshot.id, report);
    if (action.expectedUpdatedAt && currentReport.updatedAt !== action.expectedUpdatedAt) {
      throw createHttpError(409, 'This report changed since it was opened. Refresh it before continuing.');
    }
    const assignedTo = action.assigneeUid || decodedToken.uid;
    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: decodedToken.uid,
    };

    if (action.action === 'assign') {
      if (report.status === 'resolved') {
        throw createHttpError(409, 'Resolved reports cannot be assigned.');
      }

      update.assignedAt = admin.firestore.FieldValue.serverTimestamp();
      update.assignedBy = decodedToken.uid;
      update.assignedTo = assignedTo;
      update.status = 'triage';
    }

    if (action.action === 'triage') {
      if (report.status === 'resolved') throw createHttpError(409, 'Resolved reports must be reopened first.');
      update.assignedAt = report.assignedAt || admin.firestore.FieldValue.serverTimestamp();
      update.assignedBy = report.assignedBy || decodedToken.uid;
      update.assignedTo = report.assignedTo || assignedTo;
      update.status = 'triage';
    }

    if (action.action === 'resolve') {
      update.resolutionNote = action.note;
      update.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
      update.resolvedBy = decodedToken.uid;
      update.status = 'resolved';
    }

    if (action.action === 'reopen') {
      if (report.status !== 'resolved') throw createHttpError(409, 'Only resolved reports can be reopened.');
      update.resolutionNote = admin.firestore.FieldValue.delete();
      update.resolvedAt = admin.firestore.FieldValue.delete();
      update.resolvedBy = admin.firestore.FieldValue.delete();
      update.status = 'open';
    }

    if (action.action === 'escalate') {
      if (report.status === 'resolved') throw createHttpError(409, 'Resolved reports must be reopened first.');
      update.assignedTo = report.assignedTo || assignedTo;
      update.escalatedAt = admin.firestore.FieldValue.serverTimestamp();
      update.escalatedBy = decodedToken.uid;
      update.severity = 'critical';
      update.status = 'triage';
    }

    if (action.action === 'note') {
      update.noteCount = admin.firestore.FieldValue.increment(1);
    }

    transaction.update(reportRef, update);
    transaction.set(auditRef, {
      action: `report-${action.action}`,
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      after: {
        assignedTo: update.assignedTo || report.assignedTo || '',
        severity: update.severity || report.severity || 'medium',
        status: update.status || report.status || 'open',
      },
      assignedTo: update.assignedTo || report.assignedTo || '',
      before: {
        assignedTo: report.assignedTo || '',
        severity: report.severity || 'medium',
        status: report.status || 'open',
      },
      countryCode: scopedReport.countryCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      kind: 'report-workflow',
      note: action.note || '',
      reportId: action.reportId,
      requestId: action.requestId,
      severity: update.severity || report.severity || 'medium',
      status: update.status || report.status || 'open',
      targetUid: report.targetUid || '',
    });

    return auditRef.id;
  });
}

async function executeAdminRoomAction(db, decodedToken, action, scope = { ok: true, regionCodes: null }) {
  const requiresFreshAuth = [
    'clear-staff-lockdown',
    'close-room',
    'kick-everyone',
    'remove-member',
    'reopen-room',
    'reverse-ownership-transfer',
    'staff-lockdown',
  ].includes(action.action);
  if (requiresFreshAuth) {
    const freshness = assertFreshAdminAuth(decodedToken);
    if (!freshness.ok) {
      throw Object.assign(createHttpError(freshness.status, freshness.error), {
        code: freshness.code,
      });
    }
  }
  if (scope.role === 'super-moderator' && action.action === 'transfer-host') {
    throw Object.assign(createHttpError(403, 'Super Moderators cannot transfer room ownership or hosting.'), {
      code: 'FORBIDDEN',
    });
  }
  if (
    action.action === 'staff-lockdown'
    || action.action === 'kick-everyone'
    || action.action === 'clear-staff-lockdown'
    || (
      scope.role === 'super-moderator'
      && ['close-room', 'mute-member', 'remove-member', 'unmute-member'].includes(action.action)
    )
  ) {
    const roomSnapshot = await db.doc(`rooms/${action.roomId}`).get();
    if (!roomSnapshot.exists) throw createHttpError(404, 'Admin room action requires an existing room.');
    const room = roomSnapshot.data();
    const scopeCheck = assertRoomInOperatorScope(scope, room);
    if (!scopeCheck.ok) throw createHttpError(scopeCheck.status, scopeCheck.error);
    const result = await executeRoomCommand({
      body: {
        action: action.action,
        expectedRevision: Number.isInteger(room.revision) ? room.revision : 1,
        reason: action.reason,
        requestId: action.requestId,
        roomId: action.roomId,
        targetUid: action.targetUid,
      },
      db,
      decodedToken,
      fieldValue: admin.firestore.FieldValue,
    });
    if (!result.ok) {
      throw Object.assign(new Error(result.error || 'Room command failed.'), {
        status: result.status || 400,
        code: result.code,
      });
    }
    if (result.liveKit?.type !== 'none') {
      const roomService = new RoomServiceClient(
        liveKitUrl.value(),
        liveKitApiKey.value(),
        liveKitApiSecret.value(),
      );
      try {
        await synchronizeRoomCommandLiveKit({
          db,
          fieldValue: admin.firestore.FieldValue,
          liveKit: result.liveKit,
          requestId: result.result.requestId,
          roomId: result.result.roomId,
          roomService,
        });
      } catch (error) {
        console.error('[functions.adminDashboard] livekit-sync:pending', {
          action: action.action,
          errorMessage: error instanceof Error ? error.message : String(error),
          requestId: action.requestId,
          roomId: action.roomId,
        });
      }
    }
    return `command_${action.requestId}`;
  }

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${action.roomId}`);
    const auditRef = db.doc(`adminAuditEvents/room_${action.requestId}`);
    const targetRef = action.targetUid ? roomRef.collection('members').doc(action.targetUid) : null;
    const targetOperatorRef = action.targetUid ? db.doc(`adminProfiles/${action.targetUid}`) : null;
    const [roomSnapshot, auditSnapshot, targetSnapshot, targetOperatorSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(auditRef),
      targetRef ? transaction.get(targetRef) : Promise.resolve(null),
      targetOperatorRef ? transaction.get(targetOperatorRef) : Promise.resolve(null),
    ]);

    if (!roomSnapshot.exists) {
      throw createHttpError(404, 'Admin room action requires an existing room.');
    }
    const room = roomSnapshot.data();
    const scopeCheck = assertRoomInOperatorScope(scope, room);
    if (!scopeCheck.ok) throw createHttpError(scopeCheck.status, scopeCheck.error);
    if (auditSnapshot.exists) {
      const previous = auditSnapshot.data();
      if (previous.action === action.action && previous.actorUid === decodedToken.uid && previous.roomId === action.roomId && previous.targetUid === action.targetUid) return auditRef.id;
      throw createHttpError(409, 'This request identifier was already used.');
    }

    const currentUpdatedAt = readAdminTimestampIso(room.updatedAt);
    if (action.expectedUpdatedAt && action.expectedUpdatedAt !== currentUpdatedAt) throw createHttpError(409, 'This room changed since it was opened. Refresh before continuing.');
    if (room.staffLockdown && action.action === 'reopen-room') {
      throw createHttpError(403, 'Clear staff lockdown before reopening this room.');
    }
    const target = targetSnapshot?.exists ? targetSnapshot.data() : undefined;
    if (action.targetUid) {
      const hierarchyCheck = assertAdminTargetHierarchy(
        resolveAdminRole(decodedToken),
        targetOperatorSnapshot?.exists ? targetOperatorSnapshot.data() : undefined,
        action.targetUid,
      );
      if (!hierarchyCheck.ok) {
        throw Object.assign(createHttpError(hierarchyCheck.status, hierarchyCheck.error), {
          code: hierarchyCheck.code,
        });
      }
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const eventRef = roomRef.collection('moderationEvents').doc(action.requestId);
    const actionPayload = {
      action: action.action,
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      before: {
        availability: room.availability || '',
        hostId: room.hostId || '',
        status: room.status || '',
        targetMuted: Boolean(target?.mutedAt),
        targetStatus: target?.status || '',
      },
      countryCode: typeof room.countryCode === 'string' ? room.countryCode.trim().toUpperCase() : '',
      createdAt: timestamp,
      reason: action.reason,
      requestId: action.requestId,
      roomId: action.roomId,
      targetUid: action.targetUid || '',
    };

    if (action.action === 'close-room') {
      if (room.status === 'closed') throw createHttpError(409, 'Room is already closed.');
      transaction.update(roomRef, { status: 'closed', updatedAt: timestamp, updatedBy: decodedToken.uid });
    } else if (action.action === 'reopen-room') {
      if (room.status !== 'closed') throw createHttpError(409, 'Only closed rooms can be reopened.');
      if (room.deletionStatus === 'finalized' || room.availability === 'purged') {
        throw createHttpError(409, 'The room recovery period has ended.');
      }
      const recoveringRemoval = room.availability === 'removed' && room.deletionStatus === 'recoverable';
      if (!recoveringRemoval) {
        const hostSnapshot = room.hostId === action.targetUid && targetSnapshot
          ? targetSnapshot
          : await transaction.get(roomRef.collection('members').doc(room.hostId));
        if (!hostSnapshot?.exists || hostSnapshot.data()?.status !== 'active') {
          throw createHttpError(409, 'The room host must have an active membership before reopening.');
        }
      }
      transaction.update(roomRef, {
        ...(recoveringRemoval
          ? {
            availability: 'active',
            deletionStatus: admin.firestore.FieldValue.delete(),
            removalReason: admin.firestore.FieldValue.delete(),
            removedAt: admin.firestore.FieldValue.delete(),
            removedBy: admin.firestore.FieldValue.delete(),
            scheduledDeletionAt: admin.firestore.FieldValue.delete(),
          }
          : {}),
        status: 'active',
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    } else if (action.action === 'reverse-ownership-transfer') {
      if (resolveAdminRole(decodedToken) !== 'owner') {
        throw createHttpError(403, 'Only the Platform Owner can reverse a fraudulent ownership transfer.');
      }
      if (room.status !== 'active' || room.availability !== 'active') {
        throw createHttpError(409, 'Ownership reversal requires an active room.');
      }
      if (!room.lastOwnershipTransferId) {
        throw createHttpError(409, 'This room has no reversible ownership transfer.');
      }
      const transferRef = roomRef.collection('ownershipTransfers').doc(room.lastOwnershipTransferId);
      const transferSnapshot = await transaction.get(transferRef);
      if (
        !transferSnapshot.exists
        || transferSnapshot.data()?.status !== 'accepted'
        || transferSnapshot.data()?.fromUid !== action.targetUid
        || transferSnapshot.data()?.toUid !== (room.ownerUid || room.hostId)
      ) {
        throw createHttpError(409, 'The latest accepted transfer does not match this reversal.');
      }
      if (!target || target.status !== 'active' || target.authorityRole !== 'moderator') {
        throw createHttpError(409, 'The former owner must have an active moderator membership.');
      }
      const currentOwnerUid = room.ownerUid || room.hostId;
      const currentOwnerRef = roomRef.collection('members').doc(currentOwnerUid);
      const currentOwnerSnapshot = await transaction.get(currentOwnerRef);
      if (!currentOwnerSnapshot.exists || currentOwnerSnapshot.data()?.status !== 'active') {
        throw createHttpError(409, 'The current owner membership is not active.');
      }
      const currentOwner = currentOwnerSnapshot.data();
      transaction.update(currentOwnerRef, {
        authorityRole: 'moderator',
        role: currentOwner.seatId ? 'speaker' : 'listener',
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
      transaction.update(targetRef, {
        authorityRole: 'owner',
        role: 'host',
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
      transaction.update(transferRef, {
        reversalAuditId: auditRef.id,
        reversedAt: timestamp,
        reversedBy: decodedToken.uid,
        reversalReason: action.reason,
        status: 'reversed',
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        hostAvatarLabel: target.avatarLabel || '',
        hostDisplayName: target.displayName || '',
        hostId: action.targetUid,
        lastOwnershipTransferredAt: timestamp,
        lastOwnershipTransferId: admin.firestore.FieldValue.delete(),
        ownerAvatarLabel: target.avatarLabel || '',
        ownerDisplayName: target.displayName || '',
        ownerUid: action.targetUid,
        ownershipRevision: Number.isInteger(room.ownershipRevision) ? room.ownershipRevision + 1 : 2,
        ownershipTransferCooldownUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revision: Number.isInteger(room.revision) ? room.revision + 1 : 2,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    } else if (['mute-member', 'remove-member', 'transfer-host', 'unmute-member'].includes(action.action)) {
      if (room.status !== 'active') throw createHttpError(409, 'Participant actions require an active room.');
      if (!target || target.status !== 'active') throw createHttpError(409, 'An active target participant is required.');
      if (action.action !== 'transfer-host' && action.targetUid === room.hostId) throw createHttpError(409, 'Use host transfer before moderating the current host.');

      if (action.action === 'remove-member') {
        transaction.update(targetRef, {
          canPublishAudio: false,
          removedAt: timestamp,
          removedBy: decodedToken.uid,
          status: 'removed',
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        transaction.update(roomRef, { participantCount: Math.max(0, readAdminAmount(room.participantCount) - 1), updatedAt: timestamp, updatedBy: decodedToken.uid });
      } else if (action.action === 'mute-member') {
        if (target.mutedAt) throw createHttpError(409, 'Participant is already muted.');
        transaction.update(targetRef, { canPublishAudio: false, mutedAt: timestamp, mutedBy: decodedToken.uid, muteReason: action.reason, updatedAt: timestamp, updatedBy: decodedToken.uid });
        transaction.update(roomRef, { updatedAt: timestamp, updatedBy: decodedToken.uid });
      } else if (action.action === 'unmute-member') {
        if (!target.mutedAt) throw createHttpError(409, 'Participant is not muted.');
        transaction.update(targetRef, {
          canPublishAudio: target.role === 'speaker',
          mutedAt: admin.firestore.FieldValue.delete(),
          mutedBy: admin.firestore.FieldValue.delete(),
          muteReason: admin.firestore.FieldValue.delete(),
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        transaction.update(roomRef, { updatedAt: timestamp, updatedBy: decodedToken.uid });
      } else if (action.action === 'transfer-host') {
        if (action.targetUid === room.hostId) throw createHttpError(409, 'Participant is already the room host.');
        if (target.mutedAt) throw createHttpError(409, 'A muted participant cannot become host until the mute is lifted.');
        const oldHostRef = roomRef.collection('members').doc(room.hostId);
        const oldHostSnapshot = await transaction.get(oldHostRef);
        if (!oldHostSnapshot.exists || oldHostSnapshot.data()?.status !== 'active') throw createHttpError(409, 'Current host membership is not active.');
        transaction.update(oldHostRef, { canPublishAudio: true, role: 'speaker', updatedAt: timestamp, updatedBy: decodedToken.uid });
        transaction.update(targetRef, { canPublishAudio: true, role: 'host', updatedAt: timestamp, updatedBy: decodedToken.uid });
        transaction.update(roomRef, {
          hostAvatarLabel: typeof target.avatarLabel === 'string' ? target.avatarLabel : '',
          hostDisplayName: typeof target.displayName === 'string' ? target.displayName : '',
          hostId: action.targetUid,
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
      }
    }

    const afterPayload = {
      availability: action.action === 'reopen-room' ? 'active' : room.availability || '',
      hostId: action.action === 'transfer-host' ? action.targetUid : room.hostId || '',
      status: action.action === 'close-room'
        ? 'closed'
        : action.action === 'reopen-room'
          ? 'active'
          : room.status || '',
      targetMuted: action.action === 'mute-member'
        ? true
        : action.action === 'unmute-member'
          ? false
          : Boolean(target?.mutedAt),
      targetStatus: action.action === 'remove-member' ? 'removed' : target?.status || '',
    };
    transaction.create(eventRef, {
      ...actionPayload,
      after: afterPayload,
      regionCode: actionPayload.countryCode,
    });
    transaction.create(auditRef, {
      ...actionPayload,
      after: afterPayload,
      eventPath: eventRef.path,
      kind: 'room-moderation',
      status: action.action === 'close-room' ? 'closed' : action.action === 'reopen-room' ? 'active' : room.status,
    });

    return auditRef.id;
  });
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function createAdminUserNote(
  db,
  decodedToken,
  note,
  scope = { ok: true, regionCodes: null },
) {
  const noteRef = db.collection('adminUserNotes').doc();
  const profileSnapshot = await db.doc(`publicProfiles/${note.targetUid}`).get();

  await noteRef.set({
    actorRegionCodes: scope.regionCodes || [],
    actorRole: resolveAdminRole(decodedToken),
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    countryCode: String(profileSnapshot.data()?.countryCode || '').trim().toUpperCase(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    note: note.note,
    targetUid: note.targetUid,
  });

  return noteRef.id;
}

async function getCollectionCount(query) {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function getCollectionGroupCount(query) {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}
