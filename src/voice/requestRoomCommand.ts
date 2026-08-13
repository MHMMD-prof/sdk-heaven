import { VoiceProviderConfig } from './types';
import { debugError, debugLog } from '../utils/debugLog';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';
import {
  RoomChatMode,
  RoomEffectsPolicy,
  RoomHistoryVisibility,
  RoomKeywordFilterMode,
} from './roomV2Contract';

export type RoomCommandAction =
  | 'promote-speaker'
  | 'demote-listener'
  | 'mute-member'
  | 'unmute-member'
  | 'remove-member'
  | 'ban-member'
  | 'unban-member'
  | 'assign-moderator'
  | 'remove-moderator'
  | 'grant-dj'
  | 'revoke-dj'
  | 'transfer-ownership'
  | 'lock-audio'
  | 'unlock-audio'
  | 'close-room'
  | 'remove-room'
  | 'update-room-settings'
  | 'report-member'
  | 'claim-seat'
  | 'leave-seat'
  | 'request-seat'
  | 'cancel-seat-request'
  | 'approve-seat-request'
  | 'reject-seat-request'
  | 'invite-to-seat'
  | 'accept-seat-invite'
  | 'decline-seat-invite'
  | 'lock-seat'
  | 'unlock-seat'
  | 'set-seat-mode'
  | 'resize-seats'
  | 'reserve-seat'
  | 'resume-seat';

export type RoomCommandRequest = {
  roomId: string;
  action: RoomCommandAction;
  targetUid?: string;
  reason?: string;
  expectedRevision?: number;
  requestId?: string;
  seatId?: string;
  seatMode?: 'open' | 'request' | 'invite' | 'locked';
  seatTargetCount?: 5 | 10 | 15 | 20;
  sessionId?: string;
  settings?: RoomSettingsPatch;
};

export type RoomSettingsPatch = {
  announcement?: string;
  welcomeMessage?: string;
  chatMode?: RoomChatMode;
  slowModeSeconds?: 0 | 5 | 10 | 30 | 60;
  historyVisibility?: RoomHistoryVisibility;
  keywordFilterMode?: RoomKeywordFilterMode;
  effectsPolicy?: RoomEffectsPolicy;
};

export type RoomCommandResult = {
  action: RoomCommandAction;
  liveKitSyncStatus:
    | 'not-required'
    | 'pending'
    | 'leased'
    | 'synced'
    | 'synced-offline'
    | 'dead-letter';
  requestId: string;
  revision: number;
  roomId: string;
  seatId?: string;
  status: 'applied';
  targetUid?: string;
};

type RoomCommandResponse = {
  ok?: boolean;
  replayed?: boolean;
  result?: RoomCommandResult;
  code?: string;
  error?: string;
};

export class RoomCommandRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomCommandRequestError';
    this.code = code;
    this.status = status;
  }
}

const roomCommandRequestTimeoutMs = 10_000;

export async function requestRoomCommand(
  request: RoomCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
): Promise<RoomCommandResult> {
  const endpoint = config?.roomCommandEndpoint;
  if (!endpoint) throw new RoomCommandRequestError('ENDPOINT_MISSING', 'Room command endpoint is not configured.', 0);

  const requestId = request.requestId || createRoomCommandRequestId();
  const payload = { ...request, requestId };
  const idToken = await getIdToken();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), roomCommandRequestTimeoutMs);
    try {
      debugLog('voice.command', 'request:start', {
        action: request.action,
        attempt,
        requestId,
        roomId: request.roomId,
      });
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          ...(await getVoiceAppCheckHeader()),
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      const responsePayload = await readResponse(response);

      if (response.ok && responsePayload.ok === true && !responsePayload.result && typeof (responsePayload as { action?: unknown }).action === 'string') {
        return {
          action: request.action,
          liveKitSyncStatus: 'pending',
          requestId,
          revision: (request.expectedRevision ?? 0) + 1,
          roomId: request.roomId,
          status: 'applied',
          targetUid: request.targetUid,
        };
      }

      if (!response.ok || responsePayload.ok !== true || !responsePayload.result) {
        const error = new RoomCommandRequestError(
          responsePayload.code || `HTTP_${response.status}`,
          roomCommandErrorMessage(responsePayload.code, responsePayload.error),
          response.status,
        );
        if (response.status >= 500 && attempt === 1) {
          lastError = error;
          continue;
        }
        throw error;
      }

      debugLog('voice.command', 'request:success', {
        action: request.action,
        replayed: responsePayload.replayed === true,
        requestId,
        revision: responsePayload.result.revision,
        roomId: request.roomId,
      });
      return responsePayload.result;
    } catch (error) {
      if (error instanceof RoomCommandRequestError) throw error;
      lastError = error;
      if (attempt === 1) continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  debugError('voice.command', 'request:networkError', lastError, {
    action: request.action,
    requestId,
    roomId: request.roomId,
  });
  throw new RoomCommandRequestError(
    isAbortError(lastError) ? 'TIMEOUT' : 'NETWORK_ERROR',
    isAbortError(lastError) ? 'انتهت مهلة أمر الغرفة. حاول مرة أخرى.' : 'تعذر الاتصال بخدمة الغرفة. تحقق من الشبكة وحاول مجدداً.',
    0,
  );
}

