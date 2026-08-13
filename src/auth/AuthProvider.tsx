import type { User } from '@firebase/auth';
import { ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AccountDeletionRequestInput } from './accountLifecycle';
import type { AccountDeletionStatus, AccountLifecycleState } from './accountLifecycleClient';
import { createProfilePayload, isCompleteProfile, mapUserProfileDocument, validateProfileInput } from './profile';
import { AuthUser, ProfileStatus, SaveProfileInput, UserProfile } from './types';

type AuthContextValue = {
  authUser: AuthUser | null;
  accountState: AccountLifecycleState;
  deletionStatus: AccountDeletionStatus | null;
  initializing: boolean;
  profile: UserProfile | null;
  profileStatus: ProfileStatus;
  refreshUser: () => Promise<void>;
  requestAccountDeletion: (input: AccountDeletionRequestInput, password: string) => Promise<void>;
  cancelAccountDeletion: (password: string) => Promise<void>;
  refreshAccountLifecycle: () => Promise<void>;
  saveProfile: (input: SaveProfileInput) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendPasswordResetForCurrentUser: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const previousMediaCacheUid = useRef('');
  const [authRevision, setAuthRevision] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [accountState, setAccountState] = useState<AccountLifecycleState>('active');
  const [deletionStatus, setDeletionStatus] = useState<AccountDeletionStatus | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('missing');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const previousUid = previousMediaCacheUid.current;
    const nextUid = user?.uid || '';
    if (previousUid && previousUid !== nextUid) {
      void import('../personalChat/directChatMedia').then(({ clearProtectedDirectChatMedia }) => clearProtectedDirectChatMedia(previousUid)).catch(() => undefined);
    }
    previousMediaCacheUid.current = nextUid;
  }, [user?.uid]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isActive = true;

    void Promise.all([import('./firebase'), import('@firebase/auth')])
      .then(([{ firebaseAuth }, { onAuthStateChanged }]) => {
        if (!isActive) {
          return;
        }

        unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
          setUser(nextUser);
          setAuthRevision((revision) => revision + 1);
          setInitializing(Boolean(nextUser));
        });
      })
      .catch(() => {
        if (isActive) {
          setUser(null);
          setInitializing(false);
        }
      });

    return () => {
      isActive = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setAccountState('active');
      setDeletionStatus(null);
      setInitializing(false);
      return;
    }
    let active = true;
    void user.getIdTokenResult()
      .then(async (token) => {
        if (!active) return;
        const pending = token.claims.accountDeletionPending === true;
        setAccountState(pending ? 'deletion-pending' : 'active');
        if (pending) {
          const { getDeletionStatusCommand } = await import('./accountLifecycleClient');
          const status = await getDeletionStatusCommand();
          if (active) {
            setDeletionStatus(status);
            if (status.state === 'purging') setAccountState('purging');
          }
        } else {
          setDeletionStatus(null);
        }
      })
      .catch(() => { if (active) setAccountState('active'); })
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [authRevision, user]);

  useEffect(() => {
    if (!user || accountState !== 'active') {
      setProfile(null);
      setProfileStatus('missing');
      return undefined;
    }

    setProfileStatus('loading');

    let unsubscribe: (() => void) | undefined;
    let isActive = true;

    void Promise.all([import('./firebase'), import('firebase/firestore')])
      .then(([{ firebaseDb }, { doc, onSnapshot }]) => {
        if (!isActive) {
          return;
        }

        unsubscribe = onSnapshot(
          doc(firebaseDb, 'users', user.uid),
          (snapshot) => {
            if (!snapshot.exists()) {
              setProfile(null);
              setProfileStatus('missing');
              return;
            }

            const nextProfile = mapUserProfileDocument(snapshot.data());
            setProfile(nextProfile);
            setProfileStatus(isCompleteProfile(nextProfile) ? 'complete' : 'missing');
          },
          () => {
            setProfile(null);
            setProfileStatus('error');
          },
        );
      })
      .catch(() => {
        if (isActive) {
          setProfile(null);
          setProfileStatus('error');
        }
      });

    return () => {
      isActive = false;
      unsubscribe?.();
    };
  }, [accountState, user?.uid]);

  const authUser = useMemo<AuthUser | null>(() => {
    if (!user || !isCompleteProfile(profile)) {
      return null;
    }

    return {
      avatarLabel: profile.avatarLabel,
      displayName: profile.displayName,
      email: profile.email,
      uid: user.uid,
    };
  }, [profile, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accountState,
      authUser,
      cancelAccountDeletion: async (password) => {
        const { firebaseAuth } = await import('./firebase');
        const { cancelDeletionCommand, reauthenticateCurrentUser } = await import('./accountLifecycleClient');
        await reauthenticateCurrentUser(password);
        await cancelDeletionCommand();
        if (firebaseAuth.currentUser) await firebaseAuth.currentUser.getIdToken(true);
        setAccountState('active');
        setDeletionStatus(null);
        setAuthRevision((revision) => revision + 1);
      },
      deletionStatus,
      initializing,
      profile,
      profileStatus,
      refreshUser: async () => {
        const [{ firebaseAuth }, { reload }] = await Promise.all([import('./firebase'), import('@firebase/auth')]);
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser) {
          setUser(null);
          return;
        }

        await reload(currentUser);
        setUser(firebaseAuth.currentUser);
        setAuthRevision((revision) => revision + 1);
      },
      saveProfile: async (input) => {
        const [
          { firebaseAuth, firebaseDb },
          { doc, getDoc, serverTimestamp, setDoc },
        ] = await Promise.all([import('./firebase'), import('firebase/firestore')]);
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser?.email) {
          throw new Error('A signed-in user is required to save a profile.');
        }

        const validation = validateProfileInput(input);

        if (!validation.ok) {
          throw new Error(validation.message);
        }

        const profilePayload = createProfilePayload(currentUser.uid, currentUser.email, validation.value);

        if (!profilePayload) {
          throw new Error('Profile is incomplete.');
        }

        const profileRef = doc(firebaseDb, 'users', currentUser.uid);
        const existingProfile = await getDoc(profileRef);
        const existingProfileData = existingProfile.data();
        const shouldSetCreatedAt = !existingProfile.exists() || !existingProfileData?.createdAt;
        await setDoc(
          profileRef,
          {
            ...profilePayload,
            ...(shouldSetCreatedAt ? { createdAt: serverTimestamp() } : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      },
      refreshAccountLifecycle: async () => {
        const { getDeletionStatusCommand } = await import('./accountLifecycleClient');
        const status = await getDeletionStatusCommand();
        setDeletionStatus(status);
        if (status.state === 'deletion-pending' || status.state === 'purging') setAccountState(status.state);
      },
      requestAccountDeletion: async (input, password) => {
        const { firebaseAuth } = await import('./firebase');
        const { requestDeletionCommand, reauthenticateCurrentUser } = await import('./accountLifecycleClient');
        await reauthenticateCurrentUser(password);
        const status = await requestDeletionCommand(input.reason || '');
        setDeletionStatus(status);
        setAccountState('deletion-pending');
        const currentUid = firebaseAuth.currentUser?.uid || '';
        try { await import('../notifications/pushNotifications').then(({ unregisterCurrentDevice }) => unregisterCurrentDevice()); } catch {}
        if (currentUid) {
          try { await import('../personalChat/directChatDrafts').then(({ clearDirectChatPrivateData }) => clearDirectChatPrivateData(currentUid)); } catch {}
          try { await import('../personalChat/directChatMedia').then(({ clearProtectedDirectChatMedia }) => clearProtectedDirectChatMedia(currentUid)); } catch {}
        }
        const { signOut: firebaseSignOut } = await import('@firebase/auth');
        await firebaseSignOut(firebaseAuth);
      },
      sendPasswordReset: async (email) => {
        const [{ firebaseAuth }, { sendPasswordResetEmail }] = await Promise.all([
          import('./firebase'),
          import('@firebase/auth'),
        ]);

        await sendPasswordResetEmail(firebaseAuth, email);
      },
      sendPasswordResetForCurrentUser: async () => {
        const [{ firebaseAuth }, { sendPasswordResetEmail }] = await Promise.all([
          import('./firebase'),
          import('@firebase/auth'),
        ]);
        const currentEmail = firebaseAuth.currentUser?.email;

        if (!currentEmail) {
          throw new Error('No signed-in email is available for password reset.');
        }

        await sendPasswordResetEmail(firebaseAuth, currentEmail);
      },
      signIn: async (email, password) => {
        const [{ firebaseAuth }, { signInWithEmailAndPassword }] = await Promise.all([
          import('./firebase'),
          import('@firebase/auth'),
        ]);

        await signInWithEmailAndPassword(firebaseAuth, email, password);
      },
      signOut: async () => {
        const [{ firebaseAuth }, { signOut: firebaseSignOut }] = await Promise.all([
          import('./firebase'),
          import('@firebase/auth'),
        ]);
        const signingOutUid = firebaseAuth.currentUser?.uid || '';

        try {
          const { unregisterCurrentDevice } = await import('../notifications/pushNotifications');
          await unregisterCurrentDevice();
        } catch {
          // Signing out must remain available even when push services are offline.
        }
        if (signingOutUid) {
          try {
            const { clearDirectChatPrivateData } = await import('../personalChat/directChatDrafts');
            await clearDirectChatPrivateData(signingOutUid);
          } catch {
            // Draft wipe must not block sign-out.
          }
        }
        await firebaseSignOut(firebaseAuth);
      },
      signUp: async (email, password) => {
        const [{ firebaseAuth }, { createUserWithEmailAndPassword }] = await Promise.all([
          import('./firebase'),
          import('@firebase/auth'),
        ]);

        await createUserWithEmailAndPassword(firebaseAuth, email, password);
      },
      user,
    }),
    [accountState, authRevision, authUser, deletionStatus, initializing, profile, profileStatus, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}

export function useRequireAuth() {
  const { authUser } = useAuth();

  if (!authUser) {
    throw new Error('useRequireAuth requires a complete signed-in auth profile.');
  }

  return authUser;
}
