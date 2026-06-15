import {
  VoiceConnectionState,
  VoiceParticipant,
  VoiceRoomCommandResult,
} from './types';

export type VoiceRoomSessionState = {
  roomId?: string;
  connectionState: VoiceConnectionState;
  errorMessage?: string;
  participants: VoiceParticipant[];
  speakingParticipantIds: string[];
  canPublishAudio: boolean;
  isMicMuted: boolean;
  isSpeakerEnabled: boolean;
  lastCommandResult?: VoiceRoomCommandResult;
};

export type VoiceRoomSessionAction =
  | { type: 'connectionStateChanged'; connectionState: VoiceConnectionState }
  | { type: 'connectionErrorChanged'; errorMessage?: string }
  | { type: 'roomIdChanged'; roomId?: string }
  | { type: 'publishAudioChanged'; canPublishAudio: boolean }
  | { type: 'participantsChanged'; participants: VoiceParticipant[] }
  | { type: 'speakingChanged'; participantIds: string[] }
  | { type: 'micMutedChanged'; isMicMuted: boolean }
  | { type: 'speakerEnabledChanged'; isSpeakerEnabled: boolean }
  | { type: 'commandCompleted'; result: VoiceRoomCommandResult }
  | { type: 'reset' };

export const initialVoiceRoomSessionState: VoiceRoomSessionState = {
  connectionState: 'idle',
  participants: [],
  speakingParticipantIds: [],
  canPublishAudio: true,
  isMicMuted: false,
  isSpeakerEnabled: true,
};

export function voiceRoomSessionReducer(
  state: VoiceRoomSessionState,
  action: VoiceRoomSessionAction,
): VoiceRoomSessionState {
  if (action.type === 'connectionStateChanged') {
    return {
      ...state,
      connectionState: action.connectionState,
      errorMessage: action.connectionState === 'error' ? state.errorMessage : undefined,
    };
  }

  if (action.type === 'connectionErrorChanged') {
    return {
      ...state,
      connectionState: action.errorMessage ? 'error' : state.connectionState,
      errorMessage: action.errorMessage,
    };
  }

  if (action.type === 'roomIdChanged') {
    return {
      ...state,
      roomId: action.roomId,
      errorMessage: undefined,
    };
  }

  if (action.type === 'publishAudioChanged') {
    return {
      ...state,
      canPublishAudio: action.canPublishAudio,
      isMicMuted: action.canPublishAudio ? state.isMicMuted : true,
    };
  }

  if (action.type === 'participantsChanged') {
    return {
      ...state,
      participants: action.participants,
    };
  }

  if (action.type === 'speakingChanged') {
    return {
      ...state,
      speakingParticipantIds: action.participantIds,
    };
  }

  if (action.type === 'micMutedChanged') {
    return {
      ...state,
      isMicMuted: action.isMicMuted,
    };
  }

  if (action.type === 'speakerEnabledChanged') {
    return {
      ...state,
      isSpeakerEnabled: action.isSpeakerEnabled,
    };
  }

  if (action.type === 'commandCompleted') {
    return {
      ...state,
      lastCommandResult: action.result,
    };
  }

  return {
    ...initialVoiceRoomSessionState,
    connectionState: 'disconnected',
  };
}
