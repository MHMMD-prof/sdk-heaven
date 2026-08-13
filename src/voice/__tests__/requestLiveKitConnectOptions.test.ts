import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

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
        body: JSON.stringify({ clientVersion: '1.0.0', roomId: 'room-1' }),
        headers: {
          Authorization: 'Bearer id-token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('passes only the derived attendance endpoint as local connection metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      serverUrl: 'wss://livekit.example.test',
      token: 'token-1',
    }), { status: 200 }));
    const options = await requestLiveKitConnectOptions(room, {
      ...config,
      roomAttendanceCommandEndpoint: 'https://voice.example.test/roomAttendanceCommand',
    }, async () => 'id-token-1');
    expect(options.metadata).toEqual({
      attendanceCommandEndpoint: 'https://voice.example.test/roomAttendanceCommand',
      source: 'livekit',
    });
  });

  it('does not send client-computed publishing authority', async () => {
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
        body: JSON.stringify({ clientVersion: '1.0.0', roomId: 'room-1' }),
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
    await vi.advanceTimersByTimeAsync(20000);

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

  it('reports auth-denied token responses clearly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status: 403 }));

    await expect(requestLiveKitConnectOptions(room, config, async () => 'id-token-1')).rejects.toThrow(
      'Voice token request was denied.',
    );
  });

  it('refreshes a stale Firebase token once after a 401 response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        serverUrl: 'wss://livekit.example.test',
        token: 'token-2',
      }), { status: 200 }));
    const getIdToken = vi.fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');

    await expect(requestLiveKitConnectOptions(room, config, getIdToken)).resolves.toMatchObject({
      token: 'token-2',
    });
    expect(getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
  });

  it('retries one transient network failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        serverUrl: 'wss://livekit.example.test',
        token: 'token-2',
      }), { status: 200 }));

    await expect(requestLiveKitConnectOptions(room, config, async () => 'id-token-1'))
      .resolves.toMatchObject({ token: 'token-2' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
