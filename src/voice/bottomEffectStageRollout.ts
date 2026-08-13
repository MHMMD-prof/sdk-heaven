import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';

export const BOTTOM_EFFECT_STAGE_TESTER_HASH_DOMAIN = 'bottom-effect-stage-v1';

export type BottomEffectStageRolloutInput = Pick<CosmeticsFeatureFlags,
  | 'roomBottomEffectStage'
  | 'roomBottomEffectStageRollout'
  | 'roomBottomEffectStageRoomIds'
  | 'roomBottomEffectStageTesterHashes'> & {
  roomId?: string;
  viewerUidHash?: string;
};

/**
 * Resolves only the bottom-stage surface. Entry delivery and gift transaction
 * authority deliberately remain outside this rollout decision.
 */
export function resolveBottomEffectStageEnabled(input: BottomEffectStageRolloutInput) {
  if (!input.roomBottomEffectStage) return false;
  if (input.roomBottomEffectStageRollout === 'global') return true;
  const tester = Boolean(
    input.viewerUidHash && input.roomBottomEffectStageTesterHashes.includes(input.viewerUidHash),
  );
  if (input.roomBottomEffectStageRollout === 'testers') return tester;
  if (input.roomBottomEffectStageRollout === 'rooms') {
    return tester || Boolean(
      input.roomId && input.roomBottomEffectStageRoomIds.includes(input.roomId),
    );
  }
  return false;
}
