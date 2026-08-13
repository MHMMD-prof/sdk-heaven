import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MAX_ROOM_EFFECT_QUEUE,
  enqueueRoomEffect,
  resolveViewerEffectMode,
  selectActiveRoomEffect,
  type QueuedRoomEffect,
} from '../roomEffectsQueue';
import {
  BOTTOM_EFFECT_STAGE_LAYER,
  BOTTOM_EFFECT_POINTER_EVENTS,
  ROOM_DOCK_LAYER,
  ROOM_INTERACTIVE_LAYER,
  ROOM_SAFETY_LAYER,
  resolveBottomEffectCompletionDelay,
  resolveBottomEffectStageCopy,
} from '../bottomEffectStage';

describe('bottom effect stage Wave 6 automated acceptance', () => {
  it('leaves the shared audio session under LiveKit ownership', () => {
    const renderer = readFileSync(resolve(
      process.cwd(),
      'src/cosmetics/CosmeticAssetRenderer.tsx',
    ), 'utf8');
    const liveKit = readFileSync(resolve(
      process.cwd(),
      'src/voice/LiveKitVoiceClient.ts',
    ), 'utf8');

    expect(renderer).not.toContain('setAudioModeAsync');
    expect(renderer).not.toContain('onReady={() => undefined}');
    expect(liveKit).toContain('AudioSession.startAudioSession()');
    expect(liveKit).toContain('AudioSession.stopAudioSession()');
  });

  it('remounts the renderer for each queue event so late media callbacks stay isolated', () => {
    const screen = readFileSync(resolve(process.cwd(), 'src/screens/VoiceRoomScreen.tsx'), 'utf8');

    expect(screen).toContain('key={roomEffects.activeEffect.eventId}');
    expect(screen).toMatch(/completeActiveEffect\(\s*roomEffects\.activeEffect!\.eventId/);
  });

  it('bounds rapid bursts, deduplicates event IDs, and keeps priority ordering', () => {
    const now = 10_000;
    let queue: QueuedRoomEffect[] = [];
    for (let index = 0; index < 40; index += 1) {
      queue = enqueueRoomEffect(queue, effect(`event-${index}`, index % 5), now);
    }
    expect(queue).toHaveLength(MAX_ROOM_EFFECT_QUEUE);
    expect(queue.map((item) => item.priority)).toEqual([...queue]
      .map((item) => item.priority)
      .sort((left, right) => right - left));
    queue = enqueueRoomEffect(queue, effect(queue[0].eventId, 4), now);
    expect(new Set(queue.map((item) => item.eventId)).size).toBe(queue.length);
  });

  it('removes media and audio URLs under reduced motion, low memory, and off policy', () => {
    for (const mode of [
      resolveViewerEffectMode({ appReducedMotion: true }),
      resolveViewerEffectMode({ lowMemory: true }),
      resolveViewerEffectMode({ roomEffectsPolicy: 'off' }),
    ]) {
      const active = selectActiveRoomEffect([effect('event-1', 2)], mode, 10_000);
      expect(active).toMatchObject({ presentation: 'compact' });
      expect(active?.thumbnailUrl).toBeUndefined();
      expect(active?.posterUrl).toBeUndefined();
      expect(active?.soundUrl).toBeUndefined();
    }
  });

  it('cannot retain an expired stage or outlive the event lease', () => {
    expect(resolveBottomEffectCompletionDelay({
      durationMs: 6_000,
      expiresAtMs: 12_500,
      nowMs: 10_000,
    })).toBe(2_500);
    expect(selectActiveRoomEffect([effect('event-1', 2)], 'full', 30_001)).toBeNull();
  });

  it('keeps the stage non-interactive and below all protected room controls', () => {
    expect(BOTTOM_EFFECT_POINTER_EVENTS).toBe('none');
    expect(BOTTOM_EFFECT_STAGE_LAYER).toBeLessThan(ROOM_INTERACTIVE_LAYER);
    expect(ROOM_INTERACTIVE_LAYER).toBeLessThan(ROOM_SAFETY_LAYER);
    expect(ROOM_SAFETY_LAYER).toBeLessThan(ROOM_DOCK_LAYER);
  });

  it('preserves mixed RTL/LTR actor, action, item, quantity, and target copy', () => {
    const copy = resolveBottomEffectStageCopy(effect('gift-copy', 4, {
      copy: {
        itemName: { ar: 'طائرة VIP' },
        kind: 'gift',
        quantity: 3,
        recipientDisplayName: 'سارة Sara',
        schemaVersion: 1,
        senderDisplayName: 'Ahmed أحمد',
      },
    }));
    expect(copy).toContain('Ahmed أحمد');
    expect(copy).toContain('سارة Sara');
    expect(copy).toContain('طائرة VIP');
    expect(copy).toContain('3');
  });
});

function effect(
  eventId: string,
  priority: number,
  overrides: Partial<QueuedRoomEffect> = {},
): QueuedRoomEffect {
  return {
    durationMs: 4_000,
    eventId,
    expiresAtMs: 30_000,
    giftPresentationTier: 'major',
    kind: 'room-gift',
    label: 'هدية',
    priority,
    soundUrl: 'https://example.com/effect.m4a',
    thumbnailUrl: 'https://example.com/effect.mp4',
    posterUrl: 'https://example.com/effect.png',
    ...overrides,
  };
}
