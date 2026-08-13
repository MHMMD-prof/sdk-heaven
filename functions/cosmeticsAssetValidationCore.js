'use strict';

const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { inspectVectorLottieV1 } = require('./cosmeticsAssetCore');

const MEBIBYTE = 1024 * 1024;
const FORMAT_MIME_TYPES = Object.freeze({
  jpeg: Object.freeze(['image/jpeg']),
  'legacy-webp': Object.freeze(['image/webp']),
  'lottie-json': Object.freeze(['application/json']),
  'm4a-aac': Object.freeze(['audio/mp4', 'audio/x-m4a']),
  mp4: Object.freeze(['video/mp4']),
  png: Object.freeze(['image/png']),
});
const CATEGORY_FORMATS = Object.freeze({
  'avatar-frame': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'chat-bubble': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'cosmetic-badge': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'couple-effect': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'effect-audio': Object.freeze(['m4a-aac']),
  'entry-effect': Object.freeze(['png', 'lottie-json', 'mp4', 'legacy-webp']),
  'gift-effect': Object.freeze(['png', 'lottie-json', 'mp4', 'legacy-webp']),
  nameplate: Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'profile-skin': Object.freeze(['png', 'jpeg', 'legacy-webp']),
  'room-reaction': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
  'room-theme': Object.freeze(['png', 'jpeg', 'lottie-json', 'mp4', 'legacy-webp']),
  'seat-effect': Object.freeze(['png', 'lottie-json', 'legacy-webp']),
});
const CATEGORY_SLOTS = Object.freeze({
  'avatar-frame': 'avatar-frame',
  'chat-bubble': 'chat-bubble',
  'cosmetic-badge': 'cosmetic-badge',
  'entry-effect': 'entry-effect',
  nameplate: 'nameplate',
  'profile-skin': 'profile-skin',
  'seat-effect': 'seat-effect',
});
const LOOPING_CATEGORIES = new Set([
  'avatar-frame',
  'chat-bubble',
  'cosmetic-badge',
  'couple-effect',
  'nameplate',
  'room-reaction',
  'room-theme',
  'seat-effect',
]);

