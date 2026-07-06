import { VoiceProviderConfig } from './types';

export type RoomCommandAction =
  | 'promote-speaker'
  | 'demote-listener'
  | 'remove-member'
  | 'close-room'
  | 'report-member';

export type RoomCommandRequest = {
  roomId: string;
  action: RoomCommandAction;
  targetUid?: string;
  reason?: string;
};

const roomCommandRequestTimeoutMs = 10000;

export async function requestRoomCommand(
  request: RoomCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
) {
  const endpoint = config?.roomCommandEndpoint;

  if (!endpoint) {
    throw new Error('Room command endpoint is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), roomCommandRequestTimeoutMs);
  let response: Response;

  try {
    const idToken = await getIdToken();
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(request),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Room command request timed out.');
    }

    throw new Error('Room command request failed.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Room command request failed with status ${response.status}.`);
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');

  return getCurrentFirebaseIdToken();
}
