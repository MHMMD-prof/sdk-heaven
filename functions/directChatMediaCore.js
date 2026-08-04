const crypto = require('node:crypto');

const DIRECT_CHAT_UPLOAD_TTL_MS = 10 * 60 * 1_000;
const DIRECT_CHAT_MEDIA_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const DIRECT_CHAT_MAX_VOICE_BYTES = 5 * 1024 * 1024;
const DIRECT_CHAT_MAX_VOICE_DURATION_MS = 120 * 1_000;
const DIRECT_CHAT_MAX_IMAGE_DIMENSION = 8_192;
const DIRECT_CHAT_DERIVATIVE_DIMENSION = 1_600;

function createDirectChatUploadId({ conversationId, requestId, uploaderUid }) {
  if (!/^[a-f0-9]{64}$/.test(conversationId || '') || !validId(requestId, 12, 80) || !validId(uploaderUid, 1, 128)) return '';
  const digest = crypto.createHash('sha256')
    .update(`direct-chat-upload-v1\0${conversationId}\0${uploaderUid}\0${requestId}`)
    .digest('hex');
  return `dmu_${digest.slice(0, 40)}`;
}

function directChatQuarantinePath(conversationId, uploadId) {
  return `direct-chat-quarantine/${conversationId}/${uploadId}/source`;
}

function directChatMediaPath(conversationId, uploadId, kind, contentType = '') {
  if (kind === 'image') return `direct-chat-media/${conversationId}/${uploadId}/image.webp`;
  if (kind === 'voice-note') return `direct-chat-media/${conversationId}/${uploadId}/voice.${contentType === 'audio/aac' ? 'aac' : 'm4a'}`;
  return '';
}

function validateUploadedObject({ authorization, metadata, nowMs }) {
  if (!authorization || authorization.state !== 'active' || timestampToMillis(authorization.expiresAt) <= nowMs) {
    return invalid('authorization-expired');
  }
  const size = Number(metadata?.size);
  const custom = metadata?.metadata || {};
  if (
    !Number.isSafeInteger(size)
    || size !== authorization.sizeBytes
    || metadata?.contentType !== authorization.contentType
    || custom.uploaderUid !== authorization.uid
    || custom.conversationId !== authorization.conversationId
    || custom.uploadId !== authorization.uploadId
    || custom.kind !== authorization.kind
  ) return invalid('metadata-mismatch');
  return { ok: true };
}

function validateImageMetadata(metadata, declaredContentType) {
  const expectedFormat = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[declaredContentType];
  if (
    !expectedFormat
    || metadata?.format !== expectedFormat
    || !Number.isSafeInteger(metadata.width)
    || !Number.isSafeInteger(metadata.height)
    || metadata.width < 1
    || metadata.height < 1
    || metadata.width > DIRECT_CHAT_MAX_IMAGE_DIMENSION
    || metadata.height > DIRECT_CHAT_MAX_IMAGE_DIMENSION
    || Number(metadata.pages || 1) !== 1
  ) return invalid('image-invalid');
  return { ok: true, value: { height: metadata.height, width: metadata.width } };
}

function inspectVoiceNote(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 7 || buffer.length > DIRECT_CHAT_MAX_VOICE_BYTES) return invalid('voice-invalid');
  const result = contentType === 'audio/aac' ? inspectAdts(buffer) : inspectM4a(buffer);
  if (!result.ok || result.value.durationMs < 1 || result.value.durationMs > DIRECT_CHAT_MAX_VOICE_DURATION_MS) return invalid('voice-invalid');
  return result;
}

function inspectAdts(buffer) {
  const sampleRates = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350];
  let offset = 0;
  let samples = 0;
  let sampleRate = 0;
  while (offset < buffer.length) {
    if (offset + 7 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xf6) !== 0xf0) return invalid('aac-sync');
    const index = (buffer[offset + 2] >> 2) & 0x0f;
    const currentRate = sampleRates[index] || 0;
    const channels = ((buffer[offset + 2] & 1) << 2) | ((buffer[offset + 3] >> 6) & 3);
    const frameLength = ((buffer[offset + 3] & 3) << 11) | (buffer[offset + 4] << 3) | ((buffer[offset + 5] >> 5) & 7);
    const headerLength = (buffer[offset + 1] & 1) === 1 ? 7 : 9;
    if (!currentRate || !channels || frameLength < headerLength || offset + frameLength > buffer.length) return invalid('aac-frame');
    if (sampleRate && sampleRate !== currentRate) return invalid('aac-rate-change');
    sampleRate = currentRate;
    samples += 1_024;
    offset += frameLength;
  }
  if (!sampleRate || offset !== buffer.length) return invalid('aac-invalid');
  return { ok: true, value: { codec: 'aac', container: 'adts', durationMs: Math.round((samples / sampleRate) * 1_000) } };
}

