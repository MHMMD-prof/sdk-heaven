import { describe, expect, it } from 'vitest';

import { getAuthErrorMessage } from '../authErrors';

describe('getAuthErrorMessage', () => {
  it('returns a specific message for common auth failures', () => {
    expect(getAuthErrorMessage({ code: 'auth/weak-password' })).toContain('6');
    expect(getAuthErrorMessage({ code: 'auth/invalid-credential' })).not.toEqual(
      getAuthErrorMessage({ code: 'auth/weak-password' }),
    );
  });

  it('returns a safe fallback for unknown errors', () => {
    expect(getAuthErrorMessage(new Error('boom'))).toBeTruthy();
  });
});
