import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const validProductionEnv = {
  EAS_BUILD_PROFILE: 'production',
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_COMMUNITY_GUIDELINES_URL: 'https://example.com/community',
  EXPO_PUBLIC_DIRECT_CHAT_COMMAND_ENDPOINT: 'https://example.com/chat',
  EXPO_PUBLIC_FIREBASE_API_KEY: 'key',
  EXPO_PUBLIC_FIREBASE_APP_ID: 'app',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'example.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'sender',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'project',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'bucket',
  EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT: 'https://example.com/token',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://example.com/privacy',
  EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.com/1',
  EXPO_PUBLIC_SUPPORT_URL: 'https://example.com/support',
  EXPO_PUBLIC_TERMS_URL: 'https://example.com/terms',
  GOOGLE_SERVICES_INFO_PLIST: './app.json',
  SENTRY_AUTH_TOKEN: 'token',
  SENTRY_ORG: 'org',
  SENTRY_PROJECT: 'project',
};

function evaluate(overrides = {}) {
  return execFileSync(process.execPath, ['-e', "require('./app.config.js')({config:{plugins:[]}})"], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...validProductionEnv, ...overrides },
    stdio: 'pipe',
  });
}

describe('production release configuration', () => {
  it('accepts a production configuration with all legal HTTPS URLs', () => {
    expect(() => evaluate()).not.toThrow();
  });

  it('rejects store fixtures and unsafe or missing legal URLs', () => {
    expect(() => evaluate({ EXPO_PUBLIC_STORE_FIXTURES: '1' })).toThrow();
    expect(() => evaluate({ EXPO_PUBLIC_PRIVACY_POLICY_URL: 'http://example.com/privacy' })).toThrow();
    expect(() => evaluate({ EXPO_PUBLIC_TERMS_URL: '' })).toThrow();
  });
});
