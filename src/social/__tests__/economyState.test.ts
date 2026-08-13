import { describe, expect, it } from 'vitest';
import { beginEconomyLoad, resolveEconomyLoad } from '../economyState';

describe('About Me economy state', () => {
  it('never turns an unknown balance into zero', () => {
    expect(beginEconomyLoad({ status: 'disabled' }, true)).toEqual({ status: 'loading' });
    expect(resolveEconomyLoad({ status: 'loading' }, { error: 'offline' })).toEqual({ message: 'offline', status: 'error' });
  });

  it('keeps the last verified balance visibly stale during refresh failures', () => {
    const ready = { balances: { coins: 12, diamonds: 3 }, status: 'ready' as const };
    const refreshing = beginEconomyLoad(ready, true);
    expect(refreshing).toEqual({ ...ready, message: undefined, stale: true });
    expect(resolveEconomyLoad(refreshing, { error: 'offline' })).toEqual({ ...ready, message: 'offline', stale: true });
  });
});
