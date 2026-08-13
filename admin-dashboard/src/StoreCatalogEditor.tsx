import { FormEvent, useMemo, useState } from 'react';
import { User } from 'firebase/auth';

import { AdminStoreCatalogItem, upsertAdminStoreCatalog } from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { removePublishedStoreAsset, removeUploadedStoreAsset, UploadedStoreAsset, uploadStoreAsset } from './storeAssets';
import { StoreCatalogDraft, validateStoreCatalogDraft } from './storeEditorPolicy';
import { RoomThemeManifestEditor } from './RoomThemeManifestEditor';
import {
  createEntryPhysicalApprovalReceiptId,
  defaultEntryPhysicalApproval,
  defaultEntryPresentation,
  EntryPresentationEditorFields,
} from './EntryPresentationEditorFields';
import { CosmeticAssetField } from './CosmeticAssetField';
import { getStoreCosmeticAssetRequirement } from './cosmeticAssetAuthoring';

type CatalogEditorState = { duplicate?: boolean; kind: 'catalog'; item?: AdminStoreCatalogItem };

const emptyCatalog: StoreCatalogDraft = {
  availability: 'available', category: 'game-items', description: { ar: '', en: '' }, duration: { kind: 'permanent' },
  featured: false, itemId: '', name: { ar: '', en: '' }, order: 0, previewAssetUrl: '', prices: { coins: 1 }, purchasingEnabled: true,
  stock: { kind: 'unlimited' }, thumbnailUrl: '',
};

