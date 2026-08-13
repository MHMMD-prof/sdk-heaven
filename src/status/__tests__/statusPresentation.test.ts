import { describe, expect, it } from 'vitest';

import { compactStatusBadges, mapStatusPresentation, statusAsset } from '../statusPresentation';

const presentation = {
  schemaVersion: 1,
  visibility: 'public',
  vip: {
    accentColor: '#22A978',
    assets: { badge: { assetId: 'svip-badge', assetVersionId: 'v1-123456789abc' } },
    band: 'svip',
    catalogVersion: 'vip-2026-01',
    id: 'svip-4',
    level: 4,
    nameAr: 'SVIP 4',
    nameEn: 'SVIP 4',
    order: 14,
  },
  aristocracy: {
    accentColor: '#D4AF37',
    assets: { entryEffect: { assetId: 'noble-entry', assetVersionId: 'v2-abcdef123456' } },
    catalogVersion: 'noble-2026-01',
    id: 'knight',
    nameAr: 'فارس',
    nameEn: 'Knight',
    order: 1,
  },
} as const;

describe('Wave 4 status presentation', () => {
  it('maps a bounded public projection and exposes at most two compact badges', () => {
    const mapped = mapStatusPresentation(presentation);
    expect(mapped).toEqual(presentation);
    expect(compactStatusBadges(mapped).map((badge) => badge.label)).toEqual(['SVIP 4', 'فارس']);
  });

  it('fails closed for arbitrary URLs, unknown fields, mismatched bands, and hidden leaks', () => {
    expect(mapStatusPresentation({ ...presentation, priceCoins: 10 })).toBeUndefined();
    expect(mapStatusPresentation({ ...presentation, vip: { ...presentation.vip, id: 'vip-4' } })).toBeUndefined();
    expect(mapStatusPresentation({ schemaVersion: 1, visibility: 'hidden', vip: presentation.vip })).toBeUndefined();
    expect(mapStatusPresentation({ ...presentation, aristocracy: { ...presentation.aristocracy, assets: { entryEffect: { url: 'https://evil.test/x' } } } })).toBeUndefined();
  });

  it('prefers Aristocracy for a shared benefit slot and removes all slots on expiry projection', () => {
    const mapped = mapStatusPresentation(presentation);
    expect(statusAsset(mapped, 'entryEffect')).toEqual({ assetId: 'noble-entry', assetVersionId: 'v2-abcdef123456' });
    expect(statusAsset(mapStatusPresentation({ schemaVersion: 1, visibility: 'public' }), 'entryEffect')).toBeUndefined();
  });
});
