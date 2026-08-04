import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  consumeVoiceRoomHttpRateLimit,
} = require('./voiceRoomHardeningService');
const {
  VOICE_ROOM_HTTP_RATE_LIMIT,
} = require('./voiceRoomRateLimitCore');

describe('voiceRoomHardeningService', () => {
  it('counts denied-path HTTP attempts globally and replays one request ID without charging twice', async () => {
    const db = fakeDb();
    const options = {
      clock: {
        nowMillis: () => 1_000_000,
        timestampFromMillis: (value) => value,
      },
      db,
      fieldValue: { serverTimestamp: () => 1_000_000 },
      surface: 'room-command',
      uid: 'user-1',
    };
    expect(await consumeVoiceRoomHttpRateLimit({ ...options, requestId: 'request-1' }))
      .toMatchObject({ ok: true, replayed: false });
    expect(await consumeVoiceRoomHttpRateLimit({ ...options, requestId: 'request-1' }))
      .toMatchObject({ ok: true, replayed: true });
    for (let index = 1; index < VOICE_ROOM_HTTP_RATE_LIMIT; index += 1) {
      expect(await consumeVoiceRoomHttpRateLimit({ ...options, requestId: `request-${index + 1}` }))
        .toMatchObject({ ok: true });
    }
    expect(await consumeVoiceRoomHttpRateLimit({ ...options, requestId: 'request-over-limit' }))
      .toMatchObject({ code: 'RATE_LIMITED', ok: false, status: 429 });
  });
});

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