export default function StoreCatalogEditor({ editor, onClose, onSaved, user }: { editor: CatalogEditorState; onClose: () => void; onSaved: () => void; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const existing = editor.item && !editor.duplicate ? editor.item : undefined;
  const [draft, setDraft] = useState<StoreCatalogDraft>(() => {
    if (!editor.item) return emptyCatalog;
    const item = stripServerFields(editor.item);
    return editor.duplicate ? { ...item, customId: undefined, featured: false, itemId: '', name: { ...item.name } } : item;
  });
  const [reason, setReason] = useState('');
  const [thumbnail, setThumbnail] = useState<File>();
  const [preview, setPreview] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [entryPhysicalApproval, setEntryPhysicalApproval] = useState(defaultEntryPhysicalApproval);
  const cleanDraft = existing ? stripServerFields(existing) : editor.item && editor.duplicate ? { ...stripServerFields(editor.item), customId: undefined, featured: false, itemId: '', name: { ...editor.item.name } } : emptyCatalog;
  const dirty = Boolean(reason || thumbnail || preview || JSON.stringify(draft) !== JSON.stringify(cleanDraft));
  const cosmeticRequirement = getStoreCosmeticAssetRequirement(draft.category);

  async function requestClose() {
    if (!dirty || await confirm({ confirmLabel: 'تجاهل التغييرات', description: 'لن يتم حفظ التعديلات التي أجريتها على العنصر.', destructive: true, title: 'إغلاق المحرر دون حفظ؟' })) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validationErrors = validateStoreCatalogDraft(draft, reason, Boolean(draft.thumbnailUrl || thumbnail), Boolean(draft.previewAssetUrl || preview));
    setErrors(validationErrors);
    if (validationErrors.length) return;
    if (!await confirm({
      confirmLabel: existing ? 'حفظ التغييرات' : editor.duplicate ? 'إنشاء النسخة' : 'إنشاء العنصر',
      description: `${draft.name.ar} · ${categoryLabel(draft.category)} · ${durationLabel(draft.duration)} · ${draft.stock.kind === 'unlimited' ? 'مخزون غير محدود' : `المتبقي ${draft.stock.remaining.toLocaleString('ar-IQ')}`} · السبب: ${reason.trim()}`,
      destructive: Boolean(existing?.availability === 'available' && draft.availability !== 'available'),
      title: 'مراجعة التغيير قبل الحفظ',
    })) return;
    setSaving(true);
    let uploadedThumbnail: UploadedStoreAsset | undefined;
    let uploadedPreview: UploadedStoreAsset | undefined;
    try {
      if (thumbnail) uploadedThumbnail = await uploadStoreAsset(user, draft.itemId, 'thumbnail', thumbnail);
      if (preview) uploadedPreview = await uploadStoreAsset(user, draft.itemId, 'preview', preview);
      const thumbnailUrl = uploadedThumbnail?.url || draft.thumbnailUrl;
      const previewAssetUrl = uploadedPreview?.url || draft.previewAssetUrl;
      let entryPresentation = draft.category === 'cars'
        ? (draft.entryPresentation || defaultEntryPresentation)
        : undefined;
      if (entryPresentation?.animationEnabled) {
        entryPresentation = {
          ...entryPresentation,
          physicalApprovalReceiptId: await createEntryPhysicalApprovalReceiptId(
            draft.itemId,
            entryPresentation.visualAsset?.assetVersionId || '',
          ),
        };
      }
      const normalizedItem: StoreCatalogDraft = draft.category === 'custom-ids'
        ? { ...draft, cosmeticAsset: undefined, duration: { kind: 'permanent' }, entryPresentation: undefined, previewAssetUrl, stickerAsset: undefined, stock: { kind: 'limited', remaining: Math.min(1, draft.stock.kind === 'limited' ? draft.stock.remaining : 1) }, thumbnailUrl }
        : {
          ...draft,
          cosmeticAsset: isCosmeticCategory(draft.category) ? draft.cosmeticAsset : undefined,
          coupleEffectPresentation: draft.category === 'couple-effects' ? draft.coupleEffectPresentation : undefined,
          customId: undefined,
          entryPresentation,
          previewAssetUrl,
          stickerAsset: draft.category === 'stickers' ? draft.stickerAsset : undefined,
          thumbnailUrl,
        };
      await upsertAdminStoreCatalog(user, {
        ...(entryPresentation?.animationEnabled ? { entryPhysicalApproval } : {}),
        expectedUpdatedAt: existing?.updatedAt,
        item: normalizedItem,
        reason: reason.trim(),
      });
      if (existing) await Promise.allSettled([
        existing.thumbnailUrl !== thumbnailUrl ? removePublishedStoreAsset(existing.thumbnailUrl, existing.itemId, 'thumbnail') : Promise.resolve(false),
        existing.previewAssetUrl !== previewAssetUrl ? removePublishedStoreAsset(existing.previewAssetUrl, existing.itemId, 'preview') : Promise.resolve(false),
      ]);
      notify('تم حفظ عنصر المتجر', { description: 'سُجّل التغيير في سجل التدقيق الاقتصادي.', tone: 'success' });
      onSaved();
    } catch (cause) {
      await Promise.allSettled([removeUploadedStoreAsset(uploadedThumbnail), removeUploadedStoreAsset(uploadedPreview)]);
      notify('تعذّر حفظ العنصر', { description: cause instanceof Error ? cause.message : 'حدث خطأ غير متوقع.', tone: 'error' });
    } finally { setSaving(false); }
  }

  return <Drawer title={existing ? 'تعديل عنصر الكتالوج' : editor.duplicate ? 'نسخ عنصر الكتالوج' : 'إضافة عنصر جديد'} subtitle="المعاينة والبيانات التجارية" onClose={() => void requestClose()}><form className="economy-editor-form" onSubmit={submit}><PreviewCard item={draft} previewFile={preview} thumbnailFile={thumbnail} />{errors.length ? <div className="economy-form-errors" role="alert"><strong>راجع البيانات قبل الحفظ</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}<div className="economy-form-grid">
    <label>معرّف العنصر<input disabled={Boolean(existing)} pattern="[a-z0-9][a-z0-9_-]{2,79}" required value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })} /></label>
    <label>القسم<select disabled={Boolean(existing)} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as StoreCatalogDraft['category'], cosmeticAsset: undefined, coupleEffectPresentation: undefined, entryPresentation: undefined, stickerAsset: undefined })}><option value="game-items">عناصر اللعبة</option><option value="chat-themes">سمات الغرف</option><option value="avatar-frames">إطارات الصور</option><option value="profile-skins">خلفيات الملف</option><option value="chat-bubbles">فقاعات الدردشة</option><option value="nameplates">لوحات الاسم</option><option value="cosmetic-badges">الشارات التجميلية</option><option value="seat-effects">تأثيرات المقعد</option><option value="couple-effects">تأثيرات الارتباط</option><option value="stickers">ملصقات الدردشة</option><option value="cars">السيارات</option><option value="custom-ids">معرّفات مخصصة</option></select></label>
    {draft.category === 'custom-ids' ? <label>المعرّف المخصص<input disabled={Boolean(existing)} inputMode="numeric" pattern="[0-9]{7}" required value={draft.customId || ''} onChange={(e) => setDraft({ ...draft, customId: e.target.value, duration: { kind: 'permanent' }, stock: { kind: 'limited', remaining: 1 } })} /></label> : null}
    <label>الاسم العربي<input required value={draft.name.ar} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, ar: e.target.value } })} /></label>
    <label>الاسم الإنجليزي<input dir="ltr" required value={draft.name.en} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, en: e.target.value } })} /></label>
    <label className="span-2">الوصف العربي<textarea required value={draft.description.ar} onChange={(e) => setDraft({ ...draft, description: { ...draft.description, ar: e.target.value } })} /></label>
    <label className="span-2">الوصف الإنجليزي<textarea dir="ltr" required value={draft.description.en} onChange={(e) => setDraft({ ...draft, description: { ...draft.description, en: e.target.value } })} /></label>
    <label>سعر العملات<input min="1" type="number" value={draft.prices.coins ?? ''} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, coins: e.target.value ? Number(e.target.value) : undefined } })} /></label>
    <label>سعر الألماس<input min="1" type="number" value={draft.prices.diamonds ?? ''} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, diamonds: e.target.value ? Number(e.target.value) : undefined } })} /></label>
    {draft.category !== 'custom-ids' ? <><label>نوع المدة<select value={draft.duration.kind} onChange={(e) => setDraft({ ...draft, duration: e.target.value === 'permanent' ? { kind: 'permanent' } : { kind: 'timed', unit: 'days', value: 1 } })}><option value="permanent">دائم</option><option value="timed">محدد المدة</option></select></label>{draft.duration.kind === 'timed' ? <><label>قيمة المدة<input min="1" required type="number" value={draft.duration.value} onChange={(e) => { if (draft.duration.kind === 'timed') setDraft({ ...draft, duration: { kind: 'timed', unit: draft.duration.unit, value: Number(e.target.value) } }); }} /></label><label>وحدة المدة<select value={draft.duration.unit} onChange={(e) => { if (draft.duration.kind === 'timed') setDraft({ ...draft, duration: { kind: 'timed', unit: e.target.value as 'days' | 'weeks' | 'months', value: draft.duration.value } }); }}><option value="days">أيام</option><option value="weeks">أسابيع</option><option value="months">أشهر</option></select></label></> : null}<label>نوع المخزون<select value={draft.stock.kind} onChange={(e) => setDraft({ ...draft, stock: e.target.value === 'unlimited' ? { kind: 'unlimited' } : { kind: 'limited', remaining: 0 } })}><option value="unlimited">غير محدود</option><option value="limited">محدود</option></select></label>{draft.stock.kind === 'limited' ? <label>الكمية المتبقية<input min="0" required type="number" value={draft.stock.remaining} onChange={(e) => setDraft({ ...draft, stock: { kind: 'limited', remaining: Number(e.target.value) } })} /></label> : null}</> : null}
    <label>الحالة<select value={draft.availability} onChange={(e) => setDraft({ ...draft, availability: e.target.value as StoreCatalogDraft['availability'] })}><option value="available">متاح</option><option value="disabled">متوقف</option><option value="unavailable">غير متاح</option></select></label>
    <label>الترتيب<input min="0" type="number" value={draft.order} onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) })} /></label>
    <label>الصورة المصغرة<input accept="image/jpeg,image/png,image/webp" required={!draft.thumbnailUrl} type="file" onChange={(e) => setThumbnail(e.target.files?.[0])} /></label>
    <label>صورة المعاينة<input accept="image/jpeg,image/png,image/webp" required={!draft.previewAssetUrl} type="file" onChange={(e) => setPreview(e.target.files?.[0])} /></label>
    {cosmeticRequirement ? <CosmeticAssetField initialAssetId={draft.itemId} onClear={() => setDraft({ ...draft, ...(draft.category === 'stickers' ? { stickerAsset: undefined } : { cosmeticAsset: undefined }) })} onSelect={(bundle) => setDraft({ ...draft, ...(draft.category === 'stickers' ? { stickerAsset: bundle.primary } : { cosmeticAsset: bundle.primary }) })} reference={draft.category === 'stickers' ? draft.stickerAsset : draft.cosmeticAsset} requirement={cosmeticRequirement} user={user} /> : null}
    {draft.category === 'cars' ? <EntryPresentationEditorFields approval={entryPhysicalApproval} initialAssetId={`${draft.itemId || 'car'}-entry`} itemNameAr={draft.name.ar} onApprovalChange={setEntryPhysicalApproval} onChange={(entryPresentation) => setDraft({ ...draft, entryPresentation })} user={user} value={draft.entryPresentation || defaultEntryPresentation} /> : null}
    {draft.category === 'couple-effects' ? <CoupleEffectEditorFields draft={draft} onChange={setDraft} /> : null}
    <label className="economy-checkbox span-2"><input checked={draft.purchasingEnabled} type="checkbox" onChange={(e) => setDraft({ ...draft, purchasingEnabled: e.target.checked })} /> السماح بالمشتريات الجديدة</label>
    <label className="economy-checkbox span-2"><input checked={draft.featured} type="checkbox" onChange={(e) => setDraft({ ...draft, featured: e.target.checked })} /> عرض كبطاقة مميّزة أعلى المتجر</label>
    <label className="span-2 required-reason">سبب التغيير<textarea minLength={2} placeholder="اكتب سببًا واضحًا يظهر في سجل التدقيق" required value={reason} onChange={(e) => setReason(e.target.value)} /></label>
  </div><EditorFooter saving={saving} onClose={() => void requestClose()} /></form>{existing?.category === 'chat-themes' ? <RoomThemeManifestEditor themeId={existing.itemId} user={user} /> : null}</Drawer>;
}

