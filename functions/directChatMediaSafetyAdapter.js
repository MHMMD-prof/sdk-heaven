const REJECTED_LIKELIHOODS = new Set(['LIKELY', 'VERY_LIKELY']);

function createGoogleVisionSafetyAdapter({ credential, fetchImpl = globalThis.fetch } = {}) {
  return {
    async inspectImage({ buffer }) {
      if (!credential || typeof credential.getAccessToken !== 'function' || typeof fetchImpl !== 'function' || !Buffer.isBuffer(buffer)) {
        return { ok: false, reason: 'adapter-unavailable' };
      }
      try {
        const access = await credential.getAccessToken();
        const token = typeof access === 'string' ? access : access?.access_token;
        if (!token) return { ok: false, reason: 'adapter-unavailable' };
        const response = await fetchImpl('https://vision.googleapis.com/v1/images:annotate', {
          body: JSON.stringify({ requests: [{ features: [{ type: 'SAFE_SEARCH_DETECTION' }], image: { content: buffer.toString('base64') } }] }),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (!response.ok) return { ok: false, reason: 'adapter-unavailable' };
        const payload = await response.json();
        const annotation = payload?.responses?.[0]?.safeSearchAnnotation;
        if (!annotation || payload?.responses?.[0]?.error) return { ok: false, reason: 'adapter-unavailable' };
        const rejected = ['adult', 'racy', 'violence'].some((key) => REJECTED_LIKELIHOODS.has(annotation[key]));
        return rejected ? { ok: false, reason: 'unsafe-image' } : { ok: true, provider: 'google-vision-safe-search' };
      } catch {
        return { ok: false, reason: 'adapter-unavailable' };
      }
    },
  };
}

module.exports = { createGoogleVisionSafetyAdapter };
