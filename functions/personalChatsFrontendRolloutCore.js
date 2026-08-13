'use strict';

const PERSONAL_CHATS_FRONTEND_STAGES = Object.freeze([
  Object.freeze({ name: 'off', stageId: 0 }),
  Object.freeze({ name: 'internal', stageId: 1 }),
  Object.freeze({ name: 'percentage', stageId: 2 }),
  Object.freeze({ name: 'global', stageId: 3 }),
]);

function mapPersonalChatsFrontendRollout(data = {}) {
  const stage = PERSONAL_CHATS_FRONTEND_STAGES.find((candidate) => candidate.name === data.stage);
  const percentage = Number.isInteger(data.percentage) && data.percentage >= 0 && data.percentage <= 100
    ? data.percentage
    : 0;
  const salt = typeof data.salt === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(data.salt) ? data.salt : '';
  if (data.schemaVersion !== 1 || !stage) return { percentage: 0, salt: '', schemaVersion: 1, stage: 'off', stageId: 0 };
  return { percentage, salt, schemaVersion: 1, stage: stage.name, stageId: stage.stageId };
}

function resolvePersonalChatsFrontendStage(stageName, { percentage = 0, salt = '' } = {}) {
  const stage = PERSONAL_CHATS_FRONTEND_STAGES.find((candidate) => candidate.name === stageName);
  if (!stage) return undefined;
  if (stage.name === 'percentage') {
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) return undefined;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(salt)) return undefined;
  }
  return {
    masterEnabled: stage.name !== 'off',
    rollout: {
      percentage: stage.name === 'percentage' ? percentage : stage.name === 'global' ? 100 : 0,
      salt: stage.name === 'percentage' ? salt : '',
      schemaVersion: 1,
      stage: stage.name,
      stageId: stage.stageId,
    },
  };
}

function validatePersonalChatsFrontendTransition({ currentStageId, nextStageId }) {
  const current = PERSONAL_CHATS_FRONTEND_STAGES.find((stage) => stage.stageId === currentStageId);
  const next = PERSONAL_CHATS_FRONTEND_STAGES.find((stage) => stage.stageId === nextStageId);
  if (!current || !next) return { code: 'STAGE_INVALID', ok: false };
  if (nextStageId > currentStageId + 1) return { code: 'STAGE_SKIP_FORBIDDEN', ok: false };
  return { ok: true, value: next };
}

module.exports = {
  PERSONAL_CHATS_FRONTEND_STAGES,
  mapPersonalChatsFrontendRollout,
  resolvePersonalChatsFrontendStage,
  validatePersonalChatsFrontendTransition,
};
