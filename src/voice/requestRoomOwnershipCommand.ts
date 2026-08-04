import { VoiceProviderConfig } from './types';

export type RoomOwnershipAction =
  | 'offer-ownership-transfer'
  | 'accept-ownership-transfer'
  | 'decline-ownership-transfer'
  | 'cancel-ownership-transfer';

export type RoomOwnershipCommandRequest = {
  action: RoomOwnershipAction;
  roomId: string;
  expectedOwnershipRevision?: number;
  targetUid?: string;
  transferId?: string;
  requestId?: string;
};

export type RoomOwnershipCommandResult = {
  action: RoomOwnershipAction;
  expiresAtMs?: number;
  ownershipRevision: number;
  requestId: string;
  revision: number;
  roomId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  targetUid: string;
  transferId: string;
};

export class RoomOwnershipRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomOwnershipRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomOwnershipCommand(
  request: RoomOwnershipCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomOwnershipCommandResult> {
  const endpoint = config?.roomOwnershipCommandEndpoint;
  if (!endpoint) {
    throw new RoomOwnershipRequestError(
      'ENDPOINT_MISSING',
      'Room ownership endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createOwnershipRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({ ...request, requestId }),
      headers: {
        Authorization: `Bearer ${await getIdToken(true)}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = await readResponse(response);
    if (!response.ok || payload.ok !== true || !payload.result) {
      throw new RoomOwnershipRequestError(
        payload.code || `HTTP_${response.status}`,
        ownershipErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RoomOwnershipRequestError) throw error;
    throw new RoomOwnershipRequestError(
      error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      'تعذر الاتصال بخدمة ملكية الغرفة. حاول مرة أخرى.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { firebaseAuth } = await import('../auth/firebase');
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('A signed-in user is required.');
  return user.getIdToken(forceRefresh);
}

export async function reauthenticateRoomOwnership(password: string) {
  const [{ firebaseAuth }, { EmailAuthProvider, reauthenticateWithCredential }] = await Promise.all([
    import('../auth/firebase'),
    import('@firebase/auth'),
  ]);
  const user = firebaseAuth.currentUser;
  if (!user?.email) {
    throw new RoomOwnershipRequestError('AUTH_REQUIRED', 'سجّل الدخول مرة أخرى للمتابعة.', 401);
  }
  try {
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email, password),
    );
  } catch {
    throw new RoomOwnershipRequestError(
      'REAUTH_FAILED',
      'تعذر تأكيد كلمة المرور. تحقق منها وحاول مرة أخرى.',
      401,
    );
  }
}

export function createOwnershipRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `ownership_${now.toString(36)}_${entropy}`;
}

export function ownershipErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    ACCOUNT_RESTRICTED: 'هذا الحساب غير مؤهل لنقل ملكية الغرفة.',
    BLOCK_RESTRICTION: 'لا يمكن نقل الملكية بين حسابين محظورين.',
    FEATURE_DISABLED: 'نقل ملكية الغرفة غير مفعّل حالياً.',
    MODERATOR_LIMIT_REACHED: 'أزل مشرفاً قبل نقل الملكية.',
    OWNER_REQUIRED: 'هذا الإجراء متاح لمالك الغرفة الحالي فقط.',
    OWNERSHIP_COOLDOWN_ACTIVE: 'لا يمكن نقل الملكية مجدداً خلال فترة الانتظار.',
    OWNERSHIP_REVISION_CONFLICT: 'تغيّرت ملكية الغرفة. حدّث الغرفة وحاول مجدداً.',
    REAUTH_FAILED: 'تعذر تأكيد كلمة المرور.',
    RECENT_AUTH_REQUIRED: 'أدخل كلمة المرور لتأكيد هذا الإجراء الحساس.',
    RECIPIENT_REQUIRED: 'هذا العرض مخصص للمستلم المحدد فقط.',
    REQUEST_ID_CONFLICT: 'تعارض هذا الطلب مع محاولة سابقة.',
    ROOM_NOT_ACTIVE: 'الغرفة غير نشطة أو غير مؤهلة لنقل الملكية.',
    TARGET_NOT_ELIGIBLE: 'العضو المحدد غير مؤهل لامتلاك الغرفة.',
    TRANSFER_ALREADY_PENDING: 'يوجد عرض نقل ملكية معلّق بالفعل.',
    TRANSFER_EXPIRED: 'انتهت صلاحية عرض نقل الملكية.',
    TRANSFER_NOT_FOUND: 'لم يعد عرض نقل الملكية موجوداً.',
    TRANSFER_NOT_PENDING: 'تمت معالجة عرض نقل الملكية مسبقاً.',
    TRANSFER_STALE: 'تغيّرت الغرفة بعد إنشاء العرض.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ أمر ملكية الغرفة.';
}

async function readResponse(response: Response): Promise<{
  ok?: boolean;
  code?: string;
  error?: string;
  result?: RoomOwnershipCommandResult;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
