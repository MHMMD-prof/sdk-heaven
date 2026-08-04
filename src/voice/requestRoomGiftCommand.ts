import { VoiceProviderConfig } from './types';
import Constants from 'expo-constants';

export type RoomGiftAction = 'get-room-gift-center' | 'quote-room-gift' | 'send-room-gift';

export type RoomGiftPresentationTier = 'inline' | 'targeted' | 'major' | 'global';
export type RoomGiftAssetReference = { assetId: string; assetVersionId: string };
export type RoomGiftPresentation = {
  animationEnabled: boolean;
  audioAsset?: RoomGiftAssetReference;
  durationMs: number;
  fallbackAsset?: RoomGiftAssetReference;
  hapticPolicy: 'off' | 'light' | 'success';
  minimumClientVersion: string;
  performanceTier: 'low' | 'standard' | 'high';
  physicalApprovalReceiptId?: string;
  schemaVersion: 1;
  soundPolicy: 'off' | 'soft' | 'full';
  tier: RoomGiftPresentationTier;
  visualAsset?: RoomGiftAssetReference;
};

export type RoomGiftCatalogItem = {
  assetVersion?: string;
  giftId: string;
  iconKey: string;
  nameAr: string;
  price: number;
  presentation: RoomGiftPresentation;
  scoreValue: number;
  status: 'available' | 'disabled';
};

export type RoomGiftQuote = {
  assetVersion: string;
  commissionBps: number;
  currency: 'coins';
  expiresAtMs: number;
  giftId: string;
  iconKey: string;
  nameAr: string;
  platformShare: number;
  policyVersion: number;
  presentation: RoomGiftPresentation;
  presentationTier: RoomGiftPresentationTier;
  price: number;
  quantity: number;
  quoteId: string;
  recipientCredit: number;
  roomId: string;
  scoreValue: number;
  targetMode: 'member';
  targetUid: string;
  unitPrice: number;
};

export type RoomGiftEffect = {
  animationEnabled: boolean;
  audioEnabled: boolean;
  comboCount: number;
  comboKey: string;
  comboSequence: number;
  cosmeticAsset?: RoomGiftAssetReference;
  durationMs: number;
  eventId: string;
  expiresAtMs: number;
  giftId: string;
  hapticPolicy: 'off' | 'light' | 'success';
  iconKey: string;
  nameAr: string;
  presentationTier: RoomGiftPresentationTier;
  priority: number;
  quantity: number;
  recipientDisplayName: string;
  recipientUid: string;
  roomId: string;
  senderDisplayName: string;
  senderUid: string;
  soundPolicy: 'off' | 'soft' | 'full';
};

export type RoomGiftCommandRequest = {
  action: RoomGiftAction;
  giftId?: string;
  quantity?: number;
  quoteId?: string;
  requestId?: string;
  roomId: string;
  targetUid?: string;
};

export type RoomGiftCommandResult = {
  action: RoomGiftAction;
  balances?: { coins: number; diamonds: number };
  catalog?: RoomGiftCatalogItem[];
  economyBalances?: {
    gameRewards: number;
    giftEarnings: number;
    promotions: number;
  };
  effect?: RoomGiftEffect;
  eventId?: string;
  policy?: {
    commissionBps: number;
    policyVersion: number;
  } | null;
  quote?: RoomGiftQuote;
  receiptId?: string;
  requestId: string;
  roomId: string;
};

export class RoomGiftRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomGiftRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomGiftCommand(
  request: RoomGiftCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomGiftCommandResult> {
  const endpoint = config?.roomGiftCommandEndpoint;
  if (!endpoint) {
    throw new RoomGiftRequestError(
      'ENDPOINT_MISSING',
      'Room gift endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomGiftRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: request.action,
        clientVersion: Constants.expoConfig?.version || '0.0.0',
        requestId,
        roomId: request.roomId,
        ...(request.giftId ? { giftId: request.giftId } : {}),
        ...(request.quoteId ? { quoteId: request.quoteId } : {}),
        ...(request.targetUid ? { targetUid: request.targetUid, targetMode: 'member' } : {}),
        ...(request.action !== 'get-room-gift-center' ? { quantity: request.quantity ?? 1 } : {}),
      }),
      headers: {
        Authorization: `Bearer ${await getIdToken(true)}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = await readResponse(response);
    if (!response.ok || payload.ok !== true || !payload.result) {
      throw new RoomGiftRequestError(
        payload.code || `HTTP_${response.status}`,
        roomGiftErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RoomGiftRequestError) throw error;
    throw new RoomGiftRequestError(
      error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      'تعذر الاتصال بخدمة هدايا الغرفة. حاول مرة أخرى.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createRoomGiftRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `roomgift_${now.toString(36)}_${entropy}`;
}

export function roomGiftErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    ACCOUNT_RESTRICTED: 'حسابك غير مؤهل لإرسال الهدايا.',
    CATALOG_UNAVAILABLE: 'هذه الهدية غير متاحة حالياً.',
    FEATURE_DISABLED: 'هدايا الغرفة غير مفعّلة حالياً.',
    INSUFFICIENT_FUNDS: 'رصيد العملات غير كافٍ.',
    POLICY_MISSING: 'سياسة عمولة الهدايا غير مهيأة.',
    QUOTE_EXPIRED: 'انتهت صلاحية عرض السعر. أعد المحاولة.',
    QUOTE_MISMATCH: 'تغير السعر أو العمولة. أعد طلب العرض.',
    QUOTE_NOT_FOUND: 'تعذر العثور على عرض السعر.',
    RECIPIENT_UNAVAILABLE: 'المستلم غير متاح في هذه الغرفة.',
    ROOM_NOT_ACTIVE: 'الغرفة غير نشطة للهدايا.',
    SELF_GIFT_FORBIDDEN: 'لا يمكن إرسال هدية لنفسك.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ هدية الغرفة.';
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { firebaseAuth } = await import('../auth/firebase');
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('A signed-in user is required.');
  return user.getIdToken(forceRefresh);
}

async function readResponse(response: Response): Promise<{
  ok?: boolean;
  code?: string;
  error?: string;
  result?: RoomGiftCommandResult;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
