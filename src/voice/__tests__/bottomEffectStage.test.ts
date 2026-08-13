import { describe, expect, it, vi } from 'vitest';

import {
  BOTTOM_EFFECT_STAGE_LAYER,
  BOTTOM_EFFECT_POINTER_EVENTS,
  ROOM_DOCK_LAYER,
  ROOM_INTERACTIVE_LAYER,
  ROOM_SAFETY_LAYER,
  claimBottomEffectCompletion,
  claimBottomEffectStageOutcome,
  resolveBottomEffectCompletionDelay,
  resolveBottomEffectStageAssetSelection,
  resolveBottomEffectStageCopy,
  resolveBottomEffectStageGeometry,
  resolveBottomEffectStageIdentities,
  resolveBottomEffectStagePresentation,
} from '../bottomEffectStage';
import type { QueuedRoomEffect } from '../roomEffectsQueue';

describe('bottom effect stage contract', () => {
  it('anchors above the dock and grows with the device safe area', () => {
    const withoutInset = resolveBottomEffectStageGeometry({
      safeAreaBottom: 0,
      viewportHeight: 844,
      viewportWidth: 390,
    });
    const withInset = resolveBottomEffectStageGeometry({
      safeAreaBottom: 34,
      viewportHeight: 844,
      viewportWidth: 390,
    });

    expect(withoutInset).toMatchObject({ bottom: 100, height: 281, left: -16, right: -16, width: 390 });
    expect(withInset.bottom).toBe(126);
    expect(withInset.bottom - withoutInset.bottom).toBe(26);
  });

  it('bounds stage height on short and wide viewports', () => {
    expect(resolveBottomEffectStageGeometry({
      safeAreaBottom: 0,
      viewportHeight: 420,
      viewportWidth: 500,
    }).height).toBe(185);
    expect(resolveBottomEffectStageGeometry({
      safeAreaBottom: 0,
      viewportHeight: 1_200,
      viewportWidth: 900,
    }).height).toBe(360);
  });

  it('keeps room interactions, safety UI, and the dock above the stage', () => {
    expect(BOTTOM_EFFECT_POINTER_EVENTS).toBe('none');
    expect(BOTTOM_EFFECT_STAGE_LAYER).toBeLessThan(ROOM_INTERACTIVE_LAYER);
    expect(ROOM_INTERACTIVE_LAYER).toBeLessThan(ROOM_SAFETY_LAYER);
    expect(ROOM_SAFETY_LAYER).toBeLessThan(ROOM_DOCK_LAYER);
  });

  it('uses motion only in full mode and degrades safely in reduced/off modes', () => {
    expect(resolveBottomEffectStagePresentation('full', 'motion')).toBe('visual');
    expect(resolveBottomEffectStagePresentation('full', 'static')).toBe('static');
    expect(resolveBottomEffectStagePresentation('full', 'none')).toBe('static');
    expect(resolveBottomEffectStagePresentation('reduced', 'motion')).toBe('compact');
    expect(resolveBottomEffectStagePresentation('off', 'motion')).toBe('compact');
  });

  it('selects the approved static fallback when motion playback is disabled', () => {
    expect(resolveBottomEffectStageAssetSelection({
      hasCompatibility: true,
      hasFallback: true,
      motionAllowed: false,
      primaryFormat: 'lottie-json',
    })).toEqual({ media: 'static', source: 'fallback' });
    expect(resolveBottomEffectStageAssetSelection({
      hasCompatibility: false,
      hasFallback: false,
      motionAllowed: false,
      primaryFormat: 'png',
    })).toEqual({ media: 'static', source: 'primary' });
    expect(resolveBottomEffectStageAssetSelection({
      hasCompatibility: true,
      hasFallback: false,
      motionAllowed: false,
      primaryFormat: 'mp4',
    })).toEqual({ media: 'static', source: 'compatibility' });
  });

  it('renders trusted gift copy and sender/recipient identities', () => {
    const effect = giftEffect();
    expect(resolveBottomEffectStageCopy(effect)).toBe('Ahmed أرسل طائرة ×3 إلى Sara');
    expect(resolveBottomEffectStageIdentities(effect)).toEqual([
      { initial: 'A', key: 'sender', name: 'Ahmed', role: 'sender' },
      { initial: 'S', key: 'recipient', name: 'Sara', role: 'recipient' },
    ]);
  });

  it('renders both couple entrants and neutral legacy fallbacks', () => {
    const couple = baseEffect({
      copy: {
        entrantDisplayNames: ['Ahmed', 'سارة'],
        kind: 'couple-entry',
        schemaVersion: 1,
      },
      kind: 'room-entry',
    });
    expect(resolveBottomEffectStageCopy(couple)).toBe('Ahmed وسارة دخلا إلى الغرفة معًا');
    expect(resolveBottomEffectStageIdentities(couple).map((item) => item.initial)).toEqual(['A', 'س']);

    const legacy = baseEffect({ kind: 'room-entry', label: '', senderDisplayName: '' });
    expect(resolveBottomEffectStageCopy(legacy)).toBe('حدث في الغرفة');
    expect(resolveBottomEffectStageIdentities(legacy)[0]?.name).toBe('عضو');
  });

  it('uses the earlier authoritative duration or expiry deadline', () => {
    expect(resolveBottomEffectCompletionDelay({ durationMs: 4_000, expiresAtMs: 20_000, nowMs: 10_000 })).toBe(4_000);
    expect(resolveBottomEffectCompletionDelay({ durationMs: 4_000, expiresAtMs: 11_500, nowMs: 10_000 })).toBe(1_500);
    expect(resolveBottomEffectCompletionDelay({ durationMs: 4_000, expiresAtMs: 9_000, nowMs: 10_000 })).toBe(0);
  });

  it('settles media completion once and resets for the next queue item', () => {
    const completed = vi.fn();
    const state = { settled: false };
    if (claimBottomEffectCompletion(state, 'gift-1')) completed('media');
    if (claimBottomEffectCompletion(state, 'gift-1')) completed('timeout');
    if (claimBottomEffectCompletion(state, 'entry-2')) completed('media');

    expect(completed.mock.calls).toEqual([['media'], ['media']]);
  });

  it('records each render outcome once and resets for the next queue item', () => {
    const state = { recorded: new Set<'shown' | 'fallback' | 'failed'>() };

    expect(claimBottomEffectStageOutcome(state, 'gift-1', 'shown')).toBe(true);
    expect(claimBottomEffectStageOutcome(state, 'gift-1', 'shown')).toBe(false);
    expect(claimBottomEffectStageOutcome(state, 'gift-1', 'fallback')).toBe(true);
    expect(claimBottomEffectStageOutcome(state, 'entry-2', 'shown')).toBe(true);
    expect([...state.recorded]).toEqual(['shown']);
  });
});

function giftEffect(): QueuedRoomEffect {
  return baseEffect({
    copy: {
      itemName: { ar: 'طائرة', en: 'Plane' },
      kind: 'gift',
      quantity: 3,
      recipientDisplayName: 'Sara',
      schemaVersion: 1,
      senderDisplayName: 'Ahmed',
    },
    giftPresentationTier: 'major',
    kind: 'room-gift',
  });
}

function baseEffect(overrides: Partial<QueuedRoomEffect>): QueuedRoomEffect {
  return {
    durationMs: 4_000,
    eventId: 'effect-1',
    expiresAtMs: 20_000,
    kind: 'room-entry',
    label: 'legacy label',
    priority: 2,
    ...overrides,
  };
}
