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
  serverUrl?: string;
  token?: string;
};

const tokenRequestTimeoutMs = 10000;

export async function requestDrawingGuessLiveKitConnectOptions(
  options: DrawingGuessConnectOptions,
  tokenEndpoint = getDrawingGuessLiveKitTokenEndpoint(),
): Promise<DrawingGuessLiveKitConnectOptions> {
  if (!tokenEndpoint) {
    throw new Error('Drawing Guess LiveKit token endpoint is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tokenRequestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        roomId: options.roomId,
        userId: options.playerId,
        displayName: options.displayName,
        canPublishAudio: false,
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
