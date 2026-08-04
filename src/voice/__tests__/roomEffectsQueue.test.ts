import { describe, expect, it } from 'vitest';

import {
  enqueueRoomEffect,
  mapRoomEventDocument,
  QueuedRoomEffect,
  removeRoomEffect,
  resolveViewerEffectMode,
  selectActiveRoomEffect,
} from '../roomEffectsQueue';

describe('roomEffectsQueue', () => {
  it('uses compact reduced-motion presentation and keeps a bounded priority queue', () => {
    expect(resolveViewerEffectMode({
      appReducedMotion: true,
      roomEffectsPolicy: 'full',
    })).toBe('reduced');
    expect(resolveViewerEffectMode({
      roomEffectsPolicy: 'reduced',
    })).toBe('reduced');

    const now = 1_000;
    let queue: QueuedRoomEffect[] = [];
    for (let index = 0; index < 10; index += 1) {
      queue = enqueueRoomEffect(queue, {
        durationMs: 4_000,
        eventId: `e-${index}`,
        expiresAtMs: now + 5_000,
        kind: index === 9 ? 'room-entry' : 'room-gift',
        label: `item-${index}`,
        priority: index,
      }, now);
    }
    expect(queue).toHaveLength(8);
    expect(selectActiveRoomEffect(queue, 'full', now)).toMatchObject({
      eventId: 'e-9',
      kind: 'room-entry',
      presentation: 'visual',
    });
    expect(selectActiveRoomEffect(queue, 'reduced', now)).toMatchObject({
      eventId: 'e-9',
      presentation: 'compact',
      thumbnailUrl: undefined,
    });
    expect(selectActiveRoomEffect(queue, 'off', now)?.kind).toBe('room-gift');
    expect(removeRoomEffect(queue, 'e-9')).toHaveLength(7);
  });

  it('maps validated room event documents and drops expired or malformed ones', () => {
    const now = 2_000;
    expect(mapRoomEventDocument({
      kind: 'room-entry',
      payload: {
        durationMs: 99_000,
        displayName: 'Ali',
        eventId: 'ree_1',
        expiresAtMs: now + 1_000,
        nameAr: 'سيارة',
        thumbnailUrl: 'https://cdn.example.test/car.png',
        roomId: 'room-1',
        senderUid: 'user-1',
      },
      priority: 3,
      roomId: 'room-1',
      status: 'ready',
    }, now, {
      enabledKinds: new Set(['room-entry']),
      expectedRoomId: 'room-1',
    })).toMatchObject({
      durationMs: 5_000,
      eventId: 'ree_1',
      kind: 'room-entry',
      label: 'Ali — سيارة',
    });
    expect(mapRoomEventDocument({
      kind: 'room-entry',
      payload: { eventId: 'ree_2', expiresAtMs: now - 1 },
      status: 'ready',
    }, now)).toBeNull();
    expect(mapRoomEventDocument({
      kind: 'room-entry',
      payload: { eventId: 'ree_3', expiresAtMs: now + 1_000, roomId: 'other-room' },
      roomId: 'other-room',
      status: 'ready',
    }, now, { expectedRoomId: 'room-1' })).toBeNull();
    expect(mapRoomEventDocument({
      kind: 'room-entry',
      payload: {
        eventId: 'ree_4',
        expiresAtMs: now + 1_000,
        roomId: 'room-1',
        senderUid: 'blocked-user',
      },
      roomId: 'room-1',
      status: 'ready',
    }, now, {
      blockedUids: new Set(['blocked-user']),
      expectedRoomId: 'room-1',
    })).toBeNull();
  });

  it('isolates disabled effect kinds and preserves compact gift text in off mode', () => {
    const now = 5_000;
    const gift = mapRoomEventDocument({
      eventId: 'gift_1',
      expiresAt: now + 8_000,
      kind: 'room-gift',
      payload: { eventId: 'gift_1', nameAr: 'وردة', roomId: 'room-1' },
      roomId: 'room-1',
      status: 'ready',
    }, now, {
      enabledKinds: new Set(['room-gift']),
      expectedRoomId: 'room-1',
    });
    expect(gift).toMatchObject({ durationMs: 3_000, kind: 'room-gift' });
    expect(selectActiveRoomEffect(gift ? [gift] : [], 'off', now)).toMatchObject({
      label: 'وردة',
      presentation: 'compact',
    });
    expect(mapRoomEventDocument({
      eventId: 'entry_1',
      expiresAt: now + 8_000,
      kind: 'room-entry',
      payload: { eventId: 'entry_1', roomId: 'room-1' },
      roomId: 'room-1',
      status: 'ready',
    }, now, {
      enabledKinds: new Set(['room-gift']),
      expectedRoomId: 'room-1',
    })).toBeNull();
  });

  it('maps a fresh Rocket goal event and strips artwork and sound in reduced mode', () => {
    const now = 10_000;
    const rocket = mapRoomEventDocument({
      appearance: {
        animationAsset: {
          durationMs: 4_000,
          format: 'animated-webp',
          uri: 'https://cdn.example.test/rocket.webp',
        },
        name: { ar: 'صاروخ الأسبوع', en: 'Weekly Rocket' },
        soundAsset: { format: 'mp3', uri: 'https://cdn.example.test/rocket.mp3' },
        staticAsset: { format: 'webp', uri: 'https://cdn.example.test/rocket-static.webp' },
      },
      eventId: 'rrg_event_1',
      occurredAt: now - 100,
      roomId: 'room-1',
      type: 'rocket-goal-crossed',
    }, now, {
      enabledKinds: new Set(['room-rocket']),
      expectedRoomId: 'room-1',
    });
    expect(rocket).toMatchObject({
      durationMs: 4_000,
      kind: 'room-rocket',
      label: 'صاروخ الأسبوع',
      priority: 4,
      soundUrl: 'https://cdn.example.test/rocket.mp3',
      thumbnailUrl: 'https://cdn.example.test/rocket.webp',
    });
    expect(selectActiveRoomEffect(rocket ? [rocket] : [], 'reduced', now)).toMatchObject({
      presentation: 'compact',
      soundUrl: undefined,
      thumbnailUrl: undefined,
    });
    expect(selectActiveRoomEffect(rocket ? [rocket] : [], 'off', now)).toBeNull();
  });

  it('maps canonical approved-asset references and ignores malformed identities', () => {
    const now = 20_000;
    const base = {
      eventId: 'gift_asset_1',
      expiresAt: now + 8_000,
      kind: 'room-gift',
      roomId: 'room-1',
      status: 'ready',
    };
    expect(mapRoomEventDocument({
      ...base,
      payload: {
        cosmeticAsset: {
          assetId: 'gift-motion',
          assetVersionId: 'v2-bbbbbbbbbbbb',
        },
        eventId: 'gift_asset_1',
        roomId: 'room-1',
      },
    }, now)).toMatchObject({
      assetId: 'gift-motion',
      assetVersionId: 'v2-bbbbbbbbbbbb',
    });
    expect(mapRoomEventDocument({
      ...base,
      eventId: 'gift_asset_2',
      payload: {
        cosmeticAsset: { assetId: '../unsafe', assetVersionId: 'latest' },
        eventId: 'gift_asset_2',
        roomId: 'room-1',
      },
    }, now)).not.toHaveProperty('assetId');
  });

  it('delivers global gifts only to campaign-eligible viewer rooms', () => {
    const now = 25_000;
    const event = {
      eventId: 'gift_global_1',
      expiresAt: now + 8_000,
      kind: 'room-gift',
      payload: {
        eventId: 'gift_global_1',
        globalAudience: { allowedRoomVisibilities: ['public'], countryCodes: ['IQ'] },
        presentationTier: 'global',
        roomId: 'source-room',
      },
      roomId: 'source-room',
      status: 'ready',
    };
    expect(mapRoomEventDocument(event, now, {
      globalEvent: true,
      viewerCountryCode: 'IQ',
      viewerRoomVisibility: 'public',
    })).toMatchObject({ giftPresentationTier: 'global' });
    expect(mapRoomEventDocument(event, now, {
      globalEvent: true,
      viewerCountryCode: 'JO',
      viewerRoomVisibility: 'public',
    })).toBeNull();
  });

  it('coalesces gift combos without restarting the active event identity', () => {
    const now = 30_000;
    const first: QueuedRoomEffect = {
      comboCount: 1,
      comboKey: 'sender-1:rose',
      durationMs: 3_000,
      eventId: 'gift_combo_1',
      expiresAtMs: now + 4_000,
      kind: 'room-gift',
      label: 'Rose',
      priority: 2,
    };
    const second: QueuedRoomEffect = {
      ...first,
      comboCount: 2,
      eventId: 'gift_combo_2',
      expiresAtMs: now + 6_000,
    };
    const queue = enqueueRoomEffect(enqueueRoomEffect([], first, now), second, now + 100);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      comboCount: 3,
      eventId: 'gift_combo_1',
      expiresAtMs: now + 6_000,
      label: 'Rose ×3',
    });
  });

  it('bounds a twenty-person entry burst deterministically and maps exact entry assets', () => {
    const now = 40_000;
    let queue: QueuedRoomEffect[] = [];
    for (let index = 0; index < 20; index += 1) {
      const mapped = mapRoomEventDocument({
        eventId: `entry_burst_${index}`,
        expiresAt: now + 10_000 + index,
        kind: 'room-entry',
        payload: {
          animationEnabled: true,
          cosmeticAsset: {
            assetId: `entry-car-${index}`,
            assetVersionId: 'v1-aaaaaaaaaaaa',
          },
          eventId: `entry_burst_${index}`,
          expiresAtMs: now + 10_000 + index,
          roomId: 'room-1',
          senderUid: `user-${index}`,
        },
        priority: index % 2 ? 3 : 2,
        roomId: 'room-1',
        status: 'ready',
      }, now, { enabledKinds: new Set(['room-entry']), expectedRoomId: 'room-1' });
      if (mapped) queue = enqueueRoomEffect(queue, mapped, now);
    }
    expect(queue).toHaveLength(8);
    expect(queue.every((effect) => effect.priority === 3)).toBe(true);
    expect(queue.map((effect) => effect.eventId)).toEqual([
      'entry_burst_1', 'entry_burst_3', 'entry_burst_5', 'entry_burst_7',
      'entry_burst_9', 'entry_burst_11', 'entry_burst_13', 'entry_burst_15',
    ]);
    expect(queue[0]).toMatchObject({
      assetId: 'entry-car-1',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      animationEnabled: true,
    });
  });
});
