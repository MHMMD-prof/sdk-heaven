import { VoiceProviderConfig } from './types';

export type RoomRecordingAction =
  | 'get-recording-status'
  | 'acknowledge-recording-notice'
  | 'ensure-rolling-session'
  | 'stop-rolling-session'
  | 'preserve-for-report'
  | 'set-legal-hold'
  | 'request-playback';

export type RoomRecordingStatus = {
  audioAvailable: boolean;
  egressStatus: string;
  featureEnabled: boolean;
  indicator: string;
  noticeAcknowledged: boolean;
  noticeVersion: string;
  policyVersion: string;
  rollingWindowMs: number;
  sessionId: string | null;
};

export type RoomRecordingCommandResult = {
  action: RoomRecordingAction | string;
  audioStatus?: string;
  created?: boolean;
  evidence?: Record<string, unknown>;
  evidenceId?: string;
  legalHold?: boolean;
  note?: string;
  noticeVersion?: string;
  playbackAvailable?: boolean;
  playbackUrl?: string | null;
  requestId: string;
  retentionUntilMs?: number;
  roomId: string;
  session?: Record<string, unknown>;
  sessionId?: string;
  status?: RoomRecordingStatus;
  stopped?: boolean;
};

export class RoomRecordingRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomRecordingRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomRecordingCommand(
  request: {
    action: RoomRecordingAction;
    evidenceId?: string;
    legalHold?: boolean;
    noticeVersion?: string;
    reason?: string;
    reportId?: string;
    requestId?: string;
    roomId: string;
    sessionId?: string;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomRecordingCommandResult> {
  const endpoint = config?.roomRecordingCommandEndpoint;
  if (!endpoint) {
    throw new RoomRecordingRequestError(
      'ENDPOINT_MISSING',
      'Room recording endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomRecordingRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: request.action,
        ...(request.evidenceId ? { evidenceId: request.evidenceId } : {}),
        ...(typeof request.legalHold === 'boolean' ? { legalHold: request.legalHold } : {}),
        ...(request.noticeVersion ? { noticeVersion: request.noticeVersion } : {}),
        ...(request.reason ? { reason: request.reason } : {}),
        ...(request.reportId ? { reportId: request.reportId } : {}),
        requestId,
        roomId: request.roomId,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
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
      throw new RoomRecordingRequestError(
        payload.code || `HTTP_${response.status}`,
        roomRecordingErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result as RoomRecordingCommandResult;
  } catch (error) {
    if (error instanceof RoomRecordingRequestError) throw error;
    throw new RoomRecordingRequestError(
      'NETWORK',
      error instanceof Error ? error.message : 'Room recording request failed.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function roomRecordingErrorMessage(code?: string, fallback?: string) {
  switch (code) {
    case 'FEATURE_DISABLED':
      return 'تسجيل الأمان غير مفعّل حالياً.';
    case 'NOTICE_STALE':
      return 'يجب الموافقة على سياسة التسجيل الحالية.';
    case 'FORBIDDEN':
      return 'ليست لديك صلاحية لهذا الإجراء.';
    default:
      return fallback || 'تعذّر تنفيذ أمر التسجيل.';
  }
}

export const ROOM_RECORDING_POLICY_VERSION = 'safety-recording-v1';

function createRoomRecordingRequestId() {
  return `rrc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { firebaseAuth } = await import('../auth/firebase');
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new RoomRecordingRequestError('UNAUTHENTICATED', 'Sign-in is required.', 401);
  }
  return user.getIdToken(forceRefresh);
}

async function readResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
