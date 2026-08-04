import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

import {
  RoomMusicRequestError,
  ROOM_MUSIC_PROTOCOL_VERSION,
  createRoomMusicRequestId,
  requestRoomMusicCommand,
} from '../requestRoomMusicCommand';

const config = {
  roomMusicCommandEndpoint: 'https://voice.example.test/music',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('requestRoomMusicCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends authenticated versioned commands and preserves explicit request IDs', async () => {
    const result = {
      action: 'claim-dj-lease',
      leaseId: 'rml_lease_000000000001',
      requestId: 'roommusic_request_0001',
      roomId: 'room-1',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    const getToken = vi.fn(async () => 'token-1');

    await expect(requestRoomMusicCommand({
      action: 'claim-dj-lease',
      clientVersion: '1.2.3',
      requestId: result.requestId,
      roomId: result.roomId,
      trackId: 'helix-one',
    }, config, getToken)).resolves.toEqual(result);

    const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: 'claim-dj-lease',
      clientVersion: '1.2.3',
      protocolVersion: ROOM_MUSIC_PROTOCOL_VERSION,
      requestId: result.requestId,
      roomId: result.roomId,
      trackId: 'helix-one',
    });
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('maps update and rate-limit failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'CLIENT_UPDATE_REQUIRED' }), { status: 426 }),
    );
    await expect(requestRoomMusicCommand({
      action: 'list-room-music-catalog',
      roomId: 'room-1',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'CLIENT_UPDATE_REQUIRED',
      status: 426,
    } satisfies Partial<RoomMusicRequestError>);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }),
    );
    await expect(requestRoomMusicCommand({
      action: 'list-room-music-catalog',
      roomId: 'room-1',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    } satisfies Partial<RoomMusicRequestError>);
  });

  it('creates backend-valid request IDs', () => {
    expect(createRoomMusicRequestId(1, 0.5)).toMatch(/^roommusic_[a-z0-9]+_[a-z0-9]{11}$/);
  });
});
