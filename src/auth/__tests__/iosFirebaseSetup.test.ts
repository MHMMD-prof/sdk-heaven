import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..');

describe('iOS Firebase setup', () => {
  it('declares the iOS bundle id and Firebase plist path in Expo config', () => {
    const appJson = JSON.parse(readFileSync(resolve(repoRoot, 'app.json'), 'utf8')) as {
      expo?: {
        ios?: {
          bundleIdentifier?: string;
          googleServicesFile?: string;
        };
      };
    };

    expect(appJson.expo?.ios?.bundleIdentifier).toBe('com.mh.games');
    expect(appJson.expo?.ios?.googleServicesFile).toBe('./GoogleService-Info.plist');
  });

  it('documents the real plist handoff instead of relying on the Android Firebase app id', () => {
    const docs = readFileSync(resolve(repoRoot, 'docs', 'AUTH_IOS_FIREBASE_SETUP.md'), 'utf8');

    expect(docs).toContain('Use iOS bundle ID `com.mh.games`');
    expect(docs).toContain('Download the real `GoogleService-Info.plist`');
    expect(docs).toContain('Do not reuse the Android app id');
  });

  it('keeps the native iOS build gated on a real Firebase Console plist', () => {
    const docs = readFileSync(resolve(repoRoot, 'docs', 'AUTH_IOS_FIREBASE_SETUP.md'), 'utf8');

    expect(docs).toContain('Confirm `GoogleService-Info.plist` exists');
    expect(docs).toContain('Run an iOS dev-client or release-like build only on a machine with Xcode and the real plist.');
  });
});
