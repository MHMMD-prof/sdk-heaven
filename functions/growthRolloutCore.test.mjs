import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildGrowthStageFlagPatches,
  mapGrowthFeatures,
  parseGrowthRolloutStageArguments,
  resolveGrowthRolloutStage,
  resolveGrowthRolloutStageByName,
  summarizeGrowthRolloutReadiness,
  validateGrowthRolloutStageTransition,
} = require('./growthRolloutCore');

describe('growthRolloutCore', () => {
  it('resolves the four Wave 0 stages', () => {
    expect(resolveGrowthRolloutStage(0)?.name).toBe('dark');
    expect(resolveGrowthRolloutStageByName('closed-beta')?.id).toBe(1);
    expect(resolveGrowthRolloutStageByName('public-partial')?.id).toBe(2);
    expect(resolveGrowthRolloutStageByName('public')?.id).toBe(3);
  });

  it('allows sequential advance and rollback to dark', () => {
    expect(validateGrowthRolloutStageTransition({ currentStageId: 0, nextStageId: 1 })).toMatchObject({ ok: true });
    expect(validateGrowthRolloutStageTransition({ currentStageId: 1, nextStageId: 3 })).toMatchObject({
      ok: false,
      code: 'NON_SEQUENTIAL_STAGE',
    });
    expect(validateGrowthRolloutStageTransition({ currentStageId: 2, nextStageId: 0 })).toMatchObject({
      ok: true,
      rollback: true,
    });
  });

  it('keeps Wave 3 in-room PK on from closed-beta while cross-room stays dark', () => {
    const closed = buildGrowthStageFlagPatches(resolveGrowthRolloutStageByName('closed-beta'));
    expect(closed.growthFeatures.quickMatch).toBe(true);
    expect(closed.growthFeatures.luckyBag).toBe(true);
    expect(closed.growthFeatures.leaderboards).toBe(true);
    expect(closed.growthFeatures.vipTiers).toBe(true);
    expect(closed.growthFeatures.roomPk).toBe(true);
    expect(closed.growthFeatures.roomGameEconomy).toBe(true);
    expect(closed.growthFeatures.giftCombos).toBe(true);
    expect(closed.growthFeatures.luckyGifts).toBe(true);
    expect(closed.growthFeatures.magicGiftTemplates).toBe(true);
    expect(closed.growthFeatures.families).toBe(true);
    expect(closed.growthFeatures.dailyMissions).toBe(true);
    expect(closed.growthFeatures.opsEvents).toBe(true);
    expect(closed.growthFeatures.watchTogether).toBe(true);
    expect(closed.growthFeatures.softOneToOneMatch).toBe(true);
    expect(closed.growthFeatures.crossRoomPk).toBe(false);
    expect(closed.growthFeatures.maskedMatch).toBe(false);

    const partial = buildGrowthStageFlagPatches(resolveGrowthRolloutStageByName('public-partial'));
    expect(partial.growthFeatures.maskedMatch).toBe(true);
    expect(partial.growthFeatures.roomPk).toBe(true);
    expect(partial.growthFeatures.roomGameEconomy).toBe(true);
    expect(partial.growthFeatures.crossRoomPk).toBe(false);
    expect(partial.voiceRoomFeatures.voice_room_shared_music).toBe(true);

    const publicStage = resolveGrowthRolloutStageByName('public');
    const patches = buildGrowthStageFlagPatches(publicStage);
    expect(patches.growthFeatures.roomPk).toBe(true);
    expect(patches.growthFeatures.roomGameEconomy).toBe(true);
    expect(patches.growthFeatures.crossRoomPk).toBe(false);
  });

  it('closed-beta readiness requires Wave 3 PK flags when expected', () => {
    const stage = resolveGrowthRolloutStageByName('closed-beta');
    expect(stage.socialFeatures).toEqual({ pushNotifications: true });
    expect(stage.voiceRoomFeatures).toEqual({
      voice_room_gifts: true,
      voice_room_supporter_rankings: true,
      voice_room_shared_music: false,
    });
    const summary = summarizeGrowthRolloutReadiness({
      growthFeatures: {
        quickMatch: true,
        luckyBag: true,
        leaderboards: true,
        vipTiers: true,
        roomPk: true,
        roomGameEconomy: true,
        giftCombos: true,
        luckyGifts: true,
        magicGiftTemplates: true,
        families: true,
        dailyMissions: true,
        opsEvents: true,
        watchTogether: true,
        softOneToOneMatch: true,
      },
      recordedStageName: 'closed-beta',
      socialFeatures: { pushNotifications: true },
      voiceRoomFeatures: {
        voice_room_gifts: true,
        voice_room_supporter_rankings: true,
      },
    });
    expect(summary.stages.find((row) => row.name === 'closed-beta')?.ready).toBe(true);
  });

  it('parses CLI stage arguments', () => {
    expect(parseGrowthRolloutStageArguments(['--stage', 'dark']).ok).toBe(true);
    expect(parseGrowthRolloutStageArguments(['--apply', '--stage', '1']).ok).toBe(false);
    expect(parseGrowthRolloutStageArguments([
      '--apply',
      '--actor-uid',
      'owner1',
      '--stage',
      'closed-beta',
    ])).toMatchObject({
      ok: true,
      value: { apply: true, actorUid: 'owner1' },
    });
  });
});
