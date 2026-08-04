import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DIRECT_CHAT_ROLLOUT_STAGES,
  resolveDirectChatRolloutStage,
  resolveDirectChatStageFromFlags,
  validateDirectChatStageTransition,
} = require('./directChatRolloutCore');

describe('directChatRolloutCore', () => {
  it('keeps the four stages ordered and dependency-safe', () => {
    expect(DIRECT_CHAT_ROLLOUT_STAGES.map((stage) => stage.name)).toEqual([
      'dark',
      'friends-text',
      'text-and-requests',
      'text-requests-and-media',
    ]);
    expect(resolveDirectChatRolloutStage(0).flags).toEqual({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: false,
    });
    expect(resolveDirectChatRolloutStage(3).flags).toEqual({
      directMessageMedia: true,
      directMessageRequests: true,
      directMessages: true,
    });
  });

  it('maps only exact supported flag combinations', () => {
    expect(resolveDirectChatStageFromFlags(resolveDirectChatRolloutStage(2).flags)?.stageId).toBe(2);
    expect(resolveDirectChatStageFromFlags({
      directMessageMedia: true,
      directMessageRequests: false,
      directMessages: true,
    })).toBeUndefined();
  });

  it('forbids skipped forward stages while permitting immediate rollback', () => {
    expect(validateDirectChatStageTransition({ currentStageId: 0, nextStageId: 2 }))
      .toMatchObject({ code: 'STAGE_SKIP_FORBIDDEN', ok: false });
    expect(validateDirectChatStageTransition({ currentStageId: 0, nextStageId: 1 }))
      .toMatchObject({ ok: true, value: { stageId: 1 } });
    expect(validateDirectChatStageTransition({ currentStageId: 3, nextStageId: 0 }))
      .toMatchObject({ ok: true, value: { stageId: 0 } });
  });
});
