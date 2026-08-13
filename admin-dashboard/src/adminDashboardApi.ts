import { User } from 'firebase/auth';

import { ADMIN_REQUEST_TIMEOUT_MS, adminRequestErrorMessage, shouldRetryAdminRequest } from './adminRequestPolicy';

export type AdminDashboardSession = {
  admin: true;
  email: string;
  permissions: string[];
  role: AdminRole;
  uid: string;
};

export type AdminRole = 'owner' | 'super-moderator' | 'moderator' | 'support' | 'catalog-manager' | 'auditor';

export type AdminPageInfo = {
  hasNextPage: boolean | null;
  limit: number;
  nextCursor: string | null;
  returned: number;
};

export type AdminListPage<T> = {
  items: T[];
  pageInfo: AdminPageInfo;
};

export class AdminDashboardRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminDashboardRequestError';
    this.status = status;
  }
}

export type AdminOverviewMetrics = {
  activeRooms: number;
  adminAuditEvents: number;
  gameRooms: number;
  generatedAt: string;
  growthHealth: {
    emptyRoomJoinRate: number;
    emptyRoomJoins: number;
    giftGmvCoins: number;
    giftGmvDiamonds: number;
    matchAttempts: number;
    matchRoomLandings: number;
    matchToRoomRate: number;
    nonemptyRoomJoins: number;
    softMatchAttempts: number;
    softMatchPaired: number;
    softMatchPairRate: number;
    stageId: number;
    stageName: string;
    vipConversions: number;
  };
  moderationEvents: number;
  privateRooms: number;
  reports: number;
  systemStatus: 'ok';
  users: number;
};

export type AdminAuditEventRow = {
  action: string;
  actorEmail: string;
  actorUid: string;
  assignedTo: string;
  createdAt: string;
  entityId: string;
  entityType: 'catalog' | 'economy' | 'report' | 'room' | 'system' | 'user';
  eventPath: string;
  id: string;
  kind: string;
  note: string;
  publicId: string;
  reportId: string;
  roomId: string;
  source: string;
  status: string;
  targetUid: string;
  category: string;
  itemId: string;
};

export type AdminAuditFilters = {
  actorUid?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
  entityType?: '' | AdminAuditEventRow['entityType'];
  eventAction?: string;
  kind?: string;
  search?: string;
  status?: string;
  target?: string;
};

export type AdminAuditSummary = {
  activeAdministrators: number;
  economy: number;
  failed: number;
  retentionDays: number;
  security: number;
  today: number;
  total: number;
};

export type AdminAuditDetail = {
  after: unknown;
  before: unknown;
  event: AdminAuditEventRow;
  metadata: unknown;
  policy: { redactedFields: string[]; retentionDays: number };
};

export type AdminAuditExport = { count: number; csv: string; filename: string; truncated: boolean };

export type AdminStoreCatalogItem = {
  availability: 'available' | 'disabled' | 'unavailable';
  category: 'game-items' | 'chat-themes' | 'avatar-frames' | 'profile-skins' | 'chat-bubbles' | 'nameplates' | 'cosmetic-badges' | 'seat-effects' | 'couple-effects' | 'stickers' | 'cars' | 'custom-ids';
  cosmeticAsset?: { assetId: string; assetVersionId: string };
  coupleEffectPresentation?: {
    borderMode: 'off' | 'static' | 'looping';
    entranceMode: 'off' | 'static' | 'one-shot';
    profileMode: 'off' | 'static' | 'looping';
  };
  customId?: string;
  createdAt: string;
  description: { ar: string; en: string };
  duration: { kind: 'permanent' } | { kind: 'timed'; unit: 'days' | 'weeks' | 'months'; value: number };
  entryPresentation?: AdminEntryPresentation;
  featured: boolean;
  itemId: string;
  lastEditorEmail: string;
  lastEditorUid: string;
  name: { ar: string; en: string };
  order: number;
  previewAssetUrl: string;
  prices: { coins?: number; diamonds?: number };
  purchasingEnabled: boolean;
  stickerAsset?: { assetId: string; assetVersionId: string };
  stock: { kind: 'unlimited' } | { kind: 'limited'; remaining: number };
  thumbnailUrl: string;
  updatedAt: string;
};

export type AdminEntryPresentation = {
  animationEnabled: boolean;
  audioAsset?: { assetId: string; assetVersionId: string };
  audioFormat?: 'm4a-aac';
  durationMs: number;
  fallbackAsset?: { assetId: string; assetVersionId: string };
  fallbackFormat?: 'png' | 'legacy-webp';
  minimumClientVersion: string;
  performanceTier: 'low' | 'standard' | 'high';
  physicalApprovalReceiptId?: string;
  schemaVersion: 1;
  soundPolicy: 'off' | 'soft' | 'full';
  visualAsset?: { assetId: string; assetVersionId: string };
  visualFormat?: 'lottie-json' | 'mp4';
};

export type AdminEntryPhysicalApproval = {
  androidDevice: string;
  androidPassed: boolean;
  controlsSafeZonePassed: boolean;
  iosDevice: string;
  iosPassed: boolean;
  notes: string;
  opaqueCompositionPassed: boolean;
  testedClientVersion: string;
};

