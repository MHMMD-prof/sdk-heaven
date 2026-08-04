import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import type { AdminRocketAsset } from './adminDashboardApi';
import { firebaseStorage } from './firebase';

type RocketAssetSlot = 'animation' | 'sound' | 'static';

const limits = {
  animation: 12 * 1024 * 1024,
  sound: 2 * 1024 * 1024,
  static: 4 * 1024 * 1024,
} as const;

export async function uploadRoomRocketAsset(
  file: File,
  slot: RocketAssetSlot,
  version: number,
): Promise<AdminRocketAsset> {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('A valid immutable asset version is required.');
  const format = readFormat(file, slot);
  if (!format || file.size < 1 || file.size > limits[slot]) {
    throw new Error(`The ${slot} asset type or size is not allowed.`);
  }
  const fileName = slot === 'static' ? `static.${format}` : slot === 'animation' ? 'animation.webp' : `launch.${format}`;
  const storagePath = `room-rockets/global-room-rocket/v${version}/${fileName}`;
  const assetRef = ref(firebaseStorage, storagePath);
  const media: { durationMs?: number; height?: number; width?: number } = slot === 'sound'
    ? await inspectAudio(file)
    : await inspectImage(file);
  await uploadBytes(assetRef, file, {
    cacheControl: 'public,max-age=31536000,immutable',
    contentType: file.type,
  });
  return {
    bytes: file.size,
    ...(media.durationMs ? { durationMs: media.durationMs } : {}),
    format,
    ...(media.height ? { height: media.height } : {}),
    storagePath,
    uri: await getDownloadURL(assetRef),
    version,
    ...(media.width ? { width: media.width } : {}),
  };
}

function readFormat(file: File, slot: RocketAssetSlot): AdminRocketAsset['format'] | undefined {
  if (slot === 'animation') return file.type === 'image/webp' ? 'animated-webp' : undefined;
  if (slot === 'static') {
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    return undefined;
  }
  if (file.type === 'audio/mpeg') return 'mp3';
  if (['audio/mp4', 'audio/x-m4a'].includes(file.type)) return 'm4a';
  return undefined;
}

async function inspectImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const result = { height: bitmap.height, width: bitmap.width };
  bitmap.close();
  return result;
}

async function inspectAudio(file: File): Promise<{ durationMs: number }> {
  const uri = URL.createObjectURL(file);
  try {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = uri;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error('The audio metadata could not be read.'));
    });
    const durationMs = Math.round(audio.duration * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 12_000) {
      throw new Error('Rocket sound must be between 1 ms and 12 seconds.');
    }
    return { durationMs };
  } finally {
    URL.revokeObjectURL(uri);
  }
}
