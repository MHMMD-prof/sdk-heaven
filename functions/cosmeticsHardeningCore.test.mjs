import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COSMETICS_ALERT_THRESHOLDS,
  evaluateCosmeticsAlertThresholds,
  summarizeCosmeticsTelemetrySamples,
} = require('./cosmeticsHardeningCore');

describe('cosmeticsHardeningCore', () => {
  it('exposes fail-closed alert thresholds', () => {
    expect(COSMETICS_ALERT_THRESHOLDS).toMatchObject({
      assetFailureRate: 0.05,
      crashFreeSessionRatio: 0.995,
      firstFrameDelayMs: 1_500,
      fallbackRate: 0.15,
      memoryPressureRate: 0.05,
      queueExpiryRate: 0.10,
    });
  });

  it('summarizes rates and fires alerts when samples breach thresholds', () => {
    const samples = [
      ...Array.from({ length: 80 }, () => ({ event: 'ready' })),
      ...Array.from({ length: 20 }, () => ({ event: 'failure' })),
      ...Array.from({ length: 30 }, () => ({ event: 'fallback' })),
      { event: 'first-frame', elapsedMs: 2_400 },
      { event: 'first-frame', elapsedMs: 400 },
      ...Array.from({ length: 25 }, () => ({ event: 'queue-expiry' })),
      { event: 'memory-pressure' },
      { event: 'session-ok' },
      { event: 'session-crash' },
    ];
    const summary = summarizeCosmeticsTelemetrySamples(samples);
    expect(summary.assetFailureRate).toBeGreaterThan(0.05);
    expect(summary.firstFrameDelayP95Ms).toBe(2_400);
    const evaluated = evaluateCosmeticsAlertThresholds(samples);
    expect(evaluated.ok).toBe(false);
    expect(evaluated.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining([
      'ASSET_FAILURE_RATE',
      'FALLBACK_RATE',
      'FIRST_FRAME_DELAY',
      'QUEUE_EXPIRY_RATE',
      'MEMORY_PRESSURE_RATE',
      'CRASH_FREE_SESSION_RATIO',
    ]));
  });

  it('stays quiet for healthy samples including memory/crash stubs', () => {
    const samples = [
      ...Array.from({ length: 100 }, () => ({ event: 'ready' })),
      ...Array.from({ length: 100 }, () => ({ event: 'session-ok' })),
      { event: 'first-frame', elapsedMs: 200 },
      { event: 'first-frame', elapsedMs: 300 },
    ];
    expect(evaluateCosmeticsAlertThresholds(samples)).toMatchObject({ ok: true, alerts: [] });
  });
});
