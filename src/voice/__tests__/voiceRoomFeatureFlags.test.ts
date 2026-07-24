import { describe, expect, it } from 'vitest';

import {
  disabledVoiceRoomFeatureFlags,
  mapVoiceRoomFeatureFlags,
} from '../voiceRoomFeatureFlags';

describe('voiceRoomFeatureFlags', () => {
  it('fails closed for missing or malformed configuration', () => {
    expect(mapVoiceRoomFeatureFlags(undefined)).toEqual(disabledVoiceRoomFeatureFlags);
    expect(mapVoiceRoomFeatureFlags({
      voice_room_chat: 'true',
      voice_room_command_center: 'true',
      voice_room_media: 'true',
      voice_room_safety: 1,
      voice_room_seats: 1,
      voice_room_v2_mutations: null,
    })).toEqual(disabledVoiceRoomFeatureFlags);
  });

  it('maps only explicit true values', () => {
    expect(mapVoiceRoomFeatureFlags({
      voice_room_chat: true,
      voice_room_command_center: true,
      voice_room_media: true,
      voice_room_safety: true,
      voice_room_seats: true,
      voice_room_v2_mutations: false,
    })).toEqual({
      chat: true,
      commandCenter: true,
      media: true,
      safety: true,
      seats: true,
      v2Mutations: false,
    });
  });
});
