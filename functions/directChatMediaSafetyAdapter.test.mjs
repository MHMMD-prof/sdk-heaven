import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createGoogleVisionSafetyAdapter } = require('./directChatMediaSafetyAdapter');

describe('directChatMediaSafetyAdapter', () => {
  it('fails closed when unavailable and rejects likely unsafe images', async () => {
    await expect(createGoogleVisionSafetyAdapter().inspectImage({ buffer: Buffer.from('x') }))
      .resolves.toEqual({ ok: false, reason: 'adapter-unavailable' });
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ responses: [{ safeSearchAnnotation: { adult: 'VERY_LIKELY', racy: 'POSSIBLE', violence: 'UNLIKELY' } }] }),
      ok: true,
    });
    const adapter = createGoogleVisionSafetyAdapter({ credential: { getAccessToken: async () => ({ access_token: 'token' }) }, fetchImpl });
    await expect(adapter.inspectImage({ buffer: Buffer.from('image') })).resolves.toEqual({ ok: false, reason: 'unsafe-image' });
  });

  it('approves only a complete safe-search response', async () => {
    const adapter = createGoogleVisionSafetyAdapter({
      credential: { getAccessToken: async () => ({ access_token: 'token' }) },
      fetchImpl: async () => ({ json: async () => ({ responses: [{ safeSearchAnnotation: { adult: 'UNLIKELY', racy: 'POSSIBLE', violence: 'VERY_UNLIKELY' } }] }), ok: true }),
    });
    await expect(adapter.inspectImage({ buffer: Buffer.from('image') })).resolves.toMatchObject({ ok: true, provider: 'google-vision-safe-search' });
  });
});
