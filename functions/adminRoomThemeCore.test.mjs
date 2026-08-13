import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAdminRoomThemeMutation,
} = require('./adminRoomThemeCore');

describe('adminRoomThemeCore', () => {
  it('accepts a fourth catalog theme without requiring a client rebuild', () => {
    const result = normalizeAdminRoomThemeMutation({
      expectedRevision: 0,
      manifest: manifest('desert-lanterns'),
      operation: 'publish',
      reason: 'Publish a fourth validated theme',
      requestId: 'theme_publish_request_0001',
      themeId: 'desert-lanterns',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        manifest: {
          manifestVersion: 1,
          publicationStatus: 'published',
          revision: 1,
          themeId: 'desert-lanterns',
        },
      },
    });
  });

  it('rejects occupied-user border fields because those belong to user equipment', () => {
    const candidate = manifest('desert-lanterns');
    candidate.assets.occupiedAvatarFrame = candidate.assets.emptySeatFrame;

    expect(normalizeAdminRoomThemeMutation({
      expectedRevision: 0,
      manifest: candidate,
      operation: 'save-draft',
      reason: 'Invalid occupied border',
      requestId: 'theme_draft_request_00001',
      themeId: 'desert-lanterns',
    })).toMatchObject({ ok: false });
  });

  it('preserves a responsive V3 scene during admin publication', () => {
    const candidate = manifest('desert-lanterns');
    const layouts = structuredClone(candidate.layouts);
    candidate.manifestVersion = 3;
    candidate.motion = { ambient: [], background: null };
    candidate.scene = {
      background: { fit: 'cover', focalX: 0.5, focalY: 0.42 },
      stage: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      profiles: {
        compact: { layouts: structuredClone(layouts) },
        standard: { layouts: structuredClone(layouts) },
        tall: { layouts: structuredClone(layouts) },
      },
    };

    expect(normalizeAdminRoomThemeMutation({
      expectedRevision: 2,
      manifest: candidate,
      operation: 'publish',
      reason: 'Publish responsive scene',
      requestId: 'theme_publish_request_0003',
      themeId: 'desert-lanterns',
    })).toMatchObject({
      ok: true,
      value: {
        manifest: {
          manifestVersion: 3,
          revision: 3,
          scene: { profiles: { compact: {}, standard: {}, tall: {} } },
        },
      },
    });
  });
});

function manifest(themeId) {
  const asset = { uri: 'https://cdn.example.com/desert-lanterns-v1.png', version: 1 };
  return {
    assets: {
      background: asset,
      badge: null,
      dock: null,
      drawer: null,
      emptySeatFrame: null,
      stage: null,
    },
    colors: {
      background: '#090505',
      gold: '#D8B56A',
      goldSoft: '#F0D99B',
      panel: '#160B0B',
      panelRaised: '#211010',
      ruby: '#7A1022',
      rubyBright: '#C92C43',
      text: '#FFF7E6',
      textMuted: '#C9B99B',
    },
    layouts: Object.fromEntries([5, 10, 15, 20].map((count) => [String(count), seats(count)])),
    manifestVersion: 1,
    minimumClientVersion: '1.0.0',
    publicationStatus: 'draft',
    purchasingEnabled: false,
    renderingEnabled: true,
    revision: 1,
    themeId,
  };
}

function seats(count) {
  const xs = [0.12, 0.31, 0.5, 0.69, 0.88];
  const ys = [0.14, 0.37, 0.6, 0.83];
  return Array.from({ length: count }, (_, index) => ({
    scale: 1,
    seatNumber: index + 1,
    x: xs[index % 5],
    y: ys[Math.floor(index / 5)],
    z: index,
  }));
}