async function inspectCosmeticAssetBuffer({
  buffer,
  category,
  contentType,
  format,
  loop,
  usage,
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) return invalid('Asset bytes are required.');
  if (!CATEGORY_FORMATS[category]?.includes(format)) {
    return invalid('Format is not allowed for this category.');
  }
  if (!FORMAT_MIME_TYPES[format]?.includes(contentType)) {
    return invalid('Storage content type does not match the declared format.');
  }
  if (!['static', 'looping', 'one-shot'].includes(usage)) {
    return invalid('Asset usage is invalid.');
  }
  if (loop !== (usage === 'looping')) return invalid('Loop flag does not match usage.');
  if (loop && !LOOPING_CATEGORIES.has(category)) {
    return invalid('This category cannot loop.');
  }

  const budget = resolveBudget(format, category);
  if (buffer.length > budget.maxBytes) return invalid('Asset exceeds its byte-size budget.');

  let inspected;
  try {
    if (format === 'png' || format === 'jpeg' || format === 'legacy-webp') {
      inspected = await inspectStaticImage(buffer, format, budget);
    } else if (format === 'lottie-json') {
      inspected = inspectLottie(buffer, budget);
    } else if (format === 'mp4' || format === 'm4a-aac') {
      inspected = inspectIsoMedia(buffer, format, budget);
    } else {
      return invalid('Asset format is unsupported.');
    }
  } catch {
    return invalid('Asset bytes could not be decoded safely.');
  }
  if (!inspected.ok) return inspected;

  return {
    ok: true,
    value: {
      byteSize: buffer.length,
      contentType,
      format,
      metadata: inspected.metadata,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}

async function inspectStaticImage(buffer, format, budget) {
  const expected = format === 'legacy-webp' ? 'webp' : format;
  const metadata = await sharp(buffer, {
    animated: false,
    failOn: 'warning',
    limitInputPixels: budget.maxDimension * budget.maxDimension,
  }).metadata();
  if (
    metadata.format !== expected
    || !positiveInteger(metadata.width)
    || !positiveInteger(metadata.height)
    || metadata.width > budget.maxDimension
    || metadata.height > budget.maxDimension
    || Number(metadata.pages || 1) !== 1
  ) {
    return invalid('Static image type, dimensions, or page count is invalid.');
  }
  return {
    ok: true,
    metadata: {
      durationMs: 0,
      frameRate: 0,
      height: metadata.height,
      transparent: format !== 'jpeg' && metadata.hasAlpha === true,
      videoCodec: '',
      audioCodec: '',
      width: metadata.width,
    },
  };
}

function inspectLottie(buffer, budget) {
  let document;
  try {
    document = JSON.parse(buffer.toString('utf8'));
  } catch {
    return invalid('Lottie source must be valid UTF-8 JSON.');
  }
  const inspection = inspectVectorLottieV1(document, {
    byteSize: buffer.length,
    maxBytes: budget.maxBytes,
    maxDimension: budget.maxDimension,
    maxDurationMs: budget.maxDurationMs,
    maxFrameRate: budget.maxFrameRate,
  });
  if (!inspection.ok) return inspection;
  return {
    ok: true,
    metadata: {
      ...inspection.metadata,
      transparent: true,
      videoCodec: '',
      audioCodec: '',
    },
  };
}

function inspectIsoMedia(buffer, format, budget) {
  const boxes = parseBoxes(buffer);
  if (!boxes) return invalid('ISO media container is malformed.');
  const ftyp = boxes.find((box) => box.type === 'ftyp');
  const moov = boxes.find((box) => box.type === 'moov');
  if (!ftyp || !moov || !hasSupportedIsoBrand(buffer, ftyp)) {
    return invalid('MP4/M4A container brand is unsupported.');
  }
  const tracks = childBoxes(buffer, moov)
    .filter((box) => box.type === 'trak')
    .map((track) => readTrack(buffer, track))
    .filter(Boolean);
  const videoTracks = tracks.filter((track) => track.handler === 'vide');
  const audioTracks = tracks.filter((track) => track.handler === 'soun');
  const durationMs = Math.round(Math.max(0, ...tracks.map((track) => track.durationMs)));
  if (!positiveInteger(durationMs) || durationMs > budget.maxDurationMs) {
    return invalid('Media duration is missing or exceeds its budget.');
  }

  if (format === 'm4a-aac') {
    if (
      videoTracks.length > 0
      || audioTracks.length !== 1
      || !audioTracks[0].codecs.includes('mp4a')
    ) {
      return invalid('M4A must contain one AAC audio track and no video.');
    }
    return {
      ok: true,
      metadata: {
        audioCodec: 'aac',
        durationMs,
        frameRate: 0,
        height: 0,
        transparent: false,
        videoCodec: '',
        width: 0,
      },
    };
  }

  if (
    videoTracks.length !== 1
    || !videoTracks[0].codecs.some((codec) => codec === 'avc1' || codec === 'avc3')
    || videoTracks[0].codecs.some((codec) => ['hvc1', 'hev1'].includes(codec))
    || audioTracks.some((track) => !track.codecs.includes('mp4a'))
  ) {
    return invalid('MP4 must contain one H.264 track and optional AAC audio only.');
  }
  if (audioTracks.length > 0) {
    return invalid('MP4 visual assets must be silent; publish approved M4A/AAC separately.');
  }
  const video = videoTracks[0];
  if (
    !positiveInteger(video.width)
    || !positiveInteger(video.height)
    || video.width > budget.maxWidth
    || video.height > budget.maxHeight
    || !positiveFinite(video.frameRate)
    || video.frameRate > budget.maxFrameRate + 0.01
  ) {
    return invalid('MP4 dimensions or frame rate exceed the approved profile.');
  }
  return {
    ok: true,
    metadata: {
      audioCodec: '',
      durationMs,
      frameRate: round(video.frameRate, 3),
      height: video.height,
      transparent: false,
      videoCodec: 'h264',
      width: video.width,
    },
  };
}

function readTrack(buffer, track) {
  const descendants = flattenBoxes(buffer, track);
  const handlerBox = descendants.find((box) => box.type === 'hdlr');
  const mediaHeader = descendants.find((box) => box.type === 'mdhd');
  const trackHeader = descendants.find((box) => box.type === 'tkhd');
  const sampleDescription = descendants.find((box) => box.type === 'stsd');
  const timeToSample = descendants.find((box) => box.type === 'stts');
  if (!handlerBox || !mediaHeader || !sampleDescription) return undefined;
  const handler = ascii(buffer, handlerBox.dataStart + 8, 4);
  const mediaTime = readMediaTime(buffer, mediaHeader);
  const codecs = readSampleDescriptions(buffer, sampleDescription);
  if (!mediaTime || !codecs) return undefined;

  let width = 0;
  let height = 0;
  if (trackHeader && trackHeader.end - trackHeader.dataStart >= 8) {
    width = Math.round(buffer.readUInt32BE(trackHeader.end - 8) / 65536);
    height = Math.round(buffer.readUInt32BE(trackHeader.end - 4) / 65536);
  }
  const sampleCount = timeToSample ? readSampleCount(buffer, timeToSample) : 0;
  const durationSeconds = mediaTime.duration / mediaTime.timescale;
  return {
    codecs,
    durationMs: Math.round(durationSeconds * 1000),
    frameRate: handler === 'vide' && sampleCount > 0 && durationSeconds > 0
      ? sampleCount / durationSeconds
      : 0,
    handler,
    height,
    width,
  };
}

function readMediaTime(buffer, box) {
  const version = buffer[box.dataStart];
  const timescaleOffset = box.dataStart + (version === 1 ? 20 : 12);
  const durationOffset = box.dataStart + (version === 1 ? 24 : 16);
  if (durationOffset + (version === 1 ? 8 : 4) > box.end) return undefined;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  return positiveInteger(timescale) && positiveFinite(duration)
    ? { duration, timescale }
    : undefined;
}

function readSampleDescriptions(buffer, box) {
  if (box.dataStart + 8 > box.end) return undefined;
  const count = buffer.readUInt32BE(box.dataStart + 4);
  const codecs = [];
  let offset = box.dataStart + 8;
  for (let index = 0; index < count; index += 1) {
    if (offset + 8 > box.end) return undefined;
    const size = buffer.readUInt32BE(offset);
    if (size < 8 || offset + size > box.end) return undefined;
    codecs.push(ascii(buffer, offset + 4, 4));
    offset += size;
  }
  return codecs;
}

function readSampleCount(buffer, box) {
  if (box.dataStart + 8 > box.end) return 0;
  const entryCount = buffer.readUInt32BE(box.dataStart + 4);
  let offset = box.dataStart + 8;
  let samples = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 8 > box.end) return 0;
    samples += buffer.readUInt32BE(offset);
    offset += 8;
  }
  return samples;
}