function inspectM4a(buffer) {
  const topLevel = parseMp4Boxes(buffer, 0, buffer.length);
  if (!topLevel.ok) return topLevel;
  const ftyp = topLevel.value.find((box) => box.type === 'ftyp');
  const moov = topLevel.value.find((box) => box.type === 'moov');
  const mdat = topLevel.value.find((box) => box.type === 'mdat');
  if (!ftyp || ftyp.start !== 0 || ftyp.size < 16 || !moov || !mdat || mdat.size <= 8) return invalid('m4a-signature');
  const majorBrand = buffer.toString('ascii', ftyp.start + 8, ftyp.start + 12);
  if (!['M4A ', 'isom', 'mp42', 'mp41'].includes(majorBrand)) return invalid('m4a-brand');
  const moovChildren = parseMp4Boxes(buffer, moov.start + 8, moov.end);
  if (!moovChildren.ok) return moovChildren;
  const mvhd = moovChildren.value.find((box) => box.type === 'mvhd');
  const stsd = findNestedMp4Box(buffer, moov, ['trak', 'mdia', 'minf', 'stbl', 'stsd']);
  if (!mvhd || !stsd || stsd.size < 24) return invalid('m4a-structure');
  const entries = parseMp4Boxes(buffer, stsd.start + 16, stsd.end);
  if (!entries.ok || !entries.value.some((box) => box.type === 'mp4a' && box.size >= 36)) return invalid('m4a-codec');
  const mvhdOffset = mvhd.start + 4;
  const atomSize = mvhd.size;
  if (atomSize < 32) return invalid('m4a-atom');
  const version = buffer[mvhdOffset + 4];
  let timescale;
  let duration;
  if (version === 0) {
    if (mvhdOffset + 24 > buffer.length) return invalid('m4a-duration');
    timescale = buffer.readUInt32BE(mvhdOffset + 16);
    duration = buffer.readUInt32BE(mvhdOffset + 20);
  } else if (version === 1) {
    if (mvhdOffset + 36 > buffer.length) return invalid('m4a-duration');
    timescale = buffer.readUInt32BE(mvhdOffset + 24);
    const durationBig = buffer.readBigUInt64BE(mvhdOffset + 28);
    duration = durationBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(durationBig) : 0;
  } else return invalid('m4a-version');
  if (!timescale || !duration) return invalid('m4a-duration');
  return { ok: true, value: { codec: 'aac', container: 'm4a', durationMs: Math.round((duration / timescale) * 1_000) } };
}

function findNestedMp4Box(buffer, root, path) {
  let current = root;
  for (const type of path) {
    const children = parseMp4Boxes(buffer, current.start + 8, current.end);
    if (!children.ok) return undefined;
    current = children.value.find((box) => box.type === type);
    if (!current) return undefined;
  }
  return current;
}

function parseMp4Boxes(buffer, start, end) {
  if (!Buffer.isBuffer(buffer) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > buffer.length || start > end) return invalid('m4a-box-range');
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) return invalid('m4a-box-header');
    let size = buffer.readUInt32BE(offset);
    if (size === 0) size = end - offset;
    if (size === 1 || size < 8 || offset + size > end) return invalid('m4a-box-size');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return invalid('m4a-box-type');
    boxes.push({ end: offset + size, size, start: offset, type });
    offset += size;
  }
  return offset === end ? { ok: true, value: boxes } : invalid('m4a-box-tail');
}

function resolveStickerEntitlement({ assetSummary, assetVersion, catalog, nowMs, ownership, stickerItemId, uid }) {
  const expiresAtMs = timestampToMillis(ownership?.expiresAt);
  if (
    !catalog
    || catalog.itemId !== stickerItemId
    || catalog.category !== 'stickers'
    || catalog.availability !== 'available'
    || !catalog.stickerAsset
    || typeof catalog.stickerAsset.assetId !== 'string'
    || typeof catalog.stickerAsset.assetVersionId !== 'string'
    || assetSummary?.assetId !== catalog.stickerAsset.assetId
    || assetSummary?.moderationStatus !== 'approved'
    || assetSummary?.publicationStatus !== 'published'
    || assetSummary?.renderingEnabled !== true
    || assetSummary?.publishedVersionId !== catalog.stickerAsset.assetVersionId
    || assetVersion?.assetId !== catalog.stickerAsset.assetId
    || assetVersion?.assetVersionId !== catalog.stickerAsset.assetVersionId
    || assetVersion?.category !== 'room-reaction'
    || !['png', 'lottie-json', 'legacy-webp'].includes(assetVersion?.format)
    || !ownership
    || ownership.uid !== uid
    || ownership.itemId !== stickerItemId
    || ownership.category !== 'stickers'
    || ownership.state !== 'active'
    || (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs)
  ) return invalid('sticker-unavailable');
  return {
    ok: true,
    value: {
      assetId: catalog.stickerAsset.assetId,
      assetVersionId: catalog.stickerAsset.assetVersionId,
      itemId: stickerItemId,
    },
  };
}

function safeAttachmentPreview(kind) {
  return { image: 'Photo', 'voice-note': 'Voice message', sticker: 'Sticker' }[kind] || 'Message';
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return Number.NaN;
}

function validId(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}

function invalid(reason) {
  return { ok: false, reason };
}

module.exports = {
  DIRECT_CHAT_DERIVATIVE_DIMENSION,
  DIRECT_CHAT_MAX_IMAGE_BYTES,
  DIRECT_CHAT_MAX_VOICE_BYTES,
  DIRECT_CHAT_MEDIA_RETENTION_MS,
  DIRECT_CHAT_UPLOAD_TTL_MS,
  createDirectChatUploadId,
  directChatMediaPath,
  directChatQuarantinePath,
  inspectVoiceNote,
  resolveStickerEntitlement,
  safeAttachmentPreview,
  validateImageMetadata,
  validateUploadedObject,
};
