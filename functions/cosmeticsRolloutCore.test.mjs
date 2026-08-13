import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COSMETICS_ROLLOUT_STAGES,
  assertCosmeticsDark,
  parseCosmeticsRolloutStageArguments,
  resolveCosmeticsRolloutStage,
  summarizeCosmeticsRolloutReadiness,
  validateCosmeticsRolloutStageMetadataTransition,
} = require('./cosmeticsRolloutCore');

describe('cosmeticsRolloutCore', () => {
  it('orders Wave 10 stages from dark through custom', () => {
    expect(COSMETICS_ROLLOUT_STAGES.map((stage) => stage.name)).toEqual([
      'dark',
      'internal',
      'static-frames',
      'animated-frames',
      'gift-lottie',
      'gift-mp4-restricted',
      'entry-motion',
      'categories',
      'reactions-themes',
      'couple',
      'custom',
    ]);
    expect(resolveCosmeticsRolloutStage(5).requiredFlags).toMatchObject({
      cosmetics_video: true,
      room_gift_video: true,
    });
  });

  it('asserts dark when every presentation flag is false', () => {
    expect(assertCosmeticsDark({}).ok).toBe(true);
    expect(assertCosmeticsDark({ cosmetics_lottie: true }).ok).toBe(false);
  });

  it('summarizes readiness without treating enablement as this-pass default', () => {
    const readiness = summarizeCosmeticsRolloutReadiness({
      flags: {},
      gates: { 'owner-allowlist-ready': true },
      recordedStageName: 'dark',
    });
    expect(readiness.dark).toBe(true);
    expect(readiness.enablementPolicy).toBe('metadata-only-this-pass');
    expect(readiness.stages.find((stage) => stage.name === 'internal')).toMatchObject({
      enablementBlockedInThisPass: true,
      flagReady: false,
      gateReady: true,
    });
  });

  it('allows metadata stage steps without writing cosmeticsFeatures', () => {
    expect(validateCosmeticsRolloutStageMetadataTransition({
      currentStageId: 0,
      nextStageId: 2,
    })).toMatchObject({ ok: false, code: 'STAGE_SKIP_FORBIDDEN' });
    expect(validateCosmeticsRolloutStageMetadataTransition({
      currentStageId: 0,
      nextStageId: 1,
    })).toMatchObject({
      ok: true,
      writesCosmeticsFeatures: false,
      value: { name: 'internal' },
    });
    const parsed = parseCosmeticsRolloutStageArguments([
      '--stage', 'dark',
      '--apply',
      '--actor-uid', 'owner-1',
    ]);
    expect(parsed).toMatchObject({
      ok: true,
      value: { apply: true, writesCosmeticsFeatures: false, stage: { name: 'dark' } },
    });
  });
});
