import { describe, expect, it } from 'vitest';

import { createMockVoiceRoomDraft } from '../createMockVoiceRoomDraft';

describe('createMockVoiceRoomDraft', () => {
  it('uses the provided profile identity as local host', () => {
    const room = createMockVoiceRoomDraft({
      host: {
        avatarLabel: 'S',
        displayName: 'Salem',
        id: 'uid-1',
      },
      type: 'voice',
    });

    expect(room.hostId).toBe('uid-1');
    expect(room.speakers[0]).toEqual({
      avatarLabel: 'S',
      displayName: 'Salem',
      id: 'uid-1',
    });
  });
});
