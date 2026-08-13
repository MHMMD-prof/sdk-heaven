import { debugError, debugLog } from '../utils/debugLog';
import { VoiceProviderConfig } from './types';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export type RoomChatCommandAction =
  | 'send-message'
  | 'delete-message'
  | 'pin-message'
  | 'unpin-message'
  | 'block-user'
  | 'unblock-user'
  | 'report-content';

export type RoomReportSubjectType = 'user' | 'message' | 'room' | 'room-image' | 'gift' | 'voice';
export type RoomReportCategory =
  | 'harassment'
  | 'hate'
  | 'sexual-content'
  | 'threat'
  | 'underage'
  | 'spam'
  | 'scam'
  | 'personal-information'
  | 'impersonation'
  | 'unsafe-room'
  | 'other';

export type RoomChatCommandRequest = {
  action: RoomChatCommandAction;
  roomId: string;
  requestId?: string;
  text?: string;
  messageId?: string;
  replyToMessageId?: string;
  targetUid?: string;
  subjectType?: RoomReportSubjectType;
  category?: RoomReportCategory;
  details?: string;
  mediaId?: string;
  giftEventId?: string;
};

export type RoomChatCommandResult = {
  action: RoomChatCommandAction;
  messageId: string;
  reportId?: string;
  requestId: string;
  roomId: string;
  status: 'applied';
  targetUid?: string;
};

type RoomChatCommandResponse = {
  code?: string;
  details?: { retryAfterMs?: number };
  error?: string;
  ok?: boolean;
  replayed?: boolean;
  result?: RoomChatCommandResult;
};

export class RoomChatCommandError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;
  readonly status: number;

  constructor(code: string, message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'RoomChatCommandError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const requestTimeoutMs = 10_000;

export async function requestRoomChatCommand(
  request: RoomChatCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
): Promise<RoomChatCommandResult> {
  const endpoint = config?.roomChatCommandEndpoint;
  if (!endpoint) {
    throw new RoomChatCommandError('ENDPOINT_MISSING', 'خدمة دردشة الغرفة غير مهيأة.', 0);
  }
  const requestId = request.requestId || createRoomChatRequestId();
  const idToken = await getIdToken();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      debugLog('voice.chat', 'request:start', {
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
        body: JSON.stringify({ ...request, requestId }),
        signal: controller.signal,
      });
      const payload = await readResponse(response);
      if (!response.ok || payload.ok !== true || !payload.result) {
        const error = new RoomChatCommandError(
          payload.code || `HTTP_${response.status}`,
          roomChatErrorMessage(payload.code, payload.error),
          response.status,
          payload.details?.retryAfterMs,
        );
        if (response.status >= 500 && attempt === 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      debugLog('voice.chat', 'request:success', {
        action: request.action,
        replayed: payload.replayed === true,
        requestId,
        roomId: request.roomId,
      });
      return payload.result;
    } catch (error) {
      if (error instanceof RoomChatCommandError) throw error;
      lastError = error;
      if (attempt === 1) continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  debugError('voice.chat', 'request:networkError', lastError, {
    action: request.action,
    requestId,
    roomId: request.roomId,
  });
  throw new RoomChatCommandError(
    isAbortError(lastError) ? 'TIMEOUT' : 'NETWORK_ERROR',
    isAbortError(lastError)
      ? 'انتهت مهلة إرسال الطلب. حاول مرة أخرى.'
      : 'تعذر الاتصال بخدمة دردشة الغرفة.',
    0,
  );
}

export function createRoomChatRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `chat_${now.toString(36)}_${entropy}`;
}

export function roomChatErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    ACCOUNT_RESTRICTED: 'حسابك مقيّد حالياً.',
    ALREADY_BLOCKED: 'هذا المستخدم محظور بالفعل.',
    CHAT_DISABLED: 'الدردشة متوقفة في هذه الغرفة.',
    CHAT_FOLLOWERS_ONLY: 'الدردشة متاحة لأصدقاء مالك الغرفة فقط.',
    CONTENT_FILTERED: 'تحتوي الرسالة على محتوى غير مسموح.',
    FEATURE_DISABLED: 'هذه الميزة غير مفعلة حالياً.',
    FORBIDDEN: 'ليست لديك صلاحية تنفيذ هذا الإجراء.',
    MESSAGE_EMPTY: 'اكتب رسالة قبل الإرسال.',
    MESSAGE_TOO_LONG: 'الرسالة أطول من الحد المسموح.',
    RATE_LIMITED: 'أرسلت رسائل كثيرة بسرعة. انتظر قليلاً.',
    REPORT_RATE_LIMITED: 'وصلت إلى حد البلاغات المؤقت.',
    SLOW_MODE_ACTIVE: 'الوضع البطيء مفعل. انتظر قبل إرسال رسالة أخرى.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ طلب الدردشة.';
}

async function readResponse(response: Response): Promise<RoomChatCommandResponse> {
  try {
    return await response.json() as RoomChatCommandResponse;
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
