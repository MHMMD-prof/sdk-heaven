import { VoiceRoom } from '../types/voice';

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type VoiceParticipantRole = 'host' | 'speaker' | 'listener';

export type VoiceParticipant = {
  id: string;
  displayName: string;
  role: VoiceParticipantRole;
  isMuted: boolean;
  isSpeaking: boolean;
  avatarLabel: string;
};

export type VoiceConnectOptions = {
  roomId: string;
  token: string;
  serverUrl?: string;
  canPublishAudio?: boolean;
  metadata?: Record<string, string>;
  mockRoom?: VoiceRoom;
};

export type VoiceProviderKind = 'mock' | 'livekit' | 'agora';

export type VoiceProviderConfig = {
  provider: VoiceProviderKind;
  liveKit?: {
    tokenEndpoint: string;
    roomCommandEndpoint?: string;
    canPublishAudio?: boolean;
  };
};

export type VoiceRoomCommandType =
  | 'mute'
  | 'kick'
  | 'report'
  | 'block'
  | 'promote'
  | 'demote'
  | 'remove'
  | 'close';

export type VoiceRoomCommand = {
  type: VoiceRoomCommandType;
  participantId: string;
};

export type VoiceRoomCommandResult = {
  command: VoiceRoomCommand;
  status: 'applied' | 'recorded' | 'ignored';
  createdAt: number;
};

export type VoiceRoomSession = {
  roomId?: string;
  connectionState: VoiceConnectionState;
  errorMessage?: string;
  isConnecting: boolean;
  isConnected: boolean;
  canPublishAudio: boolean;
  isMicMuted: boolean;
  isSpeakerEnabled: boolean;
  participants: VoiceParticipant[];
  speakers: VoiceParticipant[];
  listeners: VoiceParticipant[];
  speakingParticipantIds: string[];
};

export type VoiceClientEvent =
  | {
      type: 'connectionStateChanged';
      connectionState: VoiceConnectionState;
    }
  | {
      type: 'participantsChanged';
      participants: VoiceParticipant[];
    }
  | {
      type: 'speakingChanged';
      participantIds: string[];
    }
  | {
      type: 'error';
      message: string;
    };

export type VoiceClientEventListener = (event: VoiceClientEvent) => void;
