import { beforeEach, describe, expect, it } from 'vitest';

import {
  getCosmeticsRuntimeEvents,
  recordBottomEffectStageRuntimeEvent,
  recordCosmeticsRuntimeEvent,
  recordPairRuntimeEvent,
  resetCosmeticsRuntimeEventsForTests,
  summarizeCosmeticsRuntimeRates,
} from '../runtimeTelemetry';

describe('cosmetics runtime telemetry', () => {
  beforeEach(resetCosmeticsRuntimeEventsForTests);

  it('records only bounded non-sensitive asset metadata', () => {
    recordCosmeticsRuntimeEvent('download', {
      descriptor: {
        assetId: 'gift-motion',
        assetVersionId: 'v2-bbbbbbbbbbbb',
        category: 'gift-effect',
        format: 'lottie-json',
      },
      elapsedMs: 12.7,
      reason: 'cache-miss',
    });
    const [event] = getCosmeticsRuntimeEvents();
    expect(event).toMatchObject({
      assetId: 'gift-motion',
      elapsedMs: 13,
      event: 'download',
    });
    expect(event).not.toHaveProperty('uri');
    expect(event).not.toHaveProperty('storagePath');
  });

  it('caps the in-memory session buffer at one hundred events', () => {
    for (let index = 0; index < 105; index += 1) {
      recordCosmeticsRuntimeEvent('ready', { reason: String(index) });
    }
    expect(getCosmeticsRuntimeEvents()).toHaveLength(100);
    expect(getCosmeticsRuntimeEvents()[0].reason).toBe('5');
  });

  it('records pair outcomes without relationship or participant identity', () => {
    recordPairRuntimeEvent('pair-gate-fallback', 'invalid-pair');
    recordPairRuntimeEvent('pair-entrance-render');
    expect(getCosmeticsRuntimeEvents()).toEqual([
      expect.objectContaining({ event: 'pair-gate-fallback', reason: 'invalid-pair' }),
      expect.objectContaining({ event: 'pair-entrance-render' }),
    ]);
    for (const event of getCosmeticsRuntimeEvents()) {
      expect(event).not.toHaveProperty('uid');
      expect(event).not.toHaveProperty('coupleIdHash');
      expect(event).not.toHaveProperty('relationshipId');
      expect(event).not.toHaveProperty('eventId');
    }
  });

  it('records bottom-stage outcomes with a fixed redacted schema', () => {
    recordBottomEffectStageRuntimeEvent('bottom-stage-shown', {
      kind: 'gift',
      presentation: 'motion',
    });
    recordBottomEffectStageRuntimeEvent('bottom-stage-cancellation', {
      kind: 'entry',
      reason: 'participant-left',
    });
    recordBottomEffectStageRuntimeEvent('bottom-stage-queue-drop', {
      kind: 'gift',
      reason: 'sender-name-or-uid-must-not-pass-through',
    });
    expect(getCosmeticsRuntimeEvents()).toEqual([
      expect.objectContaining({
        event: 'bottom-stage-shown',
        kind: 'gift',
        presentation: 'motion',
      }),
      expect.objectContaining({
        event: 'bottom-stage-cancellation',
        kind: 'entry',
        reason: 'participant-left',
      }),
      expect.objectContaining({
        event: 'bottom-stage-queue-drop',
        kind: 'gift',
      }),
    ]);
    expect(getCosmeticsRuntimeEvents()[2]).not.toHaveProperty('reason');
    for (const event of getCosmeticsRuntimeEvents()) {
      expect(event).not.toHaveProperty('uid');
      expect(event).not.toHaveProperty('roomId');
      expect(event).not.toHaveProperty('eventId');
      expect(event).not.toHaveProperty('displayName');
    }
  });

  it('summarizes local rates without requiring a backend sink', () => {
    recordCosmeticsRuntimeEvent('ready');
    recordCosmeticsRuntimeEvent('fallback');
    recordCosmeticsRuntimeEvent('failure');
    recordCosmeticsRuntimeEvent('queue-expiry');
    recordCosmeticsRuntimeEvent('first-frame', { elapsedMs: 900 });
    expect(summarizeCosmeticsRuntimeRates()).toMatchObject({
      sampleCount: 5,
      firstFrameDelayP95Ms: 900,
    });
  });
});
