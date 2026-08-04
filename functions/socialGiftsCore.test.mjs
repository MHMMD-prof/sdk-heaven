import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  mapGiftCatalogItem,
  normalizeAdminGiftCatalogInput,
  normalizeGiftCenterInput,
  normalizeSendGiftInput,
} = require('./socialGiftsCore');

describe('socialGiftsCore', () => {
  it('validates gift center targets and prevents self gifting', () => {
    expect(normalizeGiftCenterInput(undefined, 'self')).toEqual({ ok: true, value: { targetUid: '' } });
    expect(normalizeGiftCenterInput({ targetUid: 'target' }, 'self')).toEqual({ ok: true, value: { targetUid: 'target' } });
    expect(normalizeGiftCenterInput({ targetUid: 'self' }, 'self')).toMatchObject({ ok: false });
  });

  it('accepts bounded gift commands only', () => {
    expect(normalizeSendGiftInput({ giftId: 'royal_rose', message: 'مبارك', targetUid: 'target' }, 'self')).toMatchObject({ ok: true });
    expect(normalizeSendGiftInput({ giftId: 'Bad Gift', targetUid: 'target' }, 'self')).toMatchObject({ ok: false });
    expect(normalizeSendGiftInput({ giftId: 'rose', targetUid: 'self' }, 'self')).toMatchObject({ ok: false });
  });

  it('maps only supported server catalog items', () => {
    expect(mapGiftCatalogItem({ giftId: 'rose', iconKey: 'rose', nameAr: 'وردة ملكية', price: 20, scoreValue: 5, status: 'available' }))
      .toMatchObject({ giftId: 'rose', price: 20 });
    expect(mapGiftCatalogItem({ giftId: 'rose', iconKey: 'person', nameAr: 'شخص', price: 20, scoreValue: 5, status: 'available' }))
      .toBeUndefined();
  });

  it('requires an idempotency key for admin catalog operations', () => {
    expect(normalizeAdminGiftCatalogInput({
      giftId: 'rose', iconKey: 'rose', nameAr: 'وردة ملكية', price: 20,
      reason: 'تحديث السعر', requestId: 'admin_123456789', scoreValue: 5, status: 'available',
    })).toMatchObject({ ok: true });
    expect(normalizeAdminGiftCatalogInput({ giftId: 'rose', iconKey: 'rose', nameAr: 'وردة', price: 20, scoreValue: 5, status: 'available' }))
      .toMatchObject({ ok: false });
  });

  it('keeps animation off by default and requires both physical-device approvals', () => {
    const base = {
      giftId: 'rose', iconKey: 'rose', nameAr: 'وردة ملكية', price: 20,
      reason: 'إضافة العرض', requestId: 'admin_123456789', scoreValue: 5, status: 'available',
    };
    expect(normalizeAdminGiftCatalogInput(base)).toMatchObject({
      ok: true,
      value: { presentation: { animationEnabled: false, tier: 'inline' } },
    });
    const animated = {
      ...base,
      presentation: {
        animationEnabled: true,
        durationMs: 3000,
        fallbackAsset: { assetId: 'gift-fallback', assetVersionId: 'v1-bbbbbbbbbbbb' },
        hapticPolicy: 'light',
        minimumClientVersion: '1.0.0',
        performanceTier: 'standard',
        soundPolicy: 'off',
        tier: 'targeted',
        visualAsset: { assetId: 'gift-motion', assetVersionId: 'v1-aaaaaaaaaaaa' },
      },
    };
    expect(normalizeAdminGiftCatalogInput(animated)).toMatchObject({ ok: false });
    expect(normalizeAdminGiftCatalogInput({
      ...animated,
      physicalApproval: {
        androidDevice: 'Pixel 9',
        androidPassed: true,
        iosDevice: 'iPhone 16',
        iosPassed: true,
        notes: 'Voice coexistence passed',
        testedClientVersion: '1.0.0',
      },
    })).toMatchObject({
      ok: true,
      value: {
        physicalApproval: { androidPassed: true, iosPassed: true },
        presentation: {
          animationEnabled: true,
          physicalApprovalReceiptId: expect.stringMatching(/^gift_physical_/),
          tier: 'targeted',
        },
      },
    });
  });
});
