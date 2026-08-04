export type DirectChatRealtimeProjection = {
  archived: boolean;
  clearedThroughSequence: number;
  conversationId: string;
  lastMessageId: string;
  lastMessageKind: string;
  lastMessagePreview: string;
  lastMessageSenderUid: string;
  lastReadSequence: number;
  lastSequence: number;
  muted: boolean;
  ownerUid: string;
  peerUid: string;
  recipientUid: string;
  requestState: string;
  requesterUid: string;
  unreadCount: number;
  updatedAtMs: number;
};

export type DirectChatRealtimeMessage = {
  attachmentId: string;
  createdAtMs: number;
  id: string;
  kind: string;
  mediaContentType: string;
  mediaDurationMs: number;
  mediaHeight: number;
  mediaPath: string;
  mediaWidth: number;
  replyToMessageId: string;
  senderUid: string;
  sequence: number;
  sticker?: { assetId: string; assetVersionId: string; itemId: string };
  systemType: string;
  text: string;
  visibilityState: 'visible' | 'unsent';
};

type ListenerOptions<T> = {
  onData: (items: T[]) => void;
  onError?: (error: Error) => void;
};

export async function subscribeDirectChatInbox(
  uid: string,
  options: ListenerOptions<DirectChatRealtimeProjection> & { limit?: number },
) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  const pageSize = Math.min(Math.max(options.limit || 30, 1), 50);
  return firestore.onSnapshot(
    firestore.query(
      firestore.collection(firebaseDb, 'directConversationMembers', uid, 'items'),
      firestore.where('archived', '==', false),
      firestore.orderBy('updatedAt', 'desc'),
      firestore.orderBy('conversationId', 'desc'),
      firestore.limit(pageSize),
    ),
    (snapshot) => options.onData(snapshot.docs.map((document) => mapRealtimeProjection(document.data(), uid)).filter(isPresent)),
    (error) => options.onError?.(error),
  );
}

export async function subscribeDirectChatThreadTail(
  conversationId: string,
  clearedThroughSequence: number,
  options: ListenerOptions<DirectChatRealtimeMessage> & { limit?: number },
) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  const pageSize = Math.min(Math.max(options.limit || 40, 1), 50);
  return firestore.onSnapshot(
    firestore.query(
      firestore.collection(firebaseDb, 'directConversations', conversationId, 'messages'),
      firestore.where('sequence', '>', Math.max(0, clearedThroughSequence)),
      firestore.orderBy('sequence', 'desc'),
      firestore.limit(pageSize),
    ),
    (snapshot) => options.onData(snapshot.docs.map((document) => mapRealtimeMessage(document.data(), document.id)).filter(isPresent).reverse()),
    (error) => options.onError?.(error),
  );
}

export async function subscribeDirectChatUnreadSummary(uid: string, onValue: (totalUnreadCount: number) => void) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  return firestore.onSnapshot(
    firestore.doc(firebaseDb, 'directChatInboxSummaries', uid),
    (snapshot) => {
      const value = snapshot.data();
      onValue(value?.uid === uid ? safeInteger(value.totalUnreadCount) : 0);
    },
    () => onValue(0),
  );
}

export async function subscribeDirectChatReadReceipt(
  conversationId: string,
  peerUid: string,
  onValue: (lastReadSequence: number) => void,
) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  return firestore.onSnapshot(
    firestore.doc(firebaseDb, 'directConversations', conversationId, 'receipts', peerUid),
    (snapshot) => {
      const value = snapshot.data();
      onValue(value?.uid === peerUid && value?.conversationId === conversationId ? safeInteger(value.lastReadSequence) : 0);
    },
    () => onValue(0),
  );
}

export async function subscribeDirectChatPresence(
  kind: 'online' | 'typing',
  conversationId: string,
  peerUid: string,
  onValue: (active: boolean) => void,
) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  return firestore.onSnapshot(
    firestore.doc(firebaseDb, 'directChatPresence', conversationId, kind, peerUid),
    (snapshot) => {
      const value = snapshot.data();
      const expiresAtMs = timestampMillis(value?.expiresAt);
      onValue(Boolean(value?.uid === peerUid && expiresAtMs > Date.now() && (kind === 'typing' ? value?.value === true : value?.value === 'online')));
    },
    () => onValue(false),
  );
}

