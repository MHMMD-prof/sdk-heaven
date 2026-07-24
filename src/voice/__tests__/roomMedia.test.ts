import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value: false,
    writable: true,
  });
});

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock('../../auth/firebase', () => ({
  firebaseApp: {},
}));
vi.mock('../useVoiceProviderConfig', () => ({
  useVoiceProviderConfig: vi.fn(),
}));

import {
  createRoomMediaId,
  normalizeRoomImageContentType,
  requestRoomMediaCommand,
} from '../roomMedia';

const config = {
  roomMediaCommandEndpoint: 'https://voice.example.test/room-media',
  tokenEndpoint: 'https://voice.example.test/token',
};

describe('roomMedia', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes supported content types and creates a storage-safe media ID', () => {
    expect(normalizeRoomImageContentType('image/jpg')).toBe('image/jpeg');
    expect(normalizeRoomImageContentType(' IMAGE/WEBP ')).toBe('image/webp');
    expect(normalizeRoomImageContentType('image/svg+xml')).toBeNull();
    expect(createRoomMediaId(1_000, 0.5)).toMatch(/^media_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('retries a lost response once with the same idempotency key', async () => {
    const result = {
      action: 'submit-room-image' as const,
      mediaId: 'media_upload_000001',
      requestId: 'media_command_000001',
      revision: 5,
      roomId: 'room-1',
      status: 'applied' as const,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, replayed: true, result }), { status: 200 }));

    await expect(requestRoomMediaCommand({
      action: 'submit-room-image',
      expectedRevision: 4,
      mediaId: 'media_upload_000001',
      mediaPath: 'room-media/room-1/media_upload_000001/source',
      roomId: 'room-1',
    }, config, async () => 'id-token-1')).resolves.toEqual(result);

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.requestId).toBe(second.requestId);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer id-token-1',
      'Content-Type': 'application/json',
    });
  });

  it('maps authoritative rejection codes without retrying client errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'ROOM_CUSTOMIZATION_SUSPENDED',
      error: 'suspended',
    }), { status: 403 }));

    await expect(requestRoomMediaCommand({
      action: 'submit-room-image',
      expectedRevision: 4,
      mediaId: 'media_upload_000001',
      mediaPath: 'room-media/room-1/media_upload_000001/source',
      roomId: 'room-1',
    }, config, async () => 'id-token-1')).rejects.toMatchObject({
      code: 'ROOM_CUSTOMIZATION_SUSPENDED',
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
