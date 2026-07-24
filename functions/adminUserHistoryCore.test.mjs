import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { decodeAdminUserHistoryCursor, encodeAdminUserHistoryCursor, mergeAdminUserHistoryEntries } = require('./adminUserHistoryCore');

describe('adminUserHistoryCore', () => {
  it('round-trips section-bound multi-source cursors', () => {
    const cursor = encodeAdminUserHistoryCursor('reports', { reporter: { at: '2026-07-20T10:00:00Z', id: 'r-2' }, target: { at: '2026-07-19T10:00:00Z', id: 'r-1' } });
    expect(decodeAdminUserHistoryCursor(cursor, 'reports')).toEqual({ section: 'reports', sources: { reporter: { at: '2026-07-20T10:00:00.000Z', id: 'r-2' }, target: { at: '2026-07-19T10:00:00.000Z', id: 'r-1' } } });
    expect(decodeAdminUserHistoryCursor(cursor, 'store-gifts')).toBeNull();
    expect(decodeAdminUserHistoryCursor('not-a-cursor', 'reports')).toBeNull();
  });

  it('merges sources stably, deduplicates shared records, and advances consumed sources', () => {
    const result = mergeAdminUserHistoryEntries({
      entries: [
        { key: 'shared', marks: [{ at: '2026-07-21T10:00:00Z', id: 'shared', source: 'reporter' }], sortAt: '2026-07-21T10:00:00Z', value: { id: 'shared' } },
        { key: 'shared', marks: [{ at: '2026-07-21T10:00:00Z', id: 'shared', source: 'target' }], sortAt: '2026-07-21T10:00:00Z', value: { id: 'shared' } },
        { key: 'older', marks: [{ at: '2026-07-20T10:00:00Z', id: 'older', source: 'target' }], sortAt: '2026-07-20T10:00:00Z', value: { id: 'older' } },
      ],
      limit: 1,
      section: 'reports',
      sourceHasMore: { reporter: false, target: true },
    });
    expect(result.items).toEqual([{ id: 'shared' }]);
    expect(result.pageInfo).toMatchObject({ hasNextPage: true, returned: 1 });
    expect(decodeAdminUserHistoryCursor(result.pageInfo.nextCursor, 'reports')?.sources).toEqual({ reporter: { at: '2026-07-21T10:00:00.000Z', id: 'shared' }, target: { at: '2026-07-21T10:00:00.000Z', id: 'shared' } });
  });

  it('preserves untouched source cursors when another source fills a page', () => {
    const result = mergeAdminUserHistoryEntries({ entries: [{ key: 'new', marks: [{ at: '2026-07-21T10:00:00Z', id: 'new', source: 'sent' }], sortAt: '2026-07-21T10:00:00Z', value: { id: 'new' } }], incomingSources: { received: { at: '2026-07-18T10:00:00Z', id: 'old' } }, limit: 1, section: 'store-gifts', sourceHasMore: { sent: true } });
    expect(decodeAdminUserHistoryCursor(result.pageInfo.nextCursor, 'store-gifts')?.sources.received).toEqual({ at: '2026-07-18T10:00:00.000Z', id: 'old' });
  });

  it('uses source cursor order to break timestamp ties', () => {
    const result = mergeAdminUserHistoryEntries({
      entries: [
        { key: 'room:a', marks: [{ at: '2026-07-21T10:00:00Z', id: 'rooms/z/members/user', source: 'memberships' }], sortAt: '2026-07-21T10:00:00Z', sortKey: 'rooms/z/members/user', value: { id: 'z' } },
        { key: 'room:z', marks: [{ at: '2026-07-21T10:00:00Z', id: 'rooms/a/members/user', source: 'memberships' }], sortAt: '2026-07-21T10:00:00Z', sortKey: 'rooms/a/members/user', value: { id: 'a' } },
      ],
      limit: 1,
      section: 'rooms',
      sourceHasMore: { memberships: true },
    });
    expect(result.items).toEqual([{ id: 'z' }]);
    expect(decodeAdminUserHistoryCursor(result.pageInfo.nextCursor, 'rooms')?.sources.memberships.id).toBe('rooms/z/members/user');
  });
});
