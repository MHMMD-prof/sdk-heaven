import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { FirebaseStorage, getStorage } from 'firebase/storage';

type FirebaseEnv = {
  apiKey: string;
  appId: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
};

function readFirebaseEnv(): FirebaseEnv {
  const env = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? import.meta.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? import.meta.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    authDomain:
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? import.meta.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? import.meta.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? import.meta.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  };

  const missingKeys = Object.entries(env)
    .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    throw new Error(`Missing admin dashboard Firebase config: ${missingKeys.join(', ')}`);
  }

  return env as FirebaseEnv;
}

const firebaseConfig = readFirebaseEnv();

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth: Auth = getAuth(firebaseApp);
export const firebaseStorage: FirebaseStorage = getStorage(firebaseApp);
