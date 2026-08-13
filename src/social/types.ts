import type { RoomCountryCode } from '../types/voice';
import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import type { CoupleEffectProjection } from '../cosmetics/coupleEffects';
import type { EquipmentCosmetics } from '../cosmetics/equipmentCosmetics';

export type ProfileGender = 'male' | 'female';
export type ProfilePresentationUpdateInput = {
  avatarLabel: string;
  bio: string;
  countryCode: RoomCountryCode;
  displayName: string;
  gender?: ProfileGender;
};
export type ProfilePresentationUpdateResult = ProfilePresentationUpdateInput & { uid: string };
export type AvatarUploadAuthorization = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  expiresAtMillis: number;
  sha256: string;
  sizeBytes: number;
  sourcePath: string;
  uploadId: string;
};
export type AvatarFinalizeResult = { avatarUrl?: string; status: 'approved' | 'pending' | 'rejected'; uploadId: string };
export type EconomyLoadState =
  | { status: 'disabled' }
  | { status: 'loading'; previous?: StoreCurrencyAmounts }
  | { message: string; previous?: StoreCurrencyAmounts; status: 'error' }
  | { balances: StoreCurrencyAmounts; message?: string; stale?: boolean; status: 'ready' };
export type PublicProfileModerationStatus = 'active' | 'suspended' | 'removed';

export type PublicUserProfile = {
  avatarModerationStatus: 'clear' | 'pending' | 'removed';
  avatarUrl: string;
  bio: string;
  countryCode: RoomCountryCode;
  coupleEffect?: CoupleEffectProjection;
  coupleLevel: number;
  createdAt?: unknown;
  displayName: string;
  equippedAvatarFrame?: AvatarFrameProjection;
  equippedCosmetics?: EquipmentCosmetics;
  family?: {
    badgeColor: string;
    familyId: string;
    nameAr: string;
    role: 'owner' | 'elder' | 'member';
  };
  friendCount: number;
  followerCount: number;
  followingCount: number;
  gender?: ProfileGender;
  giftScore: number;
  moderationStatus: PublicProfileModerationStatus;
  normalizedName: string;
  publicId: string;
  representativeBadgeActive?: boolean;
  specialId?: string;
  uid: string;
  updatedAt?: unknown;
  vipTier?: {
    accentColor: string;
    id: string;
    nameAr: string;
    rank: number;
  };
};

export type ProfileBootstrapResult = {
  created: boolean;
  provisioned: boolean;
  publicId: string;
  repaired: boolean;
};

export type PublicProfilePresentationInput = {
  bio: string;
  countryCode: RoomCountryCode;
  gender?: ProfileGender;
};

export type PublicProfileLoadStatus = 'loading' | 'ready' | 'missing' | 'error';

export type UserDiscoveryInput = {
  countryCode?: RoomCountryCode;
  limit?: number;
  query?: string;
};

export type UserDiscoveryResult = {
  users: PublicUserProfile[];
};

export type FriendRelationshipStatus = 'none' | 'incoming' | 'outgoing' | 'friends';

export type FriendConnectionSummary = {
  createdAt?: unknown;
  profile: PublicUserProfile;
};

export type FriendsOverview = {
  friends: FriendConnectionSummary[];
  incoming: FriendConnectionSummary[];
  outgoing: FriendConnectionSummary[];
};

export type FriendTargetInput = {
  targetUid: string;
};

export type FriendMutationAction =
  | 'send-friend-request'
  | 'accept-friend-request'
  | 'decline-friend-request'
  | 'cancel-friend-request'
  | 'remove-friend';

export type FriendMutationResult = {
  status: FriendRelationshipStatus;
};

export type FriendshipStatusResult = {
  status: FriendRelationshipStatus;
};

export type FollowRelationshipStatus = 'none' | 'following';

export type FollowConnectionSummary = {
  createdAt?: unknown;
  profile: PublicUserProfile;
};

export type FollowListResult = {
  items: FollowConnectionSummary[];
};

export type FollowListInput = {
  targetUid?: string;
};

export type FollowMutationAction = 'follow-user' | 'unfollow-user';

export type FollowMutationResult = {
  followedBy: boolean;
  status: FollowRelationshipStatus;
};

export type FollowStatusResult = {
  followedBy: boolean;
  status: FollowRelationshipStatus;
};

export type BlockedUsersResult = {
  items: FollowConnectionSummary[];
};

export type CoupleRelationshipStatus = 'none' | 'incoming' | 'outgoing' | 'coupled';

