import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';

type FirebaseEnv = {
  apiKey: string;
  appId: string;
  authDomain: string;
  projectId: string;
};

function readFirebaseEnv(): FirebaseEnv {
  const env = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
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
