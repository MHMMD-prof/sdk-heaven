import { AdminStoreCatalogItem } from './adminDashboardApi';

export type StoreCatalogDraft = Omit<AdminStoreCatalogItem, 'createdAt' | 'lastEditorEmail' | 'lastEditorUid' | 'updatedAt'>;

export function validateStoreCatalogDraft(item: StoreCatalogDraft, reason: string, hasThumbnail: boolean, hasPreview: boolean) {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(item.itemId)) errors.push('معرّف العنصر يجب أن يكون لاتينيًا صالحًا من 3 إلى 80 محرفًا.');
  if (item.name.ar.trim().length < 2 || item.name.en.trim().length < 2) errors.push('الاسم العربي والإنجليزي مطلوبان.');
  if (item.description.ar.trim().length < 2 || item.description.en.trim().length < 2) errors.push('الوصف العربي والإنجليزي مطلوبان.');
  if ((!item.prices.coins || item.prices.coins < 1) && (!item.prices.diamonds || item.prices.diamonds < 1)) errors.push('أدخل سعرًا صالحًا بعملة واحدة على الأقل.');
  if (item.prices.coins !== undefined && (!Number.isSafeInteger(item.prices.coins) || item.prices.coins < 1)) errors.push('سعر العملات يجب أن يكون عددًا صحيحًا موجبًا.');
  if (item.prices.diamonds !== undefined && (!Number.isSafeInteger(item.prices.diamonds) || item.prices.diamonds < 1)) errors.push('سعر الألماس يجب أن يكون عددًا صحيحًا موجبًا.');
  if (item.duration.kind === 'timed' && (!Number.isSafeInteger(item.duration.value) || item.duration.value < 1)) errors.push('قيمة المدة المحددة يجب أن تكون عددًا صحيحًا موجبًا.');
  if (item.stock.kind === 'limited' && (!Number.isSafeInteger(item.stock.remaining) || item.stock.remaining < 0)) errors.push('المخزون المتبقي يجب أن يكون عددًا صحيحًا غير سالب.');
  if (!Number.isSafeInteger(item.order) || item.order < 0) errors.push('ترتيب العنصر يجب أن يكون عددًا صحيحًا غير سالب.');
  if (item.featured && item.availability === 'disabled') errors.push('لا يمكن عرض عنصر متوقف كبطاقة مميّزة في واجهة المتجر.');
  if (item.category === 'custom-ids' && !/^[0-9]{7}$/.test(item.customId || '')) errors.push('المعرّف المخصص يجب أن يتكون من سبعة أرقام.');
  if (!hasThumbnail || !hasPreview) errors.push('الصورة المصغرة وصورة المعاينة مطلوبتان.');
  if (reason.trim().length < 2) errors.push('اكتب سببًا واضحًا للتغيير.');
  const cosmeticCategories = ['avatar-frames', 'profile-skins', 'chat-bubbles', 'nameplates', 'cosmetic-badges', 'seat-effects', 'couple-effects'];
  if (item.cosmeticAsset && !cosmeticCategories.includes(item.category)) errors.push('Cosmetic asset references are only allowed for cosmetic equipment categories.');
  if (item.cosmeticAsset && (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(item.cosmeticAsset.assetId) || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(item.cosmeticAsset.assetVersionId))) errors.push('Select an exact immutable cosmetic asset version.');
  if (item.category === 'couple-effects' && !item.cosmeticAsset) errors.push('Select one exact approved couple-effect asset version.');
  if (item.category === 'couple-effects' && !item.coupleEffectPresentation) errors.push('Choose the profile, paired-border, and entrance presentation modes.');
  if (item.coupleEffectPresentation && item.category !== 'couple-effects') errors.push('Couple-effect presentations are only allowed for couple effects.');
  if (item.coupleEffectPresentation) {
    const presentation = item.coupleEffectPresentation;
    if (!['off', 'static', 'looping'].includes(presentation.profileMode)
      || !['off', 'static', 'looping'].includes(presentation.borderMode)
      || !['off', 'static', 'one-shot'].includes(presentation.entranceMode)) {
      errors.push('Choose only supported couple-effect presentation modes.');
    } else if ([presentation.profileMode, presentation.borderMode, presentation.entranceMode].every((mode) => mode === 'off')) {
      errors.push('Enable at least one couple-effect presentation surface.');
    }
  }
  if (item.category === 'stickers' && !item.stickerAsset) errors.push('Select an exact immutable sticker asset version.');
  if (item.stickerAsset && item.category !== 'stickers') errors.push('Sticker asset references are only allowed for stickers.');
  if (item.stickerAsset && (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(item.stickerAsset.assetId) || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(item.stickerAsset.assetVersionId))) errors.push('Select an exact immutable sticker asset version.');
  if (item.entryPresentation && item.category !== 'cars') errors.push('Entry presentations are only allowed for cars.');
  if (item.entryPresentation?.animationEnabled) {
    const references = [item.entryPresentation.visualAsset, item.entryPresentation.fallbackAsset];
    if (references.some((reference) => !reference || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(reference.assetId) || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(reference.assetVersionId))) errors.push('Select exact immutable visual and fallback entry-effect versions.');
    if (item.entryPresentation.soundPolicy !== 'off' && !item.entryPresentation.audioAsset) errors.push('Entry sound requires an exact approved audio version.');
  }
  return errors;
}

export function buildStoreAssetPath(itemId: string, kind: 'preview' | 'thumbnail', version: string) {
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)) throw new Error('Invalid store item ID.');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(version)) throw new Error('Invalid asset version.');
  return `store-assets/${itemId}/${kind}/${version}`;
}

export function parseManagedStoreAssetPath(url: string, itemId: string, kind: 'preview' | 'thumbnail') {
  if (!url || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(parsed.hostname)) return '';
    const decodedPath = decodeURIComponent(parsed.pathname);
    const expected = `store-assets/${itemId}/${kind}/`;
    const start = decodedPath.indexOf(expected);
    if (start < 0) return '';
    const path = decodedPath.slice(start).replace(/^\/+/, '');
    const version = path.slice(expected.length);
    return /^[A-Za-z0-9_-]{8,80}$/.test(version) ? path : '';
  } catch {
    return '';
  }
}
