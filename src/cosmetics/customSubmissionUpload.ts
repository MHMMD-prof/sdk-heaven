import { File } from 'expo-file-system';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';

import { firebaseApp, firebaseAuth } from '../auth/firebase';
import type { CustomUploadAuthorization } from './customSubmissions';

export async function uploadCustomCosmeticBytes(authorization: CustomUploadAuthorization, uri: string) {
  if (!authorization.sourcePath.startsWith('cosmetic-submissions/')) {
    throw new Error('UPLOAD_INVALID');
  }
  const file = new File(uri);
  const bytes = await file.bytes();
  if (bytes.byteLength !== authorization.sizeBytes) throw new Error('UPLOAD_SOURCE_CHANGED');
  const task = uploadBytesResumable(ref(getStorage(firebaseApp), authorization.sourcePath), bytes, {
    cacheControl: 'private,no-store,max-age=0',
    contentType: authorization.contentType,
    customMetadata: {
      submissionId: authorization.submissionId,
      uploaderUid: firebaseAuth.currentUser?.uid || '',
    },
  });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', undefined, reject, resolve);
  });
}
