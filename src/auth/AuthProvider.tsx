import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from '@firebase/auth';
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firebaseDb } from './firebase';
import { AccountDeletionRequestInput, createAccountDeletionRequestPayload } from './accountLifecycle';
import { createProfilePayload, isCompleteProfile, mapUserProfileDocument, validateProfileInput } from './profile';
import { AuthUser, ProfileStatus, SaveProfileInput, UserProfile } from './types';

type AuthContextValue = {
  authUser: AuthUser | null;
  initializing: boolean;
  isEmailVerified: boolean;
  profile: UserProfile | null;
  profileStatus: ProfileStatus;
  refreshUser: () => Promise<void>;
  requestAccountDeletion: (input: AccountDeletionRequestInput) => Promise<void>;
  saveProfile: (input: SaveProfileInput) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendPasswordResetForCurrentUser: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
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
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setAuthRevision((revision) => revision + 1);
      setInitializing(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !user.emailVerified) {
      setProfile(null);
      setProfileStatus('missing');
      return undefined;
    }

    setProfileStatus('loading');

    return onSnapshot(
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
  }, [user?.emailVerified, user?.uid]);

  const authUser = useMemo<AuthUser | null>(() => {
    if (!user || !user.emailVerified || !isCompleteProfile(profile)) {
      return null;
    }

    return {
      avatarLabel: profile.avatarLabel,
      displayName: profile.displayName,
      email: profile.email,
      emailVerified: user.emailVerified,
      uid: user.uid,
    };
  }, [profile, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authUser,
      initializing,
      isEmailVerified: user?.emailVerified ?? false,
      profile,
      profileStatus,
      refreshUser: async () => {
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
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser?.email || !currentUser.emailVerified) {
          throw new Error('A verified signed-in user is required to save a profile.');
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
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser?.email || !currentUser.emailVerified || !authUser) {
          throw new Error('A complete verified account is required to request account deletion.');
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
        await sendPasswordResetEmail(firebaseAuth, email);
      },
      sendPasswordResetForCurrentUser: async () => {
        const currentEmail = firebaseAuth.currentUser?.email;

        if (!currentEmail) {
          throw new Error('No signed-in email is available for password reset.');
        }

        await sendPasswordResetEmail(firebaseAuth, currentEmail);
      },
      sendVerificationEmail: async () => {
        const currentUser = firebaseAuth.currentUser;

        if (!currentUser) {
          throw new Error('No signed-in user is available for email verification.');
        }

        await sendEmailVerification(currentUser);
      },
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      },
      signOut: async () => {
        await firebaseSignOut(firebaseAuth);
      },
      signUp: async (email, password) => {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await sendEmailVerification(credential.user);
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
