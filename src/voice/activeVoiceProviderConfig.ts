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
  liveKitTokenEndpoint?.replace(/livekitToken(?:\/)?$/, 'roomCommand');

export const mockVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'mock',
};

export const liveKitVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'livekit',
  liveKit: {
    tokenEndpoint: liveKitTokenEndpoint ?? '',
    roomCommandEndpoint,
    canPublishAudio: env.EXPO_PUBLIC_VOICE_CAN_PUBLISH_AUDIO !== 'false',
  },
};

export const activeVoiceProviderConfig = liveKitTokenEndpoint
  ? liveKitVoiceProviderConfig
  : mockVoiceProviderConfig;
