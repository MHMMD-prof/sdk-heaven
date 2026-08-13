import { describe, expect, it } from 'vitest';

import { parseIncentivesTab } from './incentivesTabs';

describe('incentives workspace tabs', () => {
  it('accepts known tab keys', () => {
    expect(parseIncentivesTab('rocket')).toBe('rocket');
    expect(parseIncentivesTab('room-target')).toBe('room-target');
    expect(parseIncentivesTab('daily-login')).toBe('daily-login');
    expect(parseIncentivesTab('ops-events')).toBe('ops-events');
    expect(parseIncentivesTab('payroll')).toBe('payroll');
    expect(parseIncentivesTab('integrity')).toBe('integrity');
  });

  it('falls back to rocket for unknown or empty values', () => {
    expect(parseIncentivesTab('')).toBe('rocket');
    expect(parseIncentivesTab('missing')).toBe('rocket');
    expect(parseIncentivesTab('ROCKET')).toBe('rocket');
  });
});
