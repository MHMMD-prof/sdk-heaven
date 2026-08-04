import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import type { DirectChatInboxPage } from './directChatModels';
import {
  mapRealtimeProjection,
  subscribeDirectChatInbox,
  subscribeDirectChatUnreadSummary,
  type DirectChatRealtimeProjection,
} from './directChatRealtime';
import { createDirectChatRequestId, requestDirectChatCommand } from './requestDirectChatCommand';

type InboxStatus = 'disabled' | 'error' | 'loading' | 'offline' | 'ready';

type DirectChatContextValue = {
  enabled: boolean;
  errorMessage: string;
  hasMore: boolean;
  items: DirectChatRealtimeProjection[];
  loadMore: () => Promise<void>;
  mediaEnabled: boolean;
  refresh: () => Promise<void>;
  runPreference: (item: DirectChatRealtimeProjection, action: 'archive' | 'mute') => Promise<void>;
  status: InboxStatus;
  totalUnreadCount: number;
};

const DirectChatContext = createContext<DirectChatContextValue | undefined>(undefined);

export function DirectChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const flags = useSocialFeatureFlags();
  const enabled = flags.directMessages === true && Boolean(user?.uid);
  const [items, setItems] = useState<DirectChatRealtimeProjection[]>([]);
  const [status, setStatus] = useState<InboxStatus>('disabled');
  const [errorMessage, setErrorMessage] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const loadingMore = useRef(false);

  const mergeItems = useCallback((incoming: DirectChatRealtimeProjection[], replace = false) => {
    setItems((current) => {
      const map = new Map((replace ? [] : current).map((item) => [item.conversationId, item]));
      incoming.forEach((item) => map.set(item.conversationId, item));
      return [...map.values()]
        .filter((item) => !item.archived)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.conversationId.localeCompare(left.conversationId));
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !user?.uid) return;
    setStatus('loading');
    setErrorMessage('');
    try {
      const response = await requestDirectChatCommand<DirectChatInboxPage>({
        action: 'get-direct-chat-inbox',
        payload: { limit: 30 },
        requestId: createDirectChatRequestId(),
      });
      const page = response.result;
      mergeItems(page.items.map((item) => mapRealtimeProjection(item as unknown as Record<string, unknown>, user.uid)).filter(isPresent), true);
      setNextCursor(page.nextCursor || '');
      setHasMore(page.hasMore === true);
      setTotalUnreadCount(Math.max(0, page.totalUnreadCount || 0));
      setStatus('ready');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل المحادثات الآن.');
      setStatus('error');
    }
  }, [enabled, mergeItems, user?.uid]);

  useEffect(() => {
    if (!enabled || !user?.uid) {
      setItems([]);
      setStatus('disabled');
      setNextCursor('');
      setHasMore(false);
      setTotalUnreadCount(0);
      return undefined;
    }
    void refresh();
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeSummary: (() => void) | undefined;
    void subscribeDirectChatInbox(user.uid, {
      limit: 30,
      onData: (incoming) => {
        if (!active) return;
        mergeItems(incoming);
        setStatus('ready');
      },
      onError: () => {
        if (active) setStatus((current) => current === 'ready' ? 'offline' : 'error');
      },
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => {
      if (active) setStatus('error');
    });
    void subscribeDirectChatUnreadSummary(user.uid, (nextTotal) => {
      if (active) setTotalUnreadCount(nextTotal);
    }).then((nextUnsubscribe) => {
      if (active) unsubscribeSummary = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeSummary?.();
    };
  }, [enabled, mergeItems, refresh, user?.uid]);

  const loadMore = useCallback(async () => {
    if (!enabled || !user?.uid || !hasMore || !nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const response = await requestDirectChatCommand<DirectChatInboxPage>({
        action: 'get-direct-chat-inbox',
        payload: { cursor: nextCursor, limit: 30 },
        requestId: createDirectChatRequestId(),
      });
      const page = response.result;
      mergeItems(page.items.map((item) => mapRealtimeProjection(item as unknown as Record<string, unknown>, user.uid)).filter(isPresent));
      setNextCursor(page.nextCursor || '');
      setHasMore(page.hasMore === true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل المزيد.');
      setStatus('offline');
    } finally {
      loadingMore.current = false;
    }
  }, [enabled, hasMore, mergeItems, nextCursor, user?.uid]);

  const runPreference = useCallback(async (item: DirectChatRealtimeProjection, action: 'archive' | 'mute') => {
    if (!user?.uid) return;
    const muted = action === 'mute' ? !item.muted : item.muted;
    const archived = action === 'archive' ? true : item.archived;
    setItems((current) => current.map((candidate) => candidate.conversationId === item.conversationId
      ? { ...candidate, archived, muted }
      : candidate).filter((candidate) => !candidate.archived));
    try {
      await requestDirectChatCommand({
        action: action === 'mute' ? 'set-direct-chat-mute' : 'set-direct-chat-archive',
        payload: action === 'mute'
          ? { muted, targetUid: item.peerUid }
          : { archived: true, targetUid: item.peerUid },
        requestId: createDirectChatRequestId(),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحديث المحادثة.');
      await refresh();
    }
  }, [refresh, user?.uid]);

  const value = useMemo<DirectChatContextValue>(() => ({
    enabled,
    errorMessage,
    hasMore,
    items,
    loadMore,
    mediaEnabled: flags.directMessageMedia === true,
    refresh,
    runPreference,
    status,
    totalUnreadCount,
  }), [enabled, errorMessage, flags.directMessageMedia, hasMore, items, loadMore, refresh, runPreference, status, totalUnreadCount]);
  return <DirectChatContext.Provider value={value}>{children}</DirectChatContext.Provider>;
}

export function useDirectChats() {
  const value = useContext(DirectChatContext);
  if (!value) throw new Error('useDirectChats must be used inside DirectChatProvider.');
  return value;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
