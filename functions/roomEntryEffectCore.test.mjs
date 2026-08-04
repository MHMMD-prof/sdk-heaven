import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_DURATION_MS,
  EFFECT_TTL_MS,
  compareClientVersions,
  createEntryEffectEventId,
  mapCarEntryEffectMetadata,
  normalizeRoomEntryEffectBody,
  resolveEntryEffectAnnouncement,
  validateRoomEntryEffectRequest,
} = require('./roomEntryEffectCore');

const nowMs = 2_000_000_000_000;
const thumbnailUrl = 'https://firebasestorage.googleapis.com/v0/b/test/o/store-assets%2Fcar-1%2Fthumbnail%2Fversion_00000001';
const previewAssetUrl = 'https://firebasestorage.googleapis.com/v0/b/test/o/store-assets%2Fcar-1%2Fpreview%2Fversion_00000001';
const catalogItem = {
  availability: 'available',
  category: 'cars',
  itemId: 'car-1',
  name: { ar: 'سيارة ظل', en: 'Shadow Car' },
  previewAssetUrl,
  thumbnailUrl,
};

describe('roomEntryEffectCore', () => {
  it('validates announce commands', () => {
    expect(validateRoomEntryEffectRequest(normalizeRoomEntryEffectBody({
      action: 'announce-entry-effect',
      requestId: 'entryfx_request_00001',
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
    })).ok).toBe(true);
    expect(validateRoomEntryEffectRequest(normalizeRoomEntryEffectBody({
      action: 'announce-entry-effect',
      requestId: 'short',
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
    })).code).toBe('INVALID_REQUEST');
  });

  it('maps car metadata with static fallback defaults', () => {
    expect(mapCarEntryEffectMetadata({}, catalogItem)).toMatchObject({
      assetVersion: 'static-1',
      durationMs: DEFAULT_DURATION_MS,
      fallbackArtworkUrl: catalogItem.thumbnailUrl,
      soundPolicy: 'off',
    });
    expect(mapCarEntryEffectMetadata({
      entryEffectDurationMs: 99_000,
      entryEffectFallbackUrl: 'file:///unsafe.png',
      entryEffectHeight: 99_999,
      entryEffectWidth: 99_999,
    }, catalogItem)).toMatchObject({
      durationMs: 5_000,
      fallbackArtworkUrl: catalogItem.thumbnailUrl,
      height: 2_048,
      width: 2_048,
    });
  });

  it('announces once for equipped active cars and skips without equipment', () => {
    const command = normalizeRoomEntryEffectBody({
      action: 'announce-entry-effect',
      requestId: 'entryfx_request_00001',
      roomId: 'room-1',
      sessionId: 'presence_session_0001',
    });
    const base = {
      catalogData: {},
      catalogItem,
      command,
      equipment: { slots: { cars: 'car-1' } },
      featureFlags: { voice_room_entry_effects: true },
      nowMs,
      ownership: {
        category: 'cars',
        itemId: 'car-1',
        state: 'active',
        uid: 'user-1',
      },
      publicProfile: {
        displayName: 'Ali',
        moderationStatus: 'active',
        uid: 'user-1',
      },
      room: { availability: 'active', effectsPolicy: 'full', status: 'active' },
      senderUid: 'user-1',
    };

    expect(resolveEntryEffectAnnouncement(base).value.effect).toMatchObject({
      durationMs: DEFAULT_DURATION_MS,
      expiresAtMs: nowMs + EFFECT_TTL_MS,
      kind: 'room-entry',
      itemId: 'car-1',
      sessionId: 'presence_session_0001',
    });
    expect(resolveEntryEffectAnnouncement({
      ...base,
      equipment: { slots: {} },
    }).value).toEqual({ skipped: true, reason: 'NO_EQUIPPED_CAR' });
    expect(resolveEntryEffectAnnouncement({
      ...base,
      featureFlags: { voice_room_entry_effects: false },
    }).code).toBe('FEATURE_DISABLED');
    expect(resolveEntryEffectAnnouncement({
      ...base,
      room: { ...base.room, effectsPolicy: 'off' },
    }).value).toEqual({ skipped: true, reason: 'ROOM_EFFECTS_DISABLED' });
  });

  it('enforces minimum client versions and scopes event IDs to the entrant', () => {
    const command = normalizeRoomEntryEffectBody({
      action: 'announce-entry-effect',
      clientVersion: '1.0.0',
      requestId: 'entryfx_request_00002',
      roomId: 'room-1',
      sessionId: 'presence_session_0002',
    });
    const result = resolveEntryEffectAnnouncement({
      catalogData: { entryEffectMinimumClientVersion: '2.0.0' },
      catalogItem,
      command,
      equipment: { slots: { cars: 'car-1' } },
      featureFlags: { voice_room_entry_effects: true },
      nowMs,
      ownership: { category: 'cars', itemId: 'car-1', state: 'active', uid: 'user-1' },
      publicProfile: { displayName: 'Ali', moderationStatus: 'active', uid: 'user-1' },
      room: { availability: 'active', effectsPolicy: 'full', status: 'active' },
      senderUid: 'user-1',
    });
    expect(result).toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED', ok: false, status: 426 });
    expect(compareClientVersions('2.1.0', '2.0.9')).toBe(1);
    expect(createEntryEffectEventId('room-1', 'user-1', 'session-1'))
      .not.toBe(createEntryEffectEventId('room-1', 'user-2', 'session-1'));
  });
});
