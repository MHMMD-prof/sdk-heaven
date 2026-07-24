import { VoiceRoom } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { VoiceConnectOptions, VoiceProviderConfig } from './types';

type LiveKitTokenResponse = {
  serverUrl: string;
  token: string;
  canPublishAudio?: boolean;
};

const liveKitTokenRequestTimeoutMs = 10000;

export async function requestLiveKitConnectOptions(
  room: VoiceRoom,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
): Promise<VoiceConnectOptions> {
  if (!config?.tokenEndpoint) {
    throw new Error('LiveKit token endpoint is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), liveKitTokenRequestTimeoutMs);
  let response: Response;

  try {
    const idToken = await getIdToken();
    debugLog('voice.token', 'request:start', {
      roomId: room.id,
      endpointConfigured: Boolean(config.tokenEndpoint),
      localRole: room.localMember?.role,
    });
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ roomId: room.id }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      debugError('voice.token', 'request:timeout', error, { roomId: room.id });
      throw new Error('Voice token request timed out.');
    }

    debugError('voice.token', 'request:networkError', error, { roomId: room.id });
    throw new Error('Voice token request failed.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    debugLog('voice.token', 'request:denied', {
      roomId: room.id,
      status: response.status,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Voice token request was denied.');
    }

    throw new Error(`LiveKit token request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as LiveKitTokenResponse;

  debugLog('voice.token', 'request:success', {
    roomId: room.id,
    canPublishAudio: payload.canPublishAudio === true,
    hasServerUrl: Boolean(payload.serverUrl),
    hasToken: Boolean(payload.token),
  });

  if (!payload.serverUrl || !payload.token) {
    throw new Error('LiveKit token response must include serverUrl and token.');
  }

  return {
    roomId: room.id,
    serverUrl: payload.serverUrl,
    token: payload.token,
    canPublishAudio: payload.canPublishAudio === true,
    metadata: {
      source: 'livekit',
    },
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');

  return getCurrentFirebaseIdToken();
}