export function createRoomCommandRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `room_${now.toString(36)}_${entropy}`;
}

export function roomCommandErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    ACCOUNT_RESTRICTED: 'حسابك مقيّد حالياً ولا يمكنه تنفيذ أوامر الغرفة.',
    FEATURE_DISABLED: 'مقاعد الميكروفون متوقفة مؤقتا. حاول مرة أخرى لاحقا.',
    FORBIDDEN: 'ليست لديك الصلاحية المطلوبة لهذا الإجراء.',
    MEMBERSHIP_REQUIRED: 'أعد دخول الغرفة ثم حاول مرة أخرى.',
    MODERATOR_LIMIT_REACHED: 'وصلت الغرفة إلى الحد الأقصى للمشرفين.',
    REGION_SCOPE_DENIED: 'هذه الغرفة خارج النطاق الإقليمي المسموح لك.',
    REQUEST_ID_CONFLICT: 'تعارض مع طلب سابق. أعد المحاولة.',
    REASON_REQUIRED: 'اكتب سبباً واضحاً لهذا الإجراء.',
    REVISION_CONFLICT: 'تغيّرت الغرفة. انتظر التحديث ثم حاول مرة أخرى.',
    REVISION_REQUIRED: 'يجب تحديث بيانات الغرفة قبل تنفيذ هذا الإجراء.',
    ROOM_MIGRATION_REQUIRED: 'هذه الغرفة قيد التحديث ولا تدعم هذا الإجراء بعد.',
    ROOM_NOT_ACTIVE: 'الغرفة لم تعد نشطة.',
    ROOM_BAN_NOT_ACTIVE: 'لم يعد هذا الحظر فعالاً.',
    ROOM_SETTINGS_INVALID: 'تحقق من إعدادات الغرفة ثم حاول مرة أخرى.',
    ALREADY_SEATED: 'لديك مقعد ميكروفون بالفعل.',
    NOT_SEATED: 'لا تشغل مقعد ميكروفون حاليا.',
    SEAT_COMMAND_REQUIRED: 'استخدم مقعد الميكروفون بدلا من الترقية القديمة.',
    SEAT_COUNT_INVALID: 'عدد مقاعد الميكروفون غير صالح.',
    SEAT_ENGINE_NOT_ACTIVE: 'مقاعد الميكروفون الجديدة لم تُفعّل لهذه الغرفة بعد.',
    SEAT_INVITE_EXPIRED: 'انتهت دعوة مقعد الميكروفون.',
    SEAT_INVITE_NOT_PENDING: 'لا توجد دعوة ميكروفون معلقة.',
    SEAT_MODE_DENIED: 'وضع مقاعد الغرفة لا يسمح بهذا الإجراء.',
    SEAT_REQUEST_EXPIRED: 'انتهى طلب مقعد الميكروفون.',
    SEAT_REQUEST_NOT_PENDING: 'لا يوجد طلب ميكروفون معلق.',
    SEAT_RESERVATION_EXPIRED: 'انتهت مهلة استعادة مقعد الميكروفون.',
    SEAT_RESERVATION_MISSING: 'لم يعد مقعد الميكروفون محجوزا لك.',
    SEAT_UNAVAILABLE: 'مقعد الميكروفون غير متاح الآن.',
    TARGET_INVALID: 'المستخدم المستهدف لم يعد متاحاً في الغرفة.',
    TARGET_PROTECTED: 'لا يمكن تطبيق هذا الإجراء على هذا الدور.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ أمر الغرفة. حاول مرة أخرى.';
}

async function readResponse(response: Response): Promise<RoomCommandResponse> {
  try {
    return await response.json() as RoomCommandResponse;
  } catch {
    return {};
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');
  return getCurrentFirebaseIdToken();
}
