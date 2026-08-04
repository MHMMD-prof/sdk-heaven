import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

import {
  RoomGameRequestError,
  createRoomGameRequestId,
  requestRoomGameCommand,
} from '../requestRoomGameCommand';

const config = {
  roomGameCommandEndpoint: 'https://voice.example.test/games',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('requestRoomGameCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends authenticated versioned commands and preserves an explicit request ID', async () => {
    const result = {
      action: 'create-room-game-invite',
      requestId: 'roomgame_request_0001',
      roomId: 'room-1',
      sessionId: 'rgs_session_000000000001',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    const getToken = vi.fn(async () => 'token-1');

    await expect(requestRoomGameCommand({
      action: 'create-room-game-invite',
      clientVersion: '1.2.3',
      gameId: 'drawing-guess',
      requestId: result.requestId,
      roomId: result.roomId,
    }, config, getToken)).resolves.toEqual(result);

    const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: 'create-room-game-invite',
      clientVersion: '1.2.3',
      gameId: 'drawing-guess',
      requestId: result.requestId,
      roomId: result.roomId,
    });
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('maps update and rate-limit failures without retrying under a new ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'CLIENT_UPDATE_REQUIRED' }), { status: 426 }),
    );
    await expect(requestRoomGameCommand({
      action: 'list-room-games',
      roomId: 'room-1',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'CLIENT_UPDATE_REQUIRED',
      status: 426,
    } satisfies Partial<RoomGameRequestError>);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }),
    );
    await expect(requestRoomGameCommand({
      action: 'list-room-games',
      roomId: 'room-1',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    } satisfies Partial<RoomGameRequestError>);
  });

  it('creates backend-valid request IDs', () => {
    expect(createRoomGameRequestId(1, 0.5)).toMatch(/^roomgame_[a-z0-9]+_[a-z0-9]{11}$/);
  });
});
