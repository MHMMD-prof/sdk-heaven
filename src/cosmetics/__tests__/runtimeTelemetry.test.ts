import { beforeEach, describe, expect, it } from 'vitest';

import {
  getCosmeticsRuntimeEvents,
  recordCosmeticsRuntimeEvent,
  resetCosmeticsRuntimeEventsForTests,
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
});
