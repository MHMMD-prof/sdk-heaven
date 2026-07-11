import { describe, expect, it } from 'vitest';

import { shouldReconnectVoiceRoom } from '../roomReconnect';

describe('useVoiceRoomController reconnect policy', () => {
  it('reconnects only when the app returns to active from a non-active state', () => {
    expect(shouldReconnectVoiceRoom('background', 'active')).toBe(true);
    expect(shouldReconnectVoiceRoom('inactive', 'active')).toBe(true);
    expect(shouldReconnectVoiceRoom('active', 'active')).toBe(false);
    expect(shouldReconnectVoiceRoom('active', 'background')).toBe(false);
    expect(shouldReconnectVoiceRoom('background', 'inactive')).toBe(false);
  });
});
