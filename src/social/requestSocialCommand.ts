import { getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '../auth/firebase';
import { createSocialRequestId } from './publicProfile';
import type {
  CoupleMutationAction,
  CoupleMutationResult,
  CouplesOverview,
  CoupleStatusResult,
  FriendMutationAction,
  FriendMutationResult,
  FriendsOverview,
  FriendshipStatusResult,
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
} from './types';

const functions = getFunctions(firebaseApp, 'us-central1');

export async function requestProfileBootstrap(
  request: SocialCommandRequest<'bootstrap-profile' | 'get-readiness'>,
): Promise<SocialCommandResult<ProfileBootstrapResult>> {
  return callSocialCommand<SocialCommandRequest<'bootstrap-profile' | 'get-readiness'>, ProfileBootstrapResult>(request);
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
  code: 'AUTH_REQUIRED' | 'EMAIL_VERIFICATION_REQUIRED' | 'FEATURE_DISABLED' | 'INVALID_REQUEST' | 'PROFILE_INCOMPLETE' | 'PUBLIC_ID_EXHAUSTED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'CONFLICT' | 'NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'ITEM_UNAVAILABLE' | 'OUT_OF_STOCK' | 'DUPLICATE_OWNERSHIP' | 'REQUEST_CONFLICT' | 'INVALID_RECIPIENT' | 'INTERNAL';
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
