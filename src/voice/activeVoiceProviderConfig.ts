import { VoiceProviderConfig } from './types';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const env = typeof process === 'undefined' ? {} : process.env ?? {};
const liveKitTokenEndpoint = env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT;
const roomCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_COMMAND_ENDPOINT ??
  deriveRoomCommandEndpoint(liveKitTokenEndpoint);
const roomMediaCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_MEDIA_COMMAND_ENDPOINT ??
  deriveRoomMediaCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomChatCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_CHAT_COMMAND_ENDPOINT ??
  deriveRoomChatCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);

export function deriveRoomCommandEndpoint(tokenEndpoint?: string) {
  if (!tokenEndpoint) {
    return undefined;
  }

  return tokenEndpoint
    .replace(/livekitToken(?:\/)?$/, 'roomCommand')
    .replace(/livekittoken-/i, 'roomcommand-');
}

export function deriveRoomMediaCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomMediaCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomMediaCommand')
    .replace(/roomcommand-/i, 'roommediacommand-')
    .replace(/livekittoken-/i, 'roommediacommand-');
}

export function deriveRoomChatCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomChatCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomChatCommand')
    .replace(/roomcommand-/i, 'roomchatcommand-')
    .replace(/livekittoken-/i, 'roomchatcommand-');
}

export const mockVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'mock',
};

export const liveKitVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'livekit',
  liveKit: {
    tokenEndpoint: liveKitTokenEndpoint ?? '',
    roomChatCommandEndpoint,
    roomCommandEndpoint,
    roomMediaCommandEndpoint,
    canPublishAudio: env.EXPO_PUBLIC_VOICE_CAN_PUBLISH_AUDIO !== 'false',
  },
};

export const activeVoiceProviderConfig = liveKitTokenEndpoint
  ? liveKitVoiceProviderConfig
  : mockVoiceProviderConfig;