export type AdminRoomThemeSeat = {
  seatNumber: number;
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type AdminRoomThemeManifest = {
  manifestVersion: 1 | 2 | 3;
  themeId: string;
  publicationStatus: 'draft' | 'published' | 'disabled';
  renderingEnabled: boolean;
  purchasingEnabled: boolean;
  minimumClientVersion: string;
  revision: number;
  assets: Record<'background' | 'stage' | 'emptySeatFrame' | 'badge' | 'dock' | 'drawer', { uri: string; version: number } | null>;
  colors: Record<'background' | 'panel' | 'panelRaised' | 'ruby' | 'rubyBright' | 'gold' | 'goldSoft' | 'text' | 'textMuted', string>;
  layouts: Record<'5' | '10' | '15' | '20', AdminRoomThemeSeat[]>;
  motion?: {
    background: { assetId: string; assetVersionId: string } | null;
    ambient: Array<{
      id: string;
      asset: { assetId: string; assetVersionId: string };
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  };
  scene?: {
    background: { fit: 'cover' | 'contain'; focalX: number; focalY: number };
    stage: { fit: 'cover' | 'contain'; focalX: number; focalY: number };
    profiles: Record<'compact' | 'standard' | 'tall', {
      layouts: Record<'5' | '10' | '15' | '20', AdminRoomThemeSeat[]>;
    }>;
  };
};

export type AdminRoomThemeDetail = {
  manifest: AdminRoomThemeManifest | null;
  versions: Array<{ manifest: AdminRoomThemeManifest; revision: number }>;
};

export type AdminCosmeticAssetSummary = {
  id: string;
  assetId: string;
  approvedVersionId?: string;
  approvalId?: string;
  category: string;
  currentVersionId?: string;
  moderationStatus: 'draft' | 'processing' | 'pending' | 'approved' | 'rejected' | 'suspended';
  ownerType: 'platform' | 'user';
  ownerUid?: string;
  pendingVersionId?: string;
  publicationStatus: 'unpublished' | 'published' | 'disabled';
  publishedVersionId?: string;
  renderingEnabled: boolean;
  revision: number;
  slot?: string;
  updatedAt?: string;
};

export type AdminCosmeticAssetVersion = {
  id: string;
  assetId: string;
  assetVersionId: string;
  audioAssetId?: string;
  audioAssetVersionId?: string;
  byteSize: number;
  category: string;
  contentType: string;
  createdAt?: string;
  durationMs: number;
  fallbackAssetId?: string;
  fallbackAssetVersionId?: string;
  format: string;
  frameRate: number;
  height: number;
  sha256: string;
  storagePath: string;
  transparent: boolean;
  width: number;
};

export type AdminCosmeticAssetApproval = {
  id: string;
  assetId: string;
  assetVersionId: string;
  checksum: string;
  createdAt?: string;
  decision: 'approved' | 'rejected';
  reason: string;
  reviewerUid: string;
};

export type AdminCosmeticAssetDetail = {
  asset: AdminCosmeticAssetSummary | null;
  approvals: AdminCosmeticAssetApproval[];
  versions: AdminCosmeticAssetVersion[];
};

export type AdminRocketAsset = {
  bytes: number;
  durationMs?: number;
  format: 'png' | 'webp' | 'animated-webp' | 'mp4' | 'lottie-json' | 'mp3' | 'm4a';
  height?: number;
  storagePath: string;
  uri: string;
  version: number;
  width?: number;
};

export type AdminRocketRewardBundle = {
  coins: number;
  diamonds: number;
  items: Array<{ itemId: string; duplicateFallback?: { amount: number; currency: 'coins' | 'diamonds' } }>;
  schemaVersion: 1;
};

export type AdminRocketTemplate = {
  animationApproval?: {
    approvalId: string;
    fallbackVerified: true;
    memoryVerified: true;
    physicalAndroidDevice: string;
    reducedMotionVerified: true;
    testedClientVersion: string;
  };
  appearance: {
    animationAsset?: AdminRocketAsset;
    name: { ar: string; en: string };
    soundAsset?: AdminRocketAsset;
    staticAsset?: AdminRocketAsset;
  };
  enabledRankCount: 1 | 2 | 3;
  minimumClientVersion: string;
  publicationStatus: 'draft' | 'published' | 'disabled';
  rewards: Partial<Record<'1' | '2' | '3', AdminRocketRewardBundle>>;
  schemaVersion: 1;
  targetSupportPoints: number;
  templateId: 'global-room-rocket';
  templateVersion: 1;
  timeZone: string;
};

export type AdminRocketCampaignDetail = {
  campaign: {
    draft?: AdminRocketTemplate;
    emergencyDisabled: boolean;
    lastPublishedRevision: number;
    nextEffectiveCycleId: string;
    revision: number;
  } | null;
  operations: {
    activeCycleCount: number;
    activeCycles: Array<{
      cycleId: string;
      endAtMillis: number;
      roomId: string;
      state: string;
      supportPoints: number;
      targetSupportPoints: number;
    }>;
    qualifyingRoomCount: number;
    settlementCounts: Record<string, number>;
    settledRewards: { coins: number; diamonds: number; itemGrantCount: number };
    settlementSampleLimited: boolean;
  };
  versions: Array<{
    effectiveFromAtMillis: number;
    effectiveFromCycleId: string;
    revision: number;
    rewardLiability: { coins: number; diamonds: number; itemGrantCount: number; rankCount: number };
    template: AdminRocketTemplate;
  }>;
};

export type AdminDailyLoginRewardItem = {
  duplicateFallback?: { amount: number; currency: 'coins' | 'diamonds' };
  itemId: string;
};

export type AdminDailyLoginRewardBundle = {
  coins: number;
  diamonds: number;
  items: AdminDailyLoginRewardItem[];
  schemaVersion: 1;
};

export type AdminDailyLoginTemplate = {
  minimumClientVersion: string;
  rewards: Array<{ day: number; reward: AdminDailyLoginRewardBundle }>;
  schemaVersion: 1;
  timeZone: 'Asia/Baghdad';
};

export type AdminDailyLoginVersion = AdminDailyLoginTemplate & {
  createdAtMillis?: number;
  publicationStatus: 'published';
  publishedAtMillis?: number;
  revision: number;
  startsAtMillis?: number;
};

export type AdminDailyLoginCampaignDetail = {
  current: {
    activeRevision: number;
    claimsPaused: boolean;
    emergencyDisabled: boolean;
    lastPublishedRevision: number;
    presentationVisible: boolean;
    publicationStatus: 'draft' | 'published' | 'retired';
    revision: number;
    scheduledAtMillis?: number;
    scheduledRevision?: number;
    schemaVersion: 1;
  } | null;
  draft: {
    revision: number;
    template: AdminDailyLoginTemplate;
    updatedAtMillis?: number;
    updatedBy: string;
  } | null;
  effective: AdminDailyLoginVersion | null;
  features: {
    itemRewardsEnabled: boolean;
    rewardsEnabled: boolean;
  };
  liability: Array<{ claimants: number; coins: number; diamonds: number; items: number }>;
  metrics: {
    claimCount: number;
    failedClaimCount: number;
    heldUserCount: number;
    itemRewardCount: number;
    lastReconciliationAtMillis: number;
    replayCount: number;
    settled: { coins: number; diamonds: number };
    sevenDayPerUser: { claimants: number; coins: number; diamonds: number; items: number };
  };
  revision: number;
  versions: AdminDailyLoginVersion[];
};

export type AdminRoomTargetTemplate = {
  conversion: {
    denominator: number;
    numerator: number;
    payoutCurrency: 'coins' | 'diamonds';
    rounding: 'floor';
    sourceCurrency: 'coins';
  };
  eligibleGiftRules: {
    committedOnly: true;
    excludeSelfGifts: true;
    minimumDebitedCoins: number;
  };
  enabled: boolean;
  maxSelectedUsers: number;
  perRoomReturnCap: number;
  perUserReturnCap: number;
  publicationStatus: 'draft' | 'published' | 'disabled';
  returnBps: number;
  riskValuation: {
    diamondValueCoins: number;
    itemValuesCoins: Record<string, number>;
  };
  schemaVersion: 1;
  targetSupportPoints: number;
  templateId: 'global-room-target';
  templateVersion: 1;
  timeZone: string;
};

export type AdminRoomTargetRiskSnapshot = {
  commissionBps?: number;
  commissionPolicyVersion?: number;
  evaluatedAtMillis?: number;
  marginCoins?: number;
  rocketLiabilityCoins?: number;
  roomTargetLiabilityCoins?: number;
  stackedLiabilityCoins?: number;
  targetCommissionCoins?: number;
  viable?: boolean;
};

export type AdminRoomTargetCampaignDetail = {
  campaign: {
    draft?: AdminRoomTargetTemplate;
    emergencyDisabled: boolean;
    lastPublishedRevision: number;
    nextEffectiveCycleId: string;
    revision: number;
  } | null;
  operations: {
    activeCycleCount: number;
    activeCycles: Array<{
      cycleId: string;
      eligibleSpendCoins: number;
      endAtMillis: number;
      roomId: string;
      rosterSize: number;
      state: string;
      supportPoints: number;
      targetSupportPoints: number;
    }>;
    activeHoldCount: number;
    qualifyingRoomCount: number;
    settlementCounts: Record<string, number>;
    settledReturns: { coins: number; diamonds: number };
    settlementSampleLimited: boolean;
  };
  versions: Array<{
    effectiveFromAtMillis: number;
    effectiveFromCycleId: string;
    operation: string;
    revision: number;
    riskSnapshot: AdminRoomTargetRiskSnapshot;
    template: AdminRoomTargetTemplate;
  }>;
};

export type AdminWeeklyIncentiveIntegrity = {
  alerts: Array<{ id: string; alertId?: string; assessmentId?: string; discrepancies?: string[]; settlementId?: string; state?: string }>;
  assessments: Array<{ id: string; assessmentId?: string; riskScore?: number; settlementId?: string; signals?: Array<{ code: string; severity: string }> }>;
  generatedAtMillis: number;
  health: {
    estimatedLiabilityCoins: number;
    failedPayoutCount: number;
    heldPayoutCount: number;
    heldValueCoins: number;
    reconciliationDriftCount: number;
    schedulers: Array<{ id: string; lagMillis: number; lastRunAtMillis: number; status: string }>;
  };
  reports: Array<{ balanced?: boolean; discrepancies?: string[]; id: string; kind?: string; sourceId?: string }>;
  retentionPolicy: Record<string, { days: number; condition?: string }>;
};

export type AdminAttendanceShadowReport = {
  days: Array<{ dayId: string; endAtMillis: number; excusedMillis: number; qualifiedMillis: number; startAtMillis: number }>;
  generatedAtMillis: number;
  muteGraceMillis: number;
  muteGraceCycling: { flagged: boolean; resetCount: number; windowMillis: number };
  outageWindows: Array<{ endAtMillis: number; outageId: string; reason: string; startAtMillis: number }>;
  rawIntervals: Array<{ endAtMillis: number; exclusionReason: string; intervalId: string; roomId: string; seatId: string; startAtMillis: number; state: string }>;
  reconnectGroups: Array<{ endAtMillis: number; intervalCount: number; qualifiedMillis: number; startAtMillis: number }>;
  reportOnly: true;
  sessions: Array<{ connected: boolean; lastObservedAtMillis: number; microphonePublished: boolean; muted: boolean; roomId: string; seated: boolean; seatId: string; sessionId: string }>;
  timeZone: string;
  uid: string;
};

export type AdminPayrollPlan = {
  category: 'super-admin' | 'employee' | 'female-host';
  currency: 'coins' | 'diamonds';
  dailyMinimumMinutes: number;
  enabled: boolean;
  effectiveFromCycleId: string;
  muteGraceMinutes: 5;
  name: { ar: string; en: string };
  planId: string;
  requiredWeekdays: number[];
  revision: number;
  schemaVersion: 1;
  timeZone: 'Asia/Baghdad';
  weeklyAmount: number;
};

export type AdminPayrollEnrollment = {
  effectiveFromCycleId: string;
  endAtMillis: number;
  planId: string;
  schemaVersion: 1;
  startAtMillis: number;
  state: 'active' | 'suspended' | 'ended';
  uid: string;
  weeklyAmountOverride: number;
};

export type AdminPayrollOverview = {
  cycle: { cycleId: string; endAtMillis: number; startAtMillis: number; timeZone: string };
  nextCycle: { cycleId: string; endAtMillis: number; startAtMillis: number; timeZone: string };
  enrollments: Array<{ currentConfig: AdminPayrollEnrollment | null; pendingConfig: AdminPayrollEnrollment | null; uid: string }>;
  outcomes: Array<{
    amount: number;
    createdAtMillis: number;
    currency: string;
    cycleId: string;
    daily: Array<{ dayId: string; met: boolean; qualifiedMinutes: number; requiredMinutes: number; weekday: number }>;
    failureCode: string;
    ledgerBalanced: boolean;
    ledgerDiscrepancies: string[];
    outcomeId: string;
    planId: string;
    settlementId: string;
    state: string;
    uid: string;
  }>;
  plans: Array<{ currentConfig: AdminPayrollPlan | null; pendingConfig: AdminPayrollPlan | null; planId: string }>;
  projected: Array<{ amount: number; currency: string; enrollmentCount: number; planId: string }>;
};

export type AdminStoreFilters = {
  availability?: '' | AdminStoreCatalogItem['availability'];
  category?: '' | AdminStoreCatalogItem['category'];
  cursor?: string;
  search?: string;
  status?: '' | 'available' | 'disabled' | 'sold';
};

export type AdminGiftCatalogItem = {
  createdAt: string;
  giftId: string;
  iconKey: 'rose' | 'crown' | 'diamond' | 'heart' | 'star';
  lastEditorEmail: string;
  lastEditorUid: string;
  nameAr: string;
  price: number;
  presentation: {
    animationEnabled: boolean;
    approvalMode?: 'simple' | 'strict';
    audioAsset?: { assetId: string; assetVersionId: string };
    audioFormat?: 'm4a-aac';
    durationMs: number;
    fallbackAsset?: { assetId: string; assetVersionId: string };
    fallbackFormat?: 'jpeg' | 'legacy-webp' | 'png';
    hapticPolicy: 'off' | 'light' | 'success';
    minimumClientVersion: string;
    performanceTier: 'low' | 'standard' | 'high';
    physicalApprovalReceiptId?: string;
    schemaVersion: 1;
    soundPolicy: 'off' | 'soft' | 'full';
    tier: 'inline' | 'targeted' | 'major' | 'global';
    visualAsset?: { assetId: string; assetVersionId: string };
    visualFormat?: 'lottie-json' | 'mp4';
  };
  scoreValue: number;
  status: 'available' | 'disabled';
  theater?: {
    luckyTableId?: string;
    tags: Array<'combo' | 'storm' | 'lucky' | 'magic'>;
  };
  updatedAt: string;
};

export type AdminSpecialIdItem = {
  createdAt: string;
  lastEditorEmail: string;
  lastEditorUid: string;
  ownerUid: string;
  price: number;
  specialId: string;
  status: 'available' | 'disabled' | 'sold';
  updatedAt: string;
};

export type AdminEconomyTransaction = {
  actorUid: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  currency: 'coins' | 'diamonds';
  displayName: string;
  id: string;
  note: string;
  publicId: string;
  referenceId: string;
  source: string;
  specialId: string;
  type: 'credit' | 'debit' | 'purchase' | 'transfer';
  uid: string;
};

export type AdminEconomyExport = AdminAuditExport;

export type AdminStoreItemHistory = {
  actorUid: string;
  amount: number;
  createdAt: string;
  currency: '' | 'coins' | 'diamonds';
  id: string;
  kind: 'purchase' | 'gift' | 'catalog-change';
  targetUid: string;
};

export type AdminStoreItemDetail = {
  history: AdminStoreItemHistory[];
  item: AdminStoreCatalogItem;
  metrics: {
    activeOwnerships: number;
    equippedOwnerships: number;
    expiredOwnerships: number;
    gifts: number;
    ownerships: number;
    purchases: number;
    revenueCoins: number;
    revenueDiamonds: number;
  };
  sampled: { auditEvents: boolean; ownerships: boolean; transactions: boolean };
};

export type AdminStoreSummary = {
  activeCatalogItems: number;
  activeGifts: number;
  availableSpecialIds: number;
  catalogItems: number;
  giftedItems24h: number;
  gifts: number;
  purchases24h: number;
  revenueCoins24h: number;
  revenueDiamonds24h: number;
  sampled24h: boolean;
  soldOutItems: number;
  specialIds: number;
  transactions: number;
};

export type AdminEconomyFilters = {
  createdFrom?: string;
  createdTo?: string;
  currency?: '' | 'coins' | 'diamonds';
  cursor?: string;
  search?: string;
  source?: string;
  type?: '' | AdminEconomyTransaction['type'];
};

export type AdminUserRow = {
  avatarModerationStatus: string;
  avatarLabel: string;
  avatarUrl: string;
  bio: string;
  countryCode: string;
  coupleLevel: number;
  createdAt: string;
  displayName: string;
  email: string;
  friendCount: number;
  gender: '' | 'female' | 'male';
  giftScore: number;
  moderationStatus: string;
  notificationPreferencesConfigured: boolean;
  publicId: string;
  profileHealthReason: 'invalid-profile' | 'invalid-reservation' | 'missing-profile' | 'ready';
  publicProfileStatus: 'ready' | 'missing' | 'invalid';
  specialId: string;
  uid: string;
  updatedAt: string;
  walletCoins: number;
  walletDiamonds: number;
};

export type AdminUserFilters = {
  avatarStatus?: '' | 'clear' | 'pending' | 'removed';
  countryCode?: string;
  cursor?: string;
  moderationStatus?: '' | 'active' | 'suspended' | 'removed';
  profileStatus?: '' | 'ready' | 'missing' | 'invalid';
  relationship?: '' | 'coupled' | 'single';
  search: string;
};
export type AdminUserAction = 'avatar-approve' | 'avatar-reject' | 'ban' | 'force-sign-out' | 'mute' | 'note' | 'suspend' | 'unban' | 'unmute' | 'unsuspend' | 'warn';
export type AdminUserSummary = { active: number; pendingAvatars: number; removed: number; suspended: number; total: number };
export type AdminUserRelationshipContext = { createdAt: string; id: string; kind: 'friend' | 'friend-request-incoming' | 'friend-request-outgoing' | 'following' | 'follower' | 'couple-request-incoming' | 'couple-request-outgoing'; peerDisplayName: string; peerPublicId: string; peerUid: string; status: string; updatedAt: string };
export type AdminUserBlockContext = { createdAt: string; direction: 'incoming' | 'outgoing'; id: string; peerDisplayName: string; peerPublicId: string; peerUid: string };
export type AdminUserGiftContext = { amount: number; channel: 'social' | 'store'; createdAt: string; currency: string; direction: 'sent' | 'received'; id: string; itemId: string; label: string; peerDisplayName: string; peerPublicId: string; peerUid: string };
export type AdminUserOwnershipContext = { acquiredAt: string; acquisitionSource: 'gift' | 'purchase'; category: string; equipped: boolean; expiresAt: string; itemId: string; nameAr: string; state: 'active' | 'expired'; thumbnailUrl: string };
export type AdminUserRoomContext = AdminRoomRow & { joinedAt: string; memberStatus: string; relation: 'host' | 'member'; role: string };
export type AdminUserRoomModerationContext = { action: string; actorUid: string; createdAt: string; id: string; reason: string; roomId: string };
export type AdminUserTransferContext = { amount: number; createdAt: string; currency: 'coins' | 'diamonds'; direction: 'sent' | 'received'; id: string; peerDisplayName: string; peerPublicId: string; peerUid: string; status: string; transferId: string };
export type AdminUserOperationalContext = {
  directChat: {
    recentAudits: AdminUserDirectChatRestrictAudit[];
    restriction: AdminUserDirectChatRestriction | null;
  };
  errors: Partial<Record<'activity' | 'directChat' | 'economy' | 'notes' | 'notifications' | 'reports' | 'rooms' | 'social' | 'store' | 'transfers', string>>;
  limits: { blocksScanned: number; perSection: number };
  reports: { items: AdminReportRow[]; sampled: boolean; summary: { open: number; recentResolved: number; total: number; urgent: number } };
  rooms: { items: AdminUserRoomContext[]; moderation: AdminUserRoomModerationContext[]; sampled: boolean };
  social: { blocks: AdminUserBlockContext[]; gifts: AdminUserGiftContext[]; relationships: AdminUserRelationshipContext[]; sampled: boolean };
  store: { gifts: AdminUserGiftContext[]; ownerships: AdminUserOwnershipContext[]; sampled: boolean };
  transfers: { items: AdminUserTransferContext[]; sampled: boolean };
};

export type AdminUserDirectChatRestriction = {
  active: boolean;
  actorUid: string;
  endsAt: string;
  reason: string;
  reportId: string;
  startsAt: string;
  state: string;
};

export type AdminUserDirectChatRestrictAudit = {
  action: string;
  actorUid: string;
  createdAt: string;
  id: string;
  note: string;
  reportId: string;
  status: string;
};

export type AdminDirectChatRetentionBounds = {
  fallbackDays: number;
  maxDays: number;
  minDays: number;
};

export type AdminDirectChatRetentionPolicy = {
  evidenceRetentionDays: number;
  legalHoldRetentionDays: number;
  messageRetentionDays: number;
  policyVersion: number;
  source: string;
  updatedAt: string;
  updatedBy: string;
};

export type AdminDirectChatRetention = {
  bounds: {
    evidenceRetentionDays: AdminDirectChatRetentionBounds;
    legalHoldRetentionDays: AdminDirectChatRetentionBounds;
    messageRetentionDays: AdminDirectChatRetentionBounds;
  };
  policy: AdminDirectChatRetentionPolicy;
};

export type AdminDirectChatOpsStatus = {
  flags: {
    directMessageMedia: boolean;
    directMessageRequests: boolean;
    directMessages: boolean;
  };
  lastReconcile: null | { createdAt: string; id: string };
  retention: {
    evidenceRetentionDays: number;
    legalHoldRetentionDays: number;
    messageRetentionDays: number;
    policyVersion: number;
    source: string;
    sweepCursor: string;
    sweepUpdatedAt: string;
    sweepWrapped: boolean;
  };
  restrictedAccountSampleCount: number | null;
  rollout: null | {
    note: string;
    stageId: number | null;
    updatedAt: string;
    updatedBy: string;
  };
  stage: null | { name: string; stageId: number };
};
export type AdminUserHistorySection = 'activity' | 'notes' | 'ownerships' | 'reports' | 'room-moderation' | 'rooms' | 'social-gifts' | 'store-gifts' | 'transfers';
export type AdminUserHistoryItemMap = {
  activity: AdminAuditEventRow;
  notes: AdminUserDetail['notes'][number];
  ownerships: AdminUserOwnershipContext;
  reports: AdminReportRow;
  'room-moderation': AdminUserRoomModerationContext;
  rooms: AdminUserRoomContext;
  'social-gifts': AdminUserGiftContext;
  'store-gifts': AdminUserGiftContext;
  transfers: AdminUserTransferContext;
};
export type AdminUserDetail = {
  account: { createdAt: string; disabled: boolean; emailVerified: boolean; lastSignInAt: string; tokensValidAfterAt: string };
  activity: AdminAuditEventRow[];
  avatarSubmission: null | { contentType: string; createdAt: string; moderationReason: string; previewUrl: string; scanner: string; sizeBytes: number; status: string; uploadId: string };
  couple: { coupleId: string; partner: null | { displayName: string; publicId: string; uid: string } };
  context: AdminUserOperationalContext;
  notifications: { configured: boolean; preferences: {
    coupleRequests: boolean;
    directMessageRequests: boolean;
    directMessages: boolean;
    friendRequests: boolean;
    gifts: boolean;
    readReceipts: boolean;
    showMessagePreview: boolean;
    showOnlineStatus: boolean;
    walletTransfers: boolean;
  }; registeredDeviceCount: number };
  notes: Array<{ actorEmail: string; actorUid: string; createdAt: string; id: string; note: string }>;
  profile: AdminUserRow;
  representative: {
    active: boolean;
    currencies: { coins: boolean; diamonds: boolean };
    limits: Partial<Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>>;
    pin: { configured: boolean; resetRequired: boolean; updatedAt: string };
    updatedAt: string;
  };
  restrictions: { mutedUntil: string; reason: string };
  wallet: {
    balances: { coins: number; diamonds: number };
    lifetimeCredit: { coins: number; diamonds: number };
    lifetimeDebit: { coins: number; diamonds: number };
    transactions: Array<{ amount: number; balanceAfter: number; createdAt: string; currency: string; id: string; note: string; referenceId: string; source: string; type: string; uid: string }>;
    updatedAt: string;
  };
};

export type AccountDeletionJob = {
  hold: boolean;
  lastError: string;
  purgeAfter: string;
  requestedAt: string;
  retryCount: number;
  state: string;
  uid: string;
  updatedAt: string;
};

export type AdminRoomRow = {
  activeRoomImageId: string;
  createdAt: string;
  countryCode: string;
  currentGameId: string;
  hostAvatarLabel: string;
  hostDisplayName: string;
  hostId: string;
  id: string;
  participantCount: number;
  openReportCount: number;
  revision: number;
  roomCustomizationSuspended: boolean;
  roomImageReviewStatus: string;
  status: string;
  title: string;
  type: string;
  updatedAt: string;
  visibility: string;
};

export type AdminRoomStatusFilter = 'active' | 'closed' | 'all';
export type AdminRoomAction = 'clear-staff-lockdown' | 'close-room' | 'kick-everyone' | 'mute-member' | 'remove-member' | 'reopen-room' | 'staff-lockdown' | 'transfer-host' | 'unmute-member';
export type AdminRoomMediaAction = 'approve-room-image' | 'reject-room-image' | 'remove-room-image' | 'restore-room-customization';
export type AdminRoomFilters = {
  capacity?: '' | 'quiet' | 'busy' | 'crowded';
  countryCode?: string;
  cursor?: string;
  host?: string;
  search?: string;
  status: AdminRoomStatusFilter;
  type?: '' | 'voice' | 'game';
  visibility?: '' | 'public' | 'private';
};
export type AdminRoomSummary = { active: number; flagged: number; games: number; participants: number; privateRooms: number; sampled: boolean; total: number };
export type AdminRoomMember = { avatarLabel: string; canPublishAudio: boolean; displayName: string; joinedAt: string; lastSeenAt: string; muted: boolean; online: boolean; publicId: string; role: string; status: string; uid: string };
export type AdminRoomModerationEvent = { action: string; actorEmail: string; actorUid: string; createdAt: string; id: string; reason: string; targetUid: string };
export type AdminRoomMedia = { bytes: number; contentType: string; createdAt: string; height: number; id: string; moderationReason: string; ownerUid: string; path: string; status: string; updatedAt: string; width: number };
export type AdminRoomDetail = {
  game: { currentGameId: string; status: string };
  members: AdminRoomMember[];
  media: AdminRoomMedia[];
  metrics: { activeMembers: number; listeners: number; online: number; speakers: number };
  moderation: AdminRoomModerationEvent[];
  reports: AdminReportRow[];
  room: AdminRoomRow;
};

export type AdminReportRow = {
  assignedTo: string;
  contentExcerpt: string;
  createdAt: string;
  evidence: Array<{ kind: string; label: string; url: string }>;
  escalatedAt: string;
  id: string;
  noteCount: number;
  reason: string;
  reporterUid: string;
  reporterPublicId: string;
  resolvedAt: string;
  resolutionNote: string;
  roomId: string;
  severity: AdminReportSeverity;
  source: string;
  status: string;
  subjectType: string;
  targetUid: string;
  targetPublicId: string;
  updatedAt: string;
};

export type AdminReportStatusFilter = 'open' | 'triage' | 'resolved';
export type AdminReportSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AdminReportAction = 'assign' | 'escalate' | 'note' | 'reopen' | 'resolve' | 'triage';
export type AdminReportFilters = {
  assigneeUid?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
  roomId?: string;
  search?: string;
  severity?: AdminReportSeverity | '';
  source?: string;
  status: AdminReportStatusFilter;
};
export type AdminAdministrator = {
  createdAt: string;
  disabled: boolean;
  displayName: string;
  email: string;
  lastSignInAt: string;
  regionCodes: string[];
  role: AdminRole;
  scopeStatus: string;
  tokensValidAfterAt: string;
  uid: string;
};
export type AdminPreferences = {
  density: 'comfortable' | 'compact';
  notifications: { flaggedRooms: boolean; operationalFailures: boolean; urgentReports: boolean };
  reduceMotion: boolean;
  updatedAt: string;
};
export type AdminSettings = {
  cosmeticsRendererFlags: Record<
    | 'cosmetics_couple_effects'
    | 'cosmetics_couple_entrances'
    | 'cosmetics_custom_submissions'
    | 'cosmetics_custom_rendering',
    boolean
  >;
  cosmeticsRollout: {
    stageId: number;
    stageName: string;
    updatedAt: string;
    updatedBy: string;
    writesCosmeticsFeatures: false;
  };
  featureFlags: Record<
    | 'usersDiscovery'
    | 'friends'
    | 'wallet'
    | 'gifts'
    | 'couples'
    | 'pushNotifications'
    | 'representativeTransfers'
    | 'directMessages'
    | 'directMessageRequests'
    | 'directMessageMedia',
    boolean
  >;
  featureFlagsUpdatedAt: string;
  history: AdminAuditEventRow[];
  preferences: AdminPreferences;
  roleDefinitions: Array<{ permissions: string[]; role: AdminRole }>;
  roomGiftPolicy: {
    commissionBps: number;
    configured: boolean;
    effectiveAt: string;
    updatedAt: string;
    updatedBy: string;
    version: number;
  };
  session: { createdAt: string; disabled: boolean; emailVerified: boolean; lastSignInAt: string; tokensValidAfterAt: string };
};

export type RepresentativeCurrencyLimits = {
  maxPerDay: number;
  maxPerTransfer: number;
  maxTransfersPerHour: number;
};

export type AdminRepresentativeTransfer = {
  amount: number;
  createdAt: string;
  currency: 'coins' | 'diamonds';
  eligibleForReversal: boolean;
  publicReference: string;
  recipientDisplayName: string;
  recipientPublicId: string;
  recipientUid: string;
  representativeDisplayName: string;
  representativePublicId: string;
  representativeUid: string;
  reversalReason: string;
  reversedAt: string;
  status: 'completed' | 'expired' | 'reversed';
  transferId: string;
};

export type AdminRepresentativeEvent = {
  actorUid: string;
  amount: number;
  createdAt: string;
  currency: '' | 'coins' | 'diamonds';
  id: string;
  kind: string;
  publicReference: string;
  representativeUid: string;
  status: string;
};

export type AdminRepresentativeOperations = {
  auditHistory: AdminRepresentativeEvent[];
  policy: { configured: boolean; limits?: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>; updatedAt: string };
  receipt: AdminRepresentativeTransfer | null;
  recentReversals: AdminRepresentativeEvent[];
  recentSecurityEvents: AdminRepresentativeEvent[];
  recentTransfers: AdminRepresentativeTransfer[];
};
export type AdministratorAction = 'grant-role' | 'change-role' | 'remove-admin' | 'revoke-sessions' | 'set-region-scope';
export type AdminReportSummary = {
  open: number;
  overdue: number;
  resolvedToday: number;
  sampled: boolean;
  triage: number;
  unassigned: number;
  urgent: number;
};
export type AdminReportIdentity = { displayName: string; publicId: string; specialId: string; uid: string };
export type AdminReportDetail = {
  history: AdminAuditEventRow[];
  identities: { reporter: AdminReportIdentity; target: AdminReportIdentity };
  report: AdminReportRow;
};

export const DIRECT_CHAT_REPORT_SOURCE = 'direct-chat-safety-v1';
export type AdminDirectChatAction =
  | 'clear-direct-chat-restriction'
  | 'dismiss'
  | 'remove-direct-message'
  | 'restrict-direct-chat'
  | 'set-direct-chat-legal-hold';
export type AdminDirectChatEvidenceCase = {
  attachmentCount: number;
  capturedAt: string;
  category: string;
  contextRange: { endSequence: number; startSequence: number };
  conversationId: string;
  legalHold: boolean;
  policyVersion: number;
  removedMessageIds: string[];
  reportId: string;
  reporterUid: string;
  retentionUntilMs: number;
  selectedMessageIds: string[];
  snapshotCount: number;
  source: string;
  status: string;
  targetUid: string;
};
export type AdminDirectChatEvidenceSnapshot = {
  attachmentId: string;
  createdAt: string;
  kind: string;
  mediaContentType: string;
  mediaDurationMs: number;
  mediaHeld: boolean;
  mediaIsolated: boolean;
  mediaState: string;
  mediaUrl: string;
  messageId: string;
  replyToMessageId: string;
  selected: boolean;
  senderUid: string;
  sequence: number;
  systemType: string;
  text: string;
  visibilityState: string;
};
export type AdminDirectChatEvidence = {
  case: AdminDirectChatEvidenceCase;
  eventId: string;
  mediaGranted: number;
  mediaUrlExpiresAt: string;
  snapshots: AdminDirectChatEvidenceSnapshot[];
};

type AdminDashboardResponse = AdminDashboardSession & {
  error?: string;
  ok: boolean;
};

type AdminOverviewResponse = {
  error?: string;
  ok: boolean;
  overview?: Partial<AdminOverviewMetrics>;
};

type AdminAuditEventsResponse = {
  auditEvents?: unknown;
  error?: string;
  ok: boolean;
  pageInfo?: unknown;
};
type AdminAuditSummaryResponse = { error?: string; ok: boolean; summary?: unknown };
type AdminAuditDetailResponse = { detail?: unknown; error?: string; ok: boolean };
type AdminAuditExportResponse = { error?: string; export?: unknown; ok: boolean };

type AdminUsersResponse = {
  error?: string;
  ok: boolean;
  pageInfo?: unknown;
  users?: unknown;
};

type AdminUserNoteResponse = {
  error?: string;
  eventId?: string;
  noteId?: string;
  ok: boolean;
};

type AdminRoomsResponse = {
  error?: string;
  ok: boolean;
  pageInfo?: unknown;
  rooms?: unknown;
};

type AdminRoomActionResponse = {
  error?: string;
  eventId?: string;
  ok: boolean;
};
type AdminRoomSummaryResponse = { error?: string; ok: boolean; summary?: unknown };
type AdminRoomDetailResponse = { detail?: unknown; error?: string; ok: boolean };

type AdminReportsResponse = {
  error?: string;
  ok: boolean;
  pageInfo?: unknown;
  reports?: unknown;
};

type AdminReportActionResponse = {
  error?: string;
  eventId?: string;
  ok: boolean;
};

type AdminDirectChatEvidenceResponse = {
  case?: unknown;
  error?: string;
  eventId?: string;
  mediaGranted?: unknown;
  mediaUrlExpiresAt?: unknown;
  ok: boolean;
  snapshots?: unknown;
};

type AdminAdministratorsResponse = { administrators?: unknown; error?: string; ok: boolean };
type AdminSettingsResponse = { error?: string; ok: boolean; settings?: unknown };
type AdminMutationResponse = { error?: string; eventId?: string; flags?: unknown; ok: boolean; targetUid?: string };
type AdminReportDetailResponse = { detail?: unknown; error?: string; ok: boolean };
type AdminReportSummaryResponse = { error?: string; ok: boolean; summary?: unknown };
type AdminUserActionResponse = { error?: string; eventId?: string; ok: boolean };
type AdminUserDetailResponse = { detail?: unknown; error?: string; ok: boolean };
type AdminUserHistoryResponse = { error?: string; items?: unknown; ok: boolean; pageInfo?: unknown; section?: unknown };
type AdminUserSummaryResponse = { error?: string; ok: boolean; summary?: unknown };

type AdminStoreCatalogResponse = { error?: string; ok: boolean; pageInfo?: unknown; storeCatalog?: unknown };
type AdminStoreCatalogUpsertResponse = { error?: string; eventId?: string; ok: boolean };
type AdminGiftCatalogResponse = { error?: string; gifts?: unknown; ok: boolean; pageInfo?: unknown };
type AdminSpecialIdCatalogResponse = { error?: string; ok: boolean; pageInfo?: unknown; specialIds?: unknown };
type AdminEconomyHistoryResponse = { error?: string; ok: boolean; pageInfo?: unknown; transactions?: unknown };
type AdminEconomyExportResponse = { error?: string; export?: unknown; ok: boolean };
type AdminStoreItemDetailResponse = { detail?: unknown; error?: string; ok: boolean };
type AdminStoreSummaryResponse = { error?: string; ok: boolean; summary?: unknown };

function getFunctionsBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL;
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID ?? import.meta.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const baseUrl =
    typeof configuredBaseUrl === 'string' && configuredBaseUrl.trim().length > 0
      ? configuredBaseUrl
      : typeof projectId === 'string' && projectId.trim().length > 0
        ? `https://us-central1-${projectId.trim()}.cloudfunctions.net`
        : '';

  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error('Missing VITE_FIREBASE_FUNCTIONS_BASE_URL.');
  }

  return baseUrl.replace(/\/$/, '');
}

