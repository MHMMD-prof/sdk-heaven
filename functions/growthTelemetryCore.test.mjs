import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildGrowthHealthSummary,
  createEmptyGrowthTelemetry,
  incrementGrowthTelemetry,
  mapGrowthTelemetry,
  normalizeGrowthTelemetryIncrement,
} = require('./growthTelemetryCore');

const fieldValue = {
  increment: (amount) => ({ __increment: amount }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

describe('growthTelemetryCore', () => {
  it('maps empty telemetry and rates', () => {
    expect(createEmptyGrowthTelemetry().giftGmvCoins).toBe(0);
    expect(mapGrowthTelemetry({
      emptyRoomJoins: 2,
      nonemptyRoomJoins: 8,
      matchAttempts: 10,
      matchRoomLandings: 4,
    })).toMatchObject({
      emptyRoomJoinRate: 0.2,
      matchToRoomRate: 0.4,
    });
  });

  it('rejects invalid increments', () => {
    expect(normalizeGrowthTelemetryIncrement({ key: 'nope' })).toMatchObject({ ok: false });
    expect(normalizeGrowthTelemetryIncrement({ amount: 0, key: 'giftGmvCoins' })).toMatchObject({ ok: false });
    expect(normalizeGrowthTelemetryIncrement({ amount: 5, key: 'vipConversions' })).toMatchObject({
      ok: true,
      value: { amount: 5, key: 'vipConversions' },
    });
  });

  it('increments counters on the runtime doc', async () => {
    const db = new FakeFirestore({});
    await expect(incrementGrowthTelemetry({
      db,
      fieldValue,
      input: { amount: 3, key: 'giftGmvCoins' },
    })).resolves.toMatchObject({ ok: true });
    expect(db.documents.get('appRuntime/growthTelemetry')).toMatchObject({
      giftGmvCoins: { __increment: 3 },
    });
  });

  it('builds overview growth health', () => {
    expect(buildGrowthHealthSummary({
      rollout: { stageId: 1, stageName: 'closed-beta' },
      telemetry: mapGrowthTelemetry({ emptyRoomJoins: 1, nonemptyRoomJoins: 1 }),
    })).toMatchObject({
      emptyRoomJoinRate: 0.5,
      stageId: 1,
      stageName: 'closed-beta',
    });
  });
});

class FakeFirestore {
  constructor(documents) { this.documents = new Map(Object.entries(documents)); }
  doc(path) {
    return {
      get: async () => ({
        data: () => this.documents.get(path),
        exists: this.documents.has(path),
      }),
      set: async (data, options) => {
        this.documents.set(path, options?.merge
          ? { ...(this.documents.get(path) || {}), ...data }
          : data);
      },
    };
  }
}
