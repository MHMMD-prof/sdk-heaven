import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';

import { firebaseApp, firebaseAuth } from '../auth/firebase';
import type { AvatarUploadAuthorization } from './types';

export type PreparedAvatarSource = {
  bytes: Uint8Array;
  contentType: AvatarUploadAuthorization['contentType'];
  sha256: string;
  sizeBytes: number;
  uri: string;
};

export async function prepareAvatarSource(
  uri: string,
  mimeType?: string | null,
  reportedSize?: number | null,
): Promise<PreparedAvatarSource> {
  const contentType = normalizeContentType(mimeType, uri);
  if (!contentType) throw new Error('UNSUPPORTED_FORMAT');
  const file = new File(uri);
  const sizeBytes = Number(reportedSize || file.size || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5 * 1024 * 1024) {
    throw new Error('FILE_TOO_LARGE');
  }
  const bytes = await file.bytes();
  if (bytes.byteLength !== sizeBytes) throw new Error('UPLOAD_SOURCE_CHANGED');
  const sha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  return { bytes, contentType, sha256, sizeBytes, uri };
}

export async function uploadAuthorizedAvatar(
  authorization: AvatarUploadAuthorization,
  source: PreparedAvatarSource,
) {
  if (
    !authorization.sourcePath.startsWith('avatar-quarantine/')
    || authorization.contentType !== source.contentType
    || authorization.sizeBytes !== source.sizeBytes
    || authorization.sha256 !== source.sha256
  ) throw new Error('UPLOAD_SOURCE_CHANGED');

  const task = uploadBytesResumable(
    ref(getStorage(firebaseApp), authorization.sourcePath),
    source.bytes,
    {
      cacheControl: 'private,no-store,max-age=0',
      contentType: authorization.contentType,
      customMetadata: {
        sha256: authorization.sha256,
        uploaderUid: firebaseAuth.currentUser?.uid || '',
        uploadId: authorization.uploadId,
      },
    },
  );
  await new Promise<void>((resolve, reject) => task.on('state_changed', undefined, reject, resolve));
}

function normalizeContentType(value?: string | null, uri = ''): AvatarUploadAuthorization['contentType'] | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp') return normalized;
  if (/\.jpe?g(?:$|[?#])/i.test(uri)) return 'image/jpeg';
  if (/\.png(?:$|[?#])/i.test(uri)) return 'image/png';
  if (/\.webp(?:$|[?#])/i.test(uri)) return 'image/webp';
  return undefined;
}

function bytesToHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
