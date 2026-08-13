import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/getCurrentFirebaseIdToken', () => ({
  getCurrentFirebaseIdToken: vi.fn(async () => 'mock-token'),
}));
vi.mock('../../auth/appCheck', () => ({
  getFirebaseAppCheckToken: vi.fn(async () => 'mock-app-check-token'),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => 'digest'),
}));

import {
  createDirectChatRequestId,
  deriveDirectChatEndpoint,
  requestDirectChatCommand,
} from '../requestDirectChatCommand';

afterEach(() => vi.unstubAllGlobals());

describe('requestDirectChatCommand', () => {
  it('derives the endpoint and creates contract-safe request IDs', () => {
    expect(deriveDirectChatEndpoint('https://us-central1-example.cloudfunctions.net/livekitToken'))
      .toBe('https://us-central1-example.cloudfunctions.net/directChatCommand');
    expect(deriveDirectChatEndpoint('http://unsafe.test/livekitToken')).toBe('');
    expect(createDirectChatRequestId(1_000, 0.5)).toMatch(/^[A-Za-z0-9_-]{12,80}$/);
  });

  it('retries a transient failure with the exact same idempotent body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'INTERNAL' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, replayed: true, result: { action: 'get-direct-chat-inbox' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestDirectChatCommand({
      action: 'get-direct-chat-inbox',
      payload: { limit: 30 },
      requestId: 'inbox_request_0001',
    }, {
      endpoint: 'https://example.test/directChatCommand',
      getIdToken: async () => 'token',
    })).resolves.toMatchObject({ ok: true, replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Firebase-AppCheck': 'mock-app-check-token' });
  });

  it('refreshes App Check once after an invalid-token response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'APP_CHECK_INVALID' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { action: 'get-direct-chat-inbox' } }), { status: 200 }));
    const getAppCheckToken = vi.fn(async (forceRefresh = false) => forceRefresh ? 'fresh-token' : 'stale-token');
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestDirectChatCommand({
      action: 'get-direct-chat-inbox', requestId: 'inbox_request_0002',
    }, {
      endpoint: 'https://example.test/directChatCommand', getAppCheckToken, getIdToken: async () => 'token',
    })).resolves.toMatchObject({ ok: true });
    expect(getAppCheckToken.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'X-Firebase-AppCheck': 'fresh-token' });
  });
});
