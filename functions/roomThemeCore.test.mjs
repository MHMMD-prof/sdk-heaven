import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRoomThemeFingerprint,
  isClientVersionCompatible,
  normalizeRoomThemeBody,
  validateRoomThemeRequest,
} = require('./roomThemeCore');

describe('roomThemeCore', () => {
  it('normalizes and validates purchase, equip and inventory commands', () => {
    const purchase = normalizeRoomThemeBody({
      action: 'purchase-room-theme',
      applyTheme: true,
      clientVersion: '1.0.0',
      currency: 'diamonds',
      requestId: 'room_theme_request_0001',
      roomId: 'room-1',
      themeId: 'royal-theater',
    });
    expect(validateRoomThemeRequest(purchase)).toMatchObject({ ok: true });
    expect(validateRoomThemeRequest(normalizeRoomThemeBody({
      action: 'equip-room-theme',
      clientVersion: '1.0.0',
      requestId: 'room_theme_request_0002',
      roomId: 'room-1',
      themeId: 'ruby-constellation',
    }))).toMatchObject({ ok: true });
    expect(validateRoomThemeRequest(normalizeRoomThemeBody({
      action: 'get-room-theme-inventory',
      requestId: 'room_theme_request_0003',
      roomId: 'room-1',
    }))).toMatchObject({ ok: true });
  });

  it('binds idempotency to the room, theme, currency and apply choice', () => {
    const base = normalizeRoomThemeBody({
      action: 'purchase-room-theme',
      clientVersion: '1.0.0',
      currency: 'coins',
      requestId: 'room_theme_request_0004',
      roomId: 'room-1',
      themeId: 'royal-theater',
    });
    expect(buildRoomThemeFingerprint('owner-1', base)).not.toBe(
      buildRoomThemeFingerprint('owner-1', { ...base, roomId: 'room-2' }),
    );
    expect(buildRoomThemeFingerprint('owner-1', base)).not.toBe(
      buildRoomThemeFingerprint('owner-1', { ...base, currency: 'diamonds' }),
    );
  });

  it('uses semantic compatibility checks', () => {
    expect(isClientVersionCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isClientVersionCompatible('1.2.0', '1.10.0')).toBe(true);
    expect(isClientVersionCompatible('2.0.0', '1.99.0')).toBe(false);
    expect(isClientVersionCompatible('bad', '1.0.0')).toBe(false);
  });
});
