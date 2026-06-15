import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceRoom } from '../../types/voice';
import { requestLiveKitConnectOptions } from '../requestLiveKitConnectOptions';

const room: VoiceRoom = {
  id: 'room-1',
  title: 'Test Room',
  hostId: 'host-1',
  type: 'voice',
  participantCount: 1,
  speakers: [{ id: 'host-1', displayName: 'Host', avatarLabel: 'H' }],
  listeners: [],
};

const config = {
  tokenEndpoint: 'https://voice.example.test/token',
  userId: 'local-user',
  displayName: 'Local User',
  canPublishAudio: false,
};

describe('requestLiveKitConnectOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('maps a valid token response into LiveKit connect options', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          serverUrl: 'wss://livekit.example.test',
          token: 'token-1',
          canPublishAudio: true,
        }),
        { status: 200 },
      ),
    );

    const options = await requestLiveKitConnectOptions(room, config);

    expect(options).toEqual({
      roomId: room.id,
      serverUrl: 'wss://livekit.example.test',
      token: 'token-1',
      canPublishAudio: true,
      metadata: {
        source: 'livekit',
      },
    });
  });

  it('times out stalled token requests', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const request = requestLiveKitConnectOptions(room, config);
    const expectation = expect(request).rejects.toThrow('Voice token request timed out.');
    await vi.advanceTimersByTimeAsync(10000);

    await expectation;
  });

  it('rejects token responses without connection details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: 'token-1' }), { status: 200 }),
    );

    await expect(requestLiveKitConnectOptions(room, config)).rejects.toThrow(
      'LiveKit token response must include serverUrl and token.',
    );
  });
});
