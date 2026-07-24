import { useEffect, useState } from 'react';

import {
  disabledSocialFeatureFlags,
  subscribeSocialFeatureFlags,
} from './featureFlags';

export function useSocialFeatureFlags() {
  const [flags, setFlags] = useState(disabledSocialFeatureFlags);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void subscribeSocialFeatureFlags((nextFlags) => {
      if (active) {
        setFlags(nextFlags);
      }
    }).then((nextUnsubscribe) => {
      if (active) {
        unsubscribe = nextUnsubscribe;
      } else {
        nextUnsubscribe();
      }
    }).catch(() => {
      if (active) {
        setFlags(disabledSocialFeatureFlags);
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return flags;
}
