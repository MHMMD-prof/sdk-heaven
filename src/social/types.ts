import type { RoomCountryCode } from '../types/voice';

export type ProfileGender = 'male' | 'female';
export type PublicProfileModerationStatus = 'active' | 'suspended' | 'removed';

export type PublicUserProfile = {
  avatarModerationStatus: 'clear' | 'pending' | 'removed';
  avatarUrl: string;
  bio: string;
  countryCode: RoomCountryCode;
  coupleLevel: number;
  createdAt?: unknown;
  displayName: string;
  friendCount: number;
  gender?: ProfileGender;
  giftScore: number;
  moderationStatus: PublicProfileModerationStatus;
  normalizedName: string;
  publicId: string;
  representativeBadgeActive?: boolean;
  specialId?: string;
  uid: string;
  updatedAt?: unknown;
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

export type NotificationPreferences = {
  coupleRequests: boolean;
  friendRequests: boolean;
  gifts: boolean;
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
  recipientUid: string;
  scoreValue: number;
  senderDisplayName: string;
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

export type SocialCommandAction =
  | 'bootstrap-profile'
  | 'get-readiness'
  | 'search-users'
  | 'get-friends'
  | 'get-friendship-status'
  | 'get-wallet-store'
  | 'purchase-special-id'
  | 'get-store-catalog'
  | 'purchase-store-item'
  | 'get-my-store-items'
  | 'equip-store-item'
  | 'gift-store-item'
  | 'get-representative-status'
  | 'create-representative-portal-ticket'
  | 'representative-transfer'
  | 'get-gift-center'
  | 'send-gift'
  | 'get-couples'
  | 'get-couple-status'
  | 'get-notification-settings'
  | NotificationMutationAction
  | CoupleMutationAction
  | FriendMutationAction;

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
  | 'PROFILE_INCOMPLETE'
  | 'PUBLIC_ID_EXHAUSTED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type SocialCommandResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: SocialCommandErrorCode; messageAr: string } };

export type SocialFeatureFlags = {
  couples: boolean;
  friends: boolean;
  gifts: boolean;
  pushNotifications: boolean;
  representativeTransfers: boolean;
  usersDiscovery: boolean;
  wallet: boolean;
};