function hasSupportedIsoBrand(buffer, box) {
  if (box.dataStart + 8 > box.end) return false;
  const brands = [ascii(buffer, box.dataStart, 4)];
  for (let offset = box.dataStart + 8; offset + 4 <= box.end; offset += 4) {
    brands.push(ascii(buffer, offset, 4));
  }
  return brands.some((brand) => [
    'M4A ',
    'avc1',
    'iso2',
    'iso5',
    'iso6',
    'isom',
    'mp41',
    'mp42',
  ].includes(brand));
}

function parseBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) return undefined;
    let size = buffer.readUInt32BE(offset);
    const type = ascii(buffer, offset + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) return undefined;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) {
      return undefined;
    }
    boxes.push({
      dataStart: offset + headerSize,
      end: offset + size,
      start: offset,
      type,
    });
    offset += size;
  }
  return boxes;
}

function childBoxes(buffer, parent) {
  return parseBoxes(buffer, parent.dataStart, parent.end) || [];
}

function flattenBoxes(buffer, parent) {
  const containers = new Set(['mdia', 'minf', 'moov', 'stbl', 'trak']);
  const flattened = [];
  for (const child of childBoxes(buffer, parent)) {
    flattened.push(child);
    if (containers.has(child.type)) flattened.push(...flattenBoxes(buffer, child));
  }
  return flattened;
}

