import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { CosmeticAssetDescriptorV1 } from './contracts';
import {
  bytesToHex,
  cosmeticAssetCacheFileName,
  selectCosmeticCacheEvictions,
} from './assetCacheCore';
import { recordCosmeticsRuntimeEvent } from './runtimeTelemetry';

export type PreparedCosmeticAsset = {
  animationData?: Record<string, unknown>;
  cacheStatus: 'hit' | 'miss';
  descriptor: CosmeticAssetDescriptorV1;
  uri: string;
};

let cacheDirectory: Directory | undefined;
const verifiedThisSession = new Set<string>();

export async function prepareCosmeticAsset(
  descriptor: CosmeticAssetDescriptorV1,
  signal?: AbortSignal,
): Promise<PreparedCosmeticAsset> {
  throwIfAborted(signal);
  const directory = ensureCacheDirectory();
  const fileName = cosmeticAssetCacheFileName(descriptor);
  const file = new File(directory, fileName);
  const startedAt = Date.now();

  if (file.exists && Number(file.size || 0) === descriptor.byteSize) {
    if (verifiedThisSession.has(fileName) || await verifyFile(file, descriptor.sha256)) {
      verifiedThisSession.add(fileName);
      recordCosmeticsRuntimeEvent('cache-hit', {
        descriptor,
        elapsedMs: Date.now() - startedAt,
      });
      return prepared(file, descriptor, 'hit');
    }
    file.delete();
  }

  recordCosmeticsRuntimeEvent('cache-miss', { descriptor });
  throwIfAborted(signal);
  const response = await fetch(descriptor.uri, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new CosmeticAssetPreparationError('download-failed');
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > descriptor.byteSize) {
    throw new CosmeticAssetPreparationError('byte-size-mismatch');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  throwIfAborted(signal);
  if (bytes.byteLength !== descriptor.byteSize) {
    throw new CosmeticAssetPreparationError('byte-size-mismatch');
  }
  const actualSha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  if (actualSha256 !== descriptor.sha256) {
    throw new CosmeticAssetPreparationError('checksum-failed');
  }
  throwIfAborted(signal);
  file.create({ intermediates: true, overwrite: true });
  file.write(bytes);
  verifiedThisSession.add(fileName);
  recordCosmeticsRuntimeEvent('download', {
    descriptor,
    elapsedMs: Date.now() - startedAt,
  });
  pruneCosmeticCache(fileName);
  return prepared(file, descriptor, 'miss');
}

export function isCosmeticAssetCached(descriptor: CosmeticAssetDescriptorV1) {
  if (Platform.OS === 'web') return false;
  const directory = ensureCacheDirectory();
  const file = new File(directory, cosmeticAssetCacheFileName(descriptor));
  return file.exists && Number(file.size || 0) === descriptor.byteSize;
}

export function clearCosmeticAssetSessionVerification() {
  verifiedThisSession.clear();
}

async function prepared(
  file: File,
  descriptor: CosmeticAssetDescriptorV1,
  cacheStatus: PreparedCosmeticAsset['cacheStatus'],
) {
  if (descriptor.format !== 'lottie-json') {
    return { cacheStatus, descriptor, uri: file.uri };
  }
  try {
    const data: unknown = await file.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('invalid');
    }
    recordCosmeticsRuntimeEvent('decode', { descriptor });
    return {
      animationData: data as Record<string, unknown>,
      cacheStatus,
      descriptor,
      uri: file.uri,
    };
  } catch {
    throw new CosmeticAssetPreparationError('decode-failed');
  }
}

async function verifyFile(file: File, expectedSha256: string) {
  try {
    const actual = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, await file.bytes()));
    return actual === expectedSha256;
  } catch {
    return false;
  }
}

function ensureCacheDirectory() {
  if (Platform.OS === 'web') throw new CosmeticAssetPreparationError('unsupported-platform');
  cacheDirectory ??= new Directory(Paths.cache, 'cosmetics-v1');
  if (!cacheDirectory.exists) {
    cacheDirectory.create({ idempotent: true, intermediates: true });
  }
  return cacheDirectory;
}

function pruneCosmeticCache(keepName: string) {
  try {
    const directory = ensureCacheDirectory();
    const files = directory.list().filter((item): item is File => item instanceof File);
    const evictions = selectCosmeticCacheEvictions(files.map((file) => ({
      modificationTime: Number(file.modificationTime || 0),
      name: file.name,
      size: Number(file.size || 0),
    })), keepName);
    evictions.forEach((name) => {
      const file = new File(directory, name);
      if (file.exists) file.delete();
      verifiedThisSession.delete(name);
    });
  } catch {
    // Cache pruning is best-effort; rendering never depends on retaining cached files.
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CosmeticAssetPreparationError('cancelled');
}

export class CosmeticAssetPreparationError extends Error {
  constructor(readonly reason: string) {
    super(`Cosmetic asset preparation failed: ${reason}`);
    this.name = 'CosmeticAssetPreparationError';
  }
}
