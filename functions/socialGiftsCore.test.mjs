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
});