function getRoomMediaCommandUrl() {
  const configuredEndpoint = import.meta.env.VITE_ROOM_MEDIA_COMMAND_ENDPOINT;
  if (typeof configuredEndpoint === 'string' && configuredEndpoint.trim()) {
    return configuredEndpoint.trim();
  }
  return `${getFunctionsBaseUrl()}/roomMediaCommand`;
}

export async function requestAdminDashboardSession(user: User): Promise<AdminDashboardSession> {
  const payload = await requestAdminDashboard<Partial<AdminDashboardResponse>>(user, { action: 'session' });

  if (payload.ok !== true || payload.admin !== true || !payload.uid) {
    throw new Error(payload.error || 'Admin dashboard access was denied.');
  }

  return {
    admin: true,
    email: payload.email || user.email || '',
    permissions: Array.isArray(payload.permissions) ? payload.permissions.filter((value): value is string => typeof value === 'string') : [],
    role: isAdminRole(payload.role) ? payload.role : 'owner',
    uid: payload.uid,
  };
}

export async function reportAdminClientError(user: User, input: { message: string; route: string; source: string; stack: string }): Promise<void> {
  await requestAdminDashboard<AdminMutationResponse>(user, { action: 'client-error', ...input, requestId: crypto.randomUUID() });
}

export async function requestAdminSettings(user: User): Promise<AdminSettings> {
  const payload = await requestAdminDashboard<AdminSettingsResponse>(user, { action: 'admin-settings' });
  if (payload.ok !== true || !isAdminSettings(payload.settings)) throw new Error(payload.error || 'Administrator settings are unavailable.');
  return payload.settings;
}

export async function updateAdminSettings(user: User, preferences: Omit<AdminPreferences, 'updatedAt'>): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, { action: 'admin-settings-update', ...preferences, requestId: crypto.randomUUID() });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Administrator settings could not be saved.');
  return payload.eventId;
}

export async function executeAdministratorAction(user: User, input: {
  administratorAction: AdministratorAction;
  email?: string;
  reason: string;
  regionCodes?: string[];
  role?: AdminRole;
  targetUid?: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'administrator-action',
    administratorAction: input.administratorAction,
    email: input.email || '',
    reason: input.reason,
    regionCodes: input.regionCodes || [],
    requestId: crypto.randomUUID(),
    role: input.role || 'support',
    targetUid: input.targetUid || '',
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Administrator action failed.');
  return payload.eventId;
}

export async function updateAdminFeatureFlag(user: User, input: { enabled: boolean; expectedUpdatedAt: string; flag: keyof AdminSettings['featureFlags']; reason: string }): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, { action: 'feature-flag-update', ...input, requestId: crypto.randomUUID() });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Feature flag update failed.');
  return payload.eventId;
}

export type AdminPushRole = 'staff' | 'room-owners' | 'admins' | 'representatives';
export type AdminPushRoute = '' | 'Friends' | 'Couples' | 'Gifts' | 'Store' | 'RepresentativeTransfer' | 'WalletStore';

export type AdminPushAudience = {
  roles: AdminPushRole[];
  uids: string[];
};

export type AdminPushAudienceEstimate = {
  breakdown: {
    admins: number;
    representatives: number;
    'room-owners': number;
    staff: number;
    uids: number;
  };
  recipientCount: number;
  truncated: boolean;
};

export type AdminPushCampaign = {
  actorEmail: string;
  actorUid: string;
  audience: { roles: string[]; uidCount: number };
  body: string;
  breakdown: AdminPushAudienceEstimate['breakdown'];
  campaignId: string;
  counts: {
    failed: number;
    noDevices: number;
    skipped: number;
    submitted: number;
    targeted: number;
  };
  createdAt: string;
  cursor: number;
  reason: string;
  requestId: string;
  route: string;
  status: string;
  title: string;
  truncated: boolean;
  updatedAt: string;
};

export async function estimateAdminPushAudience(user: User, audience: AdminPushAudience): Promise<AdminPushAudienceEstimate> {
  const payload = await requestAdminDashboard<{
    breakdown?: unknown;
    error?: string;
    ok: boolean;
    recipientCount?: unknown;
    truncated?: unknown;
  }>(user, {
    action: 'push-audience-estimate',
    audience,
  });
  if (payload.ok !== true || !isAdminPushAudienceEstimate(payload)) {
    throw new Error(payload.error || 'تعذر تقدير جمهور الإشعار.');
  }
  return {
    breakdown: payload.breakdown as AdminPushAudienceEstimate['breakdown'],
    recipientCount: Number(payload.recipientCount),
    truncated: payload.truncated === true,
  };
}

export async function sendAdminPushNotification(user: User, input: {
  audience: AdminPushAudience;
  body: string;
  reason: string;
  requestId?: string;
  route?: AdminPushRoute;
  title: string;
}): Promise<AdminPushCampaign> {
  const payload = await requestAdminDashboard<{
    campaign?: unknown;
    error?: string;
    eventId?: string;
    ok: boolean;
    replayed?: boolean;
  }>(user, {
    action: 'push-notification-send',
    audience: input.audience,
    body: input.body,
    reason: input.reason,
    requestId: input.requestId || crypto.randomUUID(),
    route: input.route || '',
    title: input.title,
  });
  if (payload.ok !== true || !isAdminPushCampaign(payload.campaign)) {
    throw new Error(payload.error || 'تعذر إرسال الإشعار الفوري.');
  }
  return payload.campaign;
}

export async function listAdminPushCampaigns(user: User): Promise<AdminPushCampaign[]> {
  const payload = await requestAdminDashboard<{
    campaigns?: unknown;
    error?: string;
    ok: boolean;
  }>(user, { action: 'push-campaigns-list' });
  if (payload.ok !== true || !Array.isArray(payload.campaigns) || !payload.campaigns.every(isAdminPushCampaign)) {
    throw new Error(payload.error || 'تعذر تحميل حملات الإشعارات.');
  }
  return payload.campaigns;
}

export async function emergencyDisableAdminCosmeticsRenderer(user: User, input: { flag: keyof AdminSettings['cosmeticsRendererFlags']; reason: string }): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'cosmetics-renderer-disable',
    enabled: false,
    flag: input.flag,
    reason: input.reason,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Cosmetics renderer could not be disabled.');
  return payload.eventId;
}

export async function updateRoomGiftPolicy(user: User, input: {
  commissionBps: number;
  expectedVersion: number;
  reason: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'room-gift-policy-update',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Room gift commission could not be updated.');
  }
  return payload.eventId;
}

export async function requestDirectChatRetention(user: User): Promise<AdminDirectChatRetention> {
  const payload = await requestAdminDashboard<{ error?: string; ok: boolean; retention?: unknown }>(user, {
    action: 'direct-chat-retention-get',
  });
  if (payload.ok !== true || !isAdminDirectChatRetention(payload.retention)) {
    throw new Error(payload.error || 'Direct chat retention policy is unavailable.');
  }
  return payload.retention;
}

