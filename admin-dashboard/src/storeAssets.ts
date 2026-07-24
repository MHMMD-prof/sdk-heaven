import { User } from 'firebase/auth';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { firebaseStorage } from './firebase';
import { buildStoreAssetPath, parseManagedStoreAssetPath } from './storeEditorPolicy';

export type UploadedStoreAsset = { path: string; url: string };

export async function uploadStoreAsset(user: User, itemId: string, kind: 'thumbnail' | 'preview', file: File): Promise<UploadedStoreAsset> {
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)) throw new Error('Save a valid item ID before uploading assets.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.');
  await user.getIdToken(true);
  const path = buildStoreAssetPath(itemId, kind, crypto.randomUUID());
  const assetRef = ref(firebaseStorage, path);
  await uploadBytes(assetRef, file, { cacheControl: 'public,max-age=31536000,immutable', contentType: file.type });
  return { path, url: await getDownloadURL(assetRef) };
}

export async function removeUploadedStoreAsset(asset: UploadedStoreAsset | undefined) {
  if (!asset) return;
  await deleteObject(ref(firebaseStorage, asset.path));
}

export async function removePublishedStoreAsset(url: string, itemId: string, kind: 'thumbnail' | 'preview') {
  const path = parseManagedStoreAssetPath(url, itemId, kind);
  if (!path) return false;
  await deleteObject(ref(firebaseStorage, path));
  return true;
}
