import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOwnershipRequestId,
  requestRoomOwnershipCommand,
  RoomOwnershipRequestError,
} from '../requestRoomOwnershipCommand';

const config = {
  roomOwnershipCommandEndpoint: 'https://voice.example.test/ownership',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('requestRoomOwnershipCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a force-refreshed authenticated ownership offer', async () => {
    const result = {
      action: 'offer-ownership-transfer',
      expiresAtMs: 2_000,
      ownershipRevision: 3,
      requestId: 'ownership_request_0001',
      revision: 9,
      roomId: 'room-1',
      status: 'pending',
      targetUid: 'target-1',
      transferId: 'ownership_transfer_1',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result }), { status: 200 }),
    );
    const getToken = vi.fn(async () => 'token-1');
    await expect(requestRoomOwnershipCommand({
      action: 'offer-ownership-transfer',
      expectedOwnershipRevision: 3,
      requestId: 'ownership_request_0001',
      roomId: 'room-1',
      targetUid: 'target-1',
    }, config, getToken)).resolves.toEqual(result);
    expect(getToken).toHaveBeenCalledWith(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      config.roomOwnershipCommandEndpoint,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('maps stable failures and fails closed without an endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'TRANSFER_EXPIRED', error: 'expired' }), { status: 409 }),
    );
    await expect(requestRoomOwnershipCommand({
      action: 'accept-ownership-transfer',
      roomId: 'room-1',
      transferId: 'ownership_transfer_1',
    }, config, async () => 'token-1')).rejects.toMatchObject({
      code: 'TRANSFER_EXPIRED',
      status: 409,
    });
    await expect(requestRoomOwnershipCommand({
      action: 'cancel-ownership-transfer',
      roomId: 'room-1',
      transferId: 'ownership_transfer_1',
    }, undefined, async () => 'token-1')).rejects.toBeInstanceOf(RoomOwnershipRequestError);
    expect(createOwnershipRequestId(1, 0.5)).toMatch(/^ownership_1_[a-z0-9]{11}$/);
  });
});