export async function updateDirectChatRetention(user: User, input: {
  evidenceRetentionDays?: number;
  legalHoldRetentionDays?: number;
  messageRetentionDays?: number;
  reason: string;
}): Promise<{ eventId: string; unchanged: boolean }> {
  const payload = await requestAdminDashboard<{ error?: string; eventId?: string; ok: boolean; unchanged?: boolean }>(user, {
    action: 'direct-chat-retention-set',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Direct chat retention policy could not be updated.');
  }
  return { eventId: payload.eventId, unchanged: payload.unchanged === true };
}

export async function requestDirectChatOpsStatus(user: User): Promise<AdminDirectChatOpsStatus> {
  const payload = await requestAdminDashboard<{ error?: string; ok: boolean; status?: unknown }>(user, {
    action: 'direct-chat-ops-status',
  });
  if (payload.ok !== true || !isAdminDirectChatOpsStatus(payload.status)) {
    throw new Error(payload.error || 'Direct chat ops status is unavailable.');
  }
  return payload.status;
}

export async function requestAdminOverview(user: User): Promise<AdminOverviewMetrics> {
  const payload = await requestAdminDashboard<AdminOverviewResponse>(user, { action: 'overview' });
  const overview = payload.overview;

  if (payload.ok !== true || !isOverviewMetrics(overview)) {
    throw new Error(payload.error || 'Admin overview is unavailable.');
  }

  return overview;
}

export async function requestAdminAuditEvents(
  user: User,
  filters: AdminAuditFilters,
): Promise<AdminAuditEventRow[]> {
  return (await requestAdminAuditEventsPage(user, filters)).items;
}

export async function requestAdminAuditEventsPage(
  user: User,
  filters: AdminAuditFilters,
): Promise<AdminListPage<AdminAuditEventRow>> {
  const payload = await requestAdminDashboard<AdminAuditEventsResponse>(user, {
    action: 'audit-events',
    actorUid: filters.actorUid || '',
    createdFrom: filters.createdFrom || '',
    createdTo: filters.createdTo || '',
    cursor: filters.cursor || '',
    entityType: filters.entityType || '',
    eventAction: filters.eventAction || '',
    kind: filters.kind || '',
    search: filters.search || '',
    status: filters.status || '',
    target: filters.target || '',
  });

  if (payload.ok !== true || !Array.isArray(payload.auditEvents)) {
    throw new Error(payload.error || 'Admin audit events are unavailable.');
  }

  const items = payload.auditEvents.filter(isAdminAuditEventRow);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminAuditSummary(user: User): Promise<AdminAuditSummary> {
  const payload = await requestAdminDashboard<AdminAuditSummaryResponse>(user, { action: 'audit-summary' });
  if (payload.ok !== true || !isAdminAuditSummary(payload.summary)) throw new Error(payload.error || 'Audit summary is unavailable.');
  return payload.summary;
}

export async function requestAdminAuditDetail(user: User, eventId: string): Promise<AdminAuditDetail> {
  const payload = await requestAdminDashboard<AdminAuditDetailResponse>(user, { action: 'audit-detail', eventId });
  if (payload.ok !== true || !isAdminAuditDetail(payload.detail)) throw new Error(payload.error || 'Audit detail is unavailable.');
  return payload.detail;
}

export async function requestAdminAuditExport(user: User, filters: AdminAuditFilters): Promise<AdminAuditExport> {
  const payload = await requestAdminDashboard<AdminAuditExportResponse>(user, {
    action: 'audit-export', actorUid: filters.actorUid || '', createdFrom: filters.createdFrom || '', createdTo: filters.createdTo || '', entityType: filters.entityType || '', eventAction: filters.eventAction || '', kind: filters.kind || '', search: filters.search || '', status: filters.status || '', target: filters.target || '',
  });
  if (payload.ok !== true || !isAdminAuditExport(payload.export)) throw new Error(payload.error || 'Audit export is unavailable.');
  return payload.export;
}

export async function requestAdminUsers(user: User, search: string): Promise<AdminUserRow[]> {
  return (await requestAdminUsersPage(user, { search })).items;
}

export async function requestAdminUsersPage(user: User, filters: string | AdminUserFilters): Promise<AdminListPage<AdminUserRow>> {
  const query: AdminUserFilters = typeof filters === 'string' ? { search: filters } : filters;
  const payload = await requestAdminDashboard<AdminUsersResponse>(user, {
    action: 'users',
    avatarStatus: query.avatarStatus || '',
    countryCode: query.countryCode || '',
    cursor: query.cursor || '',
    moderationStatus: query.moderationStatus || '',
    profileStatus: query.profileStatus || '',
    relationship: query.relationship || '',
    search: query.search,
  });

  if (payload.ok !== true || !Array.isArray(payload.users)) {
    throw new Error(payload.error || 'Admin users are unavailable.');
  }

  const items = payload.users.filter(isAdminUserRow);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminUserSummary(user: User): Promise<AdminUserSummary> {
  const payload = await requestAdminDashboard<AdminUserSummaryResponse>(user, { action: 'user-summary' });
  if (payload.ok !== true || !isAdminUserSummary(payload.summary)) throw new Error(payload.error || 'User summary is unavailable.');
  return payload.summary;
}

export async function requestAccountDeletionJobs(user: User): Promise<AccountDeletionJob[]> {
  const payload = await requestAdminDashboard<{ error?: string; jobs?: AccountDeletionJob[]; ok?: boolean }>(user, { action: 'account-deletion-jobs' });
  if (!payload.ok || !Array.isArray(payload.jobs)) throw new Error(payload.error || 'Failed to load account deletion jobs.');
  return payload.jobs;
}

export async function retryAccountDeletionJob(user: User, targetUid: string) {
  const payload = await requestAdminDashboard<{ error?: string; ok?: boolean }>(user, { action: 'account-deletion-retry', requestId: crypto.randomUUID(), targetUid });
  if (!payload.ok) throw new Error(payload.error || 'Failed to retry account deletion job.');
}

export async function requestAdminUserDetail(user: User, targetUid: string): Promise<AdminUserDetail> {
  const payload = await requestAdminDashboard<AdminUserDetailResponse>(user, { action: 'user-detail', targetUid });
  if (payload.ok !== true || !isAdminUserDetail(payload.detail)) throw new Error(payload.error || 'User detail is unavailable.');
  return payload.detail;
}

export async function requestAdminUserHistoryPage<S extends AdminUserHistorySection>(user: User, input: { cursor?: string; limit?: number; section: S; targetUid: string }): Promise<AdminListPage<AdminUserHistoryItemMap[S]>> {
  const payload = await requestAdminDashboard<AdminUserHistoryResponse>(user, { action: 'user-history', cursor: input.cursor || '', limit: input.limit || 20, section: input.section, targetUid: input.targetUid });
  if (payload.ok !== true || payload.section !== input.section || !Array.isArray(payload.items)) throw new Error(payload.error || 'User history is unavailable.');
  const items = payload.items.filter((item): item is AdminUserHistoryItemMap[S] => isAdminUserHistoryItem(input.section, item));
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function executeAdminUserAction(user: User, input: { durationHours?: number; expectedUpdatedAt?: string; reason: string; targetUid: string; userAction: AdminUserAction }): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserActionResponse>(user, {
    action: 'user-action', durationHours: input.durationHours || 0, expectedUpdatedAt: input.expectedUpdatedAt || '', reason: input.reason, requestId: crypto.randomUUID(), targetUid: input.targetUid, userAction: input.userAction,
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'User action failed.');
  return payload.eventId;
}

export async function adjustAdminWallet(user: User, input: { amount: number; currency: 'coins' | 'diamonds'; expectedUpdatedAt?: string; mutationType: 'credit' | 'debit'; note: string; targetUid: string }): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserActionResponse>(user, { action: 'wallet-adjust', ...input, requestId: crypto.randomUUID() });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Wallet adjustment failed.');
  return payload.eventId;
}

export async function updateAdminRepresentative(user: User, input: { active: boolean; coins: boolean; diamonds: boolean; expectedUpdatedAt: string; reason: string; targetUid: string }): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserActionResponse>(user, { action: 'representative-update', ...input, requestId: crypto.randomUUID() });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Representative permission update failed.');
  return payload.eventId;
}

export async function requestAdminRepresentativeOperations(user: User, publicReference = ''): Promise<AdminRepresentativeOperations> {
  const payload = await requestAdminDashboard<{ error?: string; ok?: boolean; operations?: unknown }>(user, {
    action: 'representative-operations', publicReference,
  });
  if (payload.ok !== true || !isAdminRepresentativeOperations(payload.operations)) {
    throw new Error(payload.error || 'Representative operations are unavailable.');
  }
  return payload.operations;
}

export async function updateAdminRepresentativePolicy(user: User, input: {
  expectedUpdatedAt: string;
  limits: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>;
  reason: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'representative-policy-update', ...input, requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Representative policy update failed.');
  return payload.eventId;
}

export async function updateAdminRepresentativeOverride(user: User, input: {
  expectedUpdatedAt: string;
  limits: Partial<Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>>;
  reason: string;
  targetUid: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'representative-override-update', ...input, requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Representative override update failed.');
  return payload.eventId;
}

export async function resetAdminRepresentativePin(user: User, input: {
  expectedUpdatedAt: string;
  reason: string;
  targetUid: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'representative-pin-reset', ...input, requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Representative PIN reset failed.');
  return payload.eventId;
}

export async function reverseAdminRepresentativeTransfer(user: User, input: {
  expectedAmount: number;
  expectedCurrency: 'coins' | 'diamonds';
  publicReference: string;
  reason: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminMutationResponse>(user, {
    action: 'representative-reversal', ...input, requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Representative reversal failed.');
  return payload.eventId;
}

export async function requestAdminStoreCatalog(user: User): Promise<AdminStoreCatalogItem[]> {
  return (await requestAdminStoreCatalogPage(user)).items;
}

export async function requestAdminStoreCatalogPage(user: User, filters: AdminStoreFilters = {}): Promise<AdminListPage<AdminStoreCatalogItem>> {
  const payload = await requestAdminDashboard<AdminStoreCatalogResponse>(user, { action: 'store-catalog', availability: filters.availability || '', category: filters.category || '', cursor: filters.cursor || '', search: filters.search || '' });
  if (payload.ok !== true || !Array.isArray(payload.storeCatalog)) throw new Error(payload.error || 'Store catalog is unavailable.');
  const items = payload.storeCatalog.filter(isAdminStoreCatalogItem);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function upsertAdminStoreCatalog(user: User, input: { entryPhysicalApproval?: AdminEntryPhysicalApproval; expectedUpdatedAt?: string; item: Omit<AdminStoreCatalogItem, 'createdAt' | 'lastEditorEmail' | 'lastEditorUid' | 'updatedAt'>; reason: string }): Promise<string> {
  const payload = await requestAdminDashboard<AdminStoreCatalogUpsertResponse>(user, {
    action: 'store-catalog-upsert', entryPhysicalApproval: input.entryPhysicalApproval, expectedUpdatedAt: input.expectedUpdatedAt || '', item: input.item, reason: input.reason, requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Store catalog update failed.');
  return payload.eventId;
}

export async function requestAdminRoomTheme(user: User, themeId: string): Promise<AdminRoomThemeDetail> {
  const payload = await requestAdminDashboard<{ ok?: boolean; error?: string; theme?: AdminRoomThemeDetail }>(user, {
    action: 'room-theme',
    themeId,
  });
  if (payload.ok !== true || !payload.theme) throw new Error(payload.error || 'Room theme is unavailable.');
  return payload.theme;
}

export async function requestAdminCosmeticAssets(
  user: User,
  filters: {
    assetId?: string;
    category?: string;
    moderationStatus?: string;
    publicationStatus?: string;
  } = {},
): Promise<{ assets?: AdminCosmeticAssetSummary[] } | AdminCosmeticAssetDetail> {
  const payload = await requestAdminDashboard<{
    error?: string;
    ok?: boolean;
    registry?: { assets?: AdminCosmeticAssetSummary[] } | AdminCosmeticAssetDetail;
  }>(user, {
    action: 'cosmetic-assets',
    assetId: filters.assetId || '',
    category: filters.category || '',
    moderationStatus: filters.moderationStatus || '',
    publicationStatus: filters.publicationStatus || '',
  });
  if (payload.ok !== true || !payload.registry) {
    throw new Error(payload.error || 'Cosmetics asset registry is unavailable.');
  }
  return payload.registry;
}

export async function mutateAdminCosmeticAsset(
  user: User,
  input: {
    asset?: {
      assetId: string;
      assetVersionId: string;
      audioAssetId?: string;
      audioAssetVersionId?: string;
      category: string;
      fallbackAssetId?: string;
      fallbackAssetVersionId?: string;
      format: string;
      loop: boolean;
      minimumClientVersion: string;
      ownerType: 'platform' | 'user';
      ownerUid?: string;
      performanceTier: 'low' | 'standard' | 'high';
      slot?: string;
      usage: 'static' | 'looping' | 'one-shot';
    };
    assetId?: string;
    assetVersionId?: string;
    categories?: string[];
    confirmation?: string;
    authoritySeparationPassed?: boolean;
    readableIdentityPassed?: boolean;
    dailyUploadLimit?: number;
    expectedRevision?: number;
    maxPending?: number;
    operation:
      | 'validate-version'
      | 'approve-version'
      | 'reject-version'
      | 'publish-version'
      | 'emergency-disable'
      | 'suspend'
      | 'rollback-version'
      | 'approve-custom-submission'
      | 'reject-custom-submission'
      | 'suspend-custom-submission'
      | 'grant-custom-eligibility'
      | 'revoke-custom-eligibility';
    reason: string;
    submissionId?: string;
    uid?: string;
  },
): Promise<{
  approvalId?: string;
  assetId?: string;
  assetVersionId?: string;
  cleared?: number;
  eventId: string;
  revision?: number;
  submissionId?: string;
  uid?: string;
  validationReceiptId?: string;
}> {
  const payload = await requestAdminDashboard<{
    approvalId?: string;
    assetId?: string;
    assetVersionId?: string;
    cleared?: number;
    error?: string;
    eventId?: string;
    ok?: boolean;
    revision?: number;
    submissionId?: string;
    uid?: string;
    validationReceiptId?: string;
  }>(user, {
    action: 'cosmetic-assets-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Cosmetics asset operation failed.');
  }
  return {
    eventId: payload.eventId,
    ...(payload.approvalId ? { approvalId: payload.approvalId } : {}),
    ...(payload.assetId ? { assetId: payload.assetId } : {}),
    ...(payload.assetVersionId ? { assetVersionId: payload.assetVersionId } : {}),
    ...(typeof payload.cleared === 'number' ? { cleared: payload.cleared } : {}),
    ...(Number.isSafeInteger(payload.revision) ? { revision: Number(payload.revision) } : {}),
    ...(payload.submissionId ? { submissionId: payload.submissionId } : {}),
    ...(payload.uid ? { uid: payload.uid } : {}),
    ...(payload.validationReceiptId
      ? { validationReceiptId: payload.validationReceiptId }
      : {}),
  };
}

export type AdminCustomSubmission = {
  approvedAssetId: string;
  approvedVersionId: string;
  assetVersionId: string;
  attestation: string;
  attestedAtMs: number;
  byteSize: number;
  category: string;
  contentType: string;
  decisionReason: string;
  durationMs: number;
  fallbackAssetId: string;
  fallbackAssetVersionId: string;
  format: string;
  height: number;
  ownerUid: string;
  revision: number;
  sha256: string;
  status: string;
  submissionId: string;
  transparent: boolean;
  updatedAtMs: number;
  validationReceiptId: string;
  width: number;
};

export type AdminCustomEligibility = {
  active: boolean;
  categories: string[];
  dailyUploadLimit: number;
  maxPending: number;
  revokeReason?: string;
  uid: string;
};

export async function requestAdminCustomSubmissions(
  user: User,
  filters: { limit?: number; ownerUid?: string; status?: string } = {},
): Promise<AdminCustomSubmission[]> {
  const payload = await requestAdminDashboard<{
    error?: string;
    ok?: boolean;
    submissions?: AdminCustomSubmission[];
  }>(user, {
    action: 'cosmetic-custom-submissions',
    limit: filters.limit || 25,
    ownerUid: filters.ownerUid || '',
    status: filters.status || 'pending',
  });
  if (payload.ok !== true || !Array.isArray(payload.submissions)) {
    throw new Error(payload.error || 'Custom submission queue is unavailable.');
  }
  return payload.submissions.filter((row) => (
    typeof row.submissionId === 'string'
    && typeof row.ownerUid === 'string'
    && typeof row.status === 'string'
    && !('sourcePath' in (row as object))
  ));
}

export async function requestAdminCustomSubmissionPreview(
  user: User,
  input: { reason: string; submissionId: string },
): Promise<{ expiresAtMs: number; previewUrl: string; submission?: AdminCustomSubmission }> {
  const payload = await requestAdminDashboard<{
    error?: string;
    expiresAtMs?: number;
    ok?: boolean;
    previewUrl?: string;
    submission?: AdminCustomSubmission;
  }>(user, {
    action: 'cosmetic-custom-submission-preview',
    reason: input.reason,
    requestId: crypto.randomUUID(),
    submissionId: input.submissionId,
  });
  if (
    payload.ok !== true
    || typeof payload.previewUrl !== 'string'
    || !payload.previewUrl
    || typeof payload.expiresAtMs !== 'number'
  ) {
    throw new Error(payload.error || 'Custom submission preview is unavailable.');
  }
  return {
    expiresAtMs: payload.expiresAtMs,
    previewUrl: payload.previewUrl,
    ...(payload.submission ? { submission: payload.submission } : {}),
  };
}

export async function requestAdminCustomEligibility(
  user: User,
  uid: string,
): Promise<AdminCustomEligibility> {
  const payload = await requestAdminDashboard<{
    eligibility?: AdminCustomEligibility;
    error?: string;
    ok?: boolean;
  }>(user, {
    action: 'cosmetic-custom-eligibility',
    uid,
  });
  if (payload.ok !== true || !payload.eligibility) {
    throw new Error(payload.error || 'Custom eligibility is unavailable.');
  }
  return payload.eligibility;
}

export async function mutateAdminRoomTheme(user: User, input: {
  expectedRevision: number;
  manifest?: AdminRoomThemeManifest;
  operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
  reason: string;
  rollbackRevision?: number;
  themeId: string;
}): Promise<number> {
  const payload = await requestAdminDashboard<{ ok?: boolean; error?: string; revision?: number }>(user, {
    action: 'room-theme-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !Number.isSafeInteger(payload.revision)) throw new Error(payload.error || 'Room theme update failed.');
  return Number(payload.revision);
}

export async function requestAdminRocketCampaign(user: User): Promise<AdminRocketCampaignDetail> {
  const payload = await requestAdminDashboard<{
    error?: string;
    ok?: boolean;
    rocketCampaign?: AdminRocketCampaignDetail;
  }>(user, { action: 'rocket-campaign' });
  if (payload.ok !== true || !payload.rocketCampaign) {
    throw new Error(payload.error || 'Rocket campaign is unavailable.');
  }
  return payload.rocketCampaign;
}

export async function requestAdminDailyLoginCampaign(user: User): Promise<AdminDailyLoginCampaignDetail> {
  const payload = await requestAdminDashboard<{
    dailyLoginCampaign?: AdminDailyLoginCampaignDetail;
    error?: string;
    ok?: boolean;
  }>(user, { action: 'daily-login-campaign' });
  if (payload.ok !== true || !payload.dailyLoginCampaign) {
    throw new Error(payload.error || 'Daily Login campaign is unavailable.');
  }
  return payload.dailyLoginCampaign;
}

export type AdminOpsEvent = {
  audience: string;
  endsAtMs: number;
  eventId: string;
  startsAtMs: number;
  status: string;
  themeAr: string;
  titleAr: string;
};

export async function requestAdminOpsEvents(user: User): Promise<{
  activeEventId: string;
  events: AdminOpsEvent[];
}> {
  const payload = await requestAdminDashboard<{
    activeEventId?: string;
    error?: string;
    events?: AdminOpsEvent[];
    ok?: boolean;
  }>(user, { action: 'ops-events' });
  if (payload.ok !== true) {
    throw new Error(payload.error || 'Ops events unavailable.');
  }
  return {
    activeEventId: typeof payload.activeEventId === 'string' ? payload.activeEventId : '',
    events: Array.isArray(payload.events) ? payload.events : [],
  };
}

export async function mutateAdminOpsEvent(user: User, input: {
  action: 'publish' | 'retire';
  endsAtMs?: number;
  eventId?: string;
  reason: string;
  requestId: string;
  startsAtMs?: number;
  themeAr?: string;
  titleAr?: string;
}): Promise<{ event?: AdminOpsEvent; eventId?: string; status: string }> {
  const { action: operation, ...fields } = input;
  const payload = await requestAdminDashboard<{
    error?: string;
    event?: AdminOpsEvent;
    eventId?: string;
    ok?: boolean;
    status?: string;
  }>(user, {
    action: 'ops-events-mutate',
    operation,
    ...fields,
  });
  if (payload.ok !== true || !payload.status) {
    throw new Error(payload.error || 'Ops event mutation failed.');
  }
  return {
    event: payload.event,
    eventId: payload.eventId,
    status: payload.status,
  };
}

export async function mutateAdminDailyLoginCampaign(user: User, input: {
  enabled?: boolean;
  expectedRevision: number;
  operation:
    | 'emergency-disable'
    | 'emergency-enable'
    | 'publish'
    | 'rollback'
    | 'save-draft'
    | 'set-claims-paused'
    | 'set-presentation-visible';
  reason: string;
  rollbackRevision?: number;
  template?: AdminDailyLoginTemplate;
}): Promise<{ effectiveAtMillis?: number; publishedRevision?: number; revision: number }> {
  const payload = await requestAdminDashboard<{
    effectiveAtMillis?: number;
    error?: string;
    ok?: boolean;
    publishedRevision?: number;
    revision?: number;
  }>(user, {
    action: 'daily-login-campaign-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !Number.isSafeInteger(payload.revision)) {
    throw new Error(payload.error || 'Daily Login campaign update failed.');
  }
  return {
    ...(Number.isSafeInteger(payload.effectiveAtMillis) ? { effectiveAtMillis: payload.effectiveAtMillis } : {}),
    ...(Number.isSafeInteger(payload.publishedRevision) ? { publishedRevision: payload.publishedRevision } : {}),
    revision: Number(payload.revision),
  };
}

export async function requestAdminRoomTargetCampaign(user: User): Promise<AdminRoomTargetCampaignDetail> {
  const payload = await requestAdminDashboard<{
    error?: string;
    ok?: boolean;
    roomTargetCampaign?: AdminRoomTargetCampaignDetail;
  }>(user, { action: 'room-target-campaign' });
  if (payload.ok !== true || !payload.roomTargetCampaign) {
    throw new Error(payload.error || 'Room Target campaign is unavailable.');
  }
  return payload.roomTargetCampaign;
}

export async function requestAdminWeeklyIncentiveIntegrity(user: User): Promise<AdminWeeklyIncentiveIntegrity> {
  const payload = await requestAdminDashboard<{ error?: string; integrity?: AdminWeeklyIncentiveIntegrity; ok?: boolean }>(
    user,
    { action: 'weekly-incentive-integrity' },
  );
  if (payload.ok !== true || !payload.integrity) throw new Error(payload.error || 'Incentive integrity is unavailable.');
  return payload.integrity;
}

export async function mutateAdminWeeklyIncentiveIntegrity(user: User, input: {
  alertId?: string;
  assessmentId?: string;
  operation: 'approve-settlement' | 'reject-settlement' | 'resolve-alert';
  reason: string;
  settlementId?: string;
}): Promise<void> {
  const payload = await requestAdminDashboard<{ error?: string; ok?: boolean }>(user, {
    action: 'weekly-incentive-integrity-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true) throw new Error(payload.error || 'Integrity review failed.');
}

export async function reconcileAdminWeeklyIncentives(user: User, input: {
  apply: boolean;
  reason?: string;
}): Promise<{ balanced: number; scanned: number; unbalanced: number }> {
  const payload = await requestAdminDashboard<{
    error?: string;
    ok?: boolean;
    reconciliation?: { summary: { balanced: number; scanned: number; unbalanced: number } };
  }>(user, {
    action: 'weekly-incentive-reconcile',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.reconciliation) throw new Error(payload.error || 'Reconciliation failed.');
  return payload.reconciliation.summary;
}

export async function mutateAdminRoomTargetCampaign(user: User, input: {
  expectedRevision: number;
  operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
  reason: string;
  rollbackRevision?: number;
  template?: AdminRoomTargetTemplate;
}): Promise<{ effectiveFromCycleId?: string; revision: number; riskSnapshot?: AdminRoomTargetRiskSnapshot }> {
  const payload = await requestAdminDashboard<{
    effectiveFromCycleId?: string;
    error?: string;
    ok?: boolean;
    revision?: number;
    riskSnapshot?: AdminRoomTargetRiskSnapshot;
  }>(user, {
    action: 'room-target-campaign-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !Number.isSafeInteger(payload.revision)) {
    throw new Error(payload.error || 'Room Target campaign update failed.');
  }
  return {
    ...(payload.effectiveFromCycleId ? { effectiveFromCycleId: payload.effectiveFromCycleId } : {}),
    revision: Number(payload.revision),
    ...(payload.riskSnapshot ? { riskSnapshot: payload.riskSnapshot } : {}),
  };
}

export async function mutateAdminRoomTargetMemberHold(user: User, input: {
  cycleId: string;
  operation: 'apply' | 'release';
  reason: string;
  roomId: string;
  targetUid: string;
}): Promise<string> {
  const payload = await requestAdminDashboard<{ error?: string; eventId?: string; ok?: boolean }>(user, {
    action: 'room-target-member-hold',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Room Target hold update failed.');
  return payload.eventId;
}

export async function requestAdminAttendanceShadow(user: User, targetUid: string): Promise<AdminAttendanceShadowReport> {
  const payload = await requestAdminDashboard<{ attendance?: AdminAttendanceShadowReport; error?: string; ok?: boolean }>(
    user,
    { action: 'attendance-shadow', targetUid },
  );
  if (payload.ok !== true || !payload.attendance) throw new Error(payload.error || 'Attendance shadow report is unavailable.');
  return payload.attendance;
}

export async function mutateAdminAttendanceOutage(user: User, input: {
  endAtMillis?: number;
  operation: 'create' | 'revoke';
  outageId?: string;
  reason: string;
  startAtMillis?: number;
}): Promise<string> {
  const requestId = crypto.randomUUID();
  const payload = await requestAdminDashboard<{ auditId?: string; error?: string; ok?: boolean }>(user, {
    action: 'attendance-outage-mutate',
    endAtMillis: input.endAtMillis || 0,
    operation: input.operation,
    outageId: input.outageId || requestId,
    reason: input.reason,
    requestId,
    startAtMillis: input.startAtMillis || 0,
  });
  if (payload.ok !== true || !payload.auditId) throw new Error(payload.error || 'Attendance outage update failed.');
  return payload.auditId;
}

export async function requestAdminPayroll(user: User): Promise<AdminPayrollOverview> {
  const payload = await requestAdminDashboard<{ error?: string; ok?: boolean; payroll?: AdminPayrollOverview }>(
    user,
    { action: 'payroll-overview' },
  );
  if (payload.ok !== true || !payload.payroll) throw new Error(payload.error || 'Payroll is unavailable.');
  return payload.payroll;
}

export async function mutateAdminPayroll(user: User, input:
  | { operation: 'upsert-plan'; plan: AdminPayrollPlan; reason: string }
  | { enrollment: AdminPayrollEnrollment; operation: 'enroll'; reason: string; uid: string }
  | { operation: 'suspend' | 'resume' | 'end' | 'hold' | 'release-hold'; reason: string; uid: string }
  | { cycleId: string; dayId: string; operation: 'excuse-day'; reason: string; uid: string }
): Promise<{ auditId: string; effectiveFromCycleId?: string }> {
  const payload = await requestAdminDashboard<{
    auditId?: string;
    effectiveFromCycleId?: string;
    error?: string;
    ok?: boolean;
  }>(user, {
    action: 'payroll-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.auditId) throw new Error(payload.error || 'Payroll update failed.');
  return {
    auditId: payload.auditId,
    ...(payload.effectiveFromCycleId ? { effectiveFromCycleId: payload.effectiveFromCycleId } : {}),
  };
}

export async function mutateAdminRocketCampaign(user: User, input: {
  expectedRevision: number;
  operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
  reason: string;
  rollbackRevision?: number;
  template?: AdminRocketTemplate;
}): Promise<{ effectiveFromCycleId?: string; revision: number }> {
  const payload = await requestAdminDashboard<{
    effectiveFromCycleId?: string;
    error?: string;
    ok?: boolean;
    revision?: number;
  }>(user, {
    action: 'rocket-campaign-mutate',
    ...input,
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !Number.isSafeInteger(payload.revision)) {
    throw new Error(payload.error || 'Rocket campaign update failed.');
  }
  return {
    ...(payload.effectiveFromCycleId ? { effectiveFromCycleId: payload.effectiveFromCycleId } : {}),
    revision: Number(payload.revision),
  };
}

export async function requestAdminGiftCatalogPage(user: User, filters: AdminStoreFilters = {}): Promise<AdminListPage<AdminGiftCatalogItem>> {
  const payload = await requestAdminDashboard<AdminGiftCatalogResponse>(user, { action: 'gift-catalog', cursor: filters.cursor || '', search: filters.search || '', status: filters.status || '' });
  if (payload.ok !== true || !Array.isArray(payload.gifts)) throw new Error(payload.error || 'Gift catalog is unavailable.');
  const items = payload.gifts.filter(isAdminGiftCatalogItem);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminSpecialIdCatalogPage(user: User, filters: AdminStoreFilters = {}): Promise<AdminListPage<AdminSpecialIdItem>> {
  const payload = await requestAdminDashboard<AdminSpecialIdCatalogResponse>(user, { action: 'special-id-catalog', cursor: filters.cursor || '', search: filters.search || '', status: filters.status || '' });
  if (payload.ok !== true || !Array.isArray(payload.specialIds)) throw new Error(payload.error || 'Special ID catalog is unavailable.');
  const items = payload.specialIds.filter(isAdminSpecialIdItem);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminEconomyHistoryPage(user: User, filters: AdminEconomyFilters = {}): Promise<AdminListPage<AdminEconomyTransaction>> {
  const payload = await requestAdminDashboard<AdminEconomyHistoryResponse>(user, { action: 'economy-history', createdFrom: filters.createdFrom || '', createdTo: filters.createdTo || '', currency: filters.currency || '', cursor: filters.cursor || '', search: filters.search || '', source: filters.source || '', targetUid: '', type: filters.type || '' });
  if (payload.ok !== true || !Array.isArray(payload.transactions)) throw new Error(payload.error || 'Economy history is unavailable.');
  const items = payload.transactions.filter(isAdminEconomyTransaction);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminEconomyExport(user: User, filters: AdminEconomyFilters = {}): Promise<AdminEconomyExport> {
  const payload = await requestAdminDashboard<AdminEconomyExportResponse>(user, { action: 'economy-export', createdFrom: filters.createdFrom || '', createdTo: filters.createdTo || '', currency: filters.currency || '', requestId: crypto.randomUUID(), search: filters.search || '', source: filters.source || '', targetUid: '', type: filters.type || '' });
  if (payload.ok !== true || !isAdminAuditExport(payload.export)) throw new Error(payload.error || 'Economy export is unavailable.');
  return payload.export;
}

export async function requestAdminStoreItemDetail(user: User, itemId: string): Promise<AdminStoreItemDetail> {
  const payload = await requestAdminDashboard<AdminStoreItemDetailResponse>(user, { action: 'store-item-detail', itemId });
  if (payload.ok !== true || !isAdminStoreItemDetail(payload.detail)) throw new Error(payload.error || 'Store item detail is unavailable.');
  return payload.detail;
}

export async function requestAdminStoreSummary(user: User): Promise<AdminStoreSummary> {
  const payload = await requestAdminDashboard<AdminStoreSummaryResponse>(user, { action: 'store-summary' });
  if (payload.ok !== true || !isAdminStoreSummary(payload.summary)) throw new Error(payload.error || 'Store summary is unavailable.');
  return payload.summary;
}

export async function createAdminUserNote(user: User, targetUid: string, note: string): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'user-note',
    note,
    targetUid,
  });

  if (payload.ok !== true || !payload.noteId) {
    throw new Error(payload.error || 'Admin user note could not be saved.');
  }

  return payload.noteId;
}

export async function creditAdminWallet(user: User, targetUid: string, amount: number, note: string): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'wallet-credit',
    amount,
    note,
    requestId: crypto.randomUUID(),
    targetUid,
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Wallet credit failed.');
  return payload.eventId;
}

export async function dissolveAdminCouple(user: User, targetUid: string, reason: string): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'couple-dissolve',
    reason,
    requestId: crypto.randomUUID(),
    targetUid,
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Couple dissolution failed.');
  return payload.eventId;
}

export async function upsertAdminSpecialId(user: User, input: { expectedUpdatedAt?: string; price: number; reason: string; specialId: string; status: 'available' | 'disabled' }): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'special-id-upsert',
    expectedUpdatedAt: input.expectedUpdatedAt || '',
    price: input.price,
    reason: input.reason,
    requestId: crypto.randomUUID(),
    specialId: input.specialId,
    status: input.status,
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Special ID update failed.');
  return payload.eventId;
}

export async function upsertAdminGiftCatalog(user: User, input: {
  expectedUpdatedAt?: string;
  giftId: string;
  iconKey: 'rose' | 'crown' | 'diamond' | 'heart' | 'star';
  nameAr: string;
  price: number;
  physicalApproval?: {
    androidDevice: string;
    androidPassed: boolean;
    controlsSafeZonePassed: boolean;
    iosDevice: string;
    iosPassed: boolean;
    notes: string;
    testedClientVersion: string;
  };
  presentation: AdminGiftCatalogItem['presentation'];
  reason: string;
  reusePhysicalApprovalReceipt?: boolean;
  scoreValue: number;
  status: 'available' | 'disabled';
  theater?: AdminGiftCatalogItem['theater'];
}): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'gift-catalog-upsert',
    ...input,
    expectedUpdatedAt: input.expectedUpdatedAt || '',
    requestId: crypto.randomUUID(),
  });
  if (payload.ok !== true || !payload.eventId) throw new Error(payload.error || 'Gift catalog update failed.');
  return payload.eventId;
}

export async function requestAdminRooms(user: User, status: AdminRoomStatusFilter): Promise<AdminRoomRow[]> {
  return (await requestAdminRoomsPage(user, status)).items;
}

export async function requestAdminRoomsPage(user: User, filters: AdminRoomStatusFilter | AdminRoomFilters): Promise<AdminListPage<AdminRoomRow>> {
  const query: AdminRoomFilters = typeof filters === 'string' ? { status: filters } : filters;
  const payload = await requestAdminDashboard<AdminRoomsResponse>(user, {
    action: 'rooms',
    capacity: query.capacity || '',
    countryCode: query.countryCode || '',
    cursor: query.cursor || '',
    host: query.host || '',
    search: query.search || '',
    status: query.status,
    type: query.type || '',
    visibility: query.visibility || '',
  });

  if (payload.ok !== true || !Array.isArray(payload.rooms)) {
    throw new Error(payload.error || 'Admin rooms are unavailable.');
  }

  const items = payload.rooms.filter(isAdminRoomRow);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function requestAdminRoomSummary(user: User): Promise<AdminRoomSummary> {
  const payload = await requestAdminDashboard<AdminRoomSummaryResponse>(user, { action: 'room-summary' });
  if (payload.ok !== true || !isAdminRoomSummary(payload.summary)) throw new Error(payload.error || 'Room summary is unavailable.');
  return payload.summary;
}

export async function requestAdminRoomDetail(user: User, roomId: string): Promise<AdminRoomDetail> {
  const payload = await requestAdminDashboard<AdminRoomDetailResponse>(user, { action: 'room-detail', roomId });
  if (payload.ok !== true || !isAdminRoomDetail(payload.detail)) throw new Error(payload.error || 'Room details are unavailable.');
  return payload.detail;
}

export async function executeAdminRoomAction(
  user: User,
  input: { expectedUpdatedAt?: string; reason: string; roomAction: AdminRoomAction; roomId: string; targetUid?: string },
): Promise<string> {
  const payload = await requestAdminDashboard<AdminRoomActionResponse>(user, {
    action: 'room-action',
    expectedUpdatedAt: input.expectedUpdatedAt || '',
    reason: input.reason,
    requestId: crypto.randomUUID(),
    roomAction: input.roomAction,
    roomId: input.roomId,
    targetUid: input.targetUid || '',
  });

  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Admin room action failed.');
  }

  return payload.eventId;
}

export async function executeAdminRoomMediaAction(
  user: User,
  input: {
    action: AdminRoomMediaAction;
    expectedRevision: number;
    mediaId?: string;
    reason?: string;
    roomId: string;
    suspendCustomization?: boolean;
  },
) {
  const token = await user.getIdToken();
  const response = await fetch(getRoomMediaCommandUrl(), {
    body: JSON.stringify({
      ...input,
      mediaId: input.mediaId || '',
      reason: input.reason || '',
      requestId: crypto.randomUUID(),
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await response.json().catch(() => ({})) as {
    code?: string;
    error?: string;
    ok?: boolean;
  };
  if (!response.ok || payload.ok !== true) {
    throw new AdminDashboardRequestError(
      payload.error || 'Room media action failed.',
      response.status,
    );
  }
}

export async function requestAdminReports(user: User, status: AdminReportStatusFilter): Promise<AdminReportRow[]> {
  return (await requestAdminReportsPage(user, status)).items;
}

export async function requestAdminReportsPage(
  user: User,
  filters: AdminReportStatusFilter | AdminReportFilters,
): Promise<AdminListPage<AdminReportRow>> {
  const query: AdminReportFilters = typeof filters === 'string' ? { status: filters } : filters;
  const payload = await requestAdminDashboard<AdminReportsResponse>(user, {
    action: 'reports',
    assigneeUid: query.assigneeUid || '',
    createdFrom: query.createdFrom || '',
    createdTo: query.createdTo || '',
    cursor: query.cursor || '',
    roomId: query.roomId || '',
    search: query.search || '',
    severity: query.severity || '',
    source: query.source || '',
    status: query.status,
  });

  if (payload.ok !== true || !Array.isArray(payload.reports)) {
    throw new Error(payload.error || 'Admin reports are unavailable.');
  }

  const items = payload.reports.filter(isAdminReportRow);
  return { items, pageInfo: readAdminPageInfo(payload.pageInfo, items.length) };
}

export async function executeAdminReportAction(
  user: User,
  input: {
    assigneeUid?: string;
    expectedUpdatedAt?: string;
    note?: string;
    reportAction: AdminReportAction;
    reportId: string;
  },
): Promise<string> {
  const payload = await requestAdminDashboard<AdminReportActionResponse>(user, {
    action: 'report-action',
    assigneeUid: input.assigneeUid || '',
    expectedUpdatedAt: input.expectedUpdatedAt || '',
    note: input.note || '',
    reportAction: input.reportAction,
    reportId: input.reportId,
    requestId: crypto.randomUUID(),
  });

  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Admin report action failed.');
  }

  return payload.eventId;
}

// Every call here is logged server-side against the reason, so the caller must never invoke it
// speculatively: it is wired to an explicit staff reveal, not to opening a report.
export async function requestAdminDirectChatEvidence(
  user: User,
  input: { reason: string; reportId: string },
): Promise<AdminDirectChatEvidence> {
  const payload = await requestAdminDashboard<AdminDirectChatEvidenceResponse>(user, {
    action: 'direct-chat-evidence',
    reason: input.reason,
    reportId: input.reportId,
    requestId: crypto.randomUUID(),
  });

  if (payload.ok !== true || !isAdminDirectChatEvidenceCase(payload.case) || !Array.isArray(payload.snapshots)) {
    throw new Error(payload.error || 'Direct message evidence is unavailable.');
  }

  return {
    case: payload.case,
    eventId: typeof payload.eventId === 'string' ? payload.eventId : '',
    mediaGranted: typeof payload.mediaGranted === 'number' ? payload.mediaGranted : 0,
    mediaUrlExpiresAt: typeof payload.mediaUrlExpiresAt === 'string' ? payload.mediaUrlExpiresAt : '',
    snapshots: payload.snapshots.filter(isAdminDirectChatEvidenceSnapshot),
  };
}

export async function executeAdminDirectChatAction(
  user: User,
  input: {
    directChatAction: AdminDirectChatAction;
    durationHours?: number;
    legalHold?: boolean;
    messageIds?: string[];
    note: string;
    reportId: string;
  },
): Promise<string> {
  const payload = await requestAdminDashboard<AdminReportActionResponse>(user, {
    action: 'direct-chat-action',
    directChatAction: input.directChatAction,
    ...(typeof input.durationHours === 'number' ? { durationHours: input.durationHours } : {}),
    legalHold: input.legalHold === true,
    messageIds: input.messageIds || [],
    note: input.note,
    reportId: input.reportId,
    requestId: crypto.randomUUID(),
  });

  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Direct message moderation action failed.');
  }

  return payload.eventId;
}

export async function requestAdminAdministrators(user: User): Promise<AdminAdministrator[]> {
  const payload = await requestAdminDashboard<AdminAdministratorsResponse>(user, { action: 'administrators' });
  if (payload.ok !== true || !Array.isArray(payload.administrators)) {
    throw new Error(payload.error || 'Admin list is unavailable.');
  }
  return payload.administrators.filter(isAdminAdministrator);
}

export async function requestAdminReportSummary(user: User): Promise<AdminReportSummary> {
  const payload = await requestAdminDashboard<AdminReportSummaryResponse>(user, { action: 'report-summary' });
  if (payload.ok !== true || !isAdminReportSummary(payload.summary)) {
    throw new Error(payload.error || 'Report summary is unavailable.');
  }
  return payload.summary;
}

export async function requestAdminReportDetail(user: User, reportId: string): Promise<AdminReportDetail> {
  const payload = await requestAdminDashboard<AdminReportDetailResponse>(user, { action: 'report-detail', reportId });
  if (payload.ok !== true || !isAdminReportDetail(payload.detail)) {
    throw new Error(payload.error || 'Report details are unavailable.');
  }
  return payload.detail;
}

async function requestAdminDashboard<T extends { error?: string; ok?: boolean }>(
  user: User,
  body:
    | ({ action: 'audit-events' } & Required<AdminAuditFilters>)
    | ({ action: 'audit-export' } & Omit<Required<AdminAuditFilters>, 'cursor'>)
    | { action: 'audit-detail'; eventId: string }
    | { action: 'client-error'; message: string; requestId: string; route: string; source: string; stack: string }
    | { action: 'push-audience-estimate'; audience: AdminPushAudience }
    | { action: 'push-campaigns-list' }
    | { action: 'push-notification-send'; audience: AdminPushAudience; body: string; reason: string; requestId: string; route: AdminPushRoute; title: string }
    | { action: 'ops-events' }
    | { action: 'ops-events-mutate'; endsAtMs?: number; eventId?: string; operation: 'publish' | 'retire'; reason: string; requestId: string; startsAtMs?: number; themeAr?: string; titleAr?: string }
    | { action: 'admin-settings' | 'administrators' | 'audit-summary' | 'daily-login-campaign' | 'overview' | 'payroll-overview' | 'report-summary' | 'rocket-campaign' | 'room-target-campaign' | 'room-summary' | 'session' | 'store-summary' | 'user-summary' | 'weekly-incentive-integrity' }
    | { action: 'attendance-shadow'; targetUid: string }
    | { action: 'attendance-outage-mutate'; endAtMillis: number; operation: 'create' | 'revoke'; outageId: string; reason: string; requestId: string; startAtMillis: number }
    | ({ action: 'payroll-mutate'; requestId: string } & (
      | { operation: 'upsert-plan'; plan: AdminPayrollPlan; reason: string }
      | { enrollment: AdminPayrollEnrollment; operation: 'enroll'; reason: string; uid: string }
      | { operation: 'suspend' | 'resume' | 'end' | 'hold' | 'release-hold'; reason: string; uid: string }
      | { cycleId: string; dayId: string; operation: 'excuse-day'; reason: string; uid: string }
    ))
    | ({ action: 'admin-settings-update'; requestId: string } & Omit<AdminPreferences, 'updatedAt'>)
    | { action: 'administrator-action'; administratorAction: AdministratorAction; email: string; reason: string; regionCodes?: string[]; requestId: string; role: AdminRole; targetUid: string }
    | { action: 'feature-flag-update'; enabled: boolean; expectedUpdatedAt: string; flag: keyof AdminSettings['featureFlags']; reason: string; requestId: string }
    | { action: 'cosmetics-renderer-disable'; enabled: false; flag: keyof AdminSettings['cosmeticsRendererFlags']; reason: string; requestId: string }
    | { action: 'report-detail'; reportId: string }
    | ({ action: 'reports' } & Required<AdminReportFilters>)
    | { action: 'report-action'; assigneeUid: string; expectedUpdatedAt: string; note: string; reportAction: AdminReportAction; reportId: string; requestId: string }
    | { action: 'direct-chat-evidence'; reason: string; reportId: string; requestId: string }
    | { action: 'direct-chat-action'; directChatAction: AdminDirectChatAction; durationHours?: number; legalHold: boolean; messageIds: string[]; note: string; reportId: string; requestId: string }
    | { action: 'direct-chat-ops-status' }
    | { action: 'direct-chat-retention-get' }
    | { action: 'direct-chat-retention-set'; evidenceRetentionDays?: number; legalHoldRetentionDays?: number; messageRetentionDays?: number; reason: string; requestId: string }
    | ({ action: 'rooms' } & Required<AdminRoomFilters>)
    | { action: 'room-detail'; roomId: string }
    | { action: 'room-action'; expectedUpdatedAt: string; reason: string; requestId: string; roomAction: AdminRoomAction; roomId: string; targetUid: string }
    | { action: 'room-gift-policy-update'; commissionBps: number; expectedVersion: number; reason: string; requestId: string }
    | ({ action: 'users' } & Required<AdminUserFilters>)
    | { action: 'user-detail'; targetUid: string }
    | { action: 'user-history'; cursor: string; limit: number; section: AdminUserHistorySection; targetUid: string }
    | { action: 'user-action'; durationHours: number; expectedUpdatedAt: string; reason: string; requestId: string; targetUid: string; userAction: AdminUserAction }
    | { action: 'store-catalog'; availability: string; category: string; cursor: string; search: string }
    | { action: 'gift-catalog' | 'special-id-catalog'; cursor: string; search: string; status: string }
    | { action: 'economy-history'; createdFrom: string; createdTo: string; currency: string; cursor: string; search: string; source: string; targetUid: string; type: string }
    | { action: 'economy-export'; createdFrom: string; createdTo: string; currency: string; requestId: string; search: string; source: string; targetUid: string; type: string }
    | { action: 'store-item-detail'; itemId: string }
    | { action: 'store-catalog-upsert'; entryPhysicalApproval?: AdminEntryPhysicalApproval; expectedUpdatedAt: string; item: Omit<AdminStoreCatalogItem, 'createdAt' | 'lastEditorEmail' | 'lastEditorUid' | 'updatedAt'>; reason: string; requestId: string }
    | { action: 'cosmetic-assets'; assetId: string; category: string; moderationStatus: string; publicationStatus: string }
    | {
      action: 'cosmetic-assets-mutate';
      asset?: {
        assetId: string;
        assetVersionId: string;
        audioAssetId?: string;
        audioAssetVersionId?: string;
        category: string;
        fallbackAssetId?: string;
        fallbackAssetVersionId?: string;
        format: string;
        loop: boolean;
        minimumClientVersion: string;
        ownerType: 'platform' | 'user';
        ownerUid?: string;
        performanceTier: 'low' | 'standard' | 'high';
        slot?: string;
        usage: 'static' | 'looping' | 'one-shot';
      };
      assetId?: string;
      assetVersionId?: string;
      categories?: string[];
      confirmation?: string;
      dailyUploadLimit?: number;
      expectedRevision?: number;
      maxPending?: number;
      operation:
        | 'validate-version'
        | 'approve-version'
        | 'reject-version'
        | 'publish-version'
        | 'emergency-disable'
        | 'suspend'
        | 'rollback-version'
        | 'approve-custom-submission'
        | 'reject-custom-submission'
        | 'suspend-custom-submission'
        | 'grant-custom-eligibility'
        | 'revoke-custom-eligibility';
      reason: string;
      requestId: string;
      submissionId?: string;
      uid?: string;
    }
    | { action: 'cosmetic-custom-submissions'; limit: number; ownerUid: string; status: string }
    | { action: 'cosmetic-custom-submission-preview'; reason: string; requestId: string; submissionId: string }
    | { action: 'cosmetic-custom-eligibility'; uid: string }
    | { action: 'room-theme'; themeId: string }
    | {
      action: 'room-theme-mutate';
      expectedRevision: number;
      manifest?: AdminRoomThemeManifest;
      operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
      reason: string;
      requestId: string;
      rollbackRevision?: number;
      themeId: string;
    }
    | {
      action: 'rocket-campaign-mutate';
      expectedRevision: number;
      operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
      reason: string;
      requestId: string;
      rollbackRevision?: number;
      template?: AdminRocketTemplate;
    }
    | {
      action: 'daily-login-campaign-mutate';
      enabled?: boolean;
      expectedRevision: number;
      operation:
        | 'emergency-disable'
        | 'emergency-enable'
        | 'publish'
        | 'rollback'
        | 'save-draft'
        | 'set-claims-paused'
        | 'set-presentation-visible';
      reason: string;
      requestId: string;
      rollbackRevision?: number;
      template?: AdminDailyLoginTemplate;
    }
    | {
      action: 'room-target-campaign-mutate';
      expectedRevision: number;
      operation: 'save-draft' | 'publish' | 'emergency-disable' | 'rollback';
      reason: string;
      requestId: string;
      rollbackRevision?: number;
      template?: AdminRoomTargetTemplate;
    }
    | {
      action: 'room-target-member-hold';
      cycleId: string;
      operation: 'apply' | 'release';
      reason: string;
      requestId: string;
      roomId: string;
      targetUid: string;
    }
    | {
      action: 'weekly-incentive-integrity-mutate';
      alertId?: string;
      assessmentId?: string;
      operation: 'approve-settlement' | 'reject-settlement' | 'resolve-alert';
      reason: string;
      requestId: string;
      settlementId?: string;
    }
    | {
      action: 'weekly-incentive-reconcile';
      apply: boolean;
      reason?: string;
      requestId: string;
    }
    | { action: 'user-note'; note: string; targetUid: string }
    | { action: 'wallet-credit'; amount: number; note: string; requestId: string; targetUid: string }
    | { action: 'wallet-adjust'; amount: number; currency: 'coins' | 'diamonds'; expectedUpdatedAt?: string; mutationType: 'credit' | 'debit'; note: string; requestId: string; targetUid: string }
    | { action: 'representative-update'; active: boolean; coins: boolean; diamonds: boolean; expectedUpdatedAt: string; reason: string; requestId: string; targetUid: string }
    | { action: 'representative-operations'; publicReference: string }
    | { action: 'representative-policy-update'; expectedUpdatedAt: string; limits: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>; reason: string; requestId: string }
    | { action: 'representative-override-update'; expectedUpdatedAt: string; limits: Partial<Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>>; reason: string; requestId: string; targetUid: string }
    | { action: 'representative-pin-reset'; expectedUpdatedAt: string; reason: string; requestId: string; targetUid: string }
    | { action: 'representative-reversal'; expectedAmount: number; expectedCurrency: 'coins' | 'diamonds'; publicReference: string; reason: string; requestId: string }
    | { action: 'couple-dissolve'; reason: string; requestId: string; targetUid: string }
    | { action: 'special-id-upsert'; expectedUpdatedAt: string; price: number; reason: string; requestId: string; specialId: string; status: 'available' | 'disabled' }
    | {
      action: 'gift-catalog-upsert';
      expectedUpdatedAt: string;
      giftId: string;
      iconKey: 'rose' | 'crown' | 'diamond' | 'heart' | 'star';
      nameAr: string;
      price: number;
      reason: string;
      requestId: string;
      reusePhysicalApprovalReceipt?: boolean;
      scoreValue: number;
      status: 'available' | 'disabled';
    },
): Promise<T> {
  const token = await user.getIdToken();
  const clientRequestId = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ADMIN_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${getFunctionsBaseUrl()}/adminDashboard`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Admin-Request-Id': clientRequestId,
        },
        method: 'POST',
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T;
      if (!response.ok) {
        if (shouldRetryAdminRequest(body.action, attempt, response.status)) continue;
        throw new AdminDashboardRequestError(adminRequestErrorMessage(response.status, payload.error), response.status);
      }
      return payload;
    } catch (error) {
      if (error instanceof AdminDashboardRequestError) throw error;
      if (shouldRetryAdminRequest(body.action, attempt, 0)) continue;
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      throw new AdminDashboardRequestError(timedOut ? adminRequestErrorMessage(408) : adminRequestErrorMessage(0), timedOut ? 408 : 0);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw new AdminDashboardRequestError(adminRequestErrorMessage(0), 0);
}

function readAdminPageInfo(value: unknown, returned: number): AdminPageInfo {
  if (value && typeof value === 'object') {
    const pageInfo = value as Record<string, unknown>;
    return {
      hasNextPage: typeof pageInfo.hasNextPage === 'boolean' ? pageInfo.hasNextPage : null,
      limit: typeof pageInfo.limit === 'number' && Number.isInteger(pageInfo.limit) ? pageInfo.limit : returned,
      nextCursor: typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor ? pageInfo.nextCursor : null,
      returned: typeof pageInfo.returned === 'number' && Number.isInteger(pageInfo.returned) ? pageInfo.returned : returned,
    };
  }

  return { hasNextPage: null, limit: returned, nextCursor: null, returned };
}

function isAdminUserRow(value: unknown): value is AdminUserRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.avatarModerationStatus === 'string' &&
    typeof row.avatarLabel === 'string' &&
    typeof row.avatarUrl === 'string' &&
    typeof row.bio === 'string' &&
    typeof row.countryCode === 'string' &&
    typeof row.coupleLevel === 'number' &&
    typeof row.createdAt === 'string' &&
    typeof row.displayName === 'string' &&
    typeof row.email === 'string' &&
    typeof row.friendCount === 'number' &&
    ['', 'female', 'male'].includes(String(row.gender)) &&
    typeof row.giftScore === 'number' &&
    typeof row.moderationStatus === 'string' &&
    typeof row.notificationPreferencesConfigured === 'boolean' &&
    typeof row.publicId === 'string' &&
    ['invalid-profile', 'invalid-reservation', 'missing-profile', 'ready'].includes(String(row.profileHealthReason)) &&
    ['ready', 'missing', 'invalid'].includes(String(row.publicProfileStatus)) &&
    typeof row.specialId === 'string' &&
    typeof row.uid === 'string' &&
    typeof row.updatedAt === 'string' &&
    typeof row.walletCoins === 'number' &&
    typeof row.walletDiamonds === 'number'
  );
}

function isAdminAuditEventRow(value: unknown): value is AdminAuditEventRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.action === 'string' &&
    typeof row.actorEmail === 'string' &&
    typeof row.actorUid === 'string' &&
    typeof row.assignedTo === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.eventPath === 'string' &&
    typeof row.id === 'string' &&
    typeof row.kind === 'string' &&
    typeof row.note === 'string' &&
    typeof row.publicId === 'string' &&
    typeof row.reportId === 'string' &&
    typeof row.roomId === 'string' &&
    typeof row.source === 'string' &&
    typeof row.status === 'string' &&
    typeof row.targetUid === 'string' &&
    typeof row.category === 'string' &&
    typeof row.itemId === 'string'
  );
}

function isAdminAuditSummary(value: unknown): value is AdminAuditSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['activeAdministrators', 'economy', 'failed', 'retentionDays', 'security', 'today', 'total'].every((key) => typeof row[key] === 'number');
}

function isAdminAuditDetail(value: unknown): value is AdminAuditDetail {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (!isAdminAuditEventRow(row.event) || !row.policy || typeof row.policy !== 'object') return false;
  const policy = row.policy as Record<string, unknown>;
  return Array.isArray(policy.redactedFields) && typeof policy.retentionDays === 'number' && 'before' in row && 'after' in row && 'metadata' in row;
}

function isAdminAuditExport(value: unknown): value is AdminAuditExport {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.count === 'number' && typeof row.csv === 'string' && typeof row.filename === 'string' && typeof row.truncated === 'boolean';
}

function isAdminStoreCatalogItem(value: unknown): value is AdminStoreCatalogItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.itemId === 'string'
    && typeof row.category === 'string'
    && typeof row.availability === 'string'
    && typeof row.name === 'object'
    && typeof row.description === 'object'
    && typeof row.duration === 'object'
    && typeof row.featured === 'boolean'
    && typeof row.stock === 'object'
    && typeof row.prices === 'object'
    && typeof row.thumbnailUrl === 'string'
    && typeof row.previewAssetUrl === 'string'
    && typeof row.purchasingEnabled === 'boolean'
    && typeof row.order === 'number'
    && typeof row.createdAt === 'string'
    && typeof row.lastEditorEmail === 'string'
    && typeof row.lastEditorUid === 'string'
    && typeof row.updatedAt === 'string';
}

function isAdminGiftCatalogItem(value: unknown): value is AdminGiftCatalogItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.giftId === 'string' && typeof row.nameAr === 'string' && typeof row.iconKey === 'string'
    && typeof row.price === 'number' && typeof row.scoreValue === 'number' && typeof row.status === 'string'
    && typeof row.createdAt === 'string' && typeof row.updatedAt === 'string'
    && typeof row.lastEditorEmail === 'string' && typeof row.lastEditorUid === 'string';
}

function isAdminSpecialIdItem(value: unknown): value is AdminSpecialIdItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.specialId === 'string' && typeof row.price === 'number' && typeof row.status === 'string'
    && typeof row.ownerUid === 'string' && typeof row.createdAt === 'string' && typeof row.updatedAt === 'string'
    && typeof row.lastEditorEmail === 'string' && typeof row.lastEditorUid === 'string';
}

function isAdminEconomyTransaction(value: unknown): value is AdminEconomyTransaction {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.uid === 'string' && typeof row.actorUid === 'string'
    && typeof row.amount === 'number' && typeof row.balanceAfter === 'number' && typeof row.currency === 'string'
    && typeof row.type === 'string' && typeof row.source === 'string' && typeof row.note === 'string'
    && typeof row.referenceId === 'string' && typeof row.createdAt === 'string' && typeof row.displayName === 'string'
    && typeof row.publicId === 'string' && typeof row.specialId === 'string';
}

function isAdminStoreItemDetail(value: unknown): value is AdminStoreItemDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  if (!isAdminStoreCatalogItem(detail.item) || !detail.metrics || typeof detail.metrics !== 'object' || !detail.sampled || typeof detail.sampled !== 'object' || !Array.isArray(detail.history)) return false;
  const metrics = detail.metrics as Record<string, unknown>;
  const sampled = detail.sampled as Record<string, unknown>;
  const metricKeys = ['activeOwnerships', 'equippedOwnerships', 'expiredOwnerships', 'gifts', 'ownerships', 'purchases', 'revenueCoins', 'revenueDiamonds'];
  return metricKeys.every((key) => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]))
    && ['auditEvents', 'ownerships', 'transactions'].every((key) => typeof sampled[key] === 'boolean')
    && detail.history.every((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const row = entry as Record<string, unknown>;
      return typeof row.id === 'string' && typeof row.kind === 'string' && typeof row.createdAt === 'string'
        && typeof row.actorUid === 'string' && typeof row.targetUid === 'string' && typeof row.amount === 'number' && typeof row.currency === 'string';
    });
}

function isAdminStoreSummary(value: unknown): value is AdminStoreSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['activeCatalogItems', 'activeGifts', 'availableSpecialIds', 'catalogItems', 'giftedItems24h', 'gifts', 'purchases24h', 'revenueCoins24h', 'revenueDiamonds24h', 'soldOutItems', 'specialIds', 'transactions']
    .every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))
    && typeof row.sampled24h === 'boolean';
}

function isAdminRoomRow(value: unknown): value is AdminRoomRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.activeRoomImageId === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.countryCode === 'string' &&
    typeof row.currentGameId === 'string' &&
    typeof row.hostAvatarLabel === 'string' &&
    typeof row.hostDisplayName === 'string' &&
    typeof row.hostId === 'string' &&
    typeof row.id === 'string' &&
    typeof row.participantCount === 'number' &&
    typeof row.openReportCount === 'number' &&
    typeof row.revision === 'number' &&
    typeof row.roomCustomizationSuspended === 'boolean' &&
    typeof row.roomImageReviewStatus === 'string' &&
    typeof row.status === 'string' &&
    typeof row.title === 'string' &&
    typeof row.type === 'string' &&
    typeof row.updatedAt === 'string' &&
    typeof row.visibility === 'string'
  );
}

function isAdminRoomSummary(value: unknown): value is AdminRoomSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['active', 'flagged', 'games', 'participants', 'privateRooms', 'total'].every((key) => typeof row[key] === 'number') && typeof row.sampled === 'boolean';
}

function isAdminRoomDetail(value: unknown): value is AdminRoomDetail {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (!isAdminRoomRow(row.room) || !row.metrics || typeof row.metrics !== 'object' || !row.game || typeof row.game !== 'object') return false;
  const metrics = row.metrics as Record<string, unknown>;
  return ['activeMembers', 'listeners', 'online', 'speakers'].every((key) => typeof metrics[key] === 'number')
    && Array.isArray(row.members) && row.members.every((member) => {
      if (!member || typeof member !== 'object') return false;
      const item = member as Record<string, unknown>;
      return typeof item.uid === 'string' && typeof item.displayName === 'string' && typeof item.role === 'string' && typeof item.status === 'string' && typeof item.canPublishAudio === 'boolean' && typeof item.muted === 'boolean' && typeof item.online === 'boolean';
    })
    && Array.isArray(row.media) && row.media.every((media) => {
      if (!media || typeof media !== 'object') return false;
      const item = media as Record<string, unknown>;
      return typeof item.id === 'string'
        && typeof item.path === 'string'
        && typeof item.status === 'string'
        && typeof item.width === 'number'
        && typeof item.height === 'number';
    })
    && Array.isArray(row.moderation)
    && Array.isArray(row.reports) && row.reports.every(isAdminReportRow);
}

function isAdminReportRow(value: unknown): value is AdminReportRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.assignedTo === 'string' &&
    typeof row.contentExcerpt === 'string' &&
    typeof row.createdAt === 'string' &&
    Array.isArray(row.evidence) && row.evidence.every(isAdminReportEvidence) &&
    typeof row.escalatedAt === 'string' &&
    typeof row.id === 'string' &&
    typeof row.noteCount === 'number' &&
    typeof row.reason === 'string' &&
    typeof row.reporterUid === 'string' &&
    typeof row.reporterPublicId === 'string' &&
    typeof row.resolvedAt === 'string' &&
    typeof row.resolutionNote === 'string' &&
    typeof row.roomId === 'string' &&
    ['low', 'medium', 'high', 'critical'].includes(String(row.severity)) &&
    typeof row.source === 'string' &&
    typeof row.status === 'string' &&
    typeof row.subjectType === 'string' &&
    typeof row.targetUid === 'string' &&
    typeof row.targetPublicId === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

function isAdminAdministrator(value: unknown): value is AdminAdministrator {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.createdAt === 'string' && typeof row.disabled === 'boolean' && typeof row.displayName === 'string'
    && typeof row.email === 'string' && typeof row.lastSignInAt === 'string' && isAdminRole(row.role)
    && typeof row.tokensValidAfterAt === 'string' && typeof row.uid === 'string'
    && Array.isArray(row.regionCodes) && row.regionCodes.every((code) => typeof code === 'string')
    && typeof row.scopeStatus === 'string';
}

function isAdminPushAudienceEstimate(value: unknown): value is AdminPushAudienceEstimate {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const breakdown = row.breakdown as Record<string, unknown> | undefined;
  return Boolean(breakdown)
    && ['admins', 'representatives', 'room-owners', 'staff', 'uids'].every((key) => Number.isSafeInteger(breakdown?.[key]))
    && Number.isSafeInteger(row.recipientCount)
    && typeof row.truncated === 'boolean';
}

function isAdminPushCampaign(value: unknown): value is AdminPushCampaign {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const audience = row.audience as Record<string, unknown> | undefined;
  const counts = row.counts as Record<string, unknown> | undefined;
  return typeof row.actorEmail === 'string'
    && typeof row.actorUid === 'string'
    && Boolean(audience)
    && Array.isArray(audience?.roles)
    && Number.isSafeInteger(audience?.uidCount)
    && typeof row.body === 'string'
    && typeof row.campaignId === 'string'
    && Boolean(counts)
    && ['failed', 'noDevices', 'skipped', 'submitted', 'targeted'].every((key) => Number.isSafeInteger(counts?.[key]))
    && typeof row.createdAt === 'string'
    && Number.isSafeInteger(row.cursor)
    && typeof row.reason === 'string'
    && typeof row.requestId === 'string'
    && typeof row.route === 'string'
    && typeof row.status === 'string'
    && typeof row.title === 'string'
    && typeof row.truncated === 'boolean'
    && typeof row.updatedAt === 'string'
    && isAdminPushAudienceEstimate({ breakdown: row.breakdown, recipientCount: counts?.targeted ?? 0, truncated: row.truncated });
}

function isAdminRole(value: unknown): value is AdminRole {
  return ['owner', 'super-moderator', 'moderator', 'support', 'catalog-manager', 'auditor'].includes(String(value));
}

function isAdminSettings(value: unknown): value is AdminSettings {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (!row.preferences || typeof row.preferences !== 'object' || !row.session || typeof row.session !== 'object' || !row.featureFlags || typeof row.featureFlags !== 'object') return false;
  const preferences = row.preferences as Record<string, unknown>;
  const notifications = preferences.notifications as Record<string, unknown> | undefined;
  const session = row.session as Record<string, unknown>;
  const flags = row.featureFlags as Record<string, unknown>;
  return ['comfortable', 'compact'].includes(String(preferences.density))
    && typeof preferences.reduceMotion === 'boolean' && typeof preferences.updatedAt === 'string'
    && Boolean(notifications) && ['flaggedRooms', 'operationalFailures', 'urgentReports'].every((key) => typeof notifications?.[key] === 'boolean')
    && ['createdAt', 'lastSignInAt', 'tokensValidAfterAt'].every((key) => typeof session[key] === 'string')
    && typeof session.disabled === 'boolean' && typeof session.emailVerified === 'boolean'
    && [
      'usersDiscovery',
      'friends',
      'wallet',
      'gifts',
      'couples',
      'pushNotifications',
      'representativeTransfers',
      'directMessages',
      'directMessageRequests',
      'directMessageMedia',
    ].every((key) => typeof flags[key] === 'boolean')
    && Boolean(row.cosmeticsRendererFlags)
    && [
      'cosmetics_couple_effects',
      'cosmetics_couple_entrances',
      'cosmetics_custom_submissions',
      'cosmetics_custom_rendering',
    ].every((key) => typeof (row.cosmeticsRendererFlags as Record<string, unknown>)[key] === 'boolean')
    && Boolean(row.cosmeticsRollout)
    && typeof (row.cosmeticsRollout as Record<string, unknown>).stageName === 'string'
    && Number.isInteger((row.cosmeticsRollout as Record<string, unknown>).stageId)
    && typeof (row.cosmeticsRollout as Record<string, unknown>).updatedAt === 'string'
    && typeof (row.cosmeticsRollout as Record<string, unknown>).updatedBy === 'string'
    && (row.cosmeticsRollout as Record<string, unknown>).writesCosmeticsFeatures === false
    && typeof row.featureFlagsUpdatedAt === 'string'
    && isRoomGiftPolicy(row.roomGiftPolicy)
    && Array.isArray(row.history) && row.history.every(isAdminAuditEventRow)
    && Array.isArray(row.roleDefinitions) && row.roleDefinitions.every((definition) => {
      if (!definition || typeof definition !== 'object') return false;
      const item = definition as Record<string, unknown>;
      return isAdminRole(item.role) && Array.isArray(item.permissions) && item.permissions.every((permission) => typeof permission === 'string');
    });
}

function isRoomGiftPolicy(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Record<string, unknown>;
  return Number.isInteger(policy.commissionBps)
    && Number(policy.commissionBps) >= 0
    && Number(policy.commissionBps) <= 10_000
    && typeof policy.configured === 'boolean'
    && typeof policy.effectiveAt === 'string'
    && typeof policy.updatedAt === 'string'
    && typeof policy.updatedBy === 'string'
    && Number.isInteger(policy.version)
    && Number(policy.version) >= 0;
}

function isRepresentativeCurrencyLimits(value: unknown): value is RepresentativeCurrencyLimits {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.maxPerDay) && Number(row.maxPerDay) > 0
    && Number.isSafeInteger(row.maxPerTransfer) && Number(row.maxPerTransfer) > 0
    && Number.isSafeInteger(row.maxTransfersPerHour) && Number(row.maxTransfersPerHour) > 0;
}

function isAdminRepresentativeTransfer(value: unknown): value is AdminRepresentativeTransfer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.amount) && Number(row.amount) > 0
    && typeof row.createdAt === 'string'
    && ['coins', 'diamonds'].includes(String(row.currency))
    && typeof row.eligibleForReversal === 'boolean'
    && typeof row.publicReference === 'string'
    && typeof row.recipientUid === 'string'
    && typeof row.representativeUid === 'string'
    && typeof row.reversalReason === 'string'
    && typeof row.reversedAt === 'string'
    && ['completed', 'expired', 'reversed'].includes(String(row.status))
    && typeof row.transferId === 'string';
}

function isAdminRepresentativeEvent(value: unknown): value is AdminRepresentativeEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.actorUid === 'string' && typeof row.amount === 'number' && typeof row.createdAt === 'string'
    && typeof row.currency === 'string' && typeof row.id === 'string' && typeof row.kind === 'string'
    && typeof row.publicReference === 'string' && typeof row.representativeUid === 'string' && typeof row.status === 'string';
}

function isAdminRepresentativeOperations(value: unknown): value is AdminRepresentativeOperations {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const policy = row.policy as Record<string, unknown> | undefined;
  const limits = policy?.limits as Record<string, unknown> | undefined;
  return Boolean(policy)
    && typeof policy?.configured === 'boolean'
    && typeof policy?.updatedAt === 'string'
    && (!policy.configured || Boolean(limits) && isRepresentativeCurrencyLimits(limits?.coins) && isRepresentativeCurrencyLimits(limits?.diamonds))
    && (row.receipt === null || isAdminRepresentativeTransfer(row.receipt))
    && Array.isArray(row.recentTransfers) && row.recentTransfers.every(isAdminRepresentativeTransfer)
    && Array.isArray(row.recentReversals) && row.recentReversals.every(isAdminRepresentativeEvent)
    && Array.isArray(row.recentSecurityEvents) && row.recentSecurityEvents.every(isAdminRepresentativeEvent)
    && Array.isArray(row.auditHistory) && row.auditHistory.every(isAdminRepresentativeEvent);
}

function isAdminReportSummary(value: unknown): value is AdminReportSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['open', 'overdue', 'resolvedToday', 'triage', 'unassigned', 'urgent'].every((key) => typeof row[key] === 'number')
    && typeof row.sampled === 'boolean';
}

function isAdminReportDetail(value: unknown): value is AdminReportDetail {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (!row.identities || typeof row.identities !== 'object') return false;
  const identities = row.identities as Record<string, unknown>;
  return isAdminReportRow(row.report)
    && Array.isArray(row.history)
    && row.history.every(isAdminAuditEventRow)
    && isAdminReportIdentity(identities.reporter)
    && isAdminReportIdentity(identities.target);
}

function isAdminDirectChatEvidenceCase(value: unknown): value is AdminDirectChatEvidenceCase {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const contextRange = row.contextRange as Record<string, unknown> | undefined;
  return typeof row.attachmentCount === 'number'
    && typeof row.capturedAt === 'string'
    && typeof row.category === 'string'
    && typeof contextRange?.endSequence === 'number'
    && typeof contextRange?.startSequence === 'number'
    && typeof row.conversationId === 'string'
    && typeof row.legalHold === 'boolean'
    && typeof row.policyVersion === 'number'
    && Array.isArray(row.removedMessageIds)
    && typeof row.reportId === 'string'
    && typeof row.reporterUid === 'string'
    && typeof row.retentionUntilMs === 'number'
    && Array.isArray(row.selectedMessageIds)
    && typeof row.snapshotCount === 'number'
    && typeof row.source === 'string'
    && typeof row.status === 'string'
    && typeof row.targetUid === 'string';
}

function isAdminDirectChatEvidenceSnapshot(value: unknown): value is AdminDirectChatEvidenceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.attachmentId === 'string'
    && typeof row.createdAt === 'string'
    && typeof row.kind === 'string'
    && typeof row.mediaContentType === 'string'
    && typeof row.mediaDurationMs === 'number'
    && typeof row.mediaHeld === 'boolean'
    && typeof row.mediaIsolated === 'boolean'
    && typeof row.mediaState === 'string'
    && typeof row.mediaUrl === 'string'
    && typeof row.messageId === 'string'
    && typeof row.selected === 'boolean'
    && typeof row.senderUid === 'string'
    && typeof row.sequence === 'number'
    && typeof row.text === 'string'
    && typeof row.visibilityState === 'string';
}

function isAdminReportEvidence(value: unknown): value is { kind: string; label: string; url: string } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.kind === 'string' && typeof row.label === 'string' && typeof row.url === 'string';
}

function isAdminReportIdentity(value: unknown): value is AdminReportIdentity {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.displayName === 'string' && typeof row.publicId === 'string' && typeof row.specialId === 'string' && typeof row.uid === 'string';
}

function isAdminUserSummary(value: unknown): value is AdminUserSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['active', 'pendingAvatars', 'removed', 'suspended', 'total'].every((key) => typeof row[key] === 'number');
}

function isAdminUserDetail(value: unknown): value is AdminUserDetail {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (!isAdminUserRow(row.profile) || !isAdminUserOperationalContext(row.context) || !row.account || typeof row.account !== 'object' || !row.wallet || typeof row.wallet !== 'object' || !row.restrictions || typeof row.restrictions !== 'object' || !row.couple || typeof row.couple !== 'object' || !row.representative || typeof row.representative !== 'object' || !row.notifications || typeof row.notifications !== 'object') return false;
  const account = row.account as Record<string, unknown>;
  const wallet = row.wallet as Record<string, unknown>;
  const restrictions = row.restrictions as Record<string, unknown>;
  const couple = row.couple as Record<string, unknown>;
  const representative = row.representative as Record<string, unknown>;
  const notifications = row.notifications as Record<string, unknown>;
  const notificationPreferences = notifications.preferences as Record<string, unknown> | undefined;
  const representativeCurrencies = representative.currencies as Record<string, unknown> | undefined;
  const representativeLimits = representative.limits as Record<string, unknown> | undefined;
  const representativePin = representative.pin as Record<string, unknown> | undefined;
  const balances = wallet.balances;
  if (!balances || typeof balances !== 'object') return false;
  const walletBalances = balances as Record<string, unknown>;
  return typeof account.createdAt === 'string'
    && typeof account.disabled === 'boolean'
    && typeof account.emailVerified === 'boolean'
    && typeof account.lastSignInAt === 'string'
    && typeof account.tokensValidAfterAt === 'string'
    && Array.isArray(row.activity) && row.activity.every(isAdminAuditEventRow)
    && Array.isArray(row.notes)
    && typeof couple.coupleId === 'string'
    && typeof restrictions.mutedUntil === 'string'
    && typeof restrictions.reason === 'string'
    && typeof representative.active === 'boolean'
    && typeof representativeCurrencies?.coins === 'boolean' && typeof representativeCurrencies?.diamonds === 'boolean'
    && Boolean(representativeLimits)
    && Object.entries(representativeLimits || {}).every(([key, value]) => ['coins', 'diamonds'].includes(key) && isRepresentativeCurrencyLimits(value))
    && typeof representativePin?.configured === 'boolean' && typeof representativePin?.resetRequired === 'boolean' && typeof representativePin?.updatedAt === 'string'
    && typeof representative.updatedAt === 'string'
    && typeof notifications.configured === 'boolean'
    && typeof notifications.registeredDeviceCount === 'number'
    && [
      'coupleRequests',
      'directMessageRequests',
      'directMessages',
      'friendRequests',
      'gifts',
      'readReceipts',
      'showMessagePreview',
      'showOnlineStatus',
      'walletTransfers',
    ].every((key) => typeof notificationPreferences?.[key] === 'boolean')
    && typeof walletBalances.coins === 'number' && typeof walletBalances.diamonds === 'number'
    && Array.isArray(wallet.transactions)
    && typeof wallet.updatedAt === 'string';
}

function isAdminUserOperationalContext(value: unknown): value is AdminUserOperationalContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (!context.errors || typeof context.errors !== 'object' || !context.limits || typeof context.limits !== 'object' || !context.reports || typeof context.reports !== 'object' || !context.rooms || typeof context.rooms !== 'object' || !context.social || typeof context.social !== 'object' || !context.store || typeof context.store !== 'object' || !context.transfers || typeof context.transfers !== 'object' || !context.directChat || typeof context.directChat !== 'object') return false;
  const limits = context.limits as Record<string, unknown>;
  const reports = context.reports as Record<string, unknown>;
  const rooms = context.rooms as Record<string, unknown>;
  const social = context.social as Record<string, unknown>;
  const store = context.store as Record<string, unknown>;
  const transfers = context.transfers as Record<string, unknown>;
  const directChat = context.directChat as Record<string, unknown>;
  const summary = reports.summary as Record<string, unknown> | undefined;
  return Object.values(context.errors as Record<string, unknown>).every((message) => typeof message === 'string')
    && typeof limits.blocksScanned === 'number' && typeof limits.perSection === 'number'
    && Array.isArray(reports.items) && reports.items.every(isAdminReportRow) && typeof reports.sampled === 'boolean'
    && ['open', 'recentResolved', 'total', 'urgent'].every((key) => typeof summary?.[key] === 'number')
    && Array.isArray(rooms.items) && rooms.items.every((item) => isAdminRoomRow(item) && isRecordWithStrings(item, ['joinedAt', 'relation', 'role', 'memberStatus']))
    && Array.isArray(rooms.moderation) && rooms.moderation.every((item) => isRecordWithStrings(item, ['action', 'actorUid', 'createdAt', 'id', 'reason', 'roomId'])) && typeof rooms.sampled === 'boolean'
    && Array.isArray(social.relationships) && social.relationships.every((item) => isRecordWithStrings(item, ['createdAt', 'id', 'kind', 'peerDisplayName', 'peerPublicId', 'peerUid', 'status', 'updatedAt']))
    && Array.isArray(social.blocks) && social.blocks.every((item) => isRecordWithStrings(item, ['createdAt', 'direction', 'id', 'peerDisplayName', 'peerPublicId', 'peerUid']))
    && Array.isArray(social.gifts) && social.gifts.every(isAdminUserGiftContext) && typeof social.sampled === 'boolean'
    && Array.isArray(store.gifts) && store.gifts.every(isAdminUserGiftContext)
    && Array.isArray(store.ownerships) && store.ownerships.every((item) => isRecordWithStrings(item, ['acquiredAt', 'acquisitionSource', 'category', 'expiresAt', 'itemId', 'nameAr', 'state', 'thumbnailUrl']) && typeof (item as Record<string, unknown>).equipped === 'boolean') && typeof store.sampled === 'boolean'
    && Array.isArray(transfers.items) && transfers.items.every((item) => isRecordWithStrings(item, ['createdAt', 'currency', 'direction', 'id', 'peerDisplayName', 'peerPublicId', 'peerUid', 'status', 'transferId']) && typeof (item as Record<string, unknown>).amount === 'number') && typeof transfers.sampled === 'boolean'
    && isAdminUserDirectChatContext(directChat);
}

function isAdminUserDirectChatContext(value: Record<string, unknown>) {
  const restriction = value.restriction;
  if (restriction !== null && !isAdminUserDirectChatRestriction(restriction)) return false;
  return Array.isArray(value.recentAudits) && value.recentAudits.every(isAdminUserDirectChatRestrictAudit);
}

function isAdminUserDirectChatRestriction(value: unknown): value is AdminUserDirectChatRestriction {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.active === 'boolean'
    && typeof row.actorUid === 'string'
    && typeof row.endsAt === 'string'
    && typeof row.reason === 'string'
    && typeof row.reportId === 'string'
    && typeof row.startsAt === 'string'
    && typeof row.state === 'string';
}

function isAdminUserDirectChatRestrictAudit(value: unknown): value is AdminUserDirectChatRestrictAudit {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.action === 'string'
    && typeof row.actorUid === 'string'
    && typeof row.createdAt === 'string'
    && typeof row.id === 'string'
    && typeof row.note === 'string'
    && typeof row.reportId === 'string'
    && typeof row.status === 'string';
}

function isAdminDirectChatRetentionBounds(value: unknown): value is AdminDirectChatRetentionBounds {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isInteger(row.fallbackDays) && Number.isInteger(row.maxDays) && Number.isInteger(row.minDays);
}

function isAdminDirectChatRetention(value: unknown): value is AdminDirectChatRetention {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const bounds = row.bounds as Record<string, unknown> | undefined;
  const policy = row.policy as Record<string, unknown> | undefined;
  return Boolean(bounds)
    && isAdminDirectChatRetentionBounds(bounds?.evidenceRetentionDays)
    && isAdminDirectChatRetentionBounds(bounds?.legalHoldRetentionDays)
    && isAdminDirectChatRetentionBounds(bounds?.messageRetentionDays)
    && Boolean(policy)
    && Number.isInteger(policy?.evidenceRetentionDays)
    && Number.isInteger(policy?.legalHoldRetentionDays)
    && Number.isInteger(policy?.messageRetentionDays)
    && Number.isInteger(policy?.policyVersion)
    && typeof policy?.source === 'string'
    && typeof policy?.updatedAt === 'string'
    && typeof policy?.updatedBy === 'string';
}

function isAdminDirectChatOpsStatus(value: unknown): value is AdminDirectChatOpsStatus {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const flags = row.flags as Record<string, unknown> | undefined;
  const retention = row.retention as Record<string, unknown> | undefined;
  const lastReconcile = row.lastReconcile;
  const stage = row.stage;
  const rollout = row.rollout;
  if (!flags || !retention) return false;
  if (!['directMessages', 'directMessageRequests', 'directMessageMedia'].every((key) => typeof flags[key] === 'boolean')) return false;
  if (![
    'evidenceRetentionDays',
    'legalHoldRetentionDays',
    'messageRetentionDays',
    'policyVersion',
  ].every((key) => Number.isInteger(retention[key]))) return false;
  if (typeof retention.source !== 'string' || typeof retention.sweepCursor !== 'string' || typeof retention.sweepUpdatedAt !== 'string' || typeof retention.sweepWrapped !== 'boolean') return false;
  if (row.restrictedAccountSampleCount !== null && typeof row.restrictedAccountSampleCount !== 'number') return false;
  if (lastReconcile !== null) {
    if (!lastReconcile || typeof lastReconcile !== 'object') return false;
    const reconcile = lastReconcile as Record<string, unknown>;
    if (typeof reconcile.createdAt !== 'string' || typeof reconcile.id !== 'string') return false;
  }
  if (stage !== null) {
    if (!stage || typeof stage !== 'object') return false;
    const resolved = stage as Record<string, unknown>;
    if (typeof resolved.name !== 'string' || !Number.isInteger(resolved.stageId)) return false;
  }
  if (rollout !== null) {
    if (!rollout || typeof rollout !== 'object') return false;
    const doc = rollout as Record<string, unknown>;
    if (typeof doc.note !== 'string' || typeof doc.updatedAt !== 'string' || typeof doc.updatedBy !== 'string') return false;
    if (doc.stageId !== null && !Number.isInteger(doc.stageId)) return false;
  }
  return true;
}

function isAdminUserGiftContext(value: unknown) {
  return isRecordWithStrings(value, ['channel', 'createdAt', 'currency', 'direction', 'id', 'itemId', 'label', 'peerDisplayName', 'peerPublicId', 'peerUid']) && typeof (value as Record<string, unknown>).amount === 'number';
}

function isAdminUserHistoryItem(section: AdminUserHistorySection, value: unknown): boolean {
  if (section === 'activity') return isAdminAuditEventRow(value);
  if (section === 'notes') return isRecordWithStrings(value, ['actorEmail', 'actorUid', 'createdAt', 'id', 'note']);
  if (section === 'reports') return isAdminReportRow(value);
  if (section === 'rooms') return isAdminRoomRow(value) && isRecordWithStrings(value, ['joinedAt', 'relation', 'role', 'memberStatus']);
  if (section === 'room-moderation') return isRecordWithStrings(value, ['action', 'actorUid', 'createdAt', 'id', 'reason', 'roomId']);
  if (section === 'ownerships') return isRecordWithStrings(value, ['acquiredAt', 'acquisitionSource', 'category', 'expiresAt', 'itemId', 'nameAr', 'state', 'thumbnailUrl']) && typeof (value as Record<string, unknown>).equipped === 'boolean';
  if (section === 'social-gifts' || section === 'store-gifts') return isAdminUserGiftContext(value);
  return isRecordWithStrings(value, ['createdAt', 'currency', 'direction', 'id', 'peerDisplayName', 'peerPublicId', 'peerUid', 'status', 'transferId']) && typeof (value as Record<string, unknown>).amount === 'number';
}

function isRecordWithStrings(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return keys.every((key) => typeof row[key] === 'string');
}

function isOverviewMetrics(value: unknown): value is AdminOverviewMetrics {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metrics = value as Record<string, unknown>;
  const growth = metrics.growthHealth as Record<string, unknown> | undefined;
  return (
    typeof metrics.activeRooms === 'number' &&
    typeof metrics.adminAuditEvents === 'number' &&
    typeof metrics.gameRooms === 'number' &&
    typeof metrics.generatedAt === 'string' &&
    Boolean(growth) &&
    typeof growth?.emptyRoomJoinRate === 'number' &&
    typeof growth?.emptyRoomJoins === 'number' &&
    typeof growth?.giftGmvCoins === 'number' &&
    typeof growth?.giftGmvDiamonds === 'number' &&
    typeof growth?.matchAttempts === 'number' &&
    typeof growth?.matchRoomLandings === 'number' &&
    typeof growth?.matchToRoomRate === 'number' &&
    typeof growth?.nonemptyRoomJoins === 'number' &&
    typeof growth?.softMatchAttempts === 'number' &&
    typeof growth?.softMatchPaired === 'number' &&
    typeof growth?.softMatchPairRate === 'number' &&
    Number.isInteger(growth?.stageId) &&
    typeof growth?.stageName === 'string' &&
    typeof growth?.vipConversions === 'number' &&
    typeof metrics.moderationEvents === 'number' &&
    typeof metrics.privateRooms === 'number' &&
    typeof metrics.reports === 'number' &&
    metrics.systemStatus === 'ok' &&
    typeof metrics.users === 'number'
  );
}
