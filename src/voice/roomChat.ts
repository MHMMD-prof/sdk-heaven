import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase/firestore';

import {
  RoomMessageDocument,
  RoomHistoryVisibility,
  mapRoomMessageDocument,
} from './roomV2Contract';
import {
  RoomChatCommandRequest,
  RoomChatCommandResult,
  createRoomChatRequestId,
  requestRoomChatCommand,
} from './requestRoomChatCommand';
import { VoiceProviderConfig } from './types';
import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';

export type RoomChatDeliveryStatus = 'failed' | 'pending' | 'sent';
export type RoomChatMessage = RoomMessageDocument & {
  deliveryStatus: RoomChatDeliveryStatus;
};

type UseRoomChatInput = {
  avatarLabel: string;
  avatarFrame?: AvatarFrameProjection;
  config?: VoiceProviderConfig['liveKit'];
  displayName: string;
  enabled: boolean;
  historyVisibility: RoomHistoryVisibility;
  roomId: string;
  uid?: string;
};

const PAGE_SIZE = 50;

export function useRoomChat({
  avatarLabel,
  avatarFrame,
  config,
  displayName,
  enabled,
  historyVisibility,
  roomId,
  uid,
}: UseRoomChatInput) {
  const [serverMessages, setServerMessages] = useState<RoomChatMessage[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<RoomChatMessage[]>([]);
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  const [pinnedMessageId, setPinnedMessageId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const oldestCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | undefined>(undefined);
  const boundaryMsRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !uid || !roomId) {
      setServerMessages([]);
      setPinnedMessageId('');
      setHasOlderMessages(false);
      oldestCursorRef.current = undefined;
      boundaryMsRef.current = undefined;
      return undefined;
    }
    let mounted = true;
    const unsubscribers: (() => void)[] = [];
    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(async ([{ firebaseDb }, firestore]) => {
      if (!mounted) return;
      const boundaryMs = await resolveHistoryBoundary({
        firebaseDb,
        firestore,
        historyVisibility,
        roomId,
        uid,
      });
      if (!mounted) return;
      boundaryMsRef.current = boundaryMs;
      const messagesRef = firestore.collection(firebaseDb, 'rooms', roomId, 'messages');
      const constraints = [
        ...(boundaryMs === undefined
          ? []
          : [firestore.where('createdAt', '>=', firestore.Timestamp.fromMillis(boundaryMs))]),
        firestore.orderBy('createdAt', 'desc'),
        firestore.limit(PAGE_SIZE),
      ];
      unsubscribers.push(
        firestore.onSnapshot(
          firestore.query(messagesRef, ...constraints),
          (snapshot) => {
            if (!mounted) return;
            const mapped = snapshot.docs
              .map((item) => mapRoomMessageDocument(item.data(), item.id))
              .filter(isPresent)
              .map((message) => ({ ...message, deliveryStatus: 'sent' as const }));
            setServerMessages(mapped);
            oldestCursorRef.current = snapshot.docs.at(-1);
            setHasOlderMessages(snapshot.size === PAGE_SIZE);
            setErrorMessage('');
          },
          () => {
            if (mounted) setErrorMessage('تعذر تحميل رسائل الغرفة.');
          },
        ),
        firestore.onSnapshot(
          firestore.doc(firebaseDb, 'rooms', roomId, 'chatState', 'current'),
          (snapshot) => {
            if (!mounted) return;
            const value = snapshot.data()?.pinnedMessageId;
            setPinnedMessageId(typeof value === 'string' ? value : '');
          },
          () => {
            if (mounted) setPinnedMessageId('');
          },
        ),
      );
    }).catch(() => {
      if (mounted) setErrorMessage('تعذر بدء دردشة الغرفة.');
    });

    return () => {
      mounted = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, historyVisibility, roomId, uid]);

  useEffect(() => {
    if (!uid) {
      setBlockedUids(new Set());
      return undefined;
    }
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(([{ firebaseDb }, firestore]) => {
      if (!mounted) return;
      unsubscribe = firestore.onSnapshot(
        firestore.collection(firebaseDb, 'blocks', uid, 'blocked'),
        (snapshot) => {
          if (mounted) setBlockedUids(new Set(snapshot.docs.map((item) => item.id)));
        },
        () => {
          if (mounted) setBlockedUids(new Set());
        },
      );
    }).catch(() => {
      if (mounted) setBlockedUids(new Set());
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [uid]);

  const visibleServerMessages = useMemo(
    () => serverMessages.filter(
      (message) => message.kind === 'moderation'
        || message.senderUid === uid
        || !blockedUids.has(message.senderUid),
    ),
    [blockedUids, serverMessages, uid],
  );
  const serverIds = useMemo(
    () => new Set(visibleServerMessages.map((message) => message.id)),
    [visibleServerMessages],
  );
  const messages = useMemo(
    () => [...visibleServerMessages, ...optimisticMessages.filter((message) => !serverIds.has(message.id))]
      .sort((first, second) => (first.createdAtMs || 0) - (second.createdAtMs || 0)),
    [optimisticMessages, serverIds, visibleServerMessages],
  );

  const sendMessage = useCallback(async (text: string) => {
    if (!uid) throw new Error('Active membership is required.');
    const normalized = text.normalize('NFKC').trim().slice(0, 280);
    if (!normalized) throw new Error('اكتب رسالة قبل الإرسال.');
    const requestId = createRoomChatRequestId();
    const messageId = `chat_${requestId}`;
    const optimistic: RoomChatMessage = {
      id: messageId,
      schemaVersion: 2,
      roomId,
      senderUid: uid,
      senderDisplayName: displayName,
      senderAvatarLabel: avatarLabel,
      ...(avatarFrame ? { senderAvatarFrame: avatarFrame } : {}),
      kind: 'chat',
      text: normalized,
      status: 'active',
      revision: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      deliveryStatus: 'pending',
    };
    setOptimisticMessages((current) => [...current, optimistic]);
    try {
      const result = await requestRoomChatCommand({
        action: 'send-message',
        requestId,
        roomId,
        text: normalized,
      }, config);
      setOptimisticMessages((current) => current.map(
        (message) => message.id === messageId ? { ...message, deliveryStatus: 'sent' } : message,
      ));
      setErrorMessage('');
      return result;
    } catch (error) {
      setOptimisticMessages((current) => current.map(
        (message) => message.id === messageId ? { ...message, deliveryStatus: 'failed' } : message,
      ));
      setErrorMessage(error instanceof Error ? error.message : 'تعذر إرسال الرسالة.');
      throw error;
    }
  }, [avatarFrame, avatarLabel, config, displayName, roomId, uid]);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = optimisticMessages.find(
      (candidate) => candidate.id === messageId && candidate.deliveryStatus === 'failed',
    );
    if (!message) return undefined;
    const requestId = message.id.replace(/^chat_/, '');
    setOptimisticMessages((current) => current.map(
      (candidate) => candidate.id === messageId ? { ...candidate, deliveryStatus: 'pending' } : candidate,
    ));
    try {
      const result = await requestRoomChatCommand({
        action: 'send-message',
        requestId,
        roomId,
        text: message.text,
      }, config);
      setOptimisticMessages((current) => current.map(
        (candidate) => candidate.id === messageId ? { ...candidate, deliveryStatus: 'sent' } : candidate,
      ));
      return result;
    } catch (error) {
      setOptimisticMessages((current) => current.map(
        (candidate) => candidate.id === messageId ? { ...candidate, deliveryStatus: 'failed' } : candidate,
      ));
      setErrorMessage(error instanceof Error ? error.message : 'تعذر إعادة إرسال الرسالة.');
      throw error;
    }
  }, [config, optimisticMessages, roomId]);

  const execute = useCallback(
    (request: Omit<RoomChatCommandRequest, 'roomId'>): Promise<RoomChatCommandResult> =>
      requestRoomChatCommand({ ...request, roomId }, config),
    [config, roomId],
  );

  const loadOlder = useCallback(async () => {
    const cursor = oldestCursorRef.current;
    if (!cursor || !hasOlderMessages || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const [{ firebaseDb }, firestore] = await Promise.all([
        import('../auth/firebase'),
        import('firebase/firestore'),
      ]);
      const constraints = [
        ...(boundaryMsRef.current === undefined
          ? []
          : [firestore.where('createdAt', '>=', firestore.Timestamp.fromMillis(boundaryMsRef.current))]),
        firestore.orderBy('createdAt', 'desc'),
        firestore.startAfter(cursor),
        firestore.limit(PAGE_SIZE),
      ];
      const snapshot = await firestore.getDocs(firestore.query(
        firestore.collection(firebaseDb, 'rooms', roomId, 'messages'),
        ...constraints,
      ));
      const older = snapshot.docs
        .map((item) => mapRoomMessageDocument(item.data(), item.id))
        .filter(isPresent)
        .map((message) => ({ ...message, deliveryStatus: 'sent' as const }));
      setServerMessages((current) => dedupeMessages([...current, ...older]));
      oldestCursorRef.current = snapshot.docs.at(-1) || cursor;
      setHasOlderMessages(snapshot.size === PAGE_SIZE);
    } catch {
      setErrorMessage('تعذر تحميل الرسائل الأقدم.');
    } finally {
      setIsLoadingOlder(false);
    }
  }, [hasOlderMessages, isLoadingOlder, roomId]);

  return {
    blockedUids,
    errorMessage,
    execute,
    hasOlderMessages,
    isLoadingOlder,
    loadOlder,
    messages,
    pinnedMessageId,
    retryMessage,
    sendMessage,
  };
}

export function dedupeMessages(messages: RoomChatMessage[]) {
  return [...new Map(messages.map((message) => [message.id, message])).values()];
}

async function resolveHistoryBoundary({
  firebaseDb,
  firestore,
  historyVisibility,
  roomId,
  uid,
}: {
  firebaseDb: Firestore;
  firestore: typeof import('firebase/firestore');
  historyVisibility: RoomHistoryVisibility;
  roomId: string;
  uid: string;
}) {
  if (historyVisibility === 'everyone') return undefined;
  const collectionName = historyVisibility === 'hidden' ? 'presence' : 'members';
  const snapshot = await firestore.getDoc(
    firestore.doc(
      firebaseDb,
      'rooms',
      roomId,
      collectionName,
      uid,
    ),
  );
  const joinedAt = snapshot.data()?.joinedAt;
  return timestampToMillis(joinedAt) ?? Date.now();
}

function timestampToMillis(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { nanoseconds?: unknown; seconds?: unknown; toMillis?: unknown };
  if (typeof candidate.toMillis === 'function') {
    const millis = candidate.toMillis.call(value);
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined;
  }
  return typeof candidate.seconds === 'number'
    ? (candidate.seconds * 1_000) + Math.floor(
      (typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0) / 1_000_000,
    )
    : undefined;
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}