function resolveBudget(format, category) {
  if (format === 'lottie-json') {
    return {
      maxBytes: MEBIBYTE,
      maxDimension: 2560,
      maxDurationMs: 6000,
      maxFrameRate: 30,
    };
  }
  if (format === 'mp4') {
    return {
      maxBytes: category === 'room-theme' ? 10 * MEBIBYTE : 5 * MEBIBYTE,
      maxDurationMs: category === 'room-theme' ? 30000 : 6000,
      maxFrameRate: 30,
      maxHeight: 720,
      maxWidth: 1280,
    };
  }
  if (format === 'm4a-aac') {
    return { maxBytes: 500 * 1024, maxDurationMs: 6000 };
  }
  return {
    maxBytes: format === 'legacy-webp' ? 5 * MEBIBYTE : 3 * MEBIBYTE,
    maxDimension: 2560,
  };
}

function validateAssetIdentityDraft(value) {
  if (!isRecord(value)) return invalid('Asset draft is required.');
  const assetId = readString(value.assetId);
  const versionId = readString(value.assetVersionId);
  const category = readString(value.category);
  const format = readString(value.format);
  const ownerType = readString(value.ownerType);
  const ownerUid = readString(value.ownerUid);
  const slot = readString(value.slot);
  const usage = readString(value.usage);
  const minimumClientVersion = readString(value.minimumClientVersion);
  const performanceTier = readString(value.performanceTier);
  const fallbackAssetVersionId = readString(value.fallbackAssetVersionId);
  const audioAssetVersionId = readString(value.audioAssetVersionId);
  if (
    !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
    || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(versionId)
    || !CATEGORY_FORMATS[category]?.includes(format)
    || !['platform', 'user'].includes(ownerType)
    || (ownerType === 'platform' ? ownerUid : !/^[^/\s]{1,128}$/.test(ownerUid))
    || !['static', 'looping', 'one-shot'].includes(usage)
    || !['low', 'standard', 'high'].includes(performanceTier)
    || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(minimumClientVersion)
    || value.loop !== (usage === 'looping')
  ) {
    return invalid('Asset identity draft is invalid.');
  }
  const expectedSlot = CATEGORY_SLOTS[category] || '';
  if (slot !== expectedSlot) return invalid('Equipment slot does not match category.');
  if (format === 'lottie-json' || format === 'mp4') {
    if (!/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(fallbackAssetVersionId)) {
      return invalid('Animated assets require a versioned static fallback.');
    }
  } else if (fallbackAssetVersionId) {
    return invalid('Static/audio assets cannot declare a fallback.');
  }
  if (format === 'm4a-aac' && audioAssetVersionId) {
    return invalid('Audio assets cannot reference another audio asset.');
  }
  return {
    ok: true,
    value: {
      assetId,
      assetVersionId: versionId,
      audioAssetVersionId,
      category,
      fallbackAssetVersionId,
      format,
      loop: value.loop,
      minimumClientVersion,
      ownerType,
      ownerUid,
      performanceTier,
      slot,
      usage,
    },
  };
}

function buildCanonicalStoragePath(identity, extension) {
  const ownerSegment = identity.ownerType === 'platform'
    ? 'platform'
    : `users/${identity.ownerUid}`;
  return `cosmetic-assets/${ownerSegment}/${identity.assetId}/${identity.assetVersionId}/source.${extension}`;
}

function extensionForFormat(format) {
  return {
    jpeg: 'jpg',
    'legacy-webp': 'webp',
    'lottie-json': 'json',
    'm4a-aac': 'm4a',
    mp4: 'mp4',
    png: 'png',
  }[format] || '';
}

function ascii(buffer, start, length) {
  return buffer.toString('ascii', start, start + length);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function positiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function invalid(reason) {
  return { ok: false, reason };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  CATEGORY_FORMATS,
  FORMAT_MIME_TYPES,
  buildCanonicalStoragePath,
  extensionForFormat,
  inspectCosmeticAssetBuffer,
  validateAssetIdentityDraft,
};
