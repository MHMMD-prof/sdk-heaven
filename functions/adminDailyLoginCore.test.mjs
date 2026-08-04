import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  calculateDailyLoginLiability,
  normalizeAdminDailyLoginMutation,
  normalizeDailyLoginTemplate,
} = require('./adminDailyLoginCore');

describe('adminDailyLoginCore', () => {
  it('accepts one immutable seven-day Baghdad template', () => {
    const normalized = normalizeDailyLoginTemplate(template());
    expect(normalized).toMatchObject({
      minimumClientVersion: '1.2.3',
      schemaVersion: 1,
      timeZone: 'Asia/Baghdad',
    });
    expect(normalized.rewards).toHaveLength(7);
    expect(normalized.rewards[0]).toMatchObject({ day: 1, reward: { coins: 10 } });
    expect(normalizeDailyLoginTemplate({
      ...template(),
      rewards: template().rewards.slice(0, 6),
    })).toBeUndefined();
  });

  it('requires audited optimistic mutations and operation-specific fields', () => {
    expect(normalizeAdminDailyLoginMutation({
      expectedRevision: 3,
      operation: 'save-draft',
      reason: 'New retention campaign',
      requestId: 'request_12345678',
      template: template(),
    })).toMatchObject({ ok: true, value: { expectedRevision: 3, operation: 'save-draft' } });
    expect(normalizeAdminDailyLoginMutation({
      expectedRevision: 3,
      operation: 'set-claims-paused',
      reason: 'Economy review',
      requestId: 'request_12345678',
    })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminDailyLoginMutation({
      expectedRevision: 3,
      operation: 'rollback',
      reason: 'Return to known rewards',
      requestId: 'request_12345678',
      rollbackRevision: 0,
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('calculates full-cycle maximum liability for a requested audience', () => {
    const normalized = normalizeDailyLoginTemplate(template());
    expect(calculateDailyLoginLiability(normalized, 1_000)).toEqual({
      claimants: 1_000,
      coins: 280_000,
      diamonds: 28_000,
      items: 1_000,
    });
  });
});

function template() {
  return {
    minimumClientVersion: '1.2.3',
    rewards: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      reward: {
        coins: (index + 1) * 10,
        diamonds: index + 1,
        items: index === 6 ? [{
          duplicateFallback: { amount: 25, currency: 'coins' },
          itemId: 'golden-frame',
        }] : [],
        schemaVersion: 1,
      },
    })),
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}
