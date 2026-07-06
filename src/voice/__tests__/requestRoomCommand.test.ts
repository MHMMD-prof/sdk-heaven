import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestRoomCommand } from '../requestRoomCommand';

describe('requestRoomCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends a Firebase bearer token and command payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await requestRoomCommand(
      {
        roomId: 'room-1',
        action: 'promote-speaker',
        targetUid: 'uid-2',
      },
      { tokenEndpoint: 'https://voice.example.test/token', roomCommandEndpoint: 'https://voice.example.test/command' },
      async () => 'id-token-1',
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://voice.example.test/command',
      expect.objectContaining({
        body: JSON.stringify({
          roomId: 'room-1',
          action: 'promote-speaker',
          targetUid: 'uid-2',
        }),
        headers: {
          Authorization: 'Bearer id-token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('rejects missing endpoint and non-ok responses', async () => {
    await expect(
      requestRoomCommand({ roomId: 'room-1', action: 'close-room' }, undefined, async () => 'id-token-1'),
    ).rejects.toThrow('Room command endpoint is not configured.');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 }));

    await expect(
      requestRoomCommand(
        { roomId: 'room-1', action: 'close-room' },
        { tokenEndpoint: 'https://voice.example.test/token', roomCommandEndpoint: 'https://voice.example.test/command' },
        async () => 'id-token-1',
      ),
    ).rejects.toThrow('Room command request failed with status 403.');
  });
});
