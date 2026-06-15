import { describe, expect, it } from 'vitest';

import { VoiceRoom } from '../../types/voice';
import { createMockVoiceConnectOptions } from '../createMockVoiceConnectOptions';

const room: VoiceRoom = {
  id: 'room-1',
  title: 'Test Room',
  hostId: 'host-1',
  type: 'game',
  participantCount: 1,
  currentGameId: 'carrom-royal',
  speakers: [{ id: 'host-1', displayName: 'Host', avatarLabel: 'H' }],
  listeners: [],
};

describe('createMockVoiceConnectOptions', () => {
  it('creates mock connect options from a room snapshot', () => {
    const options = createMockVoiceConnectOptions(room);

    expect(options.roomId).toBe(room.id);
    expect(options.token).toBe('mock-token');
    expect(options.metadata?.source).toBe('mock');
    expect(options.mockRoom).toBe(room);
  });
});
