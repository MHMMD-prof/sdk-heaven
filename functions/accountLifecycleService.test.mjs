import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { _test } = require('./accountLifecycleService');

const timestamp = (value) => ({ toMillis: () => value });

describe('account lifecycle status', () => {
  it('is active without a lifecycle record', () => {
    expect(_test.deletionStatus({ exists: false })).toEqual({ state: 'active' });
  });

  it('allows recovery only before the purge deadline', () => {
    const snapshot = { exists: true, data: () => ({ purgeAfter: timestamp(2_000), requestedAt: timestamp(1_000), state: 'deletion-pending' }) };
    expect(_test.deletionStatus(snapshot, 1_500)).toEqual({ canCancel: true, purgeAfterMillis: 2_000, requestedAtMillis: 1_000, state: 'deletion-pending' });
    expect(_test.deletionStatus(snapshot, 2_000).canCancel).toBe(false);
  });
});
