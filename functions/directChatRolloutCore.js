const DIRECT_CHAT_ROLLOUT_STAGES = Object.freeze([
  Object.freeze({
    flags: Object.freeze({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: false,
    }),
    name: 'dark',
    stageId: 0,
  }),
  Object.freeze({
    flags: Object.freeze({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: true,
    }),
    name: 'friends-text',
    stageId: 1,
  }),
  Object.freeze({
    flags: Object.freeze({
      directMessageMedia: false,
      directMessageRequests: true,
      directMessages: true,
    }),
    name: 'text-and-requests',
    stageId: 2,
  }),
  Object.freeze({
    flags: Object.freeze({
      directMessageMedia: true,
      directMessageRequests: true,
      directMessages: true,
    }),
    name: 'text-requests-and-media',
    stageId: 3,
  }),
]);

function resolveDirectChatRolloutStage(stageId) {
  return DIRECT_CHAT_ROLLOUT_STAGES.find((stage) => stage.stageId === stageId);
}

function resolveDirectChatStageFromFlags(flags = {}) {
  return DIRECT_CHAT_ROLLOUT_STAGES.find((stage) => (
    Object.entries(stage.flags).every(([key, value]) => flags[key] === value)
  ));
}

function validateDirectChatStageTransition({ currentStageId, nextStageId }) {
  const current = resolveDirectChatRolloutStage(currentStageId);
  const next = resolveDirectChatRolloutStage(nextStageId);
  if (!current || !next) return { code: 'STAGE_INVALID', ok: false };
  if (nextStageId > currentStageId + 1) return { code: 'STAGE_SKIP_FORBIDDEN', ok: false };
  return { ok: true, value: next };
}

module.exports = {
  DIRECT_CHAT_ROLLOUT_STAGES,
  resolveDirectChatRolloutStage,
  resolveDirectChatStageFromFlags,
  validateDirectChatStageTransition,
};
