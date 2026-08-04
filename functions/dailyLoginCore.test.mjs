import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createDailyLoginDay,
  createDailyLoginFingerprint,
  createDailyLoginReceiptId,
  createDailyLoginSettlementId,
  isClientVersionCompatible,
  normalizeDailyLoginCampaignPointer,
  normalizeDailyLoginCampaignVersion,
  normalizeDailyLoginCommandBody,
  resolveDailyLoginCampaignRevision,
  resolveDailyLoginPosition,
  resolveDailyLoginRateLimit,
  resolveEffectiveReward,
} = require('./dailyLoginCore');

describe('dailyLoginCore', () => {
  it('uses the authoritative Baghdad calendar boundary', () => {
    expect(createDailyLoginDay(Date.parse('2026-07-30T20:59:59.999Z'))).toMatchObject({
      ok: true,
      value: {
        dateId: '2026-07-30',
        dayId: 'day_2026-07-30_asia-baghdad',
        nextResetAtMillis: Date.parse('2026-07-30T21:00:00.000Z'),
        previousDateId: '2026-07-29',
      },
    });
    expect(createDailyLoginDay(Date.parse('2026-07-30T21:00:00.000Z'))).toMatchObject({
      ok: true,
      value: {
        dateId: '2026-07-31',
        dayId: 'day_2026-07-31_asia-baghdad',
        previousDateId: '2026-07-30',
      },
    });
  });

  it('advances consecutive claims, wraps day seven, and resets after a miss', () => {
    const today = createDailyLoginDay(Date.parse('2026-07-31T12:00:00.000Z')).value;
    expect(resolveDailyLoginPosition({
      lastClaimDateId: today.previousDateId,
      lastStreakPosition: 2,
      today,
    })).toMatchObject({ ok: true, value: { alreadyClaimed: false, position: 3 } });
    expect(resolveDailyLoginPosition({
      lastClaimDateId: today.previousDateId,
      lastStreakPosition: 7,
      today,
    })).toMatchObject({ ok: true, value: { position: 1 } });
    expect(resolveDailyLoginPosition({
      lastClaimDateId: '2026-07-20',
      lastStreakPosition: 6,
      today,
    })).toMatchObject({ ok: true, value: { position: 1 } });
    expect(resolveDailyLoginPosition({
      lastClaimDateId: today.dateId,
      lastStreakPosition: 4,
      today,
    })).toMatchObject({ ok: true, value: { alreadyClaimed: true, position: 4 } });
  });

  it('strictly validates the pointer and seven immutable reward days', () => {
    expect(normalizeDailyLoginCampaignPointer({
      activeRevision: 4,
      emergencyDisabled: false,
      presentationVisible: true,
      publicationStatus: 'published',
      schemaVersion: 1,
    })).toMatchObject({ ok: true, value: { activeRevision: 4 } });
    expect(normalizeDailyLoginCampaignVersion(campaignVersion())).toMatchObject({
      ok: true,
      value: { revision: 4, timeZone: 'Asia/Baghdad' },
    });
    expect(normalizeDailyLoginCampaignVersion({
      ...campaignVersion(),
      rewards: campaignVersion().rewards.slice(0, 6),
    })).toEqual({ ok: false, code: 'CAMPAIGN_INVALID' });
    expect(normalizeDailyLoginCampaignVersion({
      ...campaignVersion(),
      timeZone: 'UTC',
    })).toEqual({ ok: false, code: 'CAMPAIGN_INVALID' });
  });

  it('switches to a scheduled revision only when its Baghdad boundary is due', () => {
    const pointer = normalizeDailyLoginCampaignPointer({
      activeRevision: 4,
      claimsPaused: false,
      emergencyDisabled: false,
      lastPublishedRevision: 5,
      presentationVisible: true,
      publicationStatus: 'published',
      revision: 8,
      scheduledAtMillis: 2_000,
      scheduledRevision: 5,
      schemaVersion: 1,
    }).value;
    expect(resolveDailyLoginCampaignRevision(pointer, 1_999)).toBe(4);
    expect(resolveDailyLoginCampaignRevision(pointer, 2_000)).toBe(5);
  });

  it('normalizes commands and hashes only valid stable identifiers', () => {
    expect(normalizeDailyLoginCommandBody({
      action: 'claim-daily-login-reward',
      clientVersion: '1.2.3',
      deviceId: 'android-installation-1',
      requestId: 'request_12345678',
    })).toMatchObject({
      ok: true,
      value: {
        action: 'claim-daily-login-reward',
        clientVersion: '1.2.3',
        requestId: 'request_12345678',
      },
    });
    expect(normalizeDailyLoginCommandBody({ action: 'claim-daily-login-reward' }))
      .toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('creates stable opaque economic identities and fingerprints', () => {
    const scope = { dayId: 'day_2026-07-31_asia-baghdad', uid: 'user-1' };
    expect(createDailyLoginReceiptId(scope)).toMatch(/^dlc_[a-f0-9]{40}$/);
    expect(createDailyLoginSettlementId(scope)).toMatch(/^dls_[a-f0-9]{40}$/);
    expect(createDailyLoginFingerprint({
      campaignRevision: 4,
      ...scope,
      rewardBundle: { coins: 10 },
      streakPosition: 1,
    })).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gates item components separately and compares compatible clients', () => {
    const reward = { coins: 5, items: [{ itemId: 'gold-frame' }] };
    expect(resolveEffectiveReward(reward, false)).toMatchObject({
      ok: true,
      value: { coins: 5, items: [] },
    });
    expect(resolveEffectiveReward({ items: [{ itemId: 'gold-frame' }] }, false))
      .toEqual({ ok: false, code: 'ITEM_REWARDS_DISABLED' });
    expect(isClientVersionCompatible('1.5.0', '1.4.9')).toBe(true);
    expect(isClientVersionCompatible('1.4.8', '1.4.9')).toBe(false);
    expect(isClientVersionCompatible('', '1.0.0')).toBe(false);
  });

  it('bounds claim attempts in a server window', () => {
    const now = 10_000;
    expect(resolveDailyLoginRateLimit({ nowMillis: now })).toMatchObject({
      ok: true,
      value: { count: 1 },
    });
    expect(resolveDailyLoginRateLimit({
      nowMillis: now,
      rate: { attemptsMs: Array.from({ length: 8 }, (_, index) => now - index) },
    })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

function campaignVersion() {
  return {
    minimumClientVersion: '1.0.0',
    publicationStatus: 'published',
    revision: 4,
    rewards: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      reward: { coins: (index + 1) * 10 },
    })),
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}
