import type { AdminStoreCatalogItem } from './adminDashboardApi';

export type CosmeticAssetFormat = 'png' | 'jpeg' | 'legacy-webp' | 'lottie-json' | 'mp4' | 'm4a-aac';
export type CosmeticAssetReference = { assetId: string; assetVersionId: string };

export type CosmeticAssetRequirement = {
  category: string;
  formats: CosmeticAssetFormat[];
  label: string;
  usage: 'static' | 'looping' | 'one-shot';
};

const equipmentRequirements: Partial<Record<AdminStoreCatalogItem['category'], CosmeticAssetRequirement>> = {
  'avatar-frames': requirement('avatar-frame', ['png', 'lottie-json', 'legacy-webp'], 'إطار الصورة', 'looping'),
  'profile-skins': requirement('profile-skin', ['png', 'jpeg', 'legacy-webp'], 'خلفية الملف', 'static'),
  'chat-bubbles': requirement('chat-bubble', ['png', 'lottie-json', 'legacy-webp'], 'فقاعة الدردشة', 'looping'),
  nameplates: requirement('nameplate', ['png', 'lottie-json', 'legacy-webp'], 'لوحة الاسم', 'looping'),
  'cosmetic-badges': requirement('cosmetic-badge', ['png', 'lottie-json', 'legacy-webp'], 'الشارة التجميلية', 'looping'),
  'seat-effects': requirement('seat-effect', ['png', 'lottie-json', 'legacy-webp'], 'تأثير المقعد', 'looping'),
  'couple-effects': requirement('couple-effect', ['png', 'lottie-json'], 'تأثير الارتباط', 'looping'),
  stickers: requirement('room-reaction', ['png', 'lottie-json', 'legacy-webp'], 'ملصق الغرفة', 'looping'),
};

export const giftAssetRequirement = requirement('gift-effect', ['lottie-json', 'mp4'], 'عرض الهدية', 'one-shot');
export const entryAssetRequirement = requirement('entry-effect', ['lottie-json', 'mp4'], 'تأثير الدخول', 'one-shot');
export const effectAudioRequirement = requirement('effect-audio', ['m4a-aac'], 'صوت التأثير', 'one-shot');
export const roomThemeBackgroundRequirement = requirement('room-theme', ['mp4'], 'حركة خلفية الغرفة', 'looping');
export const roomThemeAmbientRequirement = requirement('room-theme', ['lottie-json'], 'حركة محيطية للغرفة', 'looping');

export function getStoreCosmeticAssetRequirement(category: AdminStoreCatalogItem['category']) {
  return equipmentRequirements[category];
}

export function requiresExplicitCosmeticAsset(category: AdminStoreCatalogItem['category']) {
  return Boolean(equipmentRequirements[category]);
}

export function assetSlotForCategory(category: string) {
  return ({
    'avatar-frame': 'avatar-frame',
    'chat-bubble': 'chat-bubble',
    'cosmetic-badge': 'cosmetic-badge',
    'entry-effect': 'entry-effect',
    nameplate: 'nameplate',
    'profile-skin': 'profile-skin',
    'seat-effect': 'seat-effect',
  } as Record<string, string>)[category] || '';
}

export function isAnimatedFormat(format: string) {
  return format === 'lottie-json' || format === 'mp4';
}

export function buildCosmeticDependencyAssetId(
  primaryAssetId: string,
  kind: 'audio' | 'fallback',
  primaryVersionId: string,
) {
  const versionToken = primaryVersionId.split('-').at(-1) || '';
  const suffix = `-${kind}-${versionToken}`;
  return `${primaryAssetId.slice(0, 80 - suffix.length)}${suffix}`;
}

export function staticFormatsForCategory(category: string): CosmeticAssetFormat[] {
  return category === 'profile-skin' || category === 'room-theme'
    ? ['png', 'jpeg']
    : ['png'];
}

function requirement(category: string, formats: CosmeticAssetFormat[], label: string, usage: CosmeticAssetRequirement['usage']): CosmeticAssetRequirement {
  return { category, formats, label, usage };
}
