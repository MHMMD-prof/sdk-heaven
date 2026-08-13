import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const {
  buildCanonicalStoragePath,
  inspectCosmeticAssetBuffer,
  validateAssetIdentityDraft,
} = require('./cosmeticsAssetValidationCore');

describe('cosmetics asset identity contract', () => {
  it('normalizes a platform Lottie draft and derives its immutable path', () => {
    const result = validateAssetIdentityDraft({
      assetId: 'gold-entry',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      category: 'entry-effect',
      fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
      format: 'lottie-json',
      loop: false,
      minimumClientVersion: '1.0.0',
      ownerType: 'platform',
      performanceTier: 'standard',
      slot: 'entry-effect',
      usage: 'one-shot',
    });

    expect(result.ok).toBe(true);
    expect(buildCanonicalStoragePath(result.value, 'json')).toBe(
      'cosmetic-assets/platform/gold-entry/v1-aaaaaaaaaaaa/source.json',
    );
  });

  it('binds custom assets to an owner and rejects missing fallbacks', () => {
    const invalidOwner = validateAssetIdentityDraft({
      assetId: 'custom-frame',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      category: 'avatar-frame',
      format: 'png',
      loop: false,
      minimumClientVersion: '1.0.0',
      ownerType: 'user',
      performanceTier: 'low',
      slot: 'avatar-frame',
      usage: 'static',
    });
    expect(invalidOwner.ok).toBe(false);

    const missingFallback = validateAssetIdentityDraft({
      assetId: 'entry-video',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      category: 'entry-effect',
      format: 'mp4',
      loop: false,
      minimumClientVersion: '1.0.0',
      ownerType: 'platform',
      performanceTier: 'high',
      slot: 'entry-effect',
      usage: 'one-shot',
    });
    expect(missingFallback.ok).toBe(false);
  });
});

