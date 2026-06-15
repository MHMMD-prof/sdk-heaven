import {
  VoiceConnectOptions,
  VoiceClientEventListener,
  VoiceParticipant,
  VoiceRoomCommand,
  VoiceRoomCommandResult,
} from './types';

export interface VoiceClient {
  connect(options: VoiceConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  muteMic(): Promise<void>;
  unmuteMic(): Promise<void>;
  setSpeakerEnabled(enabled: boolean): Promise<void>;
  executeRoomCommand(command: VoiceRoomCommand): Promise<VoiceRoomCommandResult>;
  getParticipants(): Promise<VoiceParticipant[]>;
  onEvent(listener: VoiceClientEventListener): () => void;
}
