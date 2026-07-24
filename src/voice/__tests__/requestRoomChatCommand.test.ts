import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RoomChatCommandError,
  createRoomChatRequestId,
  requestRoomChatCommand,
} from '../requestRoomChatCommand';

const config = {
  roomChatCommandEndpoint: 'https://voice.example.test/chat',
  tokenEndpoint: 'https://voice.example.test/token',
};

const result = {
  action: 'send-message' as const,
  messageId: 'chat_request-1',
  requestId: 'chat_request_000001',
  roomId: 'room-1',
  status: 'applied' as const,
};

describe('requestRoomChatCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends authenticated chat commands', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );

    await expect(requestRoomChatCommand({
      action: 'send-message',
      requestId: 'chat_request_000001',
      roomId: 'room-1',
      text: 'مرحبا',
    }, config, async () => 'token-1')).resolves.toEqual(result);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      config.roomChatCommandEndpoint,
      expect.objectContaining({
        body: JSON.stringify({
          action: 'send-message',
          requestId: 'chat_request_000001',
          roomId: 'room-1',
          text: 'مرحبا',
        }),
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('retries network loss with the same idempotency key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, replayed: true, result }), { status: 200 }));

    await requestRoomChatCommand({
      action: 'send-message',
      roomId: 'room-1',
      text: 'hello',
    }, config, async () => 'token-1');

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.requestId).toBe(second.requestId);
  });

  it('returns typed rate-limit details and fails closed without an endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        code: 'SLOW_MODE_ACTIVE',
        details: { retryAfterMs: 4_000 },
        error: 'wait',
      }), { status: 429 }),
    );

    await expect(requestRoomChatCommand({
      action: 'send-message',
      roomId: 'room-1',
      text: 'hello',
    }, config, async () => 'token-1')).rejects.toMatchObject({
      code: 'SLOW_MODE_ACTIVE',
      retryAfterMs: 4_000,
      status: 429,
    });

    await expect(requestRoomChatCommand({
      action: 'send-message',
      roomId: 'room-1',
      text: 'hello',
    }, undefined, async () => 'token-1')).rejects.toBeInstanceOf(RoomChatCommandError);
    expect(createRoomChatRequestId(1, 0.5)).toMatch(/^chat_1_[a-z0-9]{11}$/);
  });
});
