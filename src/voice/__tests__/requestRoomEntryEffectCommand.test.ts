import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

import {
  RoomEntryEffectRequestError,
  createRoomEntryEffectRequestId,
  requestRoomEntryEffectCommand,
} from '../requestRoomEntryEffectCommand';

const config = {
  roomEntryEffectCommandEndpoint: 'https://voice.example.test/entry-effects',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('requestRoomEntryEffectCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends one authenticated, versioned, idempotent command', async () => {
    const result = {
      action: 'announce-entry-effect' as const,
      announced: true,
      eventId: 'ree_1',
      reason: 'ANNOUNCED',
      requestId: 'entryfx_request_00001',
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
      skipped: false,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    const getToken = vi.fn(async () => 'token-1');

    await expect(requestRoomEntryEffectCommand({
      clientVersion: '1.2.3',
      requestId: result.requestId,
      roomId: result.roomId,
      sessionId: result.sessionId,
    }, config, getToken)).resolves.toEqual(result);
    const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: 'announce-entry-effect',
      clientVersion: '1.2.3',
      requestId: result.requestId,
    });
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('maps minimum-version and rate-limit responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'CLIENT_UPDATE_REQUIRED' }), { status: 426 }),
    );
    await expect(requestRoomEntryEffectCommand({
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'CLIENT_UPDATE_REQUIRED',
      status: 426,
    } satisfies Partial<RoomEntryEffectRequestError>);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }),
    );
    await expect(requestRoomEntryEffectCommand({
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    } satisfies Partial<RoomEntryEffectRequestError>);
  });

  it('creates valid request IDs', () => {
    expect(createRoomEntryEffectRequestId(1, 0.5)).toMatch(/^entryfx_[a-z0-9]+_[a-z0-9]{11}$/);
  });
});