describe('inspectCosmeticAssetBuffer', () => {
  it('sniffs PNG/JPEG bytes instead of trusting the content type', async () => {
    const png = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 64,
        width: 64,
      },
    }).png().toBuffer();

    await expect(inspectCosmeticAssetBuffer({
      buffer: png,
      category: 'avatar-frame',
      contentType: 'image/png',
      format: 'png',
      loop: false,
      usage: 'static',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        metadata: { height: 64, transparent: true, width: 64 },
      },
    });

    await expect(inspectCosmeticAssetBuffer({
      buffer: png,
      category: 'profile-skin',
      contentType: 'image/jpeg',
      format: 'jpeg',
      loop: false,
      usage: 'static',
    })).resolves.toMatchObject({ ok: false });
  });

  it('rejects Lottie external assets and accepts the bundled vector fixture', async () => {
    const fixture = Buffer.from(JSON.stringify(
      require('../assets/cosmetics-lab/wave0-ring.json'),
    ));
    await expect(inspectCosmeticAssetBuffer({
      buffer: fixture,
      category: 'avatar-frame',
      contentType: 'application/json',
      format: 'lottie-json',
      loop: true,
      usage: 'looping',
    })).resolves.toMatchObject({
      ok: true,
      value: { metadata: { frameRate: 30, transparent: true } },
    });

    const external = Buffer.from(JSON.stringify({
      assets: [{ p: 'https://example.test/pixel.png' }],
      fr: 30,
      h: 256,
      ip: 0,
      layers: [],
      op: 30,
      w: 256,
    }));
    await expect(inspectCosmeticAssetBuffer({
      buffer: external,
      category: 'avatar-frame',
      contentType: 'application/json',
      format: 'lottie-json',
      loop: true,
      usage: 'looping',
    })).resolves.toMatchObject({ ok: false });
  });

  it('accepts silent H.264 MP4 and rejects embedded AAC or HEVC', async () => {
    const h264 = mediaFile([
      track({ codec: 'avc1', duration: 5000, frameCount: 150, handler: 'vide', height: 720, width: 1280 }),
    ]);
    await expect(inspectCosmeticAssetBuffer({
      buffer: h264,
      category: 'gift-effect',
      contentType: 'video/mp4',
      format: 'mp4',
      loop: false,
      usage: 'one-shot',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        metadata: {
          audioCodec: '',
          durationMs: 5000,
          frameRate: 30,
          videoCodec: 'h264',
        },
      },
    });

    const embeddedAudio = mediaFile([
      track({ codec: 'avc1', duration: 5000, frameCount: 150, handler: 'vide', height: 720, width: 1280 }),
      track({ codec: 'mp4a', duration: 5000, frameCount: 0, handler: 'soun' }),
    ]);
    await expect(inspectCosmeticAssetBuffer({
      buffer: embeddedAudio,
      category: 'entry-effect',
      contentType: 'video/mp4',
      format: 'mp4',
      loop: false,
      usage: 'one-shot',
    })).resolves.toEqual({
      ok: false,
      reason: 'MP4 visual assets must be silent; publish approved M4A/AAC separately.',
    });

    const hevc = mediaFile([
      track({ codec: 'hvc1', duration: 5000, frameCount: 150, handler: 'vide', height: 720, width: 1280 }),
    ]);
    await expect(inspectCosmeticAssetBuffer({
      buffer: hevc,
      category: 'gift-effect',
      contentType: 'video/mp4',
      format: 'mp4',
      loop: false,
      usage: 'one-shot',
    })).resolves.toMatchObject({ ok: false });
  });

  it('accepts short AAC-only M4A and rejects a video-bearing audio file', async () => {
    const audio = mediaFile([
      track({ codec: 'mp4a', duration: 4000, frameCount: 0, handler: 'soun' }),
    ], 'M4A ');
    await expect(inspectCosmeticAssetBuffer({
      buffer: audio,
      category: 'effect-audio',
      contentType: 'audio/mp4',
      format: 'm4a-aac',
      loop: false,
      usage: 'one-shot',
    })).resolves.toMatchObject({
      ok: true,
      value: { metadata: { audioCodec: 'aac', durationMs: 4000 } },
    });

    const mixed = mediaFile([
      track({ codec: 'mp4a', duration: 4000, frameCount: 0, handler: 'soun' }),
      track({ codec: 'avc1', duration: 4000, frameCount: 120, handler: 'vide', height: 720, width: 1280 }),
    ], 'M4A ');
    await expect(inspectCosmeticAssetBuffer({
      buffer: mixed,
      category: 'effect-audio',
      contentType: 'audio/mp4',
      format: 'm4a-aac',
      loop: false,
      usage: 'one-shot',
    })).resolves.toMatchObject({ ok: false });
  });
});

function mediaFile(tracks, majorBrand = 'isom') {
  const ftyp = box('ftyp', Buffer.concat([
    Buffer.from(majorBrand, 'ascii'),
    u32(0),
    Buffer.from('isom', 'ascii'),
    Buffer.from('mp42', 'ascii'),
  ]));
  return Buffer.concat([ftyp, box('moov', Buffer.concat(tracks))]);
}

function track({ codec, duration, frameCount, handler, height = 0, width = 0 }) {
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, tkhd.length - 8);
  tkhd.writeUInt32BE(height * 65536, tkhd.length - 4);
  const mdhd = Buffer.alloc(20);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(duration, 16);
  const hdlr = Buffer.alloc(12);
  hdlr.write(handler, 8, 4, 'ascii');
  const stsd = Buffer.concat([
    Buffer.alloc(4),
    u32(1),
    box(codec, Buffer.alloc(16)),
  ]);
  const stts = Buffer.concat([
    Buffer.alloc(4),
    u32(1),
    u32(frameCount || 1),
    u32(duration / (frameCount || 1)),
  ]);
  return box('trak', Buffer.concat([
    box('tkhd', tkhd),
    box('mdia', Buffer.concat([
      box('mdhd', mdhd),
      box('hdlr', hdlr),
      box('minf', box('stbl', Buffer.concat([
        box('stsd', stsd),
        box('stts', stts),
      ]))),
    ])),
  ]));
}

function box(type, payload) {
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, 'ascii'), payload]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
