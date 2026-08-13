import { getCurrentFirebaseIdToken } from '../auth/getCurrentFirebaseIdToken';
import type { PublicUserProfile } from '../social/types';
import type { VoiceProviderConfig } from './types';
import { createRoomCommandRequestId } from './requestRoomCommand';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export class RoomTargetCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RoomTargetCommandError';
    this.code = code;
  }
}

export async function requestRoomTargetRosterUpdate(
  roomId: string,
  selectedUids: string[],
  config?: VoiceProviderConfig['liveKit'],
) {
  const endpoint = config?.roomTargetCommandEndpoint;
  if (!endpoint) throw new RoomTargetCommandError('ENDPOINT_MISSING', 'Room Target service is not configured.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`,
      'Content-Type': 'application/json',
      ...(await getVoiceAppCheckHeader()),
    },
    body: JSON.stringify({
      requestId: createRoomCommandRequestId(),
      roomId,
      selectedUids,
    }),
  });
  let payload: { code?: string; error?: string; ok?: boolean; result?: unknown } = {};
  try {
    payload = await response.json();
  } catch {
    // The stable error below avoids exposing an HTML proxy response.
  }
  if (!response.ok || payload.ok !== true) {
    throw new RoomTargetCommandError(
      payload.code || `HTTP_${response.status}`,
      payload.error || 'Room Target update failed.',
    );
  }
  return payload.result;
}

export async function requestRoomTargetUserSearch(
  roomId: string,
  query: string,
  config?: VoiceProviderConfig['liveKit'],
): Promise<PublicUserProfile[]> {
  const endpoint = config?.roomTargetCommandEndpoint;
  if (!endpoint) throw new RoomTargetCommandError('ENDPOINT_MISSING', 'Room Target service is not configured.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`,
      'Content-Type': 'application/json',
      ...(await getVoiceAppCheckHeader()),
    },
    body: JSON.stringify({ action: 'search-roster-users', query, roomId }),
  });
  let payload: { code?: string; error?: string; ok?: boolean; result?: { users?: PublicUserProfile[] } } = {};
  try {
    payload = await response.json();
  } catch {
    // Stable failure below.
  }
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.result?.users)) {
    throw new RoomTargetCommandError(
      payload.code || `HTTP_${response.status}`,
      payload.error || 'Room Target search failed.',
    );
  }
  return payload.result.users;
}
