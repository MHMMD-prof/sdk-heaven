import {
  CosmeticAssetDescriptorV1,
  CosmeticPerformanceTier,
  CosmeticViewerMode,
  isCosmeticClientVersionCompatible,
  validateCosmeticAssetDescriptorV1,
} from './contracts';
import type { CosmeticsFeatureFlags } from './featureFlags';

export type CosmeticRendererKind = 'static' | 'lottie' | 'video' | 'audio' | 'none';
export type CosmeticRenderSource = 'primary' | 'fallback' | 'compatibility' | 'none';
export type CosmeticFallbackReason =
  | 'app-background'
  | 'asset-disabled'
  | 'audio-muted'
  | 'checksum-failed'
  | 'client-incompatible'
  | 'descriptor-invalid'
  | 'feature-disabled'
  | 'low-performance'
  | 'offline-cache-miss'
  | 'reduced-motion'
  | 'renderer-disabled'
  | 'viewer-off';

export type CosmeticRenderPlan = {
  descriptor?: CosmeticAssetDescriptorV1;
  reason?: CosmeticFallbackReason;
  renderer: CosmeticRendererKind;
  source: CosmeticRenderSource;
};

export function resolveCosmeticRenderPlan(input: {
  appActive?: boolean;
  cached?: boolean;
  compatibilityUri?: string;
  currentClientVersion: string;
  descriptor: unknown;
  deviceTier?: CosmeticPerformanceTier;
  fallbackDescriptor?: unknown;
  flags: CosmeticsFeatureFlags;
  integrity?: 'pending' | 'verified' | 'failed';
  muted?: boolean;
  online?: boolean;
  viewerMode: CosmeticViewerMode;
}): CosmeticRenderPlan {
  const primary = validateCosmeticAssetDescriptorV1(input.descriptor, {
    allowLegacyWebp: true,
    requireRenderable: true,
  });
  const fallback = validateStaticFallback(input.fallbackDescriptor);
  const compatibility = validCompatibilityUri(input.compatibilityUri);

  if (input.viewerMode === 'off') return none('viewer-off');
  if (!input.flags.assetRegistry || !input.flags.sharedRenderer) {
    return fallbackPlan(fallback, compatibility, 'feature-disabled');
  }
  if (!primary.ok) return fallbackPlan(fallback, compatibility, 'descriptor-invalid');
  const descriptor = primary.descriptor;
  if (!isCosmeticClientVersionCompatible(
    descriptor.minimumClientVersion,
    input.currentClientVersion,
  )) {
    return fallbackPlan(fallback, compatibility, 'client-incompatible');
  }
  if (input.integrity === 'failed') {
    return fallbackPlan(fallback, compatibility, 'checksum-failed');
  }
  if (input.online === false && input.cached !== true) {
    return fallbackPlan(fallback, compatibility, 'offline-cache-miss');
  }
  if (input.appActive === false) {
    return fallbackPlan(fallback, compatibility, 'app-background');
  }
  if (input.viewerMode === 'reduced' && isAnimated(descriptor)) {
    return fallbackPlan(fallback, compatibility, 'reduced-motion');
  }
  if (input.deviceTier === 'low' && descriptor.performanceTier === 'high') {
    return fallbackPlan(fallback, compatibility, 'low-performance');
  }
  if (descriptor.format === 'lottie-json' && !input.flags.lottie) {
    return fallbackPlan(fallback, compatibility, 'renderer-disabled');
  }
  if (descriptor.format === 'mp4' && !input.flags.video) {
    return fallbackPlan(fallback, compatibility, 'renderer-disabled');
  }
  if (descriptor.format === 'm4a-aac') {
    if (input.muted) return none('audio-muted');
    if (!input.flags.effectAudio) return none('renderer-disabled');
  }
  return {
    descriptor,
    renderer: rendererForFormat(descriptor.format),
    source: 'primary',
  };
}

export function rendererForFormat(format: CosmeticAssetDescriptorV1['format']): CosmeticRendererKind {
  if (format === 'lottie-json') return 'lottie';
  if (format === 'mp4') return 'video';
  if (format === 'm4a-aac') return 'audio';
  return 'static';
}

function validateStaticFallback(value: unknown): CosmeticAssetDescriptorV1 | undefined {
  const result = validateCosmeticAssetDescriptorV1(value, {
    allowLegacyWebp: true,
    requireRenderable: true,
  });
  return result.ok && rendererForFormat(result.descriptor.format) === 'static'
    ? result.descriptor
    : undefined;
}

function fallbackPlan(
  fallback: CosmeticAssetDescriptorV1 | undefined,
  compatibility: string | undefined,
  reason: CosmeticFallbackReason,
): CosmeticRenderPlan {
  if (fallback) return { descriptor: fallback, reason, renderer: 'static', source: 'fallback' };
  if (compatibility) return { reason, renderer: 'static', source: 'compatibility' };
  return none(reason);
}

function none(reason: CosmeticFallbackReason): CosmeticRenderPlan {
  return { reason, renderer: 'none', source: 'none' };
}

function validCompatibilityUri(value: unknown) {
  return typeof value === 'string' && /^https:\/\/[^\s]{1,2039}$/.test(value)
    ? value
    : undefined;
}

function isAnimated(descriptor: CosmeticAssetDescriptorV1) {
  return descriptor.format === 'lottie-json'
    || descriptor.format === 'mp4'
    || descriptor.format === 'm4a-aac';
}
