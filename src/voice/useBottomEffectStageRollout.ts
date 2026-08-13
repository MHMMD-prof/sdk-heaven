import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { useEffect, useState } from 'react';

import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import {
  BOTTOM_EFFECT_STAGE_TESTER_HASH_DOMAIN,
  resolveBottomEffectStageEnabled,
} from './bottomEffectStageRollout';

export function useBottomEffectStageRollout(
  flags: CosmeticsFeatureFlags,
  roomId?: string,
  viewerUid?: string,
) {
  const [viewerUidHash, setViewerUidHash] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!viewerUid || !['testers', 'rooms'].includes(flags.roomBottomEffectStageRollout)) {
      setViewerUidHash(undefined);
      return () => { active = false; };
    }
    void digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      `${BOTTOM_EFFECT_STAGE_TESTER_HASH_DOMAIN}\u0000${viewerUid}`,
    )
      .then((hash) => {
        if (active) setViewerUidHash(hash);
      })
      .catch(() => {
        if (active) setViewerUidHash(undefined);
      });
    return () => { active = false; };
  }, [flags.roomBottomEffectStageRollout, viewerUid]);

  return resolveBottomEffectStageEnabled({
    ...flags,
    roomId,
    viewerUidHash,
  });
}
