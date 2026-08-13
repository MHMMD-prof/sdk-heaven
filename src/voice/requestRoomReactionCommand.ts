import type { RoomReactionEnvelope } from './roomAmbientReactions';
import type { VoiceProviderConfig } from './types';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export class RoomReactionRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomReactionRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomReactionCommand(
  request: {
    assetId: string;
    assetVersionId: string;
    requestId?: string;
    roomId: string;
    sessionId: string;
  },
  config?: VoiceProviderConfig['liveKit'],
  getIdToken: (forceRefresh?: boolean) => Promise<string> = getDefaultFirebaseIdToken,
): Promise<{ envelope: RoomReactionEnvelope; requestId: string; roomId: string; topic: string }> {
  const endpoint = config?.roomReactionCommandEndpoint;
  if (!endpoint) {
    throw new RoomReactionRequestError('ENDPOINT_MISSING', 'Room reaction endpoint is not configured.', 0);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: 'send-room-reaction',
        assetId: request.assetId,
        assetVersionId: request.assetVersionId,
        requestId: request.requestId || createRoomReactionRequestId(),
        roomId: request.roomId,
        sessionId: request.sessionId,
      }),
      headers: {
        Authorization: `Bearer ${await getIdToken(true)}`,
        'Content-Type': 'application/json',
        ...(await getVoiceAppCheckHeader()),
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = await readResponse(response);
    if (!response.ok || payload.ok !== true || !payload.result) {
      throw new RoomReactionRequestError(
        payload.code || `HTTP_${response.status}`,
        payload.error || 'تعذر إرسال التفاعل.',
        response.status,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RoomReactionRequestError) throw error;
    throw new RoomReactionRequestError(
      error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      'تعذر الاتصال بخدمة تفاعلات الغرفة.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createRoomReactionRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `reaction_${now.toString(36)}_${entropy}`;
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
  result?: { envelope: RoomReactionEnvelope; requestId: string; roomId: string; topic: string };
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
