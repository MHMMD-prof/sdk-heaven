import { DrawingGuessConnectOptions } from './types';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export type DrawingGuessLiveKitConnectOptions = DrawingGuessConnectOptions & {
  serverUrl: string;
  token: string;
};

type DrawingGuessLiveKitTokenResponse = {
  gameSessionId?: string;
  participantId?: string;
  serverUrl?: string;
  token?: string;
  transportRoomId?: string;
};

const tokenRequestTimeoutMs = 10000;

export async function requestDrawingGuessLiveKitConnectOptions(
  options: DrawingGuessConnectOptions,
  tokenEndpoint = getDrawingGuessLiveKitTokenEndpoint(),
  getIdToken = getDefaultFirebaseIdToken,
): Promise<DrawingGuessLiveKitConnectOptions> {
  if (!tokenEndpoint) {
    throw new Error('Drawing Guess LiveKit token endpoint is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tokenRequestTimeoutMs);
  let response: Response;

  try {
    const idToken = await getIdToken();
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        roomId: options.roomId,
        canPublishAudio: false,
        ...(options.sessionId ? { gameSessionId: options.sessionId } : {}),
      }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Drawing Guess token request timed out.');
    }

    throw new Error('Drawing Guess token request failed.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Drawing Guess token request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as DrawingGuessLiveKitTokenResponse;

  if (!payload.serverUrl || !payload.token) {
    throw new Error('Drawing Guess token response must include serverUrl and token.');
  }
  if (
    options.sessionId
    && (
      payload.gameSessionId !== options.sessionId
      || payload.participantId !== options.playerId
      || !payload.transportRoomId
    )
  ) {
    throw new Error('Drawing Guess game transport identity did not match the joined session.');
  }

  return {
    ...options,
    serverUrl: payload.serverUrl,
    token: payload.token,
  };
}

export const getDrawingGuessLiveKitTokenEndpoint = () => {
  const env = typeof process === 'undefined' ? {} : process.env ?? {};

  return env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT ?? '';
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../../auth/getCurrentFirebaseIdToken');

  return getCurrentFirebaseIdToken();
}
