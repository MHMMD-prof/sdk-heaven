import type { FirebaseOptions } from 'firebase/app';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export const firebaseConfigEnvKeys = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
] as const;

type FirebaseConfigEnvKey = (typeof firebaseConfigEnvKeys)[number];
type FirebaseConfigEnv = Record<FirebaseConfigEnvKey, string | undefined>;

const env = typeof process === 'undefined' ? {} : process.env ?? {};

export function getMissingFirebaseConfigKeys(configEnv: Partial<FirebaseConfigEnv>) {
  return firebaseConfigEnvKeys.filter((key) => !configEnv[key]);
}

export function readFirebaseConfig(configEnv: Partial<FirebaseConfigEnv> = env): FirebaseOptions {
  const missingKeys = getMissingFirebaseConfigKeys(configEnv);

  if (missingKeys.length > 0) {
    throw new Error(`Missing Firebase config env vars: ${missingKeys.join(', ')}`);
  }

  return {
    apiKey: configEnv.EXPO_PUBLIC_FIREBASE_API_KEY,
    appId: configEnv.EXPO_PUBLIC_FIREBASE_APP_ID,
    authDomain: configEnv.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: configEnv.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    projectId: configEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: configEnv.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  };
}
