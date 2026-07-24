import type { AdminUserHistoryItemMap, AdminUserHistorySection } from './adminDashboardApi';

export function mergeAdminUserHistoryItems<S extends AdminUserHistorySection>(section: S, current: AdminUserHistoryItemMap[S][], incoming: AdminUserHistoryItemMap[S][]) {
  const seen = new Set(current.map((item) => historyItemKey(section, item)));
  return [...current, ...incoming.filter((item) => {
    const key = historyItemKey(section, item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

function historyItemKey<S extends AdminUserHistorySection>(section: S, item: AdminUserHistoryItemMap[S]) {
  if (section === 'ownerships') return `ownership:${(item as AdminUserHistoryItemMap['ownerships']).itemId}`;
  return `${section}:${String((item as { id?: string }).id || '')}`;
}