export type CoupleConnectionSummary = {
  createdAt?: unknown;
  profile: PublicUserProfile;
};

export type CouplesOverview = {
  current?: CoupleConnectionSummary;
  incoming: CoupleConnectionSummary[];
  outgoing: CoupleConnectionSummary[];
};

export type CoupleMutationAction =
  | 'send-couple-request'
  | 'accept-couple-request'
  | 'decline-couple-request'
  | 'cancel-couple-request'
  | 'dissolve-couple';

export type CoupleMutationResult = { status: CoupleRelationshipStatus };
export type CoupleStatusResult = { status: CoupleRelationshipStatus; unavailable: boolean };

export type FamilyRole = 'owner' | 'elder' | 'member';

export type FamilySummary = {
  badgeColor: string;
  familyId: string;
  homeRoomId?: string;
  inviteCode: string;
  memberCount: number;
  nameAr: string;
  ownerUid: string;
};

export type FamilyMember = {
  displayName: string;
  publicId: string;
  role: FamilyRole;
  uid: string;
};

export type FamilyInviteSummary = {
  createdAt?: unknown;
  family: FamilySummary;
  profile: PublicUserProfile;
};

export type MyFamilyResult = {
  family: FamilySummary | null;
  incoming: FamilyInviteSummary[];
  members: FamilyMember[];
  role: FamilyRole | null;
};

export type FamilyMutationAction =
  | 'create-family'
  | 'invite-to-family'
  | 'accept-family-invite'
  | 'decline-family-invite'
  | 'cancel-family-invite'
  | 'join-family'
  | 'leave-family'
  | 'kick-family-member'
  | 'dissolve-family';

export type FamilyMutationResult = {
  family?: FamilySummary;
  role?: FamilyRole;
  status: 'joined' | 'outgoing' | 'none' | 'kicked';
  targetUid?: string;
};

export type NotificationPreferences = {
  coupleRequests: boolean;
  directMessageRequests: boolean;
  directMessages: boolean;
  follows: boolean;
  friendRequests: boolean;
  gifts: boolean;
  readReceipts: boolean;
  showMessagePreview: boolean;
  showOnlineStatus: boolean;
  walletTransfers: boolean;
};

export type NotificationSettingsResult = {
  preferences: NotificationPreferences;
  registeredDeviceCount: number;
};

export type PushDeviceMutationResult = {
  preferences: NotificationPreferences;
  registered?: boolean;
};

export type NotificationMutationAction =
  | 'register-push-device'
  | 'unregister-push-device'
  | 'update-notification-preferences';

export type WalletSummary = {
  balances: StoreCurrencyAmounts;
  lifetimeCredit: StoreCurrencyAmounts;
  lifetimeDebit: StoreCurrencyAmounts;
  uid: string;
  updatedAt?: unknown;
};

export type StoreCurrencyAmounts = {
  coins: number;
  diamonds: number;
};

export type SpecialIdCatalogItem = {
  price: number;
  specialId: string;
  status: 'available' | 'sold' | 'disabled';
};
export type WalletRechargeReceipt = {
  amount: number;
  balanceAfter?: number;
  balanceBefore?: number;
  createdAt: string;
  currency: import('../store/contracts').StoreCurrency;
  publicReference?: string;
  representativeDisplayName?: string;
  representativePublicId: string;
  representativeUid: string;
  status: 'completed';
  transferId: string;
};

export type WalletStoreResult = {
  items: SpecialIdCatalogItem[];
  ownedSpecialId: string;
  recentRecharges: WalletRechargeReceipt[];
  wallet: WalletSummary;
};

export type SpecialIdPurchaseResult = { balances: StoreCurrencyAmounts; specialId: string };

