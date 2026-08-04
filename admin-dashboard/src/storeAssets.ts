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

export async function uploadRoomThemeAsset(
  user: User,
  themeId: string,
  revision: number,
  kind: 'background' | 'stage' | 'empty-seat-frame' | 'badge' | 'dock' | 'drawer',
  file: File,
): Promise<UploadedStoreAsset> {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(themeId)) throw new Error('Save a valid theme ID first.');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('A valid immutable theme revision is required.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Each theme image must be 8 MB or smaller.');
  await user.getIdToken(true);
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const assetName = kind === 'empty-seat-frame' ? 'empty-seat-frame' : kind;
  const path = `room-theme-assets/${themeId}/v${revision}/${assetName}.${extension}`;
  const assetRef = ref(firebaseStorage, path);
  await uploadBytes(assetRef, file, {
    cacheControl: 'public,max-age=31536000,immutable',
    contentType: file.type,
  });
  return { path, url: await getDownloadURL(assetRef) };
}

export async function uploadCosmeticAsset(
  user: User,
  input: {
    assetId: string;
    assetVersionId: string;
    file: File;
    format: 'png' | 'jpeg' | 'legacy-webp' | 'lottie-json' | 'mp4' | 'm4a-aac';
    ownerType: 'platform' | 'user';
    ownerUid?: string;
  },
): Promise<{ path: string }> {
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(input.assetId)) {
    throw new Error('A valid asset ID is required.');
  }
  if (!/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(input.assetVersionId)) {
    throw new Error('Use an immutable version ID such as v1-0123456789ab.');
  }
  if (
    input.ownerType === 'user'
    && !/^[^/\s]{1,128}$/.test(input.ownerUid || '')
  ) {
    throw new Error('A user-owned asset requires its approved owner UID.');
  }
  const profile = {
    jpeg: { extension: 'jpg', mime: ['image/jpeg'], maxBytes: 3 * 1024 * 1024 },
    'legacy-webp': { extension: 'webp', mime: ['image/webp'], maxBytes: 5 * 1024 * 1024 },
    'lottie-json': { extension: 'json', mime: ['application/json'], maxBytes: 1024 * 1024 },
    'm4a-aac': { extension: 'm4a', mime: ['audio/mp4', 'audio/x-m4a'], maxBytes: 500 * 1024 },
    mp4: { extension: 'mp4', mime: ['video/mp4'], maxBytes: 10 * 1024 * 1024 },
    png: { extension: 'png', mime: ['image/png'], maxBytes: 3 * 1024 * 1024 },
  }[input.format];
  if (!profile.mime.includes(input.file.type) || input.file.size > profile.maxBytes) {
    throw new Error('The selected file does not match the approved format or byte budget.');
  }
  await user.getIdToken(true);
  const ownerSegment = input.ownerType === 'platform'
    ? 'platform'
    : `users/${input.ownerUid}`;
  const path =
    `cosmetic-assets/${ownerSegment}/${input.assetId}/${input.assetVersionId}/source.${profile.extension}`;
  await uploadBytes(ref(firebaseStorage, path), input.file, {
    cacheControl: 'public,max-age=31536000,immutable',
    contentType: input.file.type,
  });
  return { path };
}
