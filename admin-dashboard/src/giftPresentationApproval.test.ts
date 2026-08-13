import { describe, expect, it } from 'vitest';

import type { AdminGiftCatalogItem } from './adminDashboardApi';
import { giftPresentationApprovalScope, isSameGiftPresentationApprovalScope } from './giftPresentationApproval';

const presentation: AdminGiftCatalogItem['presentation'] = {
  animationEnabled: true,
  approvalMode: 'strict',
  durationMs: 3_000,
  fallbackAsset: { assetId: 'gift-fallback', assetVersionId: 'v1-bbbbbbbbbbbb' },
  hapticPolicy: 'light',
  minimumClientVersion: '1.0.0',
  performanceTier: 'standard',
  physicalApprovalReceiptId: 'gift_physical_existing_receipt_0001',
  schemaVersion: 1,
  soundPolicy: 'off',
  tier: 'major',
  visualAsset: { assetId: 'gift-motion', assetVersionId: 'v1-aaaaaaaaaaaa' },
  visualFormat: 'mp4',
};

describe('gift presentation approval scope', () => {
  it('reuses a receipt only for the exact immutable presentation scope', () => {
    expect(isSameGiftPresentationApprovalScope(presentation, {
      ...presentation,
      physicalApprovalReceiptId: 'gift_physical_other_receipt_0002',
    })).toBe(true);
    expect(isSameGiftPresentationApprovalScope(presentation, { ...presentation, durationMs: 3_001 })).toBe(false);
    expect(isSameGiftPresentationApprovalScope(presentation, {
      ...presentation,
      fallbackAsset: { ...presentation.fallbackAsset!, assetVersionId: 'v2-cccccccccccc' },
    })).toBe(false);
  });

  it('includes every playback and asset field but no free-form display text', () => {
    const scope = giftPresentationApprovalScope(presentation);
    expect(scope).toContain('gift-motion');
    expect(scope).toContain('gift-fallback');
    expect(scope).toContain('major');
    expect(scope).not.toContain('physicalApprovalReceiptId');
  });
});
