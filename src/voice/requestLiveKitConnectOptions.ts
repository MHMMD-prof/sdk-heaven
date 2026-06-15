import { VoiceRoom } from '../types/voice';
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
): Promise<VoiceConnectOptions> {
  if (!config?.tokenEndpoint) {
    throw new Error('LiveKit token endpoint is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), liveKitTokenRequestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        roomId: room.id,
        userId: config.userId,
        displayName: config.displayName,
        canPublishAudio: config.canPublishAudio ?? true,
      }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Voice token request timed out.');
    }

    throw new Error('Voice token request failed.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`LiveKit token request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as LiveKitTokenResponse;

  if (!payload.serverUrl || !payload.token) {
    throw new Error('LiveKit token response must include serverUrl and token.');
  }

  return {
    roomId: room.id,
    serverUrl: payload.serverUrl,
    token: payload.token,
    canPublishAudio: payload.canPublishAudio ?? config.canPublishAudio ?? true,
    metadata: {
      source: 'livekit',
    },
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
