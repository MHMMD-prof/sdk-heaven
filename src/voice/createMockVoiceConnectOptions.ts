import { VoiceConnectOptions } from './types';
import { VoiceRoom } from '../types/voice';

export function createMockVoiceConnectOptions(room: VoiceRoom): VoiceConnectOptions {
  return {
    roomId: room.id,
    token: 'mock-token',
    canPublishAudio: true,
    metadata: {
      source: 'mock',
    },
    mockRoom: room,
  };
}
