import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { getBytes, getStorage, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { Platform } from 'react-native';

import { firebaseApp } from '../auth/firebase';
import { createDirectChatRequestId, requestDirectChatCommand } from './requestDirectChatCommand';

export const DIRECT_CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
export const DIRECT_CHAT_VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const DIRECT_CHAT_VOICE_MAX_SECONDS = 120;

export type DirectChatUploadKind = 'image' | 'voice-note';
export type DirectChatLocalAttachment = {
  contentType: 'audio/aac' | 'audio/mp4' | 'audio/x-m4a' | 'image/jpeg' | 'image/png' | 'image/webp';
  kind: DirectChatUploadKind;
  sizeBytes: number;
  uri: string;
};
export type DirectChatUploadProgress = { bytesTransferred: number; progress: number; totalBytes: number };
export type DirectChatUploadController = { cancel: () => boolean; completed: Promise<{ messageId: string; sequence: number }> };

type Authorization = {
  contentType: string;
  conversationId: string;
  kind: DirectChatUploadKind;
  sizeBytes: number;
  storagePath: string;
  uploadId: string;
};

const storage = getStorage(firebaseApp);
let mediaCacheRoot: Directory | undefined;

export function validateLocalAttachment(value: DirectChatLocalAttachment) {
  const file = new File(value.uri);
  const actualSize = Number(value.sizeBytes || file.size || 0);
  const allowed = value.kind === 'image'
    ? ['image/jpeg', 'image/png', 'image/webp'].includes(value.contentType) && actualSize <= DIRECT_CHAT_IMAGE_MAX_BYTES
    : ['audio/aac', 'audio/mp4', 'audio/x-m4a'].includes(value.contentType) && actualSize <= DIRECT_CHAT_VOICE_MAX_BYTES;
  if (!file.exists || !Number.isSafeInteger(actualSize) || actualSize < 1 || !allowed) {
    throw new Error(value.kind === 'image' ? 'IMAGE_UNSUPPORTED_OR_TOO_LARGE' : 'VOICE_UNSUPPORTED_OR_TOO_LARGE');
  }
  return { ...value, sizeBytes: actualSize };
}

export function beginDirectChatUpload({
  attachment,
  onProgress,
  replyToMessageId = '',
  targetUid,
}: {
  attachment: DirectChatLocalAttachment;
  onProgress?: (value: DirectChatUploadProgress) => void;
  replyToMessageId?: string;
  targetUid: string;
}): DirectChatUploadController {
  let task: UploadTask | undefined;
  let cancelled = false;
  const completed = (async () => {
    const local = validateLocalAttachment(attachment);
    const authorizationRequestId = createDirectChatRequestId();
    const response = await requestDirectChatCommand<Authorization>({
      action: 'create-direct-chat-upload',
      payload: { contentType: local.contentType, kind: local.kind, sizeBytes: local.sizeBytes, targetUid },
      requestId: authorizationRequestId,
    });
    if (cancelled) throw new Error('UPLOAD_CANCELLED');
    const authorization = response.result;
    const bytes = await new File(local.uri).bytes();
    if (bytes.byteLength !== local.sizeBytes) throw new Error('UPLOAD_SOURCE_CHANGED');
    task = uploadBytesResumable(ref(storage, authorization.storagePath), bytes, {
      cacheControl: 'private,no-store,max-age=0',
      contentType: authorization.contentType,
      customMetadata: {
        conversationId: authorization.conversationId,
        kind: authorization.kind,
        uploadId: authorization.uploadId,
        uploaderUid: (await import('../auth/firebase')).firebaseAuth.currentUser?.uid || '',
      },
    });
    await new Promise<void>((resolve, reject) => task?.on('state_changed', (snapshot) => {
      const totalBytes = Math.max(1, snapshot.totalBytes);
      onProgress?.({ bytesTransferred: snapshot.bytesTransferred, progress: snapshot.bytesTransferred / totalBytes, totalBytes });
    }, reject, resolve));
    if (cancelled) throw new Error('UPLOAD_CANCELLED');
    const finalized = await requestDirectChatCommand<{ messageId: string; sequence: number }>({
      action: 'finalize-direct-chat-upload',
      payload: { replyToMessageId, targetUid, uploadId: authorization.uploadId },
      requestId: createDirectChatRequestId(),
    }, { timeoutMs: 30_000 });
    return finalized.result;
  })();
  return {
    cancel: () => {
      cancelled = true;
      return task?.cancel() ?? true;
    },
    completed,
  };
}

export async function prepareProtectedDirectChatMedia(uid: string, mediaPath: string) {
  if (!uid || !/^direct-chat-media\/[a-f0-9]{64}\/dmu_[a-f0-9]{40}\/(image\.webp|voice\.(m4a|aac))$/.test(mediaPath)) {
    throw new Error('MEDIA_PATH_INVALID');
  }
  const extension = mediaPath.endsWith('.webp') ? 'webp' : mediaPath.endsWith('.aac') ? 'aac' : 'm4a';
  const maxBytes = extension === 'webp' ? DIRECT_CHAT_IMAGE_MAX_BYTES : DIRECT_CHAT_VOICE_MAX_BYTES;
  if (Platform.OS === 'web') {
    const bytes = await getBytes(ref(storage, mediaPath), maxBytes);
    const contentType = extension === 'webp' ? 'image/webp' : extension === 'aac' ? 'audio/aac' : 'audio/mp4';
    return URL.createObjectURL(new Blob([bytes], { type: contentType }));
  }
  const cacheRoot = ensureCacheRoot();
  const userDirectory = new Directory(cacheRoot, await safeCacheSegment(uid));
  if (!userDirectory.exists) userDirectory.create({ idempotent: true, intermediates: true });
  const file = new File(userDirectory, `${await safeCacheSegment(mediaPath)}.${extension}`);
  if (file.exists && file.size > 0) return file.uri;
  const bytes = await getBytes(ref(storage, mediaPath), maxBytes);
  file.create({ intermediates: true, overwrite: true });
  file.write(new Uint8Array(bytes));
  return file.uri;
}

export async function clearProtectedDirectChatMedia(uid: string) {
  if (!uid || Platform.OS === 'web') return;
  const cacheRoot = ensureCacheRoot();
  if (!cacheRoot.exists) return;
  const directory = new Directory(cacheRoot, await safeCacheSegment(uid));
  if (directory.exists) directory.delete();
}

function ensureCacheRoot() {
  if (Platform.OS === 'web') throw new Error('DIRECT_CHAT_MEDIA_UNSUPPORTED_PLATFORM');
  mediaCacheRoot ??= new Directory(Paths.cache, 'direct-chat-media-v1');
  if (!mediaCacheRoot.exists) mediaCacheRoot.create({ idempotent: true, intermediates: true });
  return mediaCacheRoot;
}

async function safeCacheSegment(value: string) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
}
