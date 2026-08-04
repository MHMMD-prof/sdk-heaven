import { describe, expect, it } from 'vitest';

import { isVoiceRoomMockFallbackAllowed } from '../voiceRoomLaunchGates';

describe('voiceRoomLaunchGates', () => {
  it('blocks mock room fallback unless explicitly allowed', () => {
    expect(isVoiceRoomMockFallbackAllowed({})).toBe(false);
    expect(isVoiceRoomMockFallbackAllowed({ EXPO_PUBLIC_VOICE_ALLOW_MOCK_ROOMS: 'false' })).toBe(false);
    expect(isVoiceRoomMockFallbackAllowed({ EXPO_PUBLIC_VOICE_ALLOW_MOCK_ROOMS: 'true' })).toBe(true);
  });
});