export type CustomerStoreCatalogItem = import('../store/contracts').StoreCatalogItem & { soldOut: boolean };
export type CustomerStoreResult = { featuredItemId: string; items: CustomerStoreCatalogItem[]; wallet: WalletSummary };
export type StorePurchaseResult = {
  balances: StoreCurrencyAmounts;
  currency: import('../store/contracts').StoreCurrency;
  expiresAt: unknown | null;
  itemId: string;
  ownershipId: string;
};
export type MyStoreItem = { catalog: import('../store/contracts').StoreCatalogItem | null; ownership: import('../store/contracts').StoreOwnership };
export type MyStoreItemsResult = { items: MyStoreItem[] };
export type StoreEquipResult = { itemId: string; ownershipId: string };
export type StoreGiftResult = { balances: StoreCurrencyAmounts; currency: import('../store/contracts').StoreCurrency; itemId: string; recipientPublicId: string; recipientUid: string };
export type RepresentativeTransferReceipt = {
  amount: number;
  balanceAfter?: number;
  balanceBefore?: number;
  createdAt: string;
  currency: import('../store/contracts').StoreCurrency;
  publicReference?: string;
  recipientDisplayName?: string;
  recipientPublicId: string;
  recipientUid: string;
  status: 'completed';
  transferId: string;
};
export type RepresentativeCurrencyLimits = { maxPerDay: number; maxPerTransfer: number; maxTransfersPerHour: number };
export type RepresentativeStatusResult = {
  dailyAllowance: { coins?: number; diamonds?: number };
  feature: { available: boolean; enabled: boolean; policyConfigured: boolean; portalConfigured: boolean };
  limits: { configured: boolean; effective?: { coins: RepresentativeCurrencyLimits; diamonds: RepresentativeCurrencyLimits }; overrideCurrencies: string[] };
  pin: { state: 'not-configured' | 'ready' | 'reset-required' } | { lockedUntil: string; state: 'locked' };
  privilege: { active: boolean; currencies: { coins: boolean; diamonds: boolean }; uid: string };
  recentTransfers: RepresentativeTransferReceipt[];
  wallet: WalletSummary;
};
export type RepresentativePortalTicketResult = { expiresAt: string; portalOrigin: string; ticket: string };
export type RepresentativeTransferResult = { amount: number; balances: StoreCurrencyAmounts; currency: import('../store/contracts').StoreCurrency; recipientPublicId: string; recipientUid: string; transferId: string };

export type GiftIconKey = 'rose' | 'crown' | 'diamond' | 'heart' | 'star';

export type GiftCatalogItem = {
  giftId: string;
  iconKey: GiftIconKey;
  nameAr: string;
  price: number;
  scoreValue: number;
  status: 'available' | 'disabled';
};

export type GiftEventSummary = {
  createdAt?: unknown;
  eventId: string;
  giftId: string;
  iconKey: GiftIconKey;
  message: string;
  nameAr: string;
  price: number;
  recipientDisplayName: string;
  recipientAvatarFrame?: AvatarFrameProjection;
  recipientUid: string;
  scoreValue: number;
  senderDisplayName: string;
  senderAvatarFrame?: AvatarFrameProjection;
  senderUid: string;
};

export type GiftCenterResult = {
  catalog: GiftCatalogItem[];
  received: GiftEventSummary[];
  recipient?: PublicUserProfile;
  sent: GiftEventSummary[];
  wallet: WalletSummary;
};

export type GiftSendResult = { balances: StoreCurrencyAmounts; eventId: string; giftScore: number };

export type BlockMutationAction = 'block-user' | 'unblock-user';
export type BlockMutationResult = { blocked: boolean; targetUid: string };

export type SocialCommandAction =
  | 'bootstrap-profile'
  | 'get-readiness'
  | 'update-profile-presentation'
  | 'create-avatar-upload'
  | 'finalize-avatar-upload'
  | 'remove-avatar'
  | 'search-users'
  | 'get-friends'
  | 'get-friendship-status'
  | 'follow-user'
  | 'unfollow-user'
  | 'get-follow-status'
  | 'get-following'
  | 'get-followers'
  | 'get-blocked-users'
  | 'get-wallet-store'
  | 'purchase-special-id'
  | 'get-store-catalog'
  | 'purchase-store-item'
  | 'get-my-store-items'
  | 'equip-store-item'
  | 'gift-store-item'
  | 'get-couple-effects'
  | 'purchase-couple-effect'
  | 'equip-couple-effect'
  | 'unequip-couple-effect'
  | 'create-cosmetic-custom-upload'
  | 'finalize-cosmetic-custom-upload'
  | 'attest-cosmetic-custom-submission'
  | 'list-cosmetic-custom-submissions'
  | 'equip-cosmetic-custom-asset'
  | 'unequip-cosmetic-custom-asset'
  | 'get-representative-status'
  | 'create-representative-portal-ticket'
  | 'representative-transfer'
  | 'get-gift-center'
  | 'send-gift'
  | BlockMutationAction
  | 'get-couples'
  | 'get-couple-status'
  | 'get-my-family'
  | 'get-notification-settings'
  | NotificationMutationAction
  | CoupleMutationAction
  | FamilyMutationAction
  | FriendMutationAction
  | FollowMutationAction
  | 'quick-match'
  | 'claim-lucky-bag'
  | 'get-leaderboard'
  | 'get-vip-status'
  | 'get-ops-missions'
  | 'claim-ops-mission'
  | 'soft-match-enqueue'
  | 'soft-match-cancel'
  | 'soft-match-status';

