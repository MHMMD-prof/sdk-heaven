import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createDirectChatUploadId,
  inspectVoiceNote,
  resolveStickerEntitlement,
  validateImageMetadata,
  validateUploadedObject,
} = require('./directChatMediaCore');

describe('directChatMediaCore', () => {
  it('creates deterministic separately scoped upload IDs', () => {
    const input = { conversationId: 'a'.repeat(64), requestId: 'upload_request_001', uploaderUid: 'uid-1' };
    expect(createDirectChatUploadId(input)).toMatch(/^dmu_[a-f0-9]{40}$/);
    expect(createDirectChatUploadId(input)).toBe(createDirectChatUploadId(input));
  });

  it('requires exact immutable upload metadata and a live authorization', () => {
    const authorization = {
      contentType: 'image/png', conversationId: 'conversation', expiresAt: 2_000,
      kind: 'image', sizeBytes: 10, state: 'active', uid: 'uid-1', uploadId: 'upload-1',
    };
    const metadata = { contentType: 'image/png', metadata: { conversationId: 'conversation', kind: 'image', uid: 'ignored', uploadId: 'upload-1', uploaderUid: 'uid-1' }, size: '10' };
    expect(validateUploadedObject({ authorization, metadata, nowMs: 1_000 })).toEqual({ ok: true });
    expect(validateUploadedObject({ authorization, metadata: { ...metadata, size: '11' }, nowMs: 1_000 })).toMatchObject({ ok: false });
    expect(validateUploadedObject({ authorization, metadata, nowMs: 2_000 })).toMatchObject({ ok: false });
  });

  it('rejects disguised, animated, and oversized-dimension images', () => {
    expect(validateImageMetadata({ format: 'png', height: 100, pages: 1, width: 100 }, 'image/png')).toMatchObject({ ok: true });
    expect(validateImageMetadata({ format: 'jpeg', height: 100, width: 100 }, 'image/png')).toMatchObject({ ok: false });
    expect(validateImageMetadata({ format: 'png', height: 100, pages: 2, width: 100 }, 'image/png')).toMatchObject({ ok: false });
    expect(validateImageMetadata({ format: 'png', height: 9_000, width: 100 }, 'image/png')).toMatchObject({ ok: false });
  });

  it('parses complete AAC ADTS frames and rejects malformed or overlong streams', () => {
    const frame = adtsFrame(100);
    expect(inspectVoiceNote(Buffer.concat([frame, frame]), 'audio/aac')).toMatchObject({ ok: true, value: { codec: 'aac', container: 'adts' } });
    expect(inspectVoiceNote(Buffer.from('not audio'), 'audio/aac')).toMatchObject({ ok: false });
    expect(inspectVoiceNote(Buffer.concat(Array.from({ length: 5_200 }, () => frame)), 'audio/aac')).toMatchObject({ ok: false });
  });

  it('reads version-one M4A duration from the container', () => {
    const ftyp = mp4Box('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42', 'binary'));
    const mvhdPayload = Buffer.alloc(40);
    mvhdPayload[0] = 1;
    mvhdPayload.writeUInt32BE(1_000, 20);
    mvhdPayload.writeBigUInt64BE(90_000n, 24);
    const mp4a = mp4Box('mp4a', Buffer.alloc(28));
    const stsd = mp4Box('stsd', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), mp4a]));
    const stbl = mp4Box('stbl', stsd);
    const minf = mp4Box('minf', stbl);
    const mdia = mp4Box('mdia', minf);
    const trak = mp4Box('trak', mdia);
    const moov = mp4Box('moov', Buffer.concat([mp4Box('mvhd', mvhdPayload), trak]));
    const m4a = Buffer.concat([ftyp, moov, mp4Box('mdat', Buffer.from([1, 2, 3]))]);
    expect(inspectVoiceNote(m4a, 'audio/mp4')).toMatchObject({ ok: true, value: { codec: 'aac', container: 'm4a', durationMs: 90_000 } });
    expect(inspectVoiceNote(Buffer.concat([ftyp, mp4Box('mdat', Buffer.from([1]))]), 'audio/mp4')).toMatchObject({ ok: false });
  });

  it('requires an active owned available sticker and returns only immutable asset identity', () => {
    const result = resolveStickerEntitlement({
      assetSummary: { assetId: 'sticker-ruby', moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: 'v1', renderingEnabled: true },
      assetVersion: { assetId: 'sticker-ruby', assetVersionId: 'v1', category: 'room-reaction', format: 'png' },
      catalog: { availability: 'available', category: 'stickers', itemId: 'ruby-heart', stickerAsset: { assetId: 'sticker-ruby', assetVersionId: 'v1' } },
      nowMs: 100,
      ownership: { category: 'stickers', itemId: 'ruby-heart', state: 'active', uid: 'uid-1' },
      stickerItemId: 'ruby-heart',
      uid: 'uid-1',
    });
    expect(result).toEqual({ ok: true, value: { assetId: 'sticker-ruby', assetVersionId: 'v1', itemId: 'ruby-heart' } });
    expect(resolveStickerEntitlement({ catalog: {}, nowMs: 100, ownership: {}, stickerItemId: 'ruby-heart', uid: 'uid-1' })).toMatchObject({ ok: false });
    expect(resolveStickerEntitlement({ assetSummary: { renderingEnabled: false }, assetVersion: {}, catalog: { availability: 'available', category: 'stickers', itemId: 'ruby-heart', stickerAsset: { assetId: 'sticker-ruby', assetVersionId: 'v1' } }, nowMs: 100, ownership: { category: 'stickers', itemId: 'ruby-heart', state: 'active', uid: 'uid-1' }, stickerItemId: 'ruby-heart', uid: 'uid-1' })).toMatchObject({ ok: false });
  });
});

function adtsFrame(payloadLength) {
  const length = 7 + payloadLength;
  const frame = Buffer.alloc(length);
  frame[0] = 0xff;
  frame[1] = 0xf1;
  frame[2] = 0x50;
  frame[3] = 0x80 | ((length >> 11) & 3);
  frame[4] = (length >> 3) & 0xff;
  frame[5] = ((length & 7) << 5) | 0x1f;
  frame[6] = 0xfc;
  return frame;
}

function mp4Box(type, payload) {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 'ascii');
  payload.copy(box, 8);
  return box;
}
