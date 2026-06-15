import { VoiceProviderConfig } from './types';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const env = typeof process === 'undefined' ? {} : process.env ?? {};
const liveKitTokenEndpoint = env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT;

export const mockVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'mock',
};

export const liveKitVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'livekit',
  liveKit: {
    tokenEndpoint: liveKitTokenEndpoint ?? '',
    userId: env.EXPO_PUBLIC_VOICE_USER_ID ?? 'local-user',
    displayName: env.EXPO_PUBLIC_VOICE_DISPLAY_NAME ?? 'أنت',
    canPublishAudio: env.EXPO_PUBLIC_VOICE_CAN_PUBLISH_AUDIO !== 'false',
  },
};

export const activeVoiceProviderConfig = liveKitTokenEndpoint
  ? liveKitVoiceProviderConfig
  : mockVoiceProviderConfig;
