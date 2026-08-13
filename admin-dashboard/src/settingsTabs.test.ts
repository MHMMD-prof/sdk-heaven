import { describe, expect, it } from 'vitest';

import { parseSettingsTab } from './settingsTabs';

describe('settings workspace tabs', () => {
  it('accepts known tab keys', () => {
    expect(parseSettingsTab('account')).toBe('account');
    expect(parseSettingsTab('admins')).toBe('admins');
    expect(parseSettingsTab('platform')).toBe('platform');
    expect(parseSettingsTab('economy')).toBe('economy');
  });

  it('falls back to account for unknown or empty values', () => {
    expect(parseSettingsTab('')).toBe('account');
    expect(parseSettingsTab('missing')).toBe('account');
    expect(parseSettingsTab('ACCOUNT')).toBe('account');
  });
});
