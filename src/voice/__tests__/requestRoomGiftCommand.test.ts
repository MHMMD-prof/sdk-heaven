import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

import {
  createRoomGiftRequestId,
  requestRoomGiftCommand,
  RoomGiftRequestError,
} from '../requestRoomGiftCommand';

const config = {
  roomGiftCommandEndpoint: 'https://voice.example.test/gifts',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('requestRoomGiftCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends an authenticated quote request', async () => {
    const result = {
      action: 'quote-room-gift',
      quote: {
        assetVersion: '1',
        commissionBps: 1000,
        currency: 'coins',
        expiresAtMs: 2_000,
        giftId: 'rose',
        iconKey: 'rose',
        nameAr: 'وردة',
        platformShare: 10,
        policyVersion: 1,
        price: 100,
        quantity: 1,
        quoteId: 'rgq_1',
        recipientCredit: 90,
        roomId: 'room-1',
        scoreValue: 5,
        targetMode: 'member',
        targetUid: 'target-1',
        unitPrice: 100,
      },
      requestId: 'roomgift_request_0001',
      roomId: 'room-1',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    const getToken = vi.fn(async () => 'token-1');
    await expect(requestRoomGiftCommand({
      action: 'quote-room-gift',
      giftId: 'rose',
      requestId: 'roomgift_request_0001',
      roomId: 'room-1',
      targetUid: 'target-1',
    }, config, getToken)).resolves.toEqual(result);
    expect(getToken).toHaveBeenCalledWith(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      config.roomGiftCommandEndpoint,
      expect.objectContaining({
        body: expect.stringContaining('"clientVersion":"1.0.0"'),
        method: 'POST',
      }),
    );
  });

  it('maps feature-disabled responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'FEATURE_DISABLED', error: 'off' }), { status: 503 }),
    );
    await expect(requestRoomGiftCommand({
      action: 'quote-room-gift',
      giftId: 'rose',
      roomId: 'room-1',
      targetUid: 'target-1',
    }, config, async () => 'token')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
      message: 'هدايا الغرفة غير مفعّلة حالياً.',
    } satisfies Partial<RoomGiftRequestError>);
  });

  it('creates stable request ids', () => {
    expect(createRoomGiftRequestId(1, 0.1)).toMatch(/^roomgift_/);
  });
});
