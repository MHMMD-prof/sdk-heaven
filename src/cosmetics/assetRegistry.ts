import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { firebaseApp, firebaseDb } from '../auth/firebase';
import type { CosmeticAssetDescriptorV1 } from './contracts';
import { mapPublishedCosmeticDescriptor } from './assetRegistryCore';
import { recordCosmeticsRuntimeEvent } from './runtimeTelemetry';

export { mapPublishedCosmeticDescriptor } from './assetRegistryCore';

export type CosmeticAssetBundle = {
  audio?: CosmeticAssetDescriptorV1;
  fallback?: CosmeticAssetDescriptorV1;
  primary: CosmeticAssetDescriptorV1;
};

export type CosmeticAssetLookupResult =
  | { ok: true; bundle: CosmeticAssetBundle }
  | { ok: false; reason: string };

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const firebaseStorage = getStorage(firebaseApp);
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1_000;
const LOOKUP_CACHE_LIMIT = 64;
const lookupCache = new Map<string, { expiresAt: number; promise: Promise<CosmeticAssetLookupResult> }>();

export async function lookupPublishedCosmeticAsset(
  assetId: string,
  expectedVersionId?: string,
): Promise<CosmeticAssetLookupResult> {
  if (!ASSET_ID_PATTERN.test(assetId)
    || (expectedVersionId && !VERSION_ID_PATTERN.test(expectedVersionId))) {
    return { ok: false, reason: 'invalid-identity' };
  }
  const key = `${assetId}:${expectedVersionId || ''}`;
  const cached = lookupCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = lookupPublishedCosmeticAssetUncached(assetId, expectedVersionId);
  lookupCache.set(key, { expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS, promise });
  while (lookupCache.size > LOOKUP_CACHE_LIMIT) lookupCache.delete(lookupCache.keys().next().value as string);
  return promise;
}

async function lookupPublishedCosmeticAssetUncached(
  assetId: string,
  expectedVersionId?: string,
): Promise<CosmeticAssetLookupResult> {
  try {
    const primary = await readPublishedDescriptor(assetId, expectedVersionId);
    if (!primary) return { ok: false, reason: 'not-published' };
    const [fallback, audio] = await Promise.all([
      primary.fallbackAssetId && primary.fallbackAssetVersionId
        ? readPublishedDescriptor(primary.fallbackAssetId, primary.fallbackAssetVersionId)
        : undefined,
      primary.audioAssetId && primary.audioAssetVersionId
        ? readPublishedDescriptor(primary.audioAssetId, primary.audioAssetVersionId)
        : undefined,
    ]);
    if (primary.fallbackAssetId && (!fallback || !isStatic(fallback))) {
      return { ok: false, reason: 'fallback-unavailable' };
    }
    if (primary.audioAssetId && (!audio || audio.category !== 'effect-audio')) {
      return { ok: false, reason: 'audio-unavailable' };
    }
    recordCosmeticsRuntimeEvent('lookup', { descriptor: primary });
    return {
      ok: true,
      bundle: {
        ...(audio ? { audio } : {}),
        ...(fallback ? { fallback } : {}),
        primary,
      },
    };
  } catch {
    return { ok: false, reason: 'lookup-failed' };
  }
}

export function usePublishedCosmeticAsset(
  assetId: string | undefined,
  assetVersionId: string | undefined,
  enabled: boolean,
) {
  const [result, setResult] = useState<CosmeticAssetLookupResult>();
  useEffect(() => {
    let active = true;
    if (!enabled || !assetId || !assetVersionId) {
      setResult(undefined);
      return () => { active = false; };
    }
    void lookupPublishedCosmeticAsset(assetId, assetVersionId).then((next) => {
      if (active) setResult(next);
    });
    return () => { active = false; };
  }, [assetId, assetVersionId, enabled]);
  return result?.ok ? result.bundle : undefined;
}

async function readPublishedDescriptor(assetId: string, expectedVersionId?: string) {
  const summarySnapshot = await getDoc(doc(firebaseDb, 'cosmeticAssets', assetId));
  if (!summarySnapshot.exists()) return undefined;
  const summary = summarySnapshot.data();
  const versionId = typeof summary.publishedVersionId === 'string'
    ? summary.publishedVersionId
    : '';
  if (!VERSION_ID_PATTERN.test(versionId) || (expectedVersionId && versionId !== expectedVersionId)) {
    return undefined;
  }
  const versionSnapshot = await getDoc(
    doc(firebaseDb, 'cosmeticAssets', assetId, 'versions', versionId),
  );
  if (!versionSnapshot.exists()) return undefined;
  const version = versionSnapshot.data();
  const storagePath = typeof version.storagePath === 'string' ? version.storagePath : '';
  if (!validCanonicalPath(storagePath, version)) return undefined;
  const uri = await getDownloadURL(ref(firebaseStorage, storagePath));
  return mapPublishedCosmeticDescriptor(summary, version, uri);
}

function validCanonicalPath(path: string, version: Record<string, unknown>) {
  const assetId = String(version.assetId || '');
  const versionId = String(version.assetVersionId || '');
  const extensions: Record<string, string> = {
    jpeg: 'jpg',
    'legacy-webp': 'webp',
    'lottie-json': 'json',
    'm4a-aac': 'm4a',
    mp4: 'mp4',
    png: 'png',
  };
  const extension = extensions[String(version.format)];
  if (!extension) return false;
  if (version.ownerType === 'platform') {
    return path === `cosmetic-assets/platform/${assetId}/${versionId}/source.${extension}`;
  }
  if (version.ownerType === 'user' && typeof version.ownerUid === 'string') {
    return path === `cosmetic-assets/users/${version.ownerUid}/${assetId}/${versionId}/source.${extension}`;
  }
  return false;
}

function isStatic(descriptor: CosmeticAssetDescriptorV1) {
  return ['png', 'jpeg', 'legacy-webp'].includes(descriptor.format);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
