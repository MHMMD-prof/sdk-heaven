import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { requestNotificationSettings } from '../social/requestSocialCommand';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { mergeDirectChatInboxItems } from './directChatInboxState';
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
  showOnlineStatus: boolean;
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
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const loadingMore = useRef(false);
  const pagedConversationIds = useRef(new Set<string>());
  const realtimeConversationIds = useRef(new Set<string>());
  const realtimeHealthy = useRef(false);
  const realtimeVersion = useRef(0);
  const unreadSummaryVersion = useRef(0);

  useEffect(() => {
    if (!enabled || !user?.uid) {
      setShowOnlineStatus(true);
      return undefined;
    }
    let active = true;
    void requestNotificationSettings().then((response) => {
      if (active && response.ok) setShowOnlineStatus(response.result.preferences.showOnlineStatus !== false);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [enabled, user?.uid]);

  const mergeItems = useCallback((incoming: DirectChatRealtimeProjection[], replace = false) => {
    setItems((current) => mergeDirectChatInboxItems({ current, incoming, replace }));
  }, []);

  const mergeRealtimeItems = useCallback((incoming: DirectChatRealtimeProjection[]) => {
    const previousRealtimeIds = realtimeConversationIds.current;
    realtimeConversationIds.current = new Set(incoming.map((item) => item.conversationId));
    setItems((current) => mergeDirectChatInboxItems({
      current,
      incoming,
      preserveConversationIds: pagedConversationIds.current,
      removeConversationIds: previousRealtimeIds,
    }));
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !user?.uid) return;
    const realtimeVersionAtStart = realtimeVersion.current;
    const unreadSummaryVersionAtStart = unreadSummaryVersion.current;
    setStatus('loading');
    setErrorMessage('');
    try {
      const response = await requestDirectChatCommand<DirectChatInboxPage>({
        action: 'get-direct-chat-inbox',
        payload: { limit: 30 },
        requestId: createDirectChatRequestId(),
      });
      const page = response.result;
      const nextItems = page.items.map((item) => mapRealtimeProjection(item as unknown as Record<string, unknown>, user.uid)).filter(isPresent);
      if (realtimeVersion.current === realtimeVersionAtStart) {
        pagedConversationIds.current.clear();
        realtimeConversationIds.current = new Set(nextItems.map((item) => item.conversationId));
        mergeItems(nextItems, true);
      }
      setNextCursor(page.nextCursor || '');
      setHasMore(page.hasMore === true);
      if (unreadSummaryVersion.current === unreadSummaryVersionAtStart) {
        setTotalUnreadCount(Math.max(0, page.totalUnreadCount || 0));
      }
      setStatus(realtimeVersion.current === realtimeVersionAtStart || realtimeHealthy.current ? 'ready' : 'offline');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل المحادثات الآن.');
      setStatus(realtimeHealthy.current ? 'ready' : 'error');
    }
  }, [enabled, mergeItems, user?.uid]);

  useEffect(() => {
    if (!enabled || !user?.uid) {
      setItems([]);
      setStatus('disabled');
      setNextCursor('');
      setHasMore(false);
      setTotalUnreadCount(0);
      pagedConversationIds.current.clear();
      realtimeConversationIds.current.clear();
      realtimeHealthy.current = false;
      realtimeVersion.current = 0;
      unreadSummaryVersion.current = 0;
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
        realtimeHealthy.current = true;
        realtimeVersion.current += 1;
        mergeRealtimeItems(incoming);
        setErrorMessage('');
        setStatus('ready');
      },
      onError: () => {
        if (active) {
          realtimeHealthy.current = false;
          setStatus((current) => current === 'ready' ? 'offline' : 'error');
        }
      },
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => {
      if (active) {
        realtimeHealthy.current = false;
        setStatus('error');
      }
    });
    void subscribeDirectChatUnreadSummary(user.uid, (nextTotal) => {
      if (active) {
        unreadSummaryVersion.current += 1;
        setTotalUnreadCount(nextTotal);
      }
    }).then((nextUnsubscribe) => {
      if (active) unsubscribeSummary = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeSummary?.();
    };
  }, [enabled, mergeRealtimeItems, refresh, user?.uid]);

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
      const nextItems = page.items.map((item) => mapRealtimeProjection(item as unknown as Record<string, unknown>, user.uid)).filter(isPresent);
      nextItems.forEach((item) => pagedConversationIds.current.add(item.conversationId));
      mergeItems(nextItems);
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
    showOnlineStatus,
    status,
    totalUnreadCount,
  }), [enabled, errorMessage, flags.directMessageMedia, hasMore, items, loadMore, refresh, runPreference, showOnlineStatus, status, totalUnreadCount]);
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
