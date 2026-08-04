import { describe, expect, it } from 'vitest';

import { createDailyLoginRequestId, deriveDailyLoginCommandEndpoint } from '../dailyLoginEndpoint';

describe('Daily Login transport helpers', () => {
  it('derives Firebase Functions and Cloud Run endpoints', () => {
    expect(deriveDailyLoginCommandEndpoint(
      'https://us-central1-yallgame-ebd19.cloudfunctions.net/livekitToken',
    )).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/dailyLoginCommand');
    expect(deriveDailyLoginCommandEndpoint(
      'https://livekittoken-abc-uc.a.run.app',
    )).toBe('https://dailylogincommand-abc-uc.a.run.app');
  });

  it('creates a backend-compatible stable request identifier', () => {
    const requestId = createDailyLoginRequestId(1_722_424_242_424, 0.123456);
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{12,80}$/);
    expect(createDailyLoginRequestId(1_722_424_242_424, 0.123456)).toBe(requestId);
  });
});
