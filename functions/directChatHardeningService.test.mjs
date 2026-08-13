import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DIRECT_CHAT_HTTP_RATE_LIMIT,
  consumeDirectChatCommandHttpRateLimits,
  consumeDirectChatHttpRateLimit,
  hashClientIp,
  readClientIp,
} = require('./directChatHardeningService');

describe('directChatHardeningService', () => {
  it('allows under the outer uid limit and replays one request ID without double-charging', async () => {
    const db = fakeDb();
    const options = baseOptions(db);
    expect(await consumeDirectChatHttpRateLimit({ ...options, requestId: 'request-1', scope: 'command_user-1' }))
      .toMatchObject({ ok: true, replayed: false });
    expect(await consumeDirectChatHttpRateLimit({ ...options, requestId: 'request-1', scope: 'command_user-1' }))
      .toMatchObject({ ok: true, replayed: true });
    for (let index = 1; index < DIRECT_CHAT_HTTP_RATE_LIMIT; index += 1) {
      expect(await consumeDirectChatHttpRateLimit({
        ...options,
        requestId: `request-${index + 1}`,
        scope: 'command_user-1',
      })).toMatchObject({ ok: true });
    }
    expect(await consumeDirectChatHttpRateLimit({
      ...options,
      requestId: 'request-over-limit',
      scope: 'command_user-1',
    })).toMatchObject({ code: 'RATE_LIMITED', ok: false, status: 429 });
  });

  it('applies an IP-hash bucket without treating IP as identity when headers are present', async () => {
    const db = fakeDb();
    const options = {
      ...baseOptions(db),
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    };
    expect(await consumeDirectChatCommandHttpRateLimits({ ...options, requestId: 'req-a' }))
      .toMatchObject({ ok: true });
    expect(db.documents.has(`directChatHttpRateLimits/command_user-1`)).toBe(true);
    expect(db.documents.has(`directChatHttpRateLimits/command_ip_${hashClientIp('203.0.113.10')}`)).toBe(true);
  });

  it('still rate-limits by uid when no client IP header is present', async () => {
    const db = fakeDb();
    const options = baseOptions(db);
    for (let index = 0; index < DIRECT_CHAT_HTTP_RATE_LIMIT; index += 1) {
      expect(await consumeDirectChatCommandHttpRateLimits({
        ...options,
        requestId: `solo-${index}`,
      })).toMatchObject({ ok: true });
    }
    expect(await consumeDirectChatCommandHttpRateLimits({
      ...options,
      requestId: 'solo-over',
    })).toMatchObject({ code: 'RATE_LIMITED', ok: false, status: 429 });
    expect([...db.documents.keys()].some((path) => path.includes('command_ip_'))).toBe(false);
  });

  it('reads the first forwarded IP and hashes it stably', () => {
    expect(readClientIp({ 'x-forwarded-for': ' 198.51.100.7 , 10.1.1.1' })).toBe('198.51.100.7');
    expect(readClientIp({ 'x-real-ip': '192.0.2.55' })).toBe('192.0.2.55');
    expect(hashClientIp('198.51.100.7')).toHaveLength(16);
    expect(hashClientIp('198.51.100.7')).toBe(hashClientIp('198.51.100.7'));
  });
});

function baseOptions(db) {
  return {
    clock: {
      nowMillis: () => 1_000_000,
      timestampFromMillis: (value) => value,
    },
    db,
    fieldValue: { serverTimestamp: () => 1_000_000 },
    headers: {},
    uid: 'user-1',
  };
}

function fakeDb() {
  const documents = new Map();
  const ref = (path) => ({ path });
  return {
    doc: ref,
    documents,
    runTransaction: async (callback) => callback({
      get: async (reference) => ({
        exists: documents.has(reference.path),
        data: () => documents.get(reference.path),
      }),
      set: (reference, value, options) => {
        documents.set(
          reference.path,
          options?.merge ? { ...(documents.get(reference.path) || {}), ...value } : value,
        );
      },
    }),
  };
}