export async function setDirectChatPresence({
  active,
  conversationId,
  kind,
  uid,
}: {
  active: boolean;
  conversationId: string;
  kind: 'online' | 'typing';
  uid: string;
}) {
  const [{ firebaseDb }, firestore] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  const reference = firestore.doc(firebaseDb, 'directChatPresence', conversationId, kind, uid);
  if (!active) {
    await firestore.deleteDoc(reference);
    return;
  }
  const lifetimeMs = kind === 'typing' ? 45_000 : 90_000;
  await firestore.setDoc(reference, {
    conversationId,
    expiresAt: firestore.Timestamp.fromMillis(Date.now() + lifetimeMs),
    kind,
    uid,
    updatedAt: firestore.serverTimestamp(),
    value: kind === 'typing' ? true : 'online',
  });
}

export function mapRealtimeProjection(value: Record<string, unknown>, ownerUid: string): DirectChatRealtimeProjection | undefined {
  if (value.ownerUid !== ownerUid || typeof value.conversationId !== 'string' || typeof value.peerUid !== 'string') return undefined;
  return {
    archived: value.archived === true,
    clearedThroughSequence: safeInteger(value.clearedThroughSequence),
    conversationId: value.conversationId,
    lastMessageId: safeString(value.lastMessageId),
    lastMessageKind: safeString(value.lastMessageKind),
    lastMessagePreview: safeString(value.lastMessagePreview),
    lastMessageSenderUid: safeString(value.lastMessageSenderUid),
    lastReadSequence: safeInteger(value.lastReadSequence),
    lastSequence: safeInteger(value.lastSequence),
    muted: value.muted === true,
    ownerUid,
    peerUid: value.peerUid,
    recipientUid: safeString(value.recipientUid),
    requestState: safeString(value.requestState),
    requesterUid: safeString(value.requesterUid),
    unreadCount: safeInteger(value.unreadCount),
    updatedAtMs: timestampMillis(value.updatedAt),
  };
}

export function mapRealtimeMessage(value: Record<string, unknown>, id: string): DirectChatRealtimeMessage | undefined {
  if (!Number.isSafeInteger(value.sequence) || !['visible', 'unsent'].includes(String(value.visibilityState))) return undefined;
  const visibilityState = value.visibilityState as 'visible' | 'unsent';
  return {
    attachmentId: safeString(value.attachmentId),
    createdAtMs: timestampMillis(value.createdAt),
    id,
    kind: safeString(value.kind),
    mediaContentType: safeString(value.mediaContentType),
    mediaDurationMs: safeInteger(value.mediaDurationMs),
    mediaHeight: safeInteger(value.mediaHeight),
    mediaPath: safeString(value.mediaPath),
    mediaWidth: safeInteger(value.mediaWidth),
    replyToMessageId: safeString(value.replyToMessageId),
    senderUid: safeString(value.senderUid),
    sequence: Number(value.sequence),
    sticker: mapSticker(value.sticker),
    systemType: safeString(value.systemType),
    text: visibilityState === 'visible' ? safeString(value.text) : '',
    visibilityState,
  };
}

function mapSticker(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const sticker = value as Record<string, unknown>;
  const assetId = safeString(sticker.assetId);
  const assetVersionId = safeString(sticker.assetVersionId);
  const itemId = safeString(sticker.itemId);
  return assetId && assetVersionId && itemId ? { assetId, assetVersionId, itemId } : undefined;
}

function timestampMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object') {
    const timestamp = value as { _nanoseconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; seconds?: unknown };
    const seconds = Number(timestamp.seconds ?? timestamp._seconds);
    const nanoseconds = Number(timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) return (seconds * 1_000) + Math.floor(nanoseconds / 1_000_000);
  }
  return 0;
}

function safeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