function Drawer({ children, onClose, subtitle, title }: { children: React.ReactNode; onClose: () => void; subtitle: string; title: string }) { useAdminDialogFocus(true, onClose, '.economy-drawer'); return <div className="economy-drawer-layer" role="presentation"><button aria-label="إغلاق" className="economy-drawer-backdrop" onClick={onClose} type="button" /><aside aria-label={title} aria-modal="true" className="economy-drawer" role="dialog" tabIndex={-1}><header><div><span>المتجر والاقتصاد</span><h2>{title}</h2><p>{subtitle}</p></div><button aria-label="إغلاق" onClick={onClose} type="button">×</button></header>{children}</aside></div>; }
function EditorFooter({ onClose, saving }: { onClose: () => void; saving: boolean }) { return <footer className="economy-editor-footer"><button className="secondary" disabled={saving} onClick={onClose} type="button">إلغاء</button><button disabled={saving} type="submit">{saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}</button></footer>; }
function PreviewCard({ item, previewFile, thumbnailFile }: { item: StoreCatalogDraft; previewFile?: File; thumbnailFile?: File }) { const preview = useMemo(() => previewFile ? URL.createObjectURL(previewFile) : item.previewAssetUrl, [item.previewAssetUrl, previewFile]); const thumb = useMemo(() => thumbnailFile ? URL.createObjectURL(thumbnailFile) : item.thumbnailUrl, [item.thumbnailUrl, thumbnailFile]); const pair = item.category === 'couple-effects' ? item.coupleEffectPresentation : undefined; return <div className="catalog-live-preview" style={preview ? { backgroundImage: `linear-gradient(180deg, transparent, rgba(10,9,15,.92)), url(${preview})` } : undefined}><div>{pair ? <div aria-label="معاينة آمنة للتأثير المشترك" style={{ display: 'flex', gap: 8 }}>{[0, 1].map((index) => <span key={index} style={{ border: pair.borderMode === 'off' ? '1px solid #715b82' : '3px solid #e7b95f', borderRadius: 999, boxShadow: pair.profileMode === 'off' ? 'none' : '0 0 16px #b568d8', display: 'grid', height: 54, placeItems: 'center', width: 54 }}>{thumb ? <img alt="" src={thumb} style={{ borderRadius: 999, height: 42, width: 42 }} /> : '◇'}</span>)}</div> : thumb ? <img alt="" src={thumb} /> : <span>◇</span>}<section><small>{categoryLabel(item.category)}</small><h3>{item.name.ar || 'اسم العنصر'}</h3><p>{pair?.entranceMode !== 'off' ? `معاينة دخول واحدة · ${pair?.entranceMode}` : item.description.ar || 'ستظهر معاينة العنصر هنا قبل الحفظ.'}</p><Price prices={item.prices} /></section></div></div>; }
function Price({ prices }: { prices: AdminStoreCatalogItem['prices'] }) { return <span className="economy-price">{prices.coins ? `${prices.coins.toLocaleString('ar-IQ')} ◈` : ''}{prices.coins && prices.diamonds ? ' · ' : ''}{prices.diamonds ? `${prices.diamonds.toLocaleString('ar-IQ')} ♦` : ''}</span>; }
function stripServerFields(item: AdminStoreCatalogItem): StoreCatalogDraft { const { createdAt: _createdAt, lastEditorEmail: _lastEditorEmail, lastEditorUid: _lastEditorUid, updatedAt: _updatedAt, ...input } = item; return input; }
function CoupleEffectEditorFields({ draft, onChange }: { draft: StoreCatalogDraft; onChange: (draft: StoreCatalogDraft) => void }) {
  const presentation = draft.coupleEffectPresentation || { borderMode: 'off', entranceMode: 'off', profileMode: 'static' };
  return <fieldset className="span-2"><legend>العرض المشترك المعتمد</legend><div className="economy-form-grid">
    <label>الملف الشخصي<select value={presentation.profileMode} onChange={(event) => onChange({ ...draft, coupleEffectPresentation: { ...presentation, profileMode: event.target.value as typeof presentation.profileMode } })}><option value="off">متوقف</option><option value="static">ثابت</option><option value="looping">متكرر</option></select></label>
    <label>الإطار المزدوج<select value={presentation.borderMode} onChange={(event) => onChange({ ...draft, coupleEffectPresentation: { ...presentation, borderMode: event.target.value as typeof presentation.borderMode } })}><option value="off">متوقف</option><option value="static">ثابت</option><option value="looping">متكرر</option></select></label>
    <label>الدخول الموحّد<select value={presentation.entranceMode} onChange={(event) => onChange({ ...draft, coupleEffectPresentation: { ...presentation, entranceMode: event.target.value as typeof presentation.entranceMode } })}><option value="off">متوقف</option><option value="static">ثابت</option><option value="one-shot">مرة واحدة</option></select></label>
  </div><small>يتحقق الخادم من أن الإصدار منشور ومعتمد وفئته couple-effect، بلا صوت، وبـ PNG أو Lottie مع PNG احتياطي مطابق.</small></fieldset>;
}
function categoryLabel(value: AdminStoreCatalogItem['category']) { return ({ 'game-items': 'عناصر اللعبة', 'chat-themes': 'سمات الغرف', 'avatar-frames': 'إطارات الصور', 'profile-skins': 'خلفيات الملف', 'chat-bubbles': 'فقاعات الدردشة', nameplates: 'لوحات الاسم', 'cosmetic-badges': 'الشارات التجميلية', 'seat-effects': 'تأثيرات المقعد', 'couple-effects': 'تأثيرات الارتباط', stickers: 'ملصقات الدردشة', cars: 'السيارات', 'custom-ids': 'معرّفات مخصصة' } as const)[value]; }
function isCosmeticCategory(value: AdminStoreCatalogItem['category']) { return ['avatar-frames', 'profile-skins', 'chat-bubbles', 'nameplates', 'cosmetic-badges', 'seat-effects', 'couple-effects'].includes(value); }
function durationLabel(value: AdminStoreCatalogItem['duration']) { return value.kind === 'permanent' ? 'دائم' : `${value.value.toLocaleString('ar-IQ')} ${value.unit === 'days' ? 'يوم' : value.unit === 'weeks' ? 'أسبوع' : 'شهر'}`; }