export type SoftMatchResult =
  | { status: 'idle' }
  | { status: 'waiting'; expiresAtMs: number; preferGender: '' | 'male' | 'female' }
  | {
      status: 'matched';
      inviteCode: string;
      peerLabelAr: string;
      roomId: string;
      sessionExpiresAtMs: number;
      sessionId: string;
    };

export type QuickMatchResult = {
  countryCode: string;
  masked: boolean;
  mask: { expiresAtMs: number; labelAr: string } | null;
  participantCount: number;
  roomId: string;
  title: string;
};

export type LuckyBagClaimResult = {
  alreadyClaimed: boolean;
  amount: number;
  balances?: { coins?: number; diamonds?: number };
  currency: 'coins' | 'diamonds';
  dayId: string;
  nextResetAtMillis: number;
  settlementId: string;
};

export type LeaderboardKind = 'wealth' | 'charm' | 'family_wealth' | 'family_charm';
export type LeaderboardWindow = 'daily' | 'weekly' | 'all';

export type LeaderboardEntry = {
  countryCode: string;
  displayName: string;
  firstContributionAtMs?: number;
  publicId: string;
  rank: number | null;
  score: number;
  uid: string;
};

export type LeaderboardBoard = {
  boardId: string;
  entries: LeaderboardEntry[];
  frozen: boolean;
  kind: LeaderboardKind;
  periodId: string;
  scope: string;
  updatedAtMs: number;
  window: LeaderboardWindow;
};

export type LeaderboardResult = {
  board: LeaderboardBoard;
  viewer: LeaderboardEntry | null;
};

export type VipTier = {
  accentColor: string;
  id: string;
  minLifetimeCreditCoins: number;
  nameAr: string;
  rank: number;
};

export type VipStatusResult = {
  catalog: VipTier[];
  lifetimeCreditCoins: number;
  nextTier: VipTier | null;
  tier: VipTier | null;
};

export type OpsMissionRow = {
  claimable: boolean;
  claimed: boolean;
  complete: boolean;
  kind: string;
  missionId: string;
  progress: number;
  rewardCoins: number;
  target: number;
  titleAr: string;
};

export type OpsEventSummary = {
  audience: string;
  endsAtMs: number;
  eventId: string;
  startsAtMs: number;
  status: string;
  themeAr: string;
  titleAr: string;
};

export type OpsMissionsOverview = {
  dayId: string;
  event: OpsEventSummary | null;
  missions: OpsMissionRow[];
  nextResetAtMillis: number;
};

export type OpsMissionClaimResult = {
  alreadyClaimed: boolean;
  amount: number;
  balances?: StoreCurrencyAmounts;
  currency: 'coins' | 'diamonds';
  dayId: string;
  missionId: string;
  nextResetAtMillis: number;
  settlementId: string;
};

export type SocialCommandRequest<
  TAction extends SocialCommandAction = SocialCommandAction,
  TPayload = never,
> = {
  action: TAction;
  requestId: string;
  version: 1;
} & ([TPayload] extends [never] ? { payload?: never } : { payload: TPayload });

export type SocialCommandErrorCode =
  | 'AUTH_REQUIRED'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_FUNDS'
  | 'ITEM_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'DUPLICATE_OWNERSHIP'
  | 'REQUEST_CONFLICT'
  | 'INVALID_RECIPIENT'
  | 'REPRESENTATIVE_REQUIRED'
  | 'INVALID_REQUEST'
  | 'UPLOAD_INVALID'
  | 'MEDIA_REJECTED'
  | 'PROFILE_INCOMPLETE'
  | 'PUBLIC_ID_EXHAUSTED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type SocialCommandResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: SocialCommandErrorCode; messageAr: string } };

export type SocialFeatureFlags = {
  avatarUploads: boolean;
  couples: boolean;
  directMessageMedia: boolean;
  directMessageRequests: boolean;
  directMessages: boolean;
  following: boolean;
  friends: boolean;
  gifts: boolean;
  personalChatsFrontendV2: boolean;
  pushNotifications: boolean;
  representativeTransfers: boolean;
  usersDiscovery: boolean;
  wallet: boolean;
};
