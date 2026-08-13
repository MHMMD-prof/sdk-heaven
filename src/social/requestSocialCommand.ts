import { getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '../auth/firebase';
import type {
  CoupleEffectEquipResult,
  CoupleEffectPurchaseResult,
  CoupleEffectsResult,
  CoupleEffectUnequipResult,
} from '../cosmetics/coupleEffects';
import type { StoreCurrency } from '../store/contracts';
import { createSocialRequestId } from './publicProfile';
import {
  buildCoupleEffectsRequest,
  buildEquipCoupleEffectRequest,
  buildPurchaseCoupleEffectRequest,
  buildUnequipCoupleEffectRequest,
} from './coupleEffectRequests';
export {
  buildCoupleEffectsRequest,
  buildEquipCoupleEffectRequest,
  buildPurchaseCoupleEffectRequest,
  buildUnequipCoupleEffectRequest,
} from './coupleEffectRequests';
import type {
  CoupleMutationAction,
  CoupleMutationResult,
  CouplesOverview,
  CoupleStatusResult,
  FriendMutationAction,
  FriendMutationResult,
  FriendsOverview,
  FriendshipStatusResult,
  FollowListInput,
  FollowListResult,
  FollowMutationAction,
  FollowMutationResult,
  FollowStatusResult,
  BlockedUsersResult,
  GiftCenterResult,
  GiftSendResult,
  NotificationPreferences,
  NotificationSettingsResult,
  PushDeviceMutationResult,
  SpecialIdPurchaseResult,
  ProfileBootstrapResult,
  SocialCommandRequest,
  SocialCommandResult,
  UserDiscoveryInput,
  UserDiscoveryResult,
  WalletStoreResult,
  CustomerStoreResult,
  StorePurchaseResult,
  MyStoreItemsResult,
  StoreEquipResult,
  StoreGiftResult,
  RepresentativeStatusResult,
  RepresentativePortalTicketResult,
  RepresentativeTransferResult,
  BlockMutationAction,
  BlockMutationResult,
  QuickMatchResult,
  LuckyBagClaimResult,
  LeaderboardKind,
  LeaderboardResult,
  LeaderboardWindow,
  VipStatusResult,
  AvatarFinalizeResult,
  AvatarUploadAuthorization,
  ProfilePresentationUpdateInput,
  ProfilePresentationUpdateResult,
} from './types';

const functions = getFunctions(firebaseApp, 'us-central1');

export async function requestProfileBootstrap(
  request: SocialCommandRequest<'bootstrap-profile' | 'get-readiness'>,
): Promise<SocialCommandResult<ProfileBootstrapResult>> {
  return callSocialCommand<SocialCommandRequest<'bootstrap-profile' | 'get-readiness'>, ProfileBootstrapResult>(request);
}

export async function requestProfilePresentationUpdate(
  payload: ProfilePresentationUpdateInput,
): Promise<SocialCommandResult<ProfilePresentationUpdateResult>> {
  return callSocialCommand<SocialCommandRequest<'update-profile-presentation', ProfilePresentationUpdateInput>, ProfilePresentationUpdateResult>({
    action: 'update-profile-presentation', payload, requestId: createSocialRequestId('profileupdate'), version: 1,
  });
}

export async function requestAvatarUpload(
  payload: { contentType: AvatarUploadAuthorization['contentType']; sha256: string; sizeBytes: number },
): Promise<SocialCommandResult<AvatarUploadAuthorization>> {
  return callSocialCommand<SocialCommandRequest<'create-avatar-upload', typeof payload>, AvatarUploadAuthorization>({
    action: 'create-avatar-upload', payload, requestId: createSocialRequestId('avatarupload'), version: 1,
  });
}

export async function requestAvatarFinalize(uploadId: string): Promise<SocialCommandResult<AvatarFinalizeResult>> {
  return callSocialCommand<SocialCommandRequest<'finalize-avatar-upload', { uploadId: string }>, AvatarFinalizeResult>({
    action: 'finalize-avatar-upload', payload: { uploadId }, requestId: createSocialRequestId('avatarfinal'), version: 1,
  });
}

export async function requestAvatarRemove(): Promise<SocialCommandResult<{ status: 'removed' }>> {
  return callSocialCommand<SocialCommandRequest<'remove-avatar'>, { status: 'removed' }>({
    action: 'remove-avatar', requestId: createSocialRequestId('avatarremove'), version: 1,
  });
}

export async function requestUserDiscovery(
  input: UserDiscoveryInput,
): Promise<SocialCommandResult<UserDiscoveryResult>> {
  return callSocialCommand<SocialCommandRequest<'search-users', UserDiscoveryInput>, UserDiscoveryResult>({
    action: 'search-users',
    payload: input,
    requestId: createSocialRequestId('discovery'),
    version: 1,
  });
}

export async function requestFriendsOverview(): Promise<SocialCommandResult<FriendsOverview>> {
  return callSocialCommand<SocialCommandRequest<'get-friends'>, FriendsOverview>({
    action: 'get-friends',
    requestId: createSocialRequestId('friends'),
    version: 1,
  });
}

export async function requestFriendshipStatus(
  targetUid: string,
): Promise<SocialCommandResult<FriendshipStatusResult>> {
  return callSocialCommand<
    SocialCommandRequest<'get-friendship-status', { targetUid: string }>,
    FriendshipStatusResult
  >({
    action: 'get-friendship-status',
    payload: { targetUid },
    requestId: createSocialRequestId('friendstatus'),
    version: 1,
  });
}

export async function requestFriendMutation(
  action: FriendMutationAction,
  targetUid: string,
): Promise<SocialCommandResult<FriendMutationResult>> {
  return callSocialCommand<
    SocialCommandRequest<FriendMutationAction, { targetUid: string }>,
    FriendMutationResult
  >({
    action,
    payload: { targetUid },
    requestId: createSocialRequestId('friend'),
    version: 1,
  });
}

export async function requestFollowStatus(
  targetUid: string,
): Promise<SocialCommandResult<FollowStatusResult>> {
  return callSocialCommand<
    SocialCommandRequest<'get-follow-status', { targetUid: string }>,
    FollowStatusResult
  >({
    action: 'get-follow-status',
    payload: { targetUid },
    requestId: createSocialRequestId('followstatus'),
    version: 1,
  });
}

export async function requestFollowList(
  kind: 'following' | 'followers',
  targetUid?: string,
): Promise<SocialCommandResult<FollowListResult>> {
  const payload: FollowListInput | undefined = targetUid ? { targetUid } : undefined;
  return callSocialCommand<
    SocialCommandRequest<'get-following' | 'get-followers', FollowListInput>,
    FollowListResult
  >({
    action: kind === 'following' ? 'get-following' : 'get-followers',
    ...(payload ? { payload } : {}),
    requestId: createSocialRequestId(kind),
    version: 1,
  } as SocialCommandRequest<'get-following' | 'get-followers', FollowListInput>);
}

export async function requestFollowMutation(
  action: FollowMutationAction,
  targetUid: string,
): Promise<SocialCommandResult<FollowMutationResult>> {
  return callSocialCommand<
    SocialCommandRequest<FollowMutationAction, { targetUid: string }>,
    FollowMutationResult
  >({
    action,
    payload: { targetUid },
    requestId: createSocialRequestId('follow'),
    version: 1,
  });
}

export async function requestBlockedUsers(): Promise<SocialCommandResult<BlockedUsersResult>> {
  return callSocialCommand<SocialCommandRequest<'get-blocked-users'>, BlockedUsersResult>({
    action: 'get-blocked-users',
    requestId: createSocialRequestId('blocked'),
    version: 1,
  });
}

export async function requestBlockMutation(
  action: BlockMutationAction,
  targetUid: string,
): Promise<SocialCommandResult<BlockMutationResult>> {
  return callSocialCommand<SocialCommandRequest<BlockMutationAction, { targetUid: string }>, BlockMutationResult>({
    action,
    payload: { targetUid },
    requestId: createSocialRequestId('block'),
    version: 1,
  });
}

export async function requestCouplesOverview(): Promise<SocialCommandResult<CouplesOverview>> {
  return callSocialCommand<SocialCommandRequest<'get-couples'>, CouplesOverview>({
    action: 'get-couples',
    requestId: createSocialRequestId('couples'),
    version: 1,
  });
}

export async function requestCoupleStatus(targetUid: string): Promise<SocialCommandResult<CoupleStatusResult>> {
  return callSocialCommand<SocialCommandRequest<'get-couple-status', { targetUid: string }>, CoupleStatusResult>({
    action: 'get-couple-status',
    payload: { targetUid },
    requestId: createSocialRequestId('couplestatus'),
    version: 1,
  });
}

export async function requestCoupleMutation(
  action: CoupleMutationAction,
  targetUid: string,
): Promise<SocialCommandResult<CoupleMutationResult>> {
  return callSocialCommand<SocialCommandRequest<CoupleMutationAction, { targetUid: string }>, CoupleMutationResult>({
    action,
    payload: { targetUid },
    requestId: createSocialRequestId('couple'),
    version: 1,
  });
}

export async function requestMyFamily(): Promise<SocialCommandResult<import('./types').MyFamilyResult>> {
  return callSocialCommand<SocialCommandRequest<'get-my-family'>, import('./types').MyFamilyResult>({
    action: 'get-my-family',
    requestId: createSocialRequestId('family'),
    version: 1,
  });
}

export async function requestFamilyMutation(
  action: import('./types').FamilyMutationAction,
  payload?: Record<string, unknown>,
): Promise<SocialCommandResult<import('./types').FamilyMutationResult>> {
  return callSocialCommand({
    action,
    requestId: createSocialRequestId('family'),
    version: 1,
    ...(payload !== undefined ? { payload } : {}),
  } as SocialCommandRequest<import('./types').FamilyMutationAction, Record<string, unknown>>);
}

export async function requestCoupleEffects(): Promise<SocialCommandResult<CoupleEffectsResult>> {
  return callSocialCommand<SocialCommandRequest<'get-couple-effects'>, CoupleEffectsResult>(
    buildCoupleEffectsRequest(),
  );
}

export async function requestPurchaseCoupleEffect(
  itemId: string,
  currency: StoreCurrency,
): Promise<SocialCommandResult<CoupleEffectPurchaseResult>> {
  return callSocialCommand<
    SocialCommandRequest<'purchase-couple-effect', { currency: StoreCurrency; itemId: string }>,
    CoupleEffectPurchaseResult
  >(buildPurchaseCoupleEffectRequest(itemId, currency));
}

export async function requestEquipCoupleEffect(
  itemId: string,
): Promise<SocialCommandResult<CoupleEffectEquipResult>> {
  return callSocialCommand<
    SocialCommandRequest<'equip-couple-effect', { itemId: string }>,
    CoupleEffectEquipResult
  >(buildEquipCoupleEffectRequest(itemId));
}

export async function requestUnequipCoupleEffect(): Promise<SocialCommandResult<CoupleEffectUnequipResult>> {
  return callSocialCommand<SocialCommandRequest<'unequip-couple-effect'>, CoupleEffectUnequipResult>(
    buildUnequipCoupleEffectRequest(),
  );
}

export async function requestCreateCosmeticCustomUpload(
  input: {
    category: import('../cosmetics/customSubmissions').CustomCosmeticCategory;
    contentType: string;
    fallbackAssetId?: string;
    fallbackAssetVersionId?: string;
    format: string;
    sizeBytes: number;
  },
): Promise<SocialCommandResult<import('../cosmetics/customSubmissions').CustomUploadAuthorization>> {
  const { buildCreateCustomUploadRequest } = await import('../cosmetics/customSubmissions');
  return callSocialCommand(buildCreateCustomUploadRequest(input));
}

export async function requestFinalizeCosmeticCustomUpload(
  submissionId: string,
): Promise<SocialCommandResult<{ submissionId: string; status: string }>> {
  const { buildFinalizeCustomUploadRequest } = await import('../cosmetics/customSubmissions');
  return callSocialCommand(buildFinalizeCustomUploadRequest(submissionId));
}

export async function requestAttestCosmeticCustomSubmission(
  submissionId: string,
  attestation: string,
): Promise<SocialCommandResult<{ submissionId: string; status: string }>> {
  const { buildAttestCustomSubmissionRequest } = await import('../cosmetics/customSubmissions');
  return callSocialCommand(buildAttestCustomSubmissionRequest(submissionId, attestation));
}

export async function requestListCosmeticCustomSubmissions(
  limit = 25,
): Promise<SocialCommandResult<{ submissions: import('../cosmetics/customSubmissions').CustomSubmissionSummary[] }>> {
  const {
    buildListCustomSubmissionsRequest,
    mapCustomSubmissionSummaries,
  } = await import('../cosmetics/customSubmissions');
  const response = await callSocialCommand<
    SocialCommandRequest<'list-cosmetic-custom-submissions', { limit: number }>,
    { submissions: unknown }
  >(buildListCustomSubmissionsRequest(limit));
  if (!response.ok) return response;
  return { ok: true, result: { submissions: mapCustomSubmissionSummaries(response.result) } };
}

export async function requestEquipCosmeticCustomAsset(
  assetId: string,
): Promise<SocialCommandResult<{ assetId: string; assetVersionId: string; category: string }>> {
  const { buildEquipCustomAssetRequest } = await import('../cosmetics/customSubmissions');
  return callSocialCommand(buildEquipCustomAssetRequest(assetId));
}

export async function requestUnequipCosmeticCustomAsset(
  category: import('../cosmetics/customSubmissions').CustomCosmeticCategory,
): Promise<SocialCommandResult<{ assetId: null; category: string }>> {
  const { buildUnequipCustomAssetRequest } = await import('../cosmetics/customSubmissions');
  return callSocialCommand(buildUnequipCustomAssetRequest(category));
}

export async function requestNotificationSettings(): Promise<SocialCommandResult<NotificationSettingsResult>> {
  return callSocialCommand<SocialCommandRequest<'get-notification-settings'>, NotificationSettingsResult>({
    action: 'get-notification-settings',
    requestId: createSocialRequestId('notifications'),
    version: 1,
  });
}

export async function requestPushDeviceRegistration(input: {
  deviceName: string;
  platform: 'android' | 'ios';
  token: string;
}): Promise<SocialCommandResult<PushDeviceMutationResult>> {
  return callSocialCommand<SocialCommandRequest<'register-push-device', typeof input>, PushDeviceMutationResult>({
    action: 'register-push-device',
    payload: input,
    requestId: createSocialRequestId('pushregister'),
    version: 1,
  });
}

export async function requestPushDeviceUnregistration(token: string): Promise<SocialCommandResult<PushDeviceMutationResult>> {
  return callSocialCommand<SocialCommandRequest<'unregister-push-device', { token: string }>, PushDeviceMutationResult>({
    action: 'unregister-push-device',
    payload: { token },
    requestId: createSocialRequestId('pushunregister'),
    version: 1,
  });
}

export async function requestNotificationPreferencesUpdate(
  preferences: NotificationPreferences,
): Promise<SocialCommandResult<PushDeviceMutationResult>> {
  return callSocialCommand<SocialCommandRequest<'update-notification-preferences', NotificationPreferences>, PushDeviceMutationResult>({
    action: 'update-notification-preferences',
    payload: preferences,
    requestId: createSocialRequestId('pushprefs'),
    version: 1,
  });
}

export async function requestWalletStore(): Promise<SocialCommandResult<WalletStoreResult>> {
  return callSocialCommand<SocialCommandRequest<'get-wallet-store'>, WalletStoreResult>({
    action: 'get-wallet-store',
    requestId: createSocialRequestId('wallet'),
    version: 1,
  });
}

export async function requestSpecialIdPurchase(
  specialId: string,
): Promise<SocialCommandResult<SpecialIdPurchaseResult>> {
  return callSocialCommand<SocialCommandRequest<'purchase-special-id', { specialId: string }>, SpecialIdPurchaseResult>({
    action: 'purchase-special-id',
    payload: { specialId },
    requestId: createSocialRequestId('purchase'),
    version: 1,
  });
}

export async function requestStoreCatalog(): Promise<SocialCommandResult<CustomerStoreResult>> {
  return callSocialCommand<SocialCommandRequest<'get-store-catalog'>, CustomerStoreResult>({
    action: 'get-store-catalog', requestId: createSocialRequestId('storecatalog'), version: 1,
  });
}

export async function requestStorePurchase(
  itemId: string,
  currency: 'coins' | 'diamonds',
): Promise<SocialCommandResult<StorePurchaseResult>> {
  return callSocialCommand<SocialCommandRequest<'purchase-store-item', { currency: 'coins' | 'diamonds'; itemId: string }>, StorePurchaseResult>({
    action: 'purchase-store-item', payload: { currency, itemId }, requestId: createSocialRequestId('storepurchase'), version: 1,
  });
}

export async function requestMyStoreItems(): Promise<SocialCommandResult<MyStoreItemsResult>> {
  return callSocialCommand<SocialCommandRequest<'get-my-store-items'>, MyStoreItemsResult>({
    action: 'get-my-store-items', requestId: createSocialRequestId('myitems'), version: 1,
  });
}

export async function requestStoreEquip(itemId: string): Promise<SocialCommandResult<StoreEquipResult>> {
  return callSocialCommand<SocialCommandRequest<'equip-store-item', { itemId: string }>, StoreEquipResult>({
    action: 'equip-store-item', payload: { itemId }, requestId: createSocialRequestId('equipitem'), version: 1,
  });
}

export async function requestStoreGift(itemId: string, currency: 'coins' | 'diamonds', recipientPublicId: string): Promise<SocialCommandResult<StoreGiftResult>> {
  return callSocialCommand<SocialCommandRequest<'gift-store-item', { currency: 'coins' | 'diamonds'; itemId: string; recipientPublicId: string }>, StoreGiftResult>({
    action: 'gift-store-item', payload: { currency, itemId, recipientPublicId }, requestId: createSocialRequestId('storegift'), version: 1,
  });
}

export async function requestRepresentativeStatus(): Promise<SocialCommandResult<RepresentativeStatusResult>> {
  return callSocialCommand<SocialCommandRequest<'get-representative-status'>, RepresentativeStatusResult>({
    action: 'get-representative-status', requestId: createSocialRequestId('representativestatus'), version: 1,
  });
}

export async function requestRepresentativePortalTicket(): Promise<SocialCommandResult<RepresentativePortalTicketResult>> {
  return callSocialCommand<SocialCommandRequest<'create-representative-portal-ticket'>, RepresentativePortalTicketResult>({
    action: 'create-representative-portal-ticket', requestId: createSocialRequestId('representativeportal'), version: 1,
  });
}

export async function requestRepresentativeTransfer(input: { amount: number; currency: 'coins' | 'diamonds'; recipientPublicId: string }): Promise<SocialCommandResult<RepresentativeTransferResult>> {
  return callSocialCommand<SocialCommandRequest<'representative-transfer', typeof input>, RepresentativeTransferResult>({
    action: 'representative-transfer', payload: input, requestId: createSocialRequestId('representativetransfer'), version: 1,
  });
}

export async function requestGiftCenter(targetUid?: string): Promise<SocialCommandResult<GiftCenterResult>> {
  return callSocialCommand<
    SocialCommandRequest<'get-gift-center', { targetUid: string }> | SocialCommandRequest<'get-gift-center'>,
    GiftCenterResult
  >({
    action: 'get-gift-center',
    ...(targetUid ? { payload: { targetUid } } : {}),
    requestId: createSocialRequestId('gifts'),
    version: 1,
  } as SocialCommandRequest<'get-gift-center', { targetUid: string }> | SocialCommandRequest<'get-gift-center'>);
}

export async function requestSendGift(
  giftId: string,
  targetUid: string,
  message = '',
): Promise<SocialCommandResult<GiftSendResult>> {
  return callSocialCommand<
    SocialCommandRequest<'send-gift', { giftId: string; message: string; targetUid: string }>,
    GiftSendResult
  >({
    action: 'send-gift',
    payload: { giftId, message, targetUid },
    requestId: createSocialRequestId('gift'),
    version: 1,
  });
}

export async function requestQuickMatch(
  preferredCountryCode?: string,
): Promise<SocialCommandResult<QuickMatchResult>> {
  return callSocialCommand<
    SocialCommandRequest<'quick-match', { preferredCountryCode?: string }> | SocialCommandRequest<'quick-match'>,
    QuickMatchResult
  >({
    action: 'quick-match',
    ...(preferredCountryCode ? { payload: { preferredCountryCode } } : {}),
    requestId: createSocialRequestId('quickmatch'),
    version: 1,
  } as SocialCommandRequest<'quick-match', { preferredCountryCode?: string }> | SocialCommandRequest<'quick-match'>);
}

export async function requestClaimLuckyBag(): Promise<SocialCommandResult<LuckyBagClaimResult>> {
  return callSocialCommand<SocialCommandRequest<'claim-lucky-bag'>, LuckyBagClaimResult>({
    action: 'claim-lucky-bag',
    requestId: createSocialRequestId('luckybag'),
    version: 1,
  });
}

export async function requestLeaderboard(input: {
  kind: LeaderboardKind;
  scope?: string;
  window: LeaderboardWindow;
}): Promise<SocialCommandResult<LeaderboardResult>> {
  return callSocialCommand<
    SocialCommandRequest<'get-leaderboard', typeof input>,
    LeaderboardResult
  >({
    action: 'get-leaderboard',
    payload: input,
    requestId: createSocialRequestId('leaderboard'),
    version: 1,
  });
}

export async function requestVipStatus(): Promise<SocialCommandResult<VipStatusResult>> {
  return callSocialCommand<SocialCommandRequest<'get-vip-status'>, VipStatusResult>({
    action: 'get-vip-status',
    requestId: createSocialRequestId('vipstatus'),
    version: 1,
  });
}

export async function requestOpsMissions(): Promise<SocialCommandResult<import('./types').OpsMissionsOverview>> {
  return callSocialCommand<SocialCommandRequest<'get-ops-missions'>, import('./types').OpsMissionsOverview>({
    action: 'get-ops-missions',
    requestId: createSocialRequestId('opsmissions'),
    version: 1,
  });
}

export async function requestClaimOpsMission(
  missionId: string,
): Promise<SocialCommandResult<import('./types').OpsMissionClaimResult>> {
  return callSocialCommand<
    SocialCommandRequest<'claim-ops-mission', { missionId: string }>,
    import('./types').OpsMissionClaimResult
  >({
    action: 'claim-ops-mission',
    payload: { missionId },
    requestId: createSocialRequestId('opsclaim'),
    version: 1,
  });
}

export async function requestSoftMatchEnqueue(
  preferGender?: 'male' | 'female',
): Promise<SocialCommandResult<import('./types').SoftMatchResult>> {
  return callSocialCommand<
    SocialCommandRequest<'soft-match-enqueue', { preferGender?: 'male' | 'female' }>
      | SocialCommandRequest<'soft-match-enqueue'>,
    import('./types').SoftMatchResult
  >({
    action: 'soft-match-enqueue',
    ...(preferGender ? { payload: { preferGender } } : {}),
    requestId: createSocialRequestId('softmatch'),
    version: 1,
  } as SocialCommandRequest<'soft-match-enqueue', { preferGender?: 'male' | 'female' }>
    | SocialCommandRequest<'soft-match-enqueue'>);
}

export async function requestSoftMatchCancel(): Promise<SocialCommandResult<import('./types').SoftMatchResult>> {
  return callSocialCommand<SocialCommandRequest<'soft-match-cancel'>, import('./types').SoftMatchResult>({
    action: 'soft-match-cancel',
    requestId: createSocialRequestId('softcancel'),
    version: 1,
  });
}

export async function requestSoftMatchStatus(): Promise<SocialCommandResult<import('./types').SoftMatchResult>> {
  return callSocialCommand<SocialCommandRequest<'soft-match-status'>, import('./types').SoftMatchResult>({
    action: 'soft-match-status',
    requestId: createSocialRequestId('softstatus'),
    version: 1,
  });
}

async function callSocialCommand<TRequest, TResult>(request: TRequest): Promise<SocialCommandResult<TResult>> {
  const callable = httpsCallable<TRequest, SocialCommandResult<TResult>>(functions, 'socialCommand');
  try {
    const response = await callable(request);
    return response.data;
  } catch (error) {
    const details = readCallableErrorDetails(error);
    return {
      ok: false,
      error: {
        code: details.code,
        messageAr: details.messageAr,
      },
    };
  }
}

function readCallableErrorDetails(error: unknown): {
  code: 'AUTH_REQUIRED' | 'EMAIL_VERIFICATION_REQUIRED' | 'FEATURE_DISABLED' | 'INVALID_REQUEST' | 'UPLOAD_INVALID' | 'MEDIA_REJECTED' | 'PROFILE_INCOMPLETE' | 'PUBLIC_ID_EXHAUSTED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'CONFLICT' | 'NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'ITEM_UNAVAILABLE' | 'OUT_OF_STOCK' | 'DUPLICATE_OWNERSHIP' | 'REQUEST_CONFLICT' | 'INVALID_RECIPIENT' | 'INTERNAL';
  messageAr: string;
} {
  const details = error && typeof error === 'object' && 'details' in error
    ? (error as { details?: unknown }).details
    : undefined;

  if (details && typeof details === 'object') {
    const candidate = details as Record<string, unknown>;
    const supportedCodes = [
      'AUTH_REQUIRED',
      'EMAIL_VERIFICATION_REQUIRED',
      'FEATURE_DISABLED',
      'INVALID_REQUEST',
      'UPLOAD_INVALID',
      'MEDIA_REJECTED',
      'PROFILE_INCOMPLETE',
      'PUBLIC_ID_EXHAUSTED',
      'PERMISSION_DENIED',
      'RATE_LIMITED',
      'CONFLICT',
      'NOT_FOUND',
      'INSUFFICIENT_FUNDS',
      'ITEM_UNAVAILABLE',
      'OUT_OF_STOCK',
      'DUPLICATE_OWNERSHIP',
      'REQUEST_CONFLICT',
      'INVALID_RECIPIENT',
      'INTERNAL',
    ] as const;
    const code = supportedCodes.find((value) => value === candidate.code);

    if (code && typeof candidate.messageAr === 'string') {
      return { code, messageAr: candidate.messageAr };
    }
  }

  return {
    code: 'INTERNAL',
    messageAr: 'تعذر تنفيذ الطلب. حاول مرة أخرى.',
  };
}
