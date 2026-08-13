import { describe, expect, it } from 'vitest';

import rolloutCore from './personalChatsFrontendRolloutCore.js';

const {
  mapPersonalChatsFrontendRollout,
  resolvePersonalChatsFrontendStage,
  validatePersonalChatsFrontendTransition,
} = rolloutCore;

describe('personalChatsFrontendRolloutCore', () => {
  it('maps invalid documents dark', () => {
    expect(mapPersonalChatsFrontendRollout({ stage: 'global' })).toEqual({
      percentage: 0, salt: '', schemaVersion: 1, stage: 'off', stageId: 0,
    });
  });

  it('requires a valid percentage and salt for cohorts', () => {
    expect(resolvePersonalChatsFrontendStage('percentage', { percentage: 0, salt: 'royal-wave6' })).toBeUndefined();
    expect(resolvePersonalChatsFrontendStage('percentage', { percentage: 10, salt: 'short' })).toBeUndefined();
    expect(resolvePersonalChatsFrontendStage('percentage', { percentage: 10, salt: 'royal-wave6' })).toEqual({
      masterEnabled: true,
      rollout: { percentage: 10, salt: 'royal-wave6', schemaVersion: 1, stage: 'percentage', stageId: 2 },
    });
  });

  it('allows one-step promotion and immediate rollback', () => {
    expect(validatePersonalChatsFrontendTransition({ currentStageId: 0, nextStageId: 1 }).ok).toBe(true);
    expect(validatePersonalChatsFrontendTransition({ currentStageId: 0, nextStageId: 2 })).toEqual({ code: 'STAGE_SKIP_FORBIDDEN', ok: false });
    expect(validatePersonalChatsFrontendTransition({ currentStageId: 3, nextStageId: 0 }).ok).toBe(true);
  });
});
