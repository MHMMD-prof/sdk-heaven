import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import type { AdminRocketAsset } from './adminDashboardApi';
import { firebaseStorage } from './firebase';

type RocketAssetSlot = 'animation' | 'sound' | 'static';
type AnimationFormat = Extract<AdminRocketAsset['format'], 'animated-webp' | 'mp4' | 'lottie-json'>;

const limits = {
  animation: 12 * 1024 * 1024,
  sound: 2 * 1024 * 1024,
  static: 4 * 1024 * 1024,
} as const;

const ANIMATION_EXTENSION: Record<AnimationFormat, string> = {
  'animated-webp': 'webp',
  'lottie-json': 'json',
  mp4: 'mp4',
};

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
  const fileName = slot === 'static'
    ? `static.${format}`
    : slot === 'animation'
      ? `animation.${ANIMATION_EXTENSION[format as AnimationFormat]}`
      : `launch.${format}`;
  const storagePath = `room-rockets/global-room-rocket/v${version}/${fileName}`;
  const assetRef = ref(firebaseStorage, storagePath);
  const media: { durationMs?: number; height?: number; width?: number } = slot === 'sound'
    ? await inspectAudio(file)
    : slot === 'animation'
      ? await inspectAnimation(file, format as AnimationFormat)
      : await inspectImage(file);
  await uploadBytes(assetRef, file, {
    cacheControl: 'public,max-age=31536000,immutable',
    contentType: file.type || contentTypeForFormat(format),
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
  if (slot === 'animation') {
    if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name)) return 'mp4';
    if (file.type === 'application/json' || /\.json$/i.test(file.name)) return 'lottie-json';
    if (file.type === 'image/webp') return 'animated-webp';
    return undefined;
  }
  if (slot === 'static') {
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    return undefined;
  }
  if (file.type === 'audio/mpeg') return 'mp3';
  if (['audio/mp4', 'audio/x-m4a'].includes(file.type)) return 'm4a';
  return undefined;
}

function contentTypeForFormat(format: AdminRocketAsset['format']) {
  switch (format) {
    case 'mp4':
      return 'video/mp4';
    case 'lottie-json':
      return 'application/json';
    case 'animated-webp':
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    default:
      return 'application/octet-stream';
  }
}

async function inspectAnimation(file: File, format: AnimationFormat) {
  if (format === 'mp4') return inspectVideo(file);
  if (format === 'lottie-json') return inspectLottie(file);
  const image = await inspectImage(file);
  return { ...image, durationMs: 3_000 };
}

async function inspectImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const result = { height: bitmap.height, width: bitmap.width };
  bitmap.close();
  return result;
}

async function inspectVideo(file: File): Promise<{ durationMs: number; height: number; width: number }> {
  const uri = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = uri;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('The video metadata could not be read.'));
    });
    const durationMs = Math.round(video.duration * 1000);
    const width = Math.round(video.videoWidth);
    const height = Math.round(video.videoHeight);
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 12_000) {
      throw new Error('Rocket animation must be between 1 ms and 12 seconds.');
    }
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new Error('Rocket animation dimensions could not be read.');
    }
    return { durationMs, height, width };
  } finally {
    URL.revokeObjectURL(uri);
  }
}

async function inspectLottie(file: File): Promise<{ durationMs: number; height: number; width: number }> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Lottie animation must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Lottie animation JSON is invalid.');
  }
  const data = parsed as Record<string, unknown>;
  const width = Number(data.w);
  const height = Number(data.h);
  const frames = Number(data.op);
  const frameRate = Number(data.fr);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Lottie animation must include width and height.');
  }
  const durationMs = Number.isFinite(frames) && Number.isFinite(frameRate) && frameRate > 0
    ? Math.round((Math.max(0, frames) / frameRate) * 1000)
    : 3_000;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 12_000) {
    throw new Error('Rocket animation must be between 1 ms and 12 seconds.');
  }
  return { durationMs, height, width };
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
