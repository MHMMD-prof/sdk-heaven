import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { useSocialFeatureFlags } from '../../social/useSocialFeatureFlags';
import {
  disabledPersonalChatFrontendRollout,
  isPersonalChatFrontendEnabled,
  subscribePersonalChatFrontendRollout,
  type PersonalChatFrontendRollout,
} from '../personalChatFrontendRollout';

export type PersonalChatPresentation = 'legacy' | 'modern-royal';

export function resolvePersonalChatPresentation(enabled: unknown, rollout: PersonalChatFrontendRollout = disabledPersonalChatFrontendRollout, uid?: string, internalPreview = false): PersonalChatPresentation {
  return isPersonalChatFrontendEnabled({ internalPreview, masterEnabled: enabled, rollout, uid }) ? 'modern-royal' : 'legacy';
}

/** Presentation-only selector. Messaging authorization remains in DirectChatProvider. */
export function usePersonalChatPresentation(): PersonalChatPresentation {
  const { user } = useAuth();
  const flags = useSocialFeatureFlags();
  const [rollout, setRollout] = useState(disabledPersonalChatFrontendRollout);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribePersonalChatFrontendRollout((next) => {
      if (active) setRollout(next);
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => {
      if (active) setRollout(disabledPersonalChatFrontendRollout);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return resolvePersonalChatPresentation(
    flags.personalChatsFrontendV2,
    rollout,
    user?.uid,
    process.env.EXPO_PUBLIC_PERSONAL_CHATS_INTERNAL_PREVIEW === '1',
  );
}
