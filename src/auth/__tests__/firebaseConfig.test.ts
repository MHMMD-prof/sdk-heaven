import { describe, expect, it } from 'vitest';

import { getMissingFirebaseConfigKeys, readFirebaseConfig } from '../firebaseConfig';

const completeEnv = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'api-key',
  EXPO_PUBLIC_FIREBASE_APP_ID: 'app-id',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'project.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'sender-id',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'project-id',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'project.firebasestorage.app',
};

describe('firebaseConfig', () => {
  it('maps Expo public env vars into Firebase options', () => {
    expect(readFirebaseConfig(completeEnv)).toEqual({
      apiKey: 'api-key',
      appId: 'app-id',
      authDomain: 'project.firebaseapp.com',
      messagingSenderId: 'sender-id',
      projectId: 'project-id',
      storageBucket: 'project.firebasestorage.app',
    });
  });

  it('reports missing config keys before Firebase initializes', () => {
    expect(getMissingFirebaseConfigKeys({ EXPO_PUBLIC_FIREBASE_API_KEY: 'api-key' })).toContain(
      'EXPO_PUBLIC_FIREBASE_APP_ID',
    );
    expect(() => readFirebaseConfig({ EXPO_PUBLIC_FIREBASE_API_KEY: 'api-key' })).toThrow(
      'Missing Firebase config env vars:',
    );
  });
});
