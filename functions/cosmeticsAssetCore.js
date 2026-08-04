'use strict';

const cosmeticAssetPolicyV1 = Object.freeze({
  schemaVersion: 1,
  formats: Object.freeze([
    'png',
    'jpeg',
    'lottie-json',
    'mp4',
    'm4a-aac',
    'legacy-webp',
  ]),
  categories: Object.freeze([
    'avatar-frame',
    'profile-skin',
    'chat-bubble',
    'nameplate',
    'cosmetic-badge',
    'entry-effect',
    'seat-effect',
    'gift-effect',
    'room-theme',
    'room-reaction',
    'couple-effect',
    'effect-audio',
  ]),
  moderationStatuses: Object.freeze([
    'draft',
    'processing',
    'pending',
    'approved',
    'rejected',
    'suspended',
  ]),
  publicationStatuses: Object.freeze([
    'unpublished',
    'published',
    'disabled',
  ]),
  equipmentSlots: Object.freeze([
    'avatar-frame',
    'profile-skin',
    'chat-bubble',
    'nameplate',
    'cosmetic-badge',
    'entry-effect',
    'seat-effect',
  ]),
  performanceTiers: Object.freeze(['low', 'standard', 'high']),
  viewerModes: Object.freeze(['full', 'reduced', 'off']),
});

/**
 * Wave 0 structural gate only. Wave 1 must still perform trusted content
 * sniffing, checksum calculation, normalization, and immutable publication.
 */
function inspectVectorLottieV1(document, options = {}) {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxDimension = options.maxDimension ?? 2560;
  const maxDurationMs = options.maxDurationMs ?? 6000;
  const maxFrameRate = options.maxFrameRate ?? 30;

  if (!isPlainObject(document)) return invalid('Lottie document must be an object.');
  if (!Number.isSafeInteger(options.byteSize) || options.byteSize < 1) {
    return invalid('Trusted byte size is required.');
  }
  if (options.byteSize > maxBytes) return invalid('Lottie exceeds the byte-size budget.');

  const frameRate = document.fr;
  const firstFrame = document.ip;
  const lastFrame = document.op;
  const width = document.w;
  const height = document.h;
  if (
    !positiveFinite(frameRate)
    || frameRate > maxFrameRate
    || !finiteNumber(firstFrame)
    || !finiteNumber(lastFrame)
    || lastFrame <= firstFrame
    || !positiveInteger(width)
    || !positiveInteger(height)
    || width > maxDimension
    || height > maxDimension
  ) {
    return invalid('Lottie canvas or frame metadata is invalid.');
  }

  const durationMs = ((lastFrame - firstFrame) / frameRate) * 1000;
  if (durationMs > maxDurationMs) return invalid('Lottie exceeds the duration budget.');

  const problem = findUnsupportedLottieFeature(document);
  if (problem) return invalid(problem);

  return {
    ok: true,
    metadata: {
      durationMs: Math.round(durationMs),
      frameRate,
      height,
      width,
    },
  };
}

function findUnsupportedLottieFeature(value, key = '', seen = new Set()) {
  if (typeof value === 'string') {
    if (/^(?:https?:|data:|file:)/i.test(value.trim())) {
      return 'Lottie contains an external or embedded resource.';
    }
    if (key === 'x' && value.trim()) return 'Lottie expressions are not supported.';
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return 'Lottie contains a cyclic object.';
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = findUnsupportedLottieFeature(item, key, seen);
      if (problem) return problem;
    }
    seen.delete(value);
    return undefined;
  }

  if (
    value.ty === 2
    || typeof value.p === 'string'
    || typeof value.u === 'string'
    || value.e === 1
  ) {
    seen.delete(value);
    return 'Lottie raster and external assets are not supported.';
  }
  if (value.ty === 5 || value.chars || value.fonts) {
    seen.delete(value);
    return 'Lottie text and fonts must be converted to vector shapes.';
  }
  if (value.ddd === 1 || value.ty === 13) {
    seen.delete(value);
    return 'Lottie 3D layers and cameras are not supported.';
  }
  if (Array.isArray(value.ef) && value.ef.length > 0) {
    seen.delete(value);
    return 'Lottie layer effects and plugins are not supported.';
  }

  for (const [childKey, child] of Object.entries(value)) {
    const problem = findUnsupportedLottieFeature(child, childKey, seen);
    if (problem) return problem;
  }
  seen.delete(value);
  return undefined;
}

function positiveFinite(value) {
  return finiteNumber(value) && value > 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(reason) {
  return { ok: false, reason };
}

function isPlainObject(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype,
  );
}

module.exports = {
  cosmeticAssetPolicyV1,
  inspectVectorLottieV1,
};
