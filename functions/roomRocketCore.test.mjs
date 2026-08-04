import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  applyRocketGiftProgress,
  buildRocketSettlementInputs,
  calculateRocketRewardLiability,
  createRocketGoalEventId,
  createRocketProjectionReceiptId,
  selectRocketPodium,
  validateRoomRocketTemplateV1,
} = require('./roomRocketCore');

function asset(slot, version = 3) {
  if (slot === 'sound') {
    return {
      bytes: 1000,
      durationMs: 3000,
      format: 'mp3',
      storagePath: `room-rockets/global-room-rocket/v${version}/launch.mp3`,
      uri: 'https://cdn.example.com/launch.mp3',
      version,
    };
  }
  return {
    bytes: 1000,
    ...(slot === 'animation' ? { durationMs: 3000 } : {}),
    format: slot === 'animation' ? 'animated-webp' : 'webp',
    height: 1200,
    storagePath: `room-rockets/global-room-rocket/v${version}/${slot}.webp`,
    uri: `https://cdn.example.com/${slot}.webp`,
    version,
    width: 800,
  };
}

function template(overrides = {}) {
  return {
    animationApproval: {
      approvalId: 'approval_device_001',
      fallbackVerified: true,
      memoryVerified: true,
      physicalAndroidDevice: 'Pixel 6a physical',
      reducedMotionVerified: true,
      testedClientVersion: '1.0.0',
    },
    appearance: {
      animationAsset: asset('animation'),
      name: { ar: 'صاروخ الأسبوع', en: 'Weekly Rocket' },
      soundAsset: asset('sound'),
      staticAsset: asset('static'),
    },
    enabledRankCount: 3,
    minimumClientVersion: '1.0.0',
    publicationStatus: 'published',
    rewards: {
      1: { coins: 0, diamonds: 100, items: [], schemaVersion: 1 },
      2: { coins: 50, diamonds: 0, items: [], schemaVersion: 1 },
      3: { coins: 25, diamonds: 0, items: [], schemaVersion: 1 },
    },
    schemaVersion: 1,
    targetSupportPoints: 1000,
    templateId: 'global-room-rocket',
    templateVersion: 1,
    timeZone: 'Asia/Baghdad',
    ...overrides,
  };
}

describe('roomRocketCore', () => {
  it('validates a publishable physical-device-approved template', () => {
    expect(validateRoomRocketTemplateV1(template())).toEqual(template());
  });

  it('rejects published animations without physical-device evidence', () => {
    expect(validateRoomRocketTemplateV1(template({ animationApproval: undefined }))).toBeUndefined();
  });

  it('rejects mutable or oversized asset paths', () => {
    const candidate = template();
    candidate.appearance.animationAsset.storagePath = 'room-rockets/global-room-rocket/current/animation.webp';
    expect(validateRoomRocketTemplateV1(candidate)).toBeUndefined();
  });

  it('unlocks exactly at the target crossing', () => {
    expect(applyRocketGiftProgress({
      giftCount: 2,
      state: 'active',
      supportPoints: 900,
      targetSupportPoints: 1000,
    }, { supportPoints: 100 })).toEqual({
      ok: true,
      value: { crossedGoal: true, giftCount: 3, state: 'unlocked', supportPoints: 1000 },
    });
    expect(applyRocketGiftProgress({
      giftCount: 3,
      state: 'unlocked',
      supportPoints: 1000,
      targetSupportPoints: 1000,
    }, { supportPoints: 50 }).value.crossedGoal).toBe(false);
  });

  it('uses spend, first contribution, then uid for stable ranking and promotes eligible users', () => {
    const result = selectRocketPodium([
      { eligibleSpendCoins: 500, firstContributionAtMillis: 20, supportPoints: 500, uid: 'z' },
      { eligibleSpendCoins: 500, firstContributionAtMillis: 10, supportPoints: 500, uid: 'held' },
      { eligibleSpendCoins: 400, firstContributionAtMillis: 5, supportPoints: 400, uid: 'a' },
      { eligibleSpendCoins: 300, firstContributionAtMillis: 1, supportPoints: 300, uid: 'b' },
    ], {
      enabledRankCount: 3,
      isEligible: ({ uid }) => uid === 'held'
        ? { eligible: false, reason: 'PAYOUT_HOLD' }
        : { eligible: true },
    });
    expect(result.value.winners.map(({ uid, rank }) => ({ rank, uid }))).toEqual([
      { rank: 1, uid: 'z' },
      { rank: 2, uid: 'a' },
      { rank: 3, uid: 'b' },
    ]);
    expect(result.value.disqualified).toEqual([{ reason: 'PAYOUT_HOLD', uid: 'held' }]);
  });

  it('creates stable goal, receipt and payout identities', () => {
    expect(createRocketGoalEventId('room-a', 'weekly_2026-07-27')).toBe(
      createRocketGoalEventId('room-a', 'weekly_2026-07-27'),
    );
    expect(createRocketProjectionReceiptId('gift-1')).toBe(createRocketProjectionReceiptId('gift-1'));
    const result = buildRocketSettlementInputs({
      cycle: { cycleId: 'weekly_2026-07-27', rewards: template().rewards },
      roomId: 'room-a',
      winners: [{ rank: 1, uid: 'u1' }],
    });
    expect(result.ok).toBe(true);
    expect(result.value[0]).toMatchObject({
      feature: 'rocket-rewards',
      source: { rank: 1, roomId: 'room-a' },
      uid: 'u1',
    });
  });

  it('derives the configured worst-case currency and item liability', () => {
    expect(calculateRocketRewardLiability(template().rewards, 3)).toEqual({
      coins: 75,
      diamonds: 100,
      itemGrantCount: 0,
      rankCount: 3,
    });
  });
});
