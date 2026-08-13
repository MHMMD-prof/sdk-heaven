import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildCoupleEntryCopySnapshot,
  buildEntryEffectCopySnapshot,
  buildGiftEffectCopySnapshot,
  resolveRoomEffectSurface,
} = require('./roomEffectPresentationCore');

describe('room effect event presentation snapshots', () => {
  it('authors bounded entry and couple identities', () => {
    expect(buildEntryEffectCopySnapshot({
      displayName: '  Ahmed\n',
      itemNameAr: 'الطائرة',
      itemNameEn: 'Plane',
    })).toEqual({
      entrantDisplayNames: ['Ahmed'],
      itemName: { ar: 'الطائرة', en: 'Plane' },
      kind: 'entry',
      schemaVersion: 1,
    });
    expect(buildCoupleEntryCopySnapshot({ memberDisplayNames: ['Ahmed', 'Sara'] }))
      .toMatchObject({ entrantDisplayNames: ['Ahmed', 'Sara'], kind: 'couple-entry' });
  });

  it('authors gift actor, item, quantity, and recipient', () => {
    expect(buildGiftEffectCopySnapshot({
      giftNameAr: 'طائرة',
      quantity: 3,
      recipientDisplayName: 'Sara',
      senderDisplayName: 'Ahmed',
    })).toEqual({
      itemName: { ar: 'طائرة' },
      kind: 'gift',
      quantity: 3,
      recipientDisplayName: 'Sara',
      schemaVersion: 1,
      senderDisplayName: 'Ahmed',
    });
  });

  it('uses deterministic surfaces instead of arbitrary coordinates', () => {
    expect(resolveRoomEffectSurface('room-entry')).toBe('bottom-stage');
    expect(resolveRoomEffectSurface('room-gift', 'inline')).toBe('compact');
    expect(resolveRoomEffectSurface('room-gift', 'targeted')).toBe('target-seat');
    expect(resolveRoomEffectSurface('room-gift', 'major')).toBe('bottom-stage');
    expect(resolveRoomEffectSurface('room-gift', 'global')).toBe('bottom-stage');
  });
});
