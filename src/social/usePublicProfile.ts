import { useCallback, useEffect, useState } from 'react';

import { createSocialRequestId, subscribePublicProfile } from './publicProfile';
import { requestProfileBootstrap } from './requestSocialCommand';
import type { PublicProfileLoadStatus, PublicUserProfile } from './types';

type UsePublicProfileOptions = {
  bootstrapIfMissing?: boolean;
};

const publicProfileLookupTimeoutMs = 8_000;

export function usePublicProfile(uid: string | undefined, options: UsePublicProfileOptions = {}) {
  const [errorMessage, setErrorMessage] = useState('');
  const [profile, setProfile] = useState<PublicUserProfile>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<PublicProfileLoadStatus>('loading');

  useEffect(() => {
    if (!uid) {
      setProfile(undefined);
      setStatus('missing');
      return undefined;
    }

    let active = true;
    let bootstrapAttempted = false;
    let listenerSettled = false;
    let unsubscribe: (() => void) | undefined;
    setErrorMessage('');
    setStatus('loading');
    const lookupTimeout = setTimeout(() => {
      if (!active || listenerSettled) {
        return;
      }

      setErrorMessage('استغرق تحميل الملف الشخصي وقتاً طويلاً. تحقق من الاتصال وحاول مرة أخرى.');
      setStatus('error');
    }, publicProfileLookupTimeoutMs);

    const bootstrap = async (surfaceError: boolean) => {
      bootstrapAttempted = true;
      const result = await requestProfileBootstrap({
        action: 'bootstrap-profile',
        requestId: createSocialRequestId('profile'),
        version: 1,
      });

      if (!active) {
        return;
      }

      if (!result.ok && surfaceError) {
        setErrorMessage(result.error.messageAr);
        setStatus('error');
      }
    };

    void subscribePublicProfile(
      uid,
      (nextProfile) => {
        if (!active) {
          return;
        }

        listenerSettled = true;
        clearTimeout(lookupTimeout);
        setProfile(nextProfile);

        if (nextProfile) {
          setErrorMessage('');
          setStatus('ready');
          if (options.bootstrapIfMissing && !bootstrapAttempted) {
            void bootstrap(false);
          }
          return;
        }

        if (options.bootstrapIfMissing && !bootstrapAttempted) {
          setStatus('loading');
          void bootstrap(true);
          return;
        }

        setStatus('missing');
      },
      () => {
        if (active) {
          listenerSettled = true;
          clearTimeout(lookupTimeout);
          setErrorMessage('تعذر تحميل الملف الشخصي. تحقق من الاتصال وحاول مرة أخرى.');
          setStatus('error');
        }
      },
    ).then((nextUnsubscribe) => {
      if (active) {
        unsubscribe = nextUnsubscribe;
      } else {
        nextUnsubscribe();
      }
    }).catch(() => {
      if (active) {
        listenerSettled = true;
        clearTimeout(lookupTimeout);
        setErrorMessage('تعذر تحميل الملف الشخصي. تحقق من الاتصال وحاول مرة أخرى.');
        setStatus('error');
      }
    });

    return () => {
      active = false;
      clearTimeout(lookupTimeout);
      unsubscribe?.();
    };
  }, [options.bootstrapIfMissing, revision, uid]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);

  return { errorMessage, profile, retry, status };
}
