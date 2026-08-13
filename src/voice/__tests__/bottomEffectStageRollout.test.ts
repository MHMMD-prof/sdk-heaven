import { describe, expect, it } from 'vitest';

import { disabledCosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { resolveBottomEffectStageEnabled } from '../bottomEffectStageRollout';

const base = {
  ...disabledCosmeticsFeatureFlags,
  roomBottomEffectStage: true,
  roomBottomEffectStageRoomIds: ['room-approved'],
  roomBottomEffectStageTesterHashes: ['a'.repeat(64)],
};

describe('bottom effect stage rollout', () => {
  it('fails closed and makes the master switch an independent rollback', () => {
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStage: false,
      roomBottomEffectStageRollout: 'global',
      roomId: 'room-approved',
      viewerUidHash: 'a'.repeat(64),
    })).toBe(false);
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStageRollout: 'off',
      roomId: 'room-approved',
      viewerUidHash: 'a'.repeat(64),
    })).toBe(false);
  });

  it('supports testers, then controlled rooms, then global rollout', () => {
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStageRollout: 'testers',
      viewerUidHash: 'a'.repeat(64),
    })).toBe(true);
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStageRollout: 'testers',
      viewerUidHash: 'b'.repeat(64),
    })).toBe(false);
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStageRollout: 'rooms',
      roomId: 'room-approved',
      viewerUidHash: 'b'.repeat(64),
    })).toBe(true);
    expect(resolveBottomEffectStageEnabled({
      ...base,
      roomBottomEffectStageRollout: 'global',
      roomId: 'any-room',
      viewerUidHash: 'b'.repeat(64),
    })).toBe(true);
  });
});
