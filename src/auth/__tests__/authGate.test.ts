import { describe, expect, it } from 'vitest';

import { resolveAuthGateRoute } from '../authGate';

describe('resolveAuthGateRoute', () => {
  it('routes through each auth/profile gate in order', () => {
    expect(
      resolveAuthGateRoute({
        initializing: true,
        isEmailVerified: false,
        profileStatus: 'missing',
        userExists: false,
      }),
    ).toBe('loading');
    expect(
      resolveAuthGateRoute({
        initializing: false,
        isEmailVerified: false,
        profileStatus: 'missing',
        userExists: false,
      }),
    ).toBe('login');
    expect(
      resolveAuthGateRoute({
        initializing: false,
        isEmailVerified: false,
        profileStatus: 'missing',
        userExists: true,
      }),
    ).toBe('email-verification');
    expect(
      resolveAuthGateRoute({
        initializing: false,
        isEmailVerified: true,
        profileStatus: 'missing',
        userExists: true,
      }),
    ).toBe('profile-setup');
    expect(
      resolveAuthGateRoute({
        initializing: false,
        isEmailVerified: true,
        profileStatus: 'complete',
        userExists: true,
      }),
    ).toBe('main');
  });
});
