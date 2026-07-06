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

    const options = await requestLiveKitConnectOptions(room, config, async () => 'id-token-1');

    expect(options).toEqual({
      roomId: room.id,
      serverUrl: 'wss://livekit.example.test',
      token: 'token-1',
      canPublishAudio: true,
      metadata: {
        source: 'livekit',
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://voice.example.test/token',
      expect.objectContaining({
        body: JSON.stringify({
          roomId: 'room-1',
          canPublishAudio: false,
        }),
        headers: {
          Authorization: 'Bearer id-token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('uses local room membership as the publish cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          serverUrl: 'wss://livekit.example.test',
          token: 'token-1',
          canPublishAudio: false,
        }),
        { status: 200 },
      ),
    );

    await requestLiveKitConnectOptions(
      {
        ...room,
        localMember: {
          id: 'uid-2',
          displayName: 'Dana',
          avatarLabel: 'D',
          role: 'listener',
          canPublishAudio: false,
        },
      },
      { ...config, canPublishAudio: true },
      async () => 'id-token-1',
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://voice.example.test/token',
      expect.objectContaining({
        body: JSON.stringify({
          roomId: 'room-1',
          canPublishAudio: false,
        }),
      }),
    );
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

    const request = requestLiveKitConnectOptions(room, config, async () => 'id-token-1');
    const expectation = expect(request).rejects.toThrow('Voice token request timed out.');
    await vi.advanceTimersByTimeAsync(10000);

    await expectation;
  });

  it('rejects token responses without connection details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: 'token-1' }), { status: 200 }),
    );

    await expect(requestLiveKitConnectOptions(room, config, async () => 'id-token-1')).rejects.toThrow(
      'LiveKit token response must include serverUrl and token.',
    );
  });
});
