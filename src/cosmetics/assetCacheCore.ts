import type { CosmeticAssetDescriptorV1 } from './contracts';

export const COSMETICS_CACHE_MAX_BYTES = 40 * 1024 * 1024;
export const COSMETICS_CACHE_MAX_FILES = 40;

export function cosmeticAssetCacheFileName(
  descriptor: Pick<CosmeticAssetDescriptorV1,
    'assetId' | 'assetVersionId' | 'format' | 'sha256'>,
) {
  const extension = {
    jpeg: 'jpg',
    'legacy-webp': 'webp',
    'lottie-json': 'json',
    'm4a-aac': 'm4a',
    mp4: 'mp4',
    png: 'png',
  }[descriptor.format];
  return `${descriptor.assetId}__${descriptor.assetVersionId}__${descriptor.sha256.slice(0, 16)}.${extension}`;
}

export function selectCosmeticCacheEvictions(
  files: Array<{ modificationTime: number; name: string; size: number }>,
  keepName?: string,
) {
  let totalBytes = files.reduce((total, file) => total + Math.max(0, file.size), 0);
  let fileCount = files.length;
  const evictions: string[] = [];
  for (const file of [...files].sort((left, right) => left.modificationTime - right.modificationTime)) {
    if (totalBytes <= COSMETICS_CACHE_MAX_BYTES && fileCount <= COSMETICS_CACHE_MAX_FILES) break;
    if (file.name === keepName) continue;
    evictions.push(file.name);
    totalBytes -= Math.max(0, file.size);
    fileCount -= 1;
  }
  return evictions;
}

export function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
