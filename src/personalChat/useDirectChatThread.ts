import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { recordPersonalChatBreadcrumb } from '../observability/personalChatTelemetry';
import { createDirectConversationId, type DirectChatReportCategory } from './directChatContract';
import type { DirectChatStatus, DirectChatThreadPage, DirectChatUiMessage } from './directChatModels';
import {
  DIRECT_CHAT_ONLINE_PRESENCE_REFRESH_MS,
  mapRealtimeMessage,
  setDirectChatPresence,
  subscribeDirectChatPresence,
  subscribeDirectChatReadReceipt,
  subscribeDirectChatThreadTail,
} from './directChatRealtime';
import { capDirectChatThreadMessages } from './directChatPerformanceBudgets';
import { useDirectChats } from './DirectChatProvider';
import { createDirectChatRequestId, requestDirectChatCommand } from './requestDirectChatCommand';

export function useDirectChatThread(targetUid: string) {
  const { user } = useAuth();
  const inbox = useDirectChats();
  const projection = inbox.items.find((item) => item.peerUid === targetUid);
  const [conversationId, setConversationId] = useState('');
  const [status, setStatus] = useState<DirectChatStatus>();
  const [messages, setMessages] = useState<DirectChatUiMessage[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerReadSequence, setPeerReadSequence] = useState(0);
  const markedThrough = useRef(0);
  const mountedRef = useRef(true);
  const initialLoadDoneRef = useRef(false);
  const optimisticSequenceRef = useRef(0);
  const realtimeFailedRef = useRef(false);
  // Retention deletes rows for both participants, so the listener floor is the higher of this
  // member's own delete-for-me marker and the conversation-wide retention watermark.
  const retentionPurgedThroughSequence = projection?.retentionPurgedThroughSequence || 0;
  const threadFloorSequence = Math.max(projection?.clearedThroughSequence || 0, retentionPurgedThroughSequence);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mergeMessages = useCallback((incoming: DirectChatUiMessage[], replace = false) => {
    setMessages((current) => {
      const pending = replace
        ? current.filter((message) => message.deliveryState === 'sending' || message.deliveryState === 'failed')
        : [];
      const map = new Map((replace ? pending : current).map((message) => [message.id, message]));

      incoming.forEach((message) => {
        if (message.clientRequestId) {
          for (const [id, existing] of map) {
            if (existing.clientRequestId === message.clientRequestId && id !== message.id) {
              map.delete(id);
            }
          }
        }
        const existing = map.get(message.id);
        map.set(message.id, {
          ...existing,
          ...message,
          deliveryState: message.deliveryState || existing?.deliveryState || 'sent',
        });
      });

      const merged = [...map.values()].sort((left, right) => left.sequence - right.sequence || left.createdAtMs - right.createdAtMs);
      const highest = merged.reduce((latest, message) => (
        message.deliveryState === 'sending' || message.deliveryState === 'failed'
          ? latest
          : Math.max(latest, message.sequence)
      ), 0);
      optimisticSequenceRef.current = Math.max(optimisticSequenceRef.current, highest);
      return capDirectChatThreadMessages(merged);
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!user?.uid || !targetUid || !inbox.enabled) return;
    try {
      const statusResponse = await requestDirectChatCommand<DirectChatStatus>({
        action: 'get-direct-chat-status',
        payload: { targetUid },
        requestId: createDirectChatRequestId(),
      });
      if (!mountedRef.current) return;
      setStatus(statusResponse.result);
      if (!conversationId) {
        const id = await createDirectConversationId(user.uid, targetUid);
        if (mountedRef.current) setConversationId(id);
      }
    } catch {
      // Keep current status; realtime/send errors surface elsewhere.
    }
  }, [conversationId, inbox.enabled, targetUid, user?.uid]);

  const loadInitial = useCallback(async () => {
    if (!user?.uid || !targetUid || !inbox.enabled) return;
    const showSpinner = !initialLoadDoneRef.current;
    if (showSpinner && mountedRef.current) setLoading(true);
    if (mountedRef.current) setErrorMessage('');
    try {
      const id = await createDirectConversationId(user.uid, targetUid);
      if (!mountedRef.current) return;
      setConversationId(id);
      const statusResponse = await requestDirectChatCommand<DirectChatStatus>({
        action: 'get-direct-chat-status',
        payload: { targetUid },
        requestId: createDirectChatRequestId(),
      });
      if (!mountedRef.current) return;
      setStatus(statusResponse.result);
      if (statusResponse.result.conversationState !== 'none') {
        const threadResponse = await requestDirectChatCommand<DirectChatThreadPage>({
          action: 'get-direct-chat-thread',
          payload: { limit: 40, targetUid },
          requestId: createDirectChatRequestId(),
        });
        if (!mountedRef.current) return;
        const page = threadResponse.result;
        mergeMessages(page.messages.map((message) => mapRealtimeMessage(message as unknown as Record<string, unknown>, message.id)).filter(isPresent), true);
        setNextCursor(page.nextCursor || '');
        setHasMore(page.hasMore === true);
      } else {
        setMessages([]);
        setNextCursor('');
        setHasMore(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : 'تعذر فتح المحادثة.');
      }
    } finally {
      initialLoadDoneRef.current = true;
      if (mountedRef.current) setLoading(false);
    }
  }, [inbox.enabled, mergeMessages, targetUid, user?.uid]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!conversationId || !user?.uid || !status || status.conversationState === 'none') return undefined;
    let active = true;
    let unsubscribeThread: (() => void) | undefined;
    let unsubscribeTyping: (() => void) | undefined;
    let unsubscribeOnline: (() => void) | undefined;
    let unsubscribeReceipt: (() => void) | undefined;
    let onlineHeartbeat: ReturnType<typeof setInterval> | undefined;
    setPeerTyping(false);
    setPeerOnline(false);
    void subscribeDirectChatThreadTail(conversationId, threadFloorSequence, {
      limit: 40,
      onData: (incoming) => {
        if (active) {
          mergeMessages(incoming);
          if (realtimeFailedRef.current) {
            realtimeFailedRef.current = false;
            recordPersonalChatBreadcrumb('thread-subscription-recovered', { outcome: 'success' });
          }
        }
      },
      onError: () => {
        if (active) {
          realtimeFailedRef.current = true;
          recordPersonalChatBreadcrumb('thread-subscription-failed', { error_code: 'REALTIME_SUBSCRIPTION', outcome: 'failure' });
          setErrorMessage('انقطع التحديث المباشر. يمكنك إعادة المحاولة.');
        }
      },
    }).then((unsubscribe) => { if (active) unsubscribeThread = unsubscribe; else unsubscribe(); }).catch(() => undefined);
    void subscribeDirectChatReadReceipt(conversationId, targetUid, (sequence) => {
      if (active) setPeerReadSequence(sequence);
    })
      .then((unsubscribe) => { if (active) unsubscribeReceipt = unsubscribe; else unsubscribe(); })
      .catch(() => undefined);
    if (status.accepted) {
      void subscribeDirectChatPresence('typing', conversationId, targetUid, (typing) => {
        if (active) setPeerTyping(typing);
      })
        .then((unsubscribe) => { if (active) unsubscribeTyping = unsubscribe; else unsubscribe(); })
        .catch(() => { if (active) setPeerTyping(false); });
      if (status.isFriend) {
        void subscribeDirectChatPresence('online', conversationId, targetUid, (online) => {
          if (active) setPeerOnline(online);
        })
          .then((unsubscribe) => { if (active) unsubscribeOnline = unsubscribe; else unsubscribe(); })
          .catch(() => { if (active) setPeerOnline(false); });
        if (inbox.showOnlineStatus) {
          const renewOnlinePresence = () => {
            void setDirectChatPresence({ active: true, conversationId, kind: 'online', uid: user.uid }).catch(() => undefined);
          };
          renewOnlinePresence();
          onlineHeartbeat = setInterval(renewOnlinePresence, DIRECT_CHAT_ONLINE_PRESENCE_REFRESH_MS);
        }
      }
    }
    return () => {
      active = false;
      unsubscribeThread?.();
      unsubscribeTyping?.();
      unsubscribeOnline?.();
      unsubscribeReceipt?.();
      if (onlineHeartbeat) clearInterval(onlineHeartbeat);
      if (status.accepted) void setDirectChatPresence({ active: false, conversationId, kind: 'typing', uid: user.uid }).catch(() => undefined);
      if (status.isFriend && inbox.showOnlineStatus) {
        void setDirectChatPresence({ active: false, conversationId, kind: 'online', uid: user.uid }).catch(() => undefined);
      }
    };
  }, [conversationId, inbox.showOnlineStatus, mergeMessages, status?.accepted, status?.conversationState, status?.isFriend, targetUid, threadFloorSequence, user?.uid]);

  const latestIncomingSequence = useMemo(() => messages.reduce(
    (latest, message) => message.senderUid !== user?.uid && message.visibilityState === 'visible' ? Math.max(latest, message.sequence) : latest,
    0,
  ), [messages, user?.uid]);
  const latestSequence = Math.max(
    projection?.lastSequence || 0,
    messages.reduce((latest, message) => message.deliveryState === 'sending' || message.deliveryState === 'failed'
      ? latest
      : Math.max(latest, message.sequence), 0),
  );
  useEffect(() => {
    if (!targetUid || latestIncomingSequence === 0 || latestSequence === 0 || markedThrough.current >= latestSequence) return;
    markedThrough.current = latestSequence;
    void requestDirectChatCommand({
      action: 'mark-direct-chat-read',
      payload: { targetUid, throughSequence: latestSequence },
      requestId: createDirectChatRequestId(),
    }).catch(() => { markedThrough.current = 0; });
  }, [latestIncomingSequence, latestSequence, targetUid]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const response = await requestDirectChatCommand<DirectChatThreadPage>({
        action: 'get-direct-chat-thread',
        payload: { cursor: nextCursor, limit: 40, targetUid },
        requestId: createDirectChatRequestId(),
      });
      if (!mountedRef.current) return;
      mergeMessages(response.result.messages.map((message) => mapRealtimeMessage(message as unknown as Record<string, unknown>, message.id)).filter(isPresent));
      setHasMore(response.result.hasMore === true);
      setNextCursor(response.result.nextCursor || '');
    } catch (error) {
      if (mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل الرسائل الأقدم.');
      }
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, mergeMessages, nextCursor, targetUid]);

  const send = useCallback(async (text: string, replyToMessageId = '', retryRequestId = '') => {
    if (!status || !user?.uid) return false;
    const requestId = retryRequestId || createDirectChatRequestId();
    const optimisticId = `optimistic_${requestId}`;
    optimisticSequenceRef.current = Math.max(optimisticSequenceRef.current, latestSequence) + 1;
    const sequence = optimisticSequenceRef.current;
    const optimistic: DirectChatUiMessage = {
      attachmentId: '',
      clientRequestId: requestId,
      createdAtMs: Date.now(),
      deliveryState: 'sending',
      id: optimisticId,
      kind: 'text',
      mediaContentType: '',
      mediaDurationMs: 0,
      mediaHeight: 0,
      mediaPath: '',
      mediaWidth: 0,
      replyToMessageId,
      senderUid: user.uid,
      sequence,
      systemType: '',
      text,
      visibilityState: 'visible',
    };
    if (mountedRef.current) {
      setMessages((current) => capDirectChatThreadMessages([
        ...current.filter((message) => message.clientRequestId !== requestId),
        optimistic,
      ]));
    }
    try {
      const action = status.requiresRequest && !status.accepted ? 'send-message-request' : 'send-direct-message';
      const response = await requestDirectChatCommand<{ messageId: string; requestState: string; sequence: number }>({
        action,
        payload: action === 'send-message-request'
          ? { targetUid, text }
          : { kind: 'text', replyToMessageId, targetUid, text },
        requestId,
      });
      if (!mountedRef.current) return true;
      setMessages((current) => current.map((message) => message.clientRequestId === requestId
        ? { ...message, deliveryState: 'sent', id: response.result.messageId, sequence: response.result.sequence }
        : message));
      optimisticSequenceRef.current = Math.max(optimisticSequenceRef.current, response.result.sequence);
      // Soft status refresh only — never full reload (avoids spinner unmount + race with rapid sends).
      void refreshStatus();
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setMessages((current) => current.map((message) => message.clientRequestId === requestId
          ? { ...message, deliveryState: 'failed' }
          : message));
        setErrorMessage(error instanceof Error ? error.message : 'تعذر إرسال الرسالة.');
      }
      return false;
    }
  }, [latestSequence, refreshStatus, status, targetUid, user?.uid]);

  const sendEmoji = useCallback(async (emoji: string, replyToMessageId = '') => {
    if (!status?.accepted || !user?.uid) return false;
    try {
      await requestDirectChatCommand({
        action: 'send-direct-message',
        payload: { kind: 'emoji', replyToMessageId, targetUid, text: emoji },
        requestId: createDirectChatRequestId(),
      });
      void refreshStatus();
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to send emoji.');
      }
      return false;
    }
  }, [refreshStatus, status?.accepted, targetUid, user?.uid]);

  const sendSticker = useCallback(async (stickerItemId: string, replyToMessageId = '') => {
    if (!status?.accepted || !user?.uid) return false;
    try {
      await requestDirectChatCommand({
        action: 'send-direct-message',
        payload: { kind: 'sticker', replyToMessageId, stickerItemId, targetUid },
        requestId: createDirectChatRequestId(),
      });
      void refreshStatus();
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to send sticker.');
      }
      return false;
    }
  }, [refreshStatus, status?.accepted, targetUid, user?.uid]);

  const decideRequest = useCallback(async (decision: 'accept' | 'reject') => {
    await requestDirectChatCommand({
      action: decision === 'accept' ? 'accept-message-request' : 'reject-message-request',
      payload: { targetUid },
      requestId: createDirectChatRequestId(),
    });
    await loadInitial();
  }, [loadInitial, targetUid]);

  const unsend = useCallback(async (messageId: string) => {
    await requestDirectChatCommand({
      action: 'unsend-direct-message',
      payload: { messageId, targetUid },
      requestId: createDirectChatRequestId(),
    });
  }, [targetUid]);

  const report = useCallback(async (category: DirectChatReportCategory, messageIds: string[], details = '') => {
    const response = await requestDirectChatCommand<{ reportId: string }>({
      action: 'report-direct-chat',
      payload: { category, ...(details ? { details } : {}), messageIds, targetUid },
      requestId: createDirectChatRequestId(),
    });
    return response.result.reportId;
  }, [targetUid]);

  const setTyping = useCallback((active: boolean) => {
    if (!conversationId || !status?.accepted || !user?.uid) return;
    void setDirectChatPresence({ active, conversationId, kind: 'typing', uid: user.uid }).catch(() => undefined);
  }, [conversationId, status?.accepted, user?.uid]);

  return {
    conversationId,
    decideRequest,
    errorMessage,
    hasMore,
    loadInitial,
    loadOlder,
    loading,
    loadingOlder,
    mediaEnabled: inbox.mediaEnabled,
    messages,
    peerOnline,
    peerReadSequence,
    peerTyping,
    projection,
    report,
    retentionPurgedThroughSequence,
    send,
    sendEmoji,
    sendSticker,
    setTyping,
    status,
    unsend,
  };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
