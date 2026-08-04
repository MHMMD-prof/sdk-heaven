import Constants from 'expo-constants';

import { VoiceProviderConfig } from './types';

export type RoomEntryEffectAction = 'announce-entry-effect';

export type RoomEntryEffectPayload = {
  animationEnabled: boolean;
  assetSnapshot?: {
    audioAsset: { assetId: string; assetVersionId: string } | null;
    audioChecksum: string;
    fallbackAsset: { assetId: string; assetVersionId: string };
    fallbackChecksum: string;
    physicalApprovalReceiptId: string;
    visualAsset: { assetId: string; assetVersionId: string };
    visualChecksum: string;
  };
  assetVersion: string;
  audioEnabled: boolean;
  canonicalSlot: 'entry-effect';
  cosmeticAsset?: { assetId: string; assetVersionId: string };
  displayName: string;
  durationMs: number;
  eventId: string;
  expiresAtMs: number;
  fallbackArtworkUrl: string;
  height: number;
  itemId: string;
  kind: 'room-entry';
  legacyEquipmentSlot: 'cars';
  minimumClientVersion: string;
  nameAr: string;
  nameEn: string;
  performanceTier: 'low' | 'standard' | 'high';
  previewAssetUrl: string;
  priority: number;
  queueHintMax: number;
  roomEffectsPolicy: 'full' | 'reduced' | 'off';
  roomId: string;
  senderUid: string;
  sessionId: string;
  soundPolicy: 'off' | 'soft' | 'full';
  thumbnailUrl: string;
  width: number;
};

export type RoomEntryEffectCommandResult = {
  action: RoomEntryEffectAction;
  announced: boolean;
  effect?: RoomEntryEffectPayload;
  eventId: string | null;
  reason: string;
  requestId: string;
  roomId: string;
  sessionId: string;
  skipped: boolean;
};

export class RoomEntryEffectRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomEntryEffectRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomEntryEffectCommand(
  request: { clientVersion?: string; roomId: string; sessionId: string; requestId?: string },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomEntryEffectCommandResult> {
  const endpoint = config?.roomEntryEffectCommandEndpoint;
  if (!endpoint) {
    throw new RoomEntryEffectRequestError(
      'ENDPOINT_MISSING',
      'Room entry-effect endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomEntryEffectRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: 'announce-entry-effect',
        clientVersion: request.clientVersion || Constants.expoConfig?.version || '1.0.0',
        requestId,
        roomId: request.roomId,
        sessionId: request.sessionId,
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
      throw new RoomEntryEffectRequestError(
        payload.code || `HTTP_${response.status}`,
        roomEntryEffectErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RoomEntryEffectRequestError) throw error;
    throw new RoomEntryEffectRequestError(
      error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      'تعذر الاتصال بخدمة مؤثرات الدخول.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createRoomEntryEffectRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `entryfx_${now.toString(36)}_${entropy}`;
}

export function roomEntryEffectErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    FEATURE_DISABLED: 'مؤثرات دخول الغرفة غير مفعّلة حالياً.',
    CLIENT_UPDATE_REQUIRED: 'يجب تحديث التطبيق لتشغيل مركبة الدخول المجهّزة.',
    MEMBERSHIP_REQUIRED: 'يجب أن تكون عضواً نشطاً في الغرفة.',
    OWNERSHIP_EXPIRED: 'انتهت صلاحية مركبة الدخول المجهّزة.',
    OWNERSHIP_INACTIVE: 'مركبة الدخول المجهّزة غير نشطة.',
    OWNERSHIP_REQUIRED: 'لا توجد مركبة دخول مجهّزة.',
    SESSION_MISMATCH: 'جلسة الحضور غير متطابقة. أعد الدخول.',
    RATE_LIMITED: 'تم إرسال محاولات كثيرة. حاول مجدداً بعد قليل.',
  };
  return (code && messages[code]) || fallback || 'تعذر إعلان مؤثر الدخول.';
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
  result?: RoomEntryEffectCommandResult;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
