import { describe, expect, it } from 'vitest';

import { adminRequestErrorMessage, isReadOnlyAdminAction, shouldRetryAdminRequest } from './adminRequestPolicy';

describe('admin request policy', () => {
  it('retries transient failures only for safe read operations', () => {
    expect(shouldRetryAdminRequest('reports', 0, 503)).toBe(true);
    expect(shouldRetryAdminRequest('user-history', 0, 503)).toBe(true);
    expect(shouldRetryAdminRequest('reports', 1, 503)).toBe(false);
    expect(shouldRetryAdminRequest('report-action', 0, 503)).toBe(false);
    expect(shouldRetryAdminRequest('wallet-adjust', 0, 0)).toBe(false);
    expect(isReadOnlyAdminAction('audit-export')).toBe(true);
    expect(shouldRetryAdminRequest('daily-login-campaign', 0, 503)).toBe(true);
    expect(shouldRetryAdminRequest('daily-login-campaign-mutate', 0, 503)).toBe(false);
    expect(shouldRetryAdminRequest('cosmetic-assets', 0, 503)).toBe(true);
    expect(shouldRetryAdminRequest('cosmetic-assets-mutate', 0, 503)).toBe(false);
  });

  it('provides consistent Arabic operational errors', () => {
    expect(adminRequestErrorMessage(401)).toContain('جلسة');
    expect(adminRequestErrorMessage(403, 'Your administrator role does not allow this action.')).toContain('دورك');
    expect(adminRequestErrorMessage(409)).toContain('تغيّرت');
    expect(adminRequestErrorMessage(503)).toContain('مؤقتًا');
  });
});
