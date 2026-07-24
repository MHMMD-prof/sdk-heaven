import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RoomCommandRequestError,
  createRoomCommandRequestId,
  requestRoomCommand,
  roomCommandErrorMessage,
} from '../requestRoomCommand';

const config = {
  tokenEndpoint: 'https://voice.example.test/token',
  roomCommandEndpoint: 'https://voice.example.test/command',
};
const result = {
  action: 'promote-speaker' as const,
  liveKitSyncStatus: 'synced' as const,
  requestId: 'room_request_0001',
  revision: 8,
  roomId: 'room-1',
  status: 'applied' as const,
  targetUid: 'uid-2',
};

describe('requestRoomCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends identity, request ID, and optimistic revision', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result }), { status: 200 }));

    await expect(requestRoomCommand(
      {
        roomId: 'room-1',
        action: 'promote-speaker',
        targetUid: 'uid-2',
        expectedRevision: 7,
        requestId: 'room_request_0001',
      },
      config,
      async () => 'id-token-1',
    )).resolves.toEqual(result);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://voice.example.test/command',
      expect.objectContaining({
        body: JSON.stringify({
          roomId: 'room-1',
          action: 'promote-speaker',
          targetUid: 'uid-2',
          expectedRevision: 7,
          requestId: 'room_request_0001',
        }),
        headers: {
          Authorization: 'Bearer id-token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('retries a lost response once with the same generated request ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, replayed: true, result }), { status: 200 }));

    await requestRoomCommand(
      { roomId: 'room-1', action: 'promote-speaker', targetUid: 'uid-2', expectedRevision: 7 },
      config,
      async () => 'id-token-1',
    );

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.requestId).toBe(secondBody.requestId);
    expect(firstBody.requestId).toMatch(/^room_/);
  });

  it('maps stable server errors to actionable Arabic messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'REVISION_CONFLICT',
      error: 'stale',
    }), { status: 409 }));

    await expect(requestRoomCommand(
      { roomId: 'room-1', action: 'close-room', expectedRevision: 7 },
      config,
      async () => 'id-token-1',
    )).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      message: roomCommandErrorMessage('REVISION_CONFLICT'),
      status: 409,
    });
  });

  it('rejects a missing endpoint with a typed error', async () => {
    await expect(
      requestRoomCommand({ roomId: 'room-1', action: 'close-room' }, undefined, async () => 'id-token-1'),
    ).rejects.toBeInstanceOf(RoomCommandRequestError);
    expect(createRoomCommandRequestId(1, 0.5)).toMatch(/^room_1_[a-z0-9]{11}$/);
  });
});
