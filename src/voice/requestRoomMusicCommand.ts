import Constants from 'expo-constants';

import { VoiceProviderConfig } from './types';

export type RoomMusicAction =
  | 'list-room-music-catalog'
  | 'claim-dj-lease'
  | 'heartbeat-dj-lease'
  | 'update-now-playing'
  | 'stop-music';

export const ROOM_MUSIC_PROTOCOL_VERSION = 2;

export type RoomMusicCatalogTrack = {
  artist: string;
  durationMs: number;
  playbackUri: string;
  title: string;
  trackId: string;
};

export type RoomMusicNowPlaying = {
  artist: string;
  durationMs: number;
  playbackState: 'idle' | 'playing' | 'paused' | 'stopped' | string;
  playbackUri: string;
  positionMs: number;
  title: string;
  trackId: string;
  updatedAtMs?: number;
};

export type RoomMusicLease = {
  djDisplayName: string;
  djUid: string;
  expiresAtMs: number;
  leaseId: string;
  nowPlaying: RoomMusicNowPlaying | null;
  publishedTrackSid: string;
  revision: number;
  roomId: string;
  serverUpdatedAtMs?: number;
  status: 'active' | 'stopped' | 'expired' | string;
};

export type RoomMusicCommandResult = {
  action: RoomMusicAction | string;
  catalog?: RoomMusicCatalogTrack[];
  deviceFilesEnabled?: boolean;
  expiresAtMs?: number;
  lease?: RoomMusicLease | null;
  leaseId?: string;
  leaseTtlMs?: number;
  note?: string;
  publishedTrackSid?: string;
  requestId: string;
  revision?: number;
  roomId: string;
  stopped?: boolean;
  syncMode?: string;
};

export class RoomMusicRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomMusicRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomMusicCommand(
  request: {
    action: RoomMusicAction;
    clientVersion?: string;
    leaseId?: string;
    positionMs?: number;
    playbackState?: string;
    requestId?: string;
    roomId: string;
    trackId?: string;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomMusicCommandResult> {
  const endpoint = config?.roomMusicCommandEndpoint;
  if (!endpoint) {
    throw new RoomMusicRequestError(
      'ENDPOINT_MISSING',
      'Room music endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomMusicRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: request.action,
        clientVersion: request.clientVersion || getCurrentClientVersion(),
        ...(request.leaseId ? { leaseId: request.leaseId } : {}),
        ...(typeof request.positionMs === 'number' ? { positionMs: request.positionMs } : {}),
        ...(request.playbackState ? { playbackState: request.playbackState } : {}),
        protocolVersion: ROOM_MUSIC_PROTOCOL_VERSION,
        requestId,
        roomId: request.roomId,
        ...(request.trackId ? { trackId: request.trackId } : {}),
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
      throw new RoomMusicRequestError(
        payload.code || `HTTP_${response.status}`,
        roomMusicErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result as RoomMusicCommandResult;
  } catch (error) {
    if (error instanceof RoomMusicRequestError) throw error;
    throw new RoomMusicRequestError(
      'NETWORK',
      error instanceof Error ? error.message : 'Room music request failed.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function roomMusicErrorMessage(code?: string, fallback?: string) {
  switch (code) {
    case 'FEATURE_DISABLED':
      return 'الموسيقى المشتركة غير مفعّلة حالياً.';
    case 'FORBIDDEN':
      return 'ليست لديك صلاحية التحكم بالموسيقى.';
    case 'LEASE_HELD':
      return 'هناك دي جي آخر يشغّل الموسيقى الآن.';
    case 'LEASE_EXPIRED':
      return 'انتهت جلسة الموسيقى. أعد التشغيل.';
    case 'MUSIC_PAUSED':
      return 'الموسيقى متوقفة بسبب إجراءات الطاقم.';
    case 'TRACK_UNKNOWN':
      return 'المقطع غير متاح في الكتالوج.';
    case 'CLIENT_UPDATE_REQUIRED':
      return 'يجب تحديث التطبيق قبل استخدام موسيقى الغرفة.';
    case 'MEMBERSHIP_REQUIRED':
      return 'يجب أن تكون عضواً نشطاً في الغرفة.';
    case 'RATE_LIMITED':
      return 'تم إرسال أوامر كثيرة. حاول مرة أخرى بعد قليل.';
    default:
      return fallback || 'تعذّر تنفيذ أمر الموسيقى.';
  }
}

function getCurrentClientVersion() {
  return Constants.expoConfig?.version || '1.0.0';
}

export function createRoomMusicRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `roommusic_${now.toString(36)}_${entropy}`;
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { firebaseAuth } = await import('../auth/firebase');
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new RoomMusicRequestError('UNAUTHENTICATED', 'Sign-in is required.', 401);
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
