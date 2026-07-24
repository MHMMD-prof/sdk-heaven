import { describe, expect, it } from 'vitest';

import { AdminUserOwnershipContext } from './adminDashboardApi';
import { mergeAdminUserHistoryItems } from './adminUserHistoryState';

describe('user history pagination', () => {
  it('appends new records without duplicating a repeated cursor page', () => {
    const current = [{ id: 'r-2' }, { id: 'r-1' }] as never[];
    const incoming = [{ id: 'r-1' }, { id: 'r-0' }] as never[];
    expect(mergeAdminUserHistoryItems('reports', current, incoming).map((item) => item.id)).toEqual(['r-2', 'r-1', 'r-0']);
  });

  it('uses item ids for ownership identity', () => {
    const ownership = (itemId: string) => ({ itemId } as AdminUserOwnershipContext);
    expect(mergeAdminUserHistoryItems('ownerships', [ownership('crown')], [ownership('crown'), ownership('frame')]).map((item) => item.itemId)).toEqual(['crown', 'frame']);
  });
});
