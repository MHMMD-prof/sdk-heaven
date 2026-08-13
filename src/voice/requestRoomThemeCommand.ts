import Constants from 'expo-constants';

import { getCurrentFirebaseIdToken } from '../auth/getCurrentFirebaseIdToken';
import { VoiceProviderConfig } from './types';
import { RoomThemeId } from './roomThemeContract';
import {
  RoomThemeInventory,
  ensureDefaultRoomThemeInventory,
} from './roomThemeInventory';
import { createRoomCommandRequestId } from './requestRoomCommand';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export type {
  RoomThemeInventory,
  RoomThemeInventoryEntry,
  RoomThemeInventoryState,
} from './roomThemeInventory';

type RoomThemeCommandResult = RoomThemeInventory | {
  balances?: { coins: number; diamonds: number };
  equipped: boolean;
  expiresAt?: unknown;
  roomId: string;
  themeId: RoomThemeId;
};

export class RoomThemeCommandError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomThemeCommandError';
    this.code = code;
    this.status = status;
  }
}

export async function requestRoomThemeCommand(
  input: {
    action: 'get-room-theme-inventory' | 'equip-room-theme' | 'purchase-room-theme';
    roomId: string;
    themeId?: RoomThemeId;
    currency?: 'coins' | 'diamonds';
    applyTheme?: boolean;
    requestId?: string;
  },
  config?: VoiceProviderConfig['liveKit'],
): Promise<RoomThemeCommandResult> {
  const endpoint = config?.roomThemeCommandEndpoint;
  if (!endpoint) throw new RoomThemeCommandError('ENDPOINT_MISSING', 'Room theme service is not configured.', 0);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`,
      'Content-Type': 'application/json',
      ...(await getVoiceAppCheckHeader()),
    },
    body: JSON.stringify({
      ...input,
      clientVersion: Constants.expoConfig?.version || '1.0.0',
      requestId: input.requestId || createRoomCommandRequestId(),
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok || payload.ok !== true || !payload.result) {
    throw new RoomThemeCommandError(
      payload.code || `HTTP_${response.status}`,
      payload.error || 'Room theme command failed.',
      response.status,
    );
  }
  return 'inventory' in payload.result
    ? ensureDefaultRoomThemeInventory(payload.result)
    : payload.result;
}

async function readPayload(response: Response): Promise<{
  code?: string;
  error?: string;
  ok?: boolean;
  result?: RoomThemeCommandResult;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
