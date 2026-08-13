import Constants from 'expo-constants';

import { VoiceRoom } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { VoiceConnectOptions, VoiceProviderConfig } from './types';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

type LiveKitTokenResponse = {
  serverUrl: string;
  token: string;
  canPublishAudio?: boolean;
};

const liveKitTokenRequestTimeoutMs = 20000;

export async function requestLiveKitConnectOptions(
  room: VoiceRoom,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
): Promise<VoiceConnectOptions> {
  if (!config?.tokenEndpoint) {
    throw new Error('LiveKit token endpoint is not configured.');
  }

  let idToken: string;

  try {
    idToken = await getIdToken(false);
  } catch (error) {
    debugError('voice.token', 'firebaseToken:error', error, { roomId: room.id });
    throw new Error('Voice authentication could not be refreshed. Please sign in again.');
  }

  debugLog('voice.token', 'request:start', {
    roomId: room.id,
    endpointConfigured: Boolean(config.tokenEndpoint),
    localRole: room.localMember?.role,
  });
  let response = await fetchTokenResponse(config.tokenEndpoint, room.id, idToken);

  if (response.status === 401) {
    try {
      idToken = await getIdToken(true);
    } catch (error) {
      debugError('voice.token', 'firebaseToken:refreshError', error, { roomId: room.id });
      throw new Error('Voice authentication could not be refreshed. Please sign in again.');
    }
    response = await fetchTokenResponse(config.tokenEndpoint, room.id, idToken);
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
      ...(config.roomAttendanceCommandEndpoint
        ? { attendanceCommandEndpoint: config.roomAttendanceCommandEndpoint }
        : {}),
      source: 'livekit',
    },
  };
}

async function fetchTokenResponse(endpoint: string, roomId: string, idToken: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), liveKitTokenRequestTimeoutMs);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          ...(await getVoiceAppCheckHeader()),
        },
        signal: controller.signal,
        body: JSON.stringify({
          clientVersion: Constants.expoConfig?.version || '1.0.0',
          roomId,
        }),
      });
    } catch (error) {
      const timedOut = controller.signal.aborted || isAbortError(error);
      debugError('voice.token', timedOut ? 'request:timeout' : 'request:networkError', error, {
        attempt: attempt + 1,
        roomId,
      });
      if (timedOut) throw new Error('Voice token request timed out.');
      if (attempt === 1) throw new Error('Voice token request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Voice token request failed.');
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function getDefaultFirebaseIdToken(forceRefresh = false) {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');

  return getCurrentFirebaseIdToken(forceRefresh);
}
