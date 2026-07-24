import type { User } from '@firebase/auth';
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

import { AccountDeletionRequestInput, createAccountDeletionRequestPayload } from './accountLifecycle';
import { createProfilePayload, isCompleteProfile, mapUserProfileDocument, validateProfileInput } from './profile';
import { AuthUser, ProfileStatus, SaveProfileInput, UserProfile } from './types';

type AuthContextValue = {
  authUser: AuthUser | null;
  initializing: boolean;
  profile: UserProfile | null;
  profileStatus: ProfileStatus;
  refreshUser: () => Promise<void>;
  requestAccountDeletion: (input: AccountDeletionRequestInput) => Promise<void>;
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
  const [authRevision, setAuthRevision] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('missing');
  const [user, setUser] = useState<User | null>(null);

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
          setInitializing(false);
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
  }, [user?.uid]);

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
      authUser,
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
      requestAccountDeletion: async (input) => {
        const [
          { firebaseAuth, firebaseDb },
          { addDoc, collection, serverTimestamp },
        ] = await Promise.all([import('./firebase'), import('firebase/firestore')]);
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser?.email || !authUser) {
          throw new Error('A complete account is required to request account deletion.');
        }

        const payload = createAccountDeletionRequestPayload(authUser, input);

        if (!payload) {
          throw new Error('Account deletion request is invalid.');
        }

        await addDoc(collection(firebaseDb, 'users', currentUser.uid, 'accountDeletionRequests'), {
          ...payload,
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
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

        try {
          const { unregisterCurrentDevice } = await import('../notifications/pushNotifications');
          await unregisterCurrentDevice();
        } catch {
          // Signing out must remain available even when push services are offline.
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
    [authRevision, authUser, initializing, profile, profileStatus, user],
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
