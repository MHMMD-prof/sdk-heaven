import { describe, expect, it } from 'vitest';

import {
  areRoomGiftComboEffectsCompatible,
  completeRoomEffectIfActive,
  enqueueRoomEffect,
  enqueueRoomEffectWithOutcome,
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

  it('ignores a late completion callback from a preempted effect', () => {
    const now = 1_000;
    const low = queueEffect('low', 1, now);
    const high = queueEffect('high', 4, now);
    const queue = enqueueRoomEffect(enqueueRoomEffect([], low, now), high, now);
    expect(completeRoomEffectIfActive(queue, 'low', 'full', now)).toBe(queue);
    expect(completeRoomEffectIfActive(queue, 'high', 'full', now).map((item) => item.eventId))
      .toEqual(['low']);
  });

  it('reports queue drops and combo updates for every enqueue path', () => {
    const now = 1_000;
    const fullQueue = Array.from({ length: 8 }, (_, index) => queueEffect(
      `kept-${index}`,
      4,
      now,
    ));
    const dropped = enqueueRoomEffectWithOutcome(fullQueue, queueEffect('dropped', 0, now), now);
    expect(dropped.dropped).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({ eventId: 'dropped' }),
        reason: 'priority-cap',
      }),
    ]);

    const comboBase = {
      ...queueEffect('combo-1', 3, now),
      comboKey: 'combo-key',
      giftId: 'gift-1',
      giftPresentationTier: 'major' as const,
      senderUid: 'sender-1',
      recipientUid: 'recipient-1',
      surface: 'bottom-stage' as const,
    };
    const combo = enqueueRoomEffectWithOutcome([comboBase], {
      ...comboBase,
      eventId: 'combo-2',
    }, now);
    expect(combo.comboUpdate).toBe(true);
    expect(combo.queue).toHaveLength(1);
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
        presentationSurface: 'full-overlay',
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
      label: 'Ali دخل إلى الغرفة باستخدام سيارة',
      surface: 'bottom-stage',
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
      label: 'عضو أرسل وردة إلى عضو',
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
      posterUrl: 'https://cdn.example.test/rocket-static.webp',
      soundUrl: 'https://cdn.example.test/rocket.mp3',
      thumbnailUrl: 'https://cdn.example.test/rocket.webp',
      visualFormat: 'animated-webp',
    });
    expect(selectActiveRoomEffect(rocket ? [rocket] : [], 'reduced', now)).toMatchObject({
      presentation: 'compact',
      posterUrl: undefined,
      soundUrl: undefined,
      thumbnailUrl: undefined,
    });
    expect(selectActiveRoomEffect(rocket ? [rocket] : [], 'off', now)).toBeNull();
  });

  it('maps mp4 rocket motion format through the queue', () => {
    const now = 10_000;
    const rocket = mapRoomEventDocument({
      appearance: {
        animationAsset: {
          durationMs: 3_500,
          format: 'mp4',
          uri: 'https://cdn.example.test/rocket.mp4',
        },
        name: { ar: 'صاروخ', en: 'Rocket' },
        staticAsset: { format: 'webp', uri: 'https://cdn.example.test/rocket-static.webp' },
      },
      eventId: 'rrg_event_mp4',
      occurredAt: now - 50,
      roomId: 'room-1',
      type: 'rocket-goal-crossed',
    }, now, {
      enabledKinds: new Set(['room-rocket']),
      expectedRoomId: 'room-1',
    });
    expect(rocket).toMatchObject({
      durationMs: 3_500,
      thumbnailUrl: 'https://cdn.example.test/rocket.mp4',
      visualFormat: 'mp4',
    });
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

  it('prefers versioned copy snapshots and derives the surface instead of trusting layout input', () => {
    const now = 22_000;
    expect(mapRoomEventDocument({
      eventId: 'gift_copy_1',
      expiresAt: now + 8_000,
      kind: 'room-gift',
      payload: {
        copy: {
          itemName: { ar: 'طائرة', en: 'Plane' },
          kind: 'gift',
          quantity: 3,
          recipientDisplayName: 'Sara',
          schemaVersion: 1,
          senderDisplayName: 'Ahmed',
        },
        eventId: 'gift_copy_1',
        nameAr: 'اسم قديم',
        presentationSurface: 'full-overlay',
        presentationTier: 'major',
        recipientDisplayName: 'Forged legacy recipient',
        roomId: 'room-1',
        senderDisplayName: 'Forged legacy sender',
      },
      roomId: 'room-1',
      status: 'ready',
    }, now)).toMatchObject({
      label: 'Ahmed أرسل طائرة ×3 إلى Sara',
      surface: 'bottom-stage',
    });
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

  it('maps all four gift tiers to their fixed surfaces with authoritative identities', () => {
    const now = 35_000;
    const expected = {
      global: 'bottom-stage',
      inline: 'compact',
      major: 'bottom-stage',
      targeted: 'target-seat',
    } as const;
    for (const [tier, surface] of Object.entries(expected)) {
      const mapped = mapRoomEventDocument({
        eventId: `gift_tier_${tier}`,
        expiresAt: now + 8_000,
        kind: 'room-gift',
        payload: {
          copy: {
            itemName: { ar: 'وردة', en: 'Rose' },
            kind: 'gift',
            quantity: 3,
            recipientDisplayName: 'Sara',
            schemaVersion: 1,
            senderDisplayName: 'Ahmed',
          },
          eventId: `gift_tier_${tier}`,
          expiresAtMs: now + 8_000,
          giftId: 'rose',
          presentationTier: tier,
          quantity: 3,
          recipientUid: 'recipient-1',
          roomId: 'room-1',
          senderUid: 'sender-1',
        },
        roomId: 'room-1',
        status: 'ready',
      }, now, { enabledKinds: new Set(['room-gift']), expectedRoomId: 'room-1' });
      expect(mapped).toMatchObject({
        giftId: 'rose',
        giftPresentationTier: tier,
        label: 'Ahmed أرسل وردة ×3 إلى Sara',
        recipientUid: 'recipient-1',
        senderUid: 'sender-1',
        surface,
      });
    }
  });

  it('merges only the same authoritative combo window and preserves media identity', () => {
    const now = 36_000;
    const first: QueuedRoomEffect = {
      animationEnabled: true,
      assetId: 'gift-motion',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      audioEnabled: true,
      comboCount: 2,
      comboKey: 'combo_sender_target_rose',
      comboSequence: 1,
      comboWindowId: 'gcw_aaaaaaaaaaaaaaaaaaaaaaaa',
      durationMs: 3_000,
      eventId: 'gift_window_1',
      expiresAtMs: now + 5_000,
      giftId: 'rose',
      giftPresentationTier: 'major',
      kind: 'room-gift',
      label: 'Ahmed أرسل وردة ×2 إلى Sara',
      priority: 3,
      recipientUid: 'target-1',
      senderUid: 'sender-1',
      surface: 'bottom-stage',
    };
    const compatible = {
      ...first,
      comboCount: 5,
      comboSequence: 2,
      eventId: 'gift_window_2',
      expiresAtMs: now + 7_000,
    };
    expect(areRoomGiftComboEffectsCompatible(first, compatible)).toBe(true);
    const merged = enqueueRoomEffect(enqueueRoomEffect([], first, now), compatible, now + 100);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      assetId: 'gift-motion',
      assetVersionId: 'v1-aaaaaaaaaaaa',
      comboCount: 5,
      comboSequence: 2,
      eventId: 'gift_window_1',
    });

    const nextWindow = {
      ...compatible,
      comboSequence: 1,
      comboWindowId: 'gcw_bbbbbbbbbbbbbbbbbbbbbbbb',
      eventId: 'gift_window_3',
    };
    expect(areRoomGiftComboEffectsCompatible(first, nextWindow)).toBe(false);
    expect(enqueueRoomEffect(merged, nextWindow, now + 200)).toHaveLength(2);
    expect(areRoomGiftComboEffectsCompatible(first, {
      ...compatible,
      eventId: 'gift_other_target',
      recipientUid: 'target-2',
    })).toBe(false);
  });

  it('drops a failed renderer queue item without mutating committed economy evidence', () => {
    const receipt = Object.freeze({ platformCredit: 20, recipientCredit: 180, senderDebit: 200 });
    const effect: QueuedRoomEffect = {
      durationMs: 3_000,
      eventId: 'gift_renderer_failed',
      expiresAtMs: 50_000,
      giftPresentationTier: 'major',
      kind: 'room-gift',
      label: 'Gift',
      priority: 3,
      surface: 'bottom-stage',
    };
    expect(removeRoomEffect([effect], effect.eventId)).toEqual([]);
    expect(receipt).toEqual({ platformCredit: 20, recipientCredit: 180, senderDebit: 200 });
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

  it('preserves customSource on mapped room-entry events', () => {
    const mapped = mapRoomEventDocument({
      eventId: 'entry_custom_1',
      expiresAt: 50_000,
      kind: 'room-entry',
      payload: {
        animationEnabled: true,
        cosmeticAsset: {
          assetId: 'cu-en-aaaaaaaaaaaaaaaaaaaa',
          assetVersionId: 'v1-aaaaaaaaaaaa',
        },
        customSource: true,
        displayName: 'Ali',
        durationMs: 4_000,
        eventId: 'entry_custom_1',
        expiresAtMs: 50_000,
        nameAr: 'دخول مخصّص',
        roomId: 'room-1',
        senderUid: 'user-1',
        visualFormat: 'lottie-json',
      },
      priority: 2,
      roomId: 'room-1',
      status: 'ready',
    }, 40_000, { enabledKinds: new Set(['room-entry']), expectedRoomId: 'room-1' });
    expect(mapped).toMatchObject({
      assetId: 'cu-en-aaaaaaaaaaaaaaaaaaaa',
      customSource: true,
      visualFormat: 'lottie-json',
    });
  });

  it('maps an approved canonical static entry fallback when motion is disabled', () => {
    const mapped = mapRoomEventDocument({
      createdAt: 45_001,
      eventId: 'entry_static_1',
      expiresAt: 55_000,
      kind: 'room-entry',
      payload: {
        animationEnabled: false,
        cosmeticAsset: {
          assetId: 'royal-entry-static',
          assetVersionId: 'v1-bbbbbbbbbbbb',
        },
        copy: {
          entrantDisplayNames: ['Ali'],
          itemName: { ar: 'سيارة الظل', en: 'Shadow Car' },
          kind: 'entry',
          schemaVersion: 1,
        },
        durationMs: 4_000,
        eventId: 'entry_static_1',
        expiresAtMs: 55_000,
        roomId: 'room-1',
        senderUid: 'user-1',
      },
      roomId: 'room-1',
      status: 'ready',
    }, 45_000, { enabledKinds: new Set(['room-entry']), expectedRoomId: 'room-1' });

    expect(mapped).toMatchObject({
      animationEnabled: false,
      assetId: 'royal-entry-static',
      assetVersionId: 'v1-bbbbbbbbbbbb',
      label: 'Ali دخل إلى الغرفة باستخدام سيارة الظل',
      occurredAtMs: 45_001,
      surface: 'bottom-stage',
    });
  });

  it('maps one exact couple entrance through the shared room-entry queue', () => {
    const now = 50_000;
    const document = {
      eventId: 'rce_pair_event_1',
      expiresAt: now + 10_000,
      kind: 'room-entry',
      payload: {
        animationEnabled: true,
        assetId: 'couple-entry',
        assetVersionId: 'v1-aaaaaaaaaaaa',
        coupleEntrance: true,
        durationMs: 4_000,
        eventId: 'rce_pair_event_1',
        expiresAtMs: now + 10_000,
        fallbackAssetId: 'couple-entry-static',
        fallbackAssetVersionId: 'v1-bbbbbbbbbbbb',
        format: 'lottie-json',
        memberDisplayNames: ['Ali', 'Noor'],
        memberUids: ['user-1', 'user-2'],
        roomId: 'room-1',
      },
      roomId: 'room-1',
      status: 'ready',
    };
    expect(mapRoomEventDocument(document, now, {
      coupleEntrancesEnabled: false,
      expectedRoomId: 'room-1',
    })).toBeNull();
    const mapped = mapRoomEventDocument(document, now, {
      coupleEntrancesEnabled: true,
      expectedRoomId: 'room-1',
    });
    expect(mapped).toMatchObject({
      assetId: 'couple-entry',
      coupleAssetFormat: 'lottie-json',
      coupleEntrance: true,
      fallbackAssetId: 'couple-entry-static',
      kind: 'room-entry',
      label: 'Ali وNoor دخلا إلى الغرفة معًا',
      surface: 'bottom-stage',
      participantUids: ['user-1', 'user-2'],
    });
    const queue = mapped
      ? enqueueRoomEffect(enqueueRoomEffect([], mapped, now), mapped, now + 1)
      : [];
    expect(queue).toHaveLength(1);
  });
});

function queueEffect(eventId: string, priority: number, now: number): QueuedRoomEffect {
  return {
    durationMs: 4_000,
    eventId,
    expiresAtMs: now + 5_000,
    kind: 'room-gift',
    label: eventId,
    priority,
  };
}
