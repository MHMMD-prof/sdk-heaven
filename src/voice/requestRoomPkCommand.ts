import Constants from 'expo-constants';

import { VoiceProviderConfig } from './types';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export type RoomPkAction =
  | 'get-room-pk-status'
  | 'start-room-pk'
  | 'join-room-pk-team'
  | 'end-room-pk';

export type RoomPkTeam = 'red' | 'blue';

export type RoomPkSession = {
  durationMs: number;
  endsAtMs: number;
  hostUid: string;
  mode: 'in-room-teams' | 'cross-room' | string;
  pkId: string;
  roomId: string;
  startedAtMs: number;
  status: 'lobby' | 'active' | 'ended' | 'forfeited' | 'void' | string;
  teams: {
    blue: { labelAr: string; memberUids: string[]; score: number };
    red: { labelAr: string; memberUids: string[]; score: number };
  };
  winner: 'red' | 'blue' | 'draw' | 'void' | null;
  winnerReason?: string;
};

export type RoomPkCommandResult = {
  action: RoomPkAction | string;
  pkId?: string;
  requestId: string;
  roomId: string;
  session?: RoomPkSession | null;
};

export class RoomPkRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomPkRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomPkCommand(
  request: {
    action: RoomPkAction;
    durationMs?: number;
    pkId?: string;
    requestId?: string;
    roomId: string;
    team?: RoomPkTeam;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomPkCommandResult> {
  const endpoint = config?.roomPkCommandEndpoint;
  if (!endpoint) {
    throw new RoomPkRequestError('ENDPOINT_MISSING', 'Room PK endpoint is not configured.', 0);
  }

  const clientVersion = resolveClientVersion();
  const requestId = request.requestId || createRoomPkRequestId(request.action);
  const body = {
    action: request.action,
    clientVersion,
    requestId,
    roomId: request.roomId,
    ...(request.durationMs ? { durationMs: request.durationMs } : {}),
    ...(request.pkId ? { pkId: request.pkId } : {}),
    ...(request.team ? { team: request.team } : {}),
  };

  const idToken = await getIdToken(true);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      ...(await getVoiceAppCheckHeader()),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true || !payload?.result) {
    const code = typeof payload?.code === 'string'
      ? payload.code
      : (typeof payload?.error?.code === 'string' ? payload.error.code : 'ROOM_PK_FAILED');
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : (typeof payload?.error === 'string' ? payload.error : 'Room PK command failed.');
    throw new RoomPkRequestError(code, message, response.status);
  }

  return payload.result as RoomPkCommandResult;
}

function createRoomPkRequestId(action: string) {
  const safe = action.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'pk';
  return `${safe}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`.slice(0, 80);
}

function resolveClientVersion() {
  const version = Constants.expoConfig?.version || Constants.nativeAppVersion || '1.0.0';
  return String(version);
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { firebaseAuth } = await import('../auth/firebase');
  const user = firebaseAuth.currentUser;
  if (!user) throw new RoomPkRequestError('AUTH_REQUIRED', 'Authentication is required.', 401);
  return user.getIdToken(forceRefresh);
}
