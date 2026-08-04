import Constants from 'expo-constants';

import { VoiceProviderConfig } from './types';

export type RoomGameAction =
  | 'list-room-games'
  | 'create-room-game-invite'
  | 'join-room-game'
  | 'leave-room-game'
  | 'end-room-game';

export type RoomGameId = 'drawing-guess' | 'carrom-royal' | 'royal-majlis';

export type RoomGameRewardPolicy = {
  cashRedemption: boolean;
  currency: 'gameRewards';
  mixWithGiftEarnings: boolean;
  policyId: string;
  version: number;
};

export type RoomGameRegistryEntry = {
  capabilities: string[];
  clientRoute: 'DrawingGuess' | 'Carrom' | 'MiniGame';
  displayName: { ar: string; en: string };
  gameId: RoomGameId;
  maxPlayers: number;
  minPlayers: number;
  minimumClientVersion: string;
  regions: string[];
  rewardsEnabled: boolean;
  rewardPolicy?: RoomGameRewardPolicy;
  rewardPolicyId: string;
  sessionMode: 'multiplayer' | 'host-local';
};

export type RoomGameSession = {
  clientRoute: 'DrawingGuess' | 'Carrom' | 'MiniGame' | string;
  expiresAtMs: number;
  gameId: RoomGameId | string;
  hostUid: string;
  maxPlayers: number;
  minPlayers: number;
  playerCount: number;
  playerUids: string[];
  rewardPolicy: RoomGameRewardPolicy | null;
  rewardsEnabled: boolean;
  roomId: string;
  sessionId: string;
  sessionMode: 'multiplayer' | 'host-local' | string;
  status: 'lobby' | 'active' | 'ended' | 'abandoned' | string;
};

export type RoomGameCommandResult = {
  action: RoomGameAction | string;
  alreadyJoined?: boolean;
  alreadyLeft?: boolean;
  games?: RoomGameRegistryEntry[];
  requestId: string;
  rewardPolicy?: RoomGameRewardPolicy;
  roomId: string;
  session?: RoomGameSession;
  sessionId?: string;
};

export class RoomGameRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomGameRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomGameCommand(
  request: {
    action: RoomGameAction;
    amount?: number;
    clientVersion?: string;
    gameId?: RoomGameId;
    requestId?: string;
    roomId: string;
    sessionId?: string;
    targetUid?: string;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<RoomGameCommandResult> {
  const endpoint = config?.roomGameCommandEndpoint;
  if (!endpoint) {
    throw new RoomGameRequestError(
      'ENDPOINT_MISSING',
      'Room game endpoint is not configured.',
      0,
    );
  }
  const requestId = request.requestId || createRoomGameRequestId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: request.action,
        ...(request.amount ? { amount: request.amount } : {}),
        clientVersion: request.clientVersion || getCurrentClientVersion(),
        ...(request.gameId ? { gameId: request.gameId } : {}),
        requestId,
        roomId: request.roomId,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        ...(request.targetUid ? { targetUid: request.targetUid } : {}),
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
      throw new RoomGameRequestError(
        payload.code || `HTTP_${response.status}`,
        roomGameErrorMessage(payload.code, payload.error),
        response.status,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RoomGameRequestError) throw error;
    throw new RoomGameRequestError(
      error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      'تعذر الاتصال بخدمة ألعاب الغرفة.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createRoomGameRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `roomgame_${now.toString(36)}_${entropy}`;
}

export function roomGameErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    FEATURE_DISABLED: 'ألعاب الغرفة غير مفعّلة حالياً.',
    CLIENT_UPDATE_REQUIRED: 'يجب تحديث التطبيق قبل تشغيل هذه اللعبة.',
    FORBIDDEN: 'ليس لديك صلاحية لهذا الإجراء.',
    MEMBERSHIP_REQUIRED: 'يجب أن تكون عضواً نشطاً في الغرفة.',
    SESSION_ALREADY_ACTIVE: 'توجد جلسة لعبة نشطة بالفعل في هذه الغرفة.',
    SESSION_FULL: 'امتلأت جلسة اللعبة.',
    SESSION_NOT_ACTIVE: 'لا توجد جلسة لعبة نشطة.',
    SESSION_NOT_JOINABLE: 'لا يمكن الانضمام إلى هذه الجلسة.',
    GAMES_PAUSED: 'تم إيقاف ألعاب الغرفة مؤقتاً.',
    RATE_LIMITED: 'تم إرسال أوامر كثيرة. حاول مرة أخرى بعد قليل.',
    REWARD_SETTLEMENT_UNAVAILABLE: 'مكافآت الألعاب غير متاحة حتى يتم اعتماد نتيجة الخادم.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ أمر لعبة الغرفة.';
}

function getCurrentClientVersion() {
  return Constants.expoConfig?.version || '1.0.0';
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
  result?: RoomGameCommandResult;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
