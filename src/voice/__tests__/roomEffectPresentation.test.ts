import { describe, expect, it } from 'vitest';

import {
  buildRoomEffectCopy,
  normalizeRoomEffectCopyInput,
  resolveRoomEffectSurface,
} from '../roomEffectPresentation';

describe('room effect presentation contract', () => {
  it('builds trusted Arabic and English entry copy', () => {
    const input = {
      entrantDisplayNames: ['Ahmed'],
      itemName: { ar: 'الطائرة', en: 'Plane' },
      kind: 'entry' as const,
      schemaVersion: 1 as const,
    };
    expect(buildRoomEffectCopy(input, 'ar')).toBe('Ahmed دخل إلى الغرفة باستخدام الطائرة');
    expect(buildRoomEffectCopy(input, 'en')).toBe('Ahmed entered the room using Plane');
  });

  it('explains who sent what, how many, and to whom', () => {
    const input = {
      itemName: { ar: 'طائرة', en: 'Plane' },
      kind: 'gift' as const,
      quantity: 3,
      recipientDisplayName: 'Sara',
      schemaVersion: 1 as const,
      senderDisplayName: 'Ahmed',
    };
    expect(buildRoomEffectCopy(input, 'ar')).toBe('Ahmed أرسل طائرة ×3 إلى Sara');
    expect(buildRoomEffectCopy(input, 'en')).toBe('Ahmed sent Plane ×3 to Sara');
  });

  it('builds couple copy and bounded neutral fallbacks', () => {
    expect(buildRoomEffectCopy({
      entrantDisplayNames: ['Ahmed', 'Sara'],
      kind: 'couple-entry',
      schemaVersion: 1,
    }, 'ar')).toBe('Ahmed وSara دخلا إلى الغرفة معًا');
    expect(buildRoomEffectCopy({
      itemName: { en: 'Rose' },
      kind: 'gift',
      quantity: 1,
      recipientDisplayName: '',
      schemaVersion: 1,
      senderDisplayName: '',
    }, 'en')).toBe('Member sent Rose to Member');
  });

  it('normalizes strict snapshots and rejects malformed or spoofed input', () => {
    expect(normalizeRoomEffectCopyInput({
      entrantDisplayNames: ['  Ahmed\n<script>  '],
      itemName: { en: ' Plane ' },
      kind: 'entry',
      schemaVersion: 1,
    })).toEqual({
      entrantDisplayNames: ['Ahmed<script>'],
      itemName: { en: 'Plane' },
      kind: 'entry',
      schemaVersion: 1,
    });
    expect(normalizeRoomEffectCopyInput({
      kind: 'gift',
      quantity: 1_000,
      schemaVersion: 1,
    })).toBeUndefined();
    expect(normalizeRoomEffectCopyInput({
      html: '<b>forged</b>',
      kind: 'entry',
      schemaVersion: 1,
    })).toBeUndefined();
  });

  it('maps only entries and major/global gifts to the bottom stage', () => {
    expect(resolveRoomEffectSurface('room-entry')).toBe('bottom-stage');
    expect(resolveRoomEffectSurface('room-gift', 'inline')).toBe('compact');
    expect(resolveRoomEffectSurface('room-gift', 'targeted')).toBe('target-seat');
    expect(resolveRoomEffectSurface('room-gift', 'major')).toBe('bottom-stage');
    expect(resolveRoomEffectSurface('room-gift', 'global')).toBe('bottom-stage');
    expect(resolveRoomEffectSurface('room-rocket')).toBe('full-overlay');
  });
});
