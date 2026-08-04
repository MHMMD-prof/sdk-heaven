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
const roomOwnershipCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_OWNERSHIP_COMMAND_ENDPOINT ??
  deriveRoomOwnershipCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomGiftCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_GIFT_COMMAND_ENDPOINT ??
  deriveRoomGiftCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomEntryEffectCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_ENTRY_EFFECT_COMMAND_ENDPOINT ??
  deriveRoomEntryEffectCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomGameCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_GAME_COMMAND_ENDPOINT ??
  deriveRoomGameCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomMusicCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_MUSIC_COMMAND_ENDPOINT ??
  deriveRoomMusicCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomRecordingCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_RECORDING_COMMAND_ENDPOINT ??
  deriveRoomRecordingCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomThemeCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_THEME_COMMAND_ENDPOINT ??
  deriveRoomThemeCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomTargetCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_TARGET_COMMAND_ENDPOINT ??
  deriveRoomTargetCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);
const roomAttendanceCommandEndpoint =
  env.EXPO_PUBLIC_ROOM_ATTENDANCE_COMMAND_ENDPOINT ??
  deriveRoomAttendanceCommandEndpoint(roomCommandEndpoint ?? liveKitTokenEndpoint);

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

export function deriveRoomOwnershipCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomOwnershipCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomOwnershipCommand')
    .replace(/roomcommand-/i, 'roomownershipcommand-')
    .replace(/livekittoken-/i, 'roomownershipcommand-');
}

export function deriveRoomGiftCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomGiftCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomGiftCommand')
    .replace(/roomcommand-/i, 'roomgiftcommand-')
    .replace(/livekittoken-/i, 'roomgiftcommand-');
}

export function deriveRoomEntryEffectCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomEntryEffectCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomEntryEffectCommand')
    .replace(/roomcommand-/i, 'roomentryeffectcommand-')
    .replace(/livekittoken-/i, 'roomentryeffectcommand-');
}

export function deriveRoomGameCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomGameCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomGameCommand')
    .replace(/roomcommand-/i, 'roomgamecommand-')
    .replace(/livekittoken-/i, 'roomgamecommand-');
}

export function deriveRoomMusicCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomMusicCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomMusicCommand')
    .replace(/roomcommand-/i, 'roommusiccommand-')
    .replace(/livekittoken-/i, 'roommusiccommand-');
}

export function deriveRoomRecordingCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomRecordingCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomRecordingCommand')
    .replace(/roomcommand-/i, 'roomrecordingcommand-')
    .replace(/livekittoken-/i, 'roomrecordingcommand-');
}

export function deriveRoomThemeCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomThemeCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomThemeCommand')
    .replace(/roomcommand-/i, 'roomthemecommand-')
    .replace(/livekittoken-/i, 'roomthemecommand-');
}

export function deriveRoomTargetCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomTargetCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomTargetCommand')
    .replace(/roomcommand-/i, 'roomtargetcommand-')
    .replace(/livekittoken-/i, 'roomtargetcommand-');
}

export function deriveRoomAttendanceCommandEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/roomCommand(?:\/)?$/, 'roomAttendanceCommand')
    .replace(/livekitToken(?:\/)?$/, 'roomAttendanceCommand')
    .replace(/roomcommand-/i, 'roomattendancecommand-')
    .replace(/livekittoken-/i, 'roomattendancecommand-');
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
    roomEntryEffectCommandEndpoint,
    roomGameCommandEndpoint,
    roomGiftCommandEndpoint,
    roomMediaCommandEndpoint,
    roomMusicCommandEndpoint,
    roomOwnershipCommandEndpoint,
    roomRecordingCommandEndpoint,
    roomThemeCommandEndpoint,
    roomTargetCommandEndpoint,
    roomAttendanceCommandEndpoint,
    canPublishAudio: env.EXPO_PUBLIC_VOICE_CAN_PUBLISH_AUDIO !== 'false',
  },
};

export function shouldUseMockVoiceProvider(
  candidateEnv: Record<string, string | undefined>,
): boolean {
  return candidateEnv.EXPO_PUBLIC_APP_ENV !== 'production'
    && candidateEnv.EXPO_PUBLIC_VOICE_ALLOW_MOCK_PROVIDER === 'true';
}

// Missing production configuration must surface an endpoint error, never a simulated room.
export const activeVoiceProviderConfig = liveKitTokenEndpoint || !shouldUseMockVoiceProvider(env)
  ? liveKitVoiceProviderConfig
  : mockVoiceProviderConfig;
