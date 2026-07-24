import { describe, expect, it } from 'vitest';

import { mergeAdminRouteSnapshotState } from './adminRouteState';

describe('admin route state', () => {
  it('adds a route snapshot without discarding unrelated history state', () => {
    expect(mergeAdminRouteSnapshotState({ adminRouteSnapshots: { users: { old: true } }, token: 'keep' }, 'reports', { page: 2 })).toEqual({ adminRouteSnapshots: { reports: { page: 2 }, users: { old: true } }, token: 'keep' });
  });
});
