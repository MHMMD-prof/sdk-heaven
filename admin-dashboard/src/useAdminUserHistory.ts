import { useEffect, useMemo, useRef, useState } from 'react';

import { firebaseAuth } from './firebase';
import { AdminUserHistoryItemMap, AdminUserHistorySection, requestAdminUserHistoryPage } from './adminDashboardApi';
import { mergeAdminUserHistoryItems } from './adminUserHistoryState';

type HistoryState<T> = { error: string; hasNextPage: boolean; items: T[]; nextCursor: string; status: 'idle' | 'loading' | 'error' };

export function useAdminUserHistory<S extends AdminUserHistorySection>({ initialItems, mayHaveMore, section, targetUid }: { initialItems: AdminUserHistoryItemMap[S][]; mayHaveMore: boolean; section: S; targetUid: string }) {
  const initialKey = useMemo(() => initialItems.map((item) => historyItemKey(section, item)).join('|'), [initialItems, section]);
  const loadingRef = useRef(false);
  const [state, setState] = useState<HistoryState<AdminUserHistoryItemMap[S]>>(() => ({ error: '', hasNextPage: mayHaveMore, items: initialItems, nextCursor: '', status: 'idle' }));

  useEffect(() => {
    loadingRef.current = false;
    setState({ error: '', hasNextPage: mayHaveMore, items: initialItems, nextCursor: '', status: 'idle' });
  }, [initialKey, mayHaveMore, section, targetUid]);

  async function loadMore() {
    const user = firebaseAuth.currentUser;
    if (!user || loadingRef.current || !state.hasNextPage) return;
    loadingRef.current = true;
    setState((current) => ({ ...current, error: '', status: 'loading' }));
    try {
      let items = state.items;
      let cursor = state.nextCursor;
      let hasNextPage: boolean = state.hasNextPage;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!hasNextPage) break;
        const page = await requestAdminUserHistoryPage(user, { cursor, section, targetUid });
        const merged = mergeAdminUserHistoryItems(section, items, page.items);
        const added = merged.length - items.length;
        items = merged;
        cursor = page.pageInfo.nextCursor || '';
        hasNextPage = page.pageInfo.hasNextPage === true && Boolean(cursor);
        if (added > 0) break;
      }
      setState({ error: '', hasNextPage, items, nextCursor: cursor, status: 'idle' });
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'تعذّر تحميل المزيد من السجل.', status: 'error' }));
    } finally {
      loadingRef.current = false;
    }
  }

  return { ...state, loadMore };
}

function historyItemKey<S extends AdminUserHistorySection>(section: S, item: AdminUserHistoryItemMap[S]) {
  if (section === 'ownerships') return `ownership:${(item as AdminUserHistoryItemMap['ownerships']).itemId}`;
  return `${section}:${String((item as { id?: string }).id || '')}`;
}
