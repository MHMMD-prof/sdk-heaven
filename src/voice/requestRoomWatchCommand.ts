import Constants from 'expo-constants';

import { VoiceProviderConfig } from './types';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export type RoomWatchAction =
  | 'list-room-watch-catalog'
  | 'claim-watch-lease'
  | 'heartbeat-watch-lease'
  | 'update-watch-playback'
  | 'stop-watch';

export const ROOM_WATCH_PROTOCOL_VERSION = 1;

export type RoomWatchCatalogItem = {
  durationMs: number;
  itemId: string;
  playbackUri: string;
  titleAr: string;
};

export type RoomWatchNowPlaying = {
  durationMs: number;
  itemId: string;
  playbackState: 'idle' | 'playing' | 'paused' | 'stopped' | string;
  playbackUri: string;
  positionMs: number;
  titleAr: string;
  updatedAtMs?: number;
};

export type RoomWatchLease = {
  expiresAtMs: number;
  hostDisplayName: string;
  hostUid: string;
  leaseId: string;
  nowPlaying: RoomWatchNowPlaying | null;
  revision: number;
  roomId: string;
  status: 'active' | 'stopped' | 'expired' | string;
};

export type RoomWatchCommandResult = {
  action: RoomWatchAction | string;
  catalog?: RoomWatchCatalogItem[];
  deviceFilesEnabled?: boolean;
  expiresAtMs?: number;
  lease?: RoomWatchLease | null;
  leaseId?: string;
  leaseTtlMs?: number;
  note?: string;
  requestId: string;
  revision?: number;
  roomId: string;
  stopped?: boolean;
  syncMode?: string;
};

export class RoomWatchRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomWatchRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomWatchCommand(
  request: {
    action: RoomWatchAction;
    clientVersion?: string;
    itemId?: string;
    leaseId?: string;
    positionMs?: number;
    playbackState?: string;
    requestId?: string;
    roomId: string;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomWatchCommandResult> {
  const endpoint = config?.roomWatchCommandEndpoint;
  if (!endpoint) {
    throw new RoomWatchRequestError(
      'ENDPOINT_MISSING',
      'Room watch endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomWatchRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const idToken = await getIdToken(false);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        ...(await getVoiceAppCheckHeader()),
      },
      body: JSON.stringify({
        action: request.action,
        clientVersion: request.clientVersion || Constants.expoConfig?.version || '1.0.0',
        itemId: request.itemId,
        leaseId: request.leaseId,
        positionMs: request.positionMs,
        playbackState: request.playbackState,
        protocolVersion: ROOM_WATCH_PROTOCOL_VERSION,
        requestId,
        roomId: request.roomId,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new RoomWatchRequestError(
        typeof payload?.code === 'string' ? payload.code : 'WATCH_FAILED',
        typeof payload?.error === 'string' ? payload.error : 'Watch command failed.',
        response.status,
      );
    }
    return {
      ...(payload.result || payload),
      requestId,
    } as RoomWatchCommandResult;
  } finally {
    clearTimeout(timeout);
  }
}

export function roomWatchErrorMessage(error: unknown) {
  if (error instanceof RoomWatchRequestError) {
    if (error.code === 'FEATURE_DISABLED') return 'المشاهدة المشتركة غير مفعّلة حالياً.';
    if (error.code === 'FORBIDDEN') return 'لا تملك صلاحية التحكم بالمشاهدة.';
    if (error.code === 'LEASE_HELD') return 'جلسة مشاهدة أخرى نشطة في الغرفة.';
    if (error.code === 'LEASE_EXPIRED') return 'انتهت جلسة المشاهدة.';
    return error.message;
  }
  return 'تعذّر تنفيذ أمر المشاهدة.';
}

function createRoomWatchRequestId() {
  return `rwc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { getAuth } = await import('firebase/auth');
  const user = getAuth().currentUser;
  if (!user) throw new RoomWatchRequestError('AUTH_REQUIRED', 'Authentication required.', 401);
  return user.getIdToken(forceRefresh);
}
