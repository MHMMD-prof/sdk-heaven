import { describe, expect, it } from 'vitest';

import { derivePayrollProgressEndpoint } from '../payrollEndpoint';

describe('derivePayrollProgressEndpoint', () => {
  it('derives Firebase Functions and Cloud Run payroll endpoints', () => {
    expect(derivePayrollProgressEndpoint(
      'https://us-central1-yallgame-ebd19.cloudfunctions.net/livekitToken',
    )).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/payrollProgress');
    expect(derivePayrollProgressEndpoint(
      'https://livekittoken-abc-uc.a.run.app',
    )).toBe('https://payrollprogress-abc-uc.a.run.app');
  });
});
