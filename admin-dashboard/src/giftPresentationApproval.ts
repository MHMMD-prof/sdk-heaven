import type { AdminGiftCatalogItem } from './adminDashboardApi';

type Presentation = AdminGiftCatalogItem['presentation'];

export function giftPresentationApprovalScope(value: Presentation) {
  return JSON.stringify({
    audioAsset: value.audioAsset || null,
    audioFormat: value.audioFormat || null,
    durationMs: value.durationMs,
    fallbackAsset: value.fallbackAsset || null,
    fallbackFormat: value.fallbackFormat || null,
    hapticPolicy: value.hapticPolicy,
    minimumClientVersion: value.minimumClientVersion,
    performanceTier: value.performanceTier,
    soundPolicy: value.soundPolicy,
    tier: value.tier,
    visualAsset: value.visualAsset || null,
    visualFormat: value.visualFormat || null,
  });
}

export function isSameGiftPresentationApprovalScope(left: Presentation, right: Presentation) {
  return left.animationEnabled === true
    && right.animationEnabled === true
    && giftPresentationApprovalScope(left) === giftPresentationApprovalScope(right);
}
