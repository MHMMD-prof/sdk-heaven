import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_DURATION_MS,
  EFFECT_TTL_MS,
  compareClientVersions,
  createCoupleEntryEffectEventId,
  createEntryEffectEventId,
  mapCarEntryEffectMetadata,
  normalizeRoomEntryEffectBody,
  resolveEntryEffectAnnouncement,
  resolveCoupleEntryEffect,
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
      animationEnabled: false,
      copy: {
        entrantDisplayNames: ['Ali'],
        kind: 'entry',
        schemaVersion: 1,
      },
      durationMs: DEFAULT_DURATION_MS,
      expiresAtMs: nowMs + EFFECT_TTL_MS,
      kind: 'room-entry',
      itemId: 'car-1',
      presentationSurface: 'bottom-stage',
      sessionId: 'presence_session_0001',
    });
    expect(resolveEntryEffectAnnouncement(base).value.effect).not.toHaveProperty('cosmeticAsset');
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

  it('announces approved custom entry effects only when custom rendering is on', () => {
    const command = normalizeRoomEntryEffectBody({
      action: 'announce-entry-effect',
      clientVersion: '1.0.0',
      requestId: 'entryfx_request_custom01',
      roomId: 'room-1',
      sessionId: 'presence_session_custom',
    });
    const projection = {
      assetId: 'cu-en-aaaaaaaaaaaaaaaaaaaa',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      itemId: 'cu-en-aaaaaaaaaaaaaaaaaaaa',
      source: 'custom',
    };
    const checksum = 'a'.repeat(64);
    const customEntryRecords = {
      approval: {
        assetId: projection.assetId,
        assetVersionId: projection.assetVersionId,
        checksum,
        decision: 'approved',
      },
      fallback: {
        approval: {
          assetId: 'entry-fallback-static',
          assetVersionId: 'v1-bbbbbbbbbbbb',
          checksum: 'b'.repeat(64),
          decision: 'approved',
        },
        summary: {
          approvalId: 'entry-fallback-static__v1-bbbbbbbbbbbb',
          approvedVersionId: 'v1-bbbbbbbbbbbb',
          moderationStatus: 'approved',
          ownerType: 'platform',
          publicationStatus: 'published',
          publishedVersionId: 'v1-bbbbbbbbbbbb',
          renderingEnabled: true,
        },
        version: {
          assetId: 'entry-fallback-static',
          assetVersionId: 'v1-bbbbbbbbbbbb',
          category: 'entry-effect',
          format: 'png',
          ownerType: 'platform',
          sha256: 'b'.repeat(64),
          usage: 'static',
        },
      },
      ownership: {
        assetId: projection.assetId,
        assetVersionId: projection.assetVersionId,
        checksum,
        state: 'active',
        uid: 'user-1',
      },
      summary: {
        approvalId: `${projection.assetId}__${projection.assetVersionId}`,
        approvedVersionId: projection.assetVersionId,
        assetId: projection.assetId,
        moderationStatus: 'approved',
        ownerType: 'user',
        ownerUid: 'user-1',
        publicationStatus: 'published',
        publishedVersionId: projection.assetVersionId,
        renderingEnabled: true,
        visibility: 'owner-bound',
      },
      version: {
        assetId: projection.assetId,
        assetVersionId: projection.assetVersionId,
        category: 'entry-effect',
        contentType: 'application/json',
        durationMs: 4_000,
        fallbackAssetId: 'entry-fallback-static',
        fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
        format: 'lottie-json',
        height: 720,
        minimumClientVersion: '1.0.0',
        ownerType: 'user',
        ownerUid: 'user-1',
        performanceTier: 'standard',
        sha256: checksum,
        usage: 'one-shot',
        width: 1280,
      },
    };
    const announced = resolveEntryEffectAnnouncement({
      catalogData: {},
      catalogItem,
      command,
      cosmeticsFlags: {
        cosmetics_custom_rendering: true,
        room_entry_animations: true,
      },
      customEntryRecords,
      equipment: {
        customCosmetics: { entryEffect: projection },
        slots: { cars: 'car-1' },
      },
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
    });
    expect(announced.value.effect).toMatchObject({
      copy: {
        entrantDisplayNames: ['Ali'],
        itemName: { en: 'Custom entrance' },
        kind: 'entry',
      },
      customSource: true,
      itemId: projection.itemId,
      presentationSurface: 'bottom-stage',
      visualFormat: 'lottie-json',
      cosmeticAsset: {
        assetId: projection.assetId,
        assetVersionId: projection.assetVersionId,
      },
    });

    expect(resolveEntryEffectAnnouncement({
      catalogData: {},
      catalogItem,
      command,
      cosmeticsFlags: { cosmetics_custom_rendering: false, room_entry_animations: true },
      customEntryRecords,
      equipment: {
        customCosmetics: { entryEffect: projection },
        slots: { cars: 'car-1' },
      },
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
    }).value.effect).toMatchObject({
      itemId: 'car-1',
      legacyEquipmentSlot: 'cars',
    });

    expect(resolveEntryEffectAnnouncement({
      catalogData: {},
      catalogItem,
      command,
      cosmeticsFlags: {
        cosmetics_custom_rendering: true,
        room_entry_animations: true,
      },
      customEntryRecords: {
        ...customEntryRecords,
        ownership: { ...customEntryRecords.ownership, checksum: 'forged' },
      },
      equipment: {
        customCosmetics: { entryEffect: projection },
        slots: { cars: 'car-1' },
      },
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
    }).value.effect).toMatchObject({
      itemId: 'car-1',
      legacyEquipmentSlot: 'cars',
    });
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

  it('creates one deterministic couple event only inside the active entrance window', () => {
    const sessionIds = ['presence_session_0001', 'presence_session_0002'];
    const coupleIdHash = 'a'.repeat(64);
    expect(createCoupleEntryEffectEventId('room-1', coupleIdHash, sessionIds))
      .toBe(createCoupleEntryEffectEventId('room-1', coupleIdHash, [...sessionIds].reverse()));
    const projection = {
      assetId: 'couple-entry',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      borderMode: 'looping',
      coupleIdHash,
      entranceMode: 'one-shot',
      fallbackAssetId: 'couple-entry-static',
      fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
      format: 'lottie-json',
      itemId: 'couple-fx',
      profileMode: 'looping',
    };
    const base = {
      approvedDescriptor: {
        assetId: projection.assetId,
        assetVersionId: projection.assetVersionId,
        fallbackAssetId: projection.fallbackAssetId,
        fallbackAssetVersionId: projection.fallbackAssetVersionId,
        format: projection.format,
      },
      command: { roomId: 'room-1', sessionId: sessionIds[0] },
      cosmeticsFlags: { cosmetics_couple_effects: true, cosmetics_couple_entrances: true },
      equipment: {
        itemId: projection.itemId,
        memberUids: ['user-1', 'user-2'],
        projection,
        relationshipId: `rel_${'b'.repeat(40)}`,
        state: 'equipped',
      },
      featureFlags: { voice_room_entry_effects: true },
      memberProfiles: [
        { coupleEffect: projection, displayName: 'Ali', moderationStatus: 'active', uid: 'user-1' },
        { coupleEffect: projection, displayName: 'Noor', moderationStatus: 'active', uid: 'user-2' },
      ],
      memberUids: ['user-1', 'user-2'],
      nowMs,
      ownership: {
        equipped: true,
        itemId: projection.itemId,
        relationshipId: `rel_${'b'.repeat(40)}`,
        state: 'active',
      },
      partnerPresence: {
        joinedAt: timestamp(nowMs - 500),
        leaseExpiresAt: timestamp(nowMs + 30_000),
        sessionId: sessionIds[1],
        status: 'online',
      },
      presence: {
        joinedAt: timestamp(nowMs - 1_000),
        leaseExpiresAt: timestamp(nowMs + 30_000),
        sessionId: sessionIds[0],
        status: 'online',
      },
      relationship: {
        coupleIdHash,
        relationshipId: `rel_${'b'.repeat(40)}`,
      },
      room: { availability: 'active', effectsPolicy: 'full', status: 'active' },
    };
    expect(resolveCoupleEntryEffect(base)).toMatchObject({
      effect: {
        copy: {
          entrantDisplayNames: ['Ali', 'Noor'],
          kind: 'couple-entry',
          schemaVersion: 1,
        },
        coupleEntrance: true,
        memberUids: ['user-1', 'user-2'],
        presentationSurface: 'bottom-stage',
      },
      eligible: true,
    });
    expect(resolveCoupleEntryEffect({
      ...base,
      partnerPresence: { ...base.partnerPresence, joinedAt: timestamp(nowMs - 8_001) },
    })).toMatchObject({ eligible: false });
    expect(resolveCoupleEntryEffect({
      ...base,
      cosmeticsFlags: { ...base.cosmeticsFlags, cosmetics_couple_entrances: false },
    })).toMatchObject({ eligible: false });
  });
});

function timestamp(value) {
  return { toMillis: () => value };
}
