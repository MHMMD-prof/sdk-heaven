import { User } from 'firebase/auth';
import { getDownloadURL, ref } from 'firebase/storage';
import lottie, { type AnimationItem } from 'lottie-web';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  type AdminCosmeticAssetVersion,
  type AdminPublishedCosmeticAssetOption,
  mutateAdminCosmeticAsset,
  requestAdminCosmeticAssets,
  requestAdminPublishedCosmeticAssetOptions,
} from './adminDashboardApi';
import {
  assetSlotForCategory,
  buildCosmeticDependencyAssetId,
  type CosmeticAssetFormat,
  type CosmeticAssetReference,
  type CosmeticAssetRequirement,
  isAnimatedFormat,
} from './cosmeticAssetAuthoring';
import { firebaseStorage } from './firebase';
import { uploadCosmeticAsset } from './storeAssets';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import './CosmeticAssetAuthoringDialog.css';

export type AuthoredCosmeticAssetBundle = {
  audio?: CosmeticAssetReference;
  durationMs?: number;
  fallback?: CosmeticAssetReference;
  format: CosmeticAssetFormat;
  performanceTier?: 'low' | 'standard' | 'high';
  primary: CosmeticAssetReference;
};

type Props = {
  initialAssetId?: string;
  onClose: () => void;
  onSelect: (bundle: AuthoredCosmeticAssetBundle) => void;
  requirement: CosmeticAssetRequirement;
  user: User;
};

export function CosmeticAssetAuthoringDialog({ initialAssetId = '', onClose, onSelect, requirement, user }: Props) {
  const [publishing, setPublishing] = useState(false);
  useAdminDialogFocus(true, publishing ? () => undefined : onClose, '.asset-authoring-dialog');
  const [tab, setTab] = useState<'existing' | 'create'>('existing');
  const [items, setItems] = useState<AdminPublishedCosmeticAssetOption[]>([]);
  const [page, setPage] = useState({ hasNextPage: false, nextCursor: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [assetId, setAssetId] = useState(normalizeSuggestedId(initialAssetId, requirement.category));
  const [format, setFormat] = useState<CosmeticAssetFormat>(requirement.formats[0]!);
  const [primaryFile, setPrimaryFile] = useState<File>();
  const [fallbackFile, setFallbackFile] = useState<File>();
  const [audioFile, setAudioFile] = useState<File>();
  const [minimumClientVersion, setMinimumClientVersion] = useState('1.0.0');
  const [performanceTier, setPerformanceTier] = useState<'low' | 'standard' | 'high'>('standard');
  const [reason, setReason] = useState('');
  const [authoritySeparationPassed, setAuthoritySeparationPassed] = useState(false);
  const [readableIdentityPassed, setReadableIdentityPassed] = useState(false);

  const load = useCallback(async (append = false) => {
    setLoading(true); setError('');
    try {
      const result = await requestAdminPublishedCosmeticAssetOptions(user, {
        category: requirement.category,
        cursor: append ? page.nextCursor : '',
        formats: requirement.formats,
      });
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setPage(result.pageInfo);
    } catch (cause) {
      setError(message(cause));
    } finally { setLoading(false); }
  }, [page.nextCursor, requirement.category, requirement.formats, user]);

  useEffect(() => { void load(false); }, [requirement.category, requirement.formats.join('|'), user]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(item: AdminPublishedCosmeticAssetOption) {
    onSelect({
      ...(item.audioAssetId ? { audio: { assetId: item.audioAssetId, assetVersionId: item.audioAssetVersionId } } : {}),
      ...(item.fallbackAssetId ? { fallback: { assetId: item.fallbackAssetId, assetVersionId: item.fallbackAssetVersionId } } : {}),
      format: item.format as CosmeticAssetFormat,
      durationMs: item.durationMs || undefined,
      performanceTier: isPerformanceTier(item.performanceTier) ? item.performanceTier : undefined,
      primary: { assetId: item.assetId, assetVersionId: item.assetVersionId },
    });
    onClose();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const animated = isAnimatedFormat(format);
    if (!primaryFile || (animated && !fallbackFile) || reason.trim().length < 3) {
      setError(animated ? 'اختر الملف الرئيسي وصورة احتياطية واكتب سبباً واضحاً.' : 'اختر الملف الرئيسي واكتب سبباً واضحاً.');
      return;
    }
    setPublishing(true); setError('');
    try {
      const primaryVersionId = nextVersionId();
      const fallback = animated && fallbackFile
        ? await publishNewAsset({
          assetId: buildCosmeticDependencyAssetId(assetId, 'fallback', primaryVersionId), category: requirement.category, file: fallbackFile,
          format: fileStaticFormat(fallbackFile, requirement.category), minimumClientVersion,
          performanceTier: 'low', reason, requirement, usage: 'static', user,
          authoritySeparationPassed, readableIdentityPassed,
        }, setProgress)
        : undefined;
      const audio = audioFile
        ? await publishNewAsset({
          assetId: buildCosmeticDependencyAssetId(assetId, 'audio', primaryVersionId), category: 'effect-audio', file: audioFile,
          format: 'm4a-aac', minimumClientVersion, performanceTier: 'low', reason,
          requirement: { category: 'effect-audio', formats: ['m4a-aac'], label: 'صوت التأثير', usage: 'one-shot' },
          usage: 'one-shot', user,
        }, setProgress)
        : undefined;
      const primary = await publishNewAsset({
        assetId, audio, category: requirement.category, fallback, file: primaryFile, format,
        assetVersionId: primaryVersionId, minimumClientVersion, performanceTier, reason, requirement,
        usage: isAnimatedFormat(format) ? requirement.usage : 'static', user,
        authoritySeparationPassed, readableIdentityPassed,
        beforeApproval: async (version) => {
          const [fallbackVersion, audioVersion] = await Promise.all([
            fallback ? loadExactVersion(user, fallback) : undefined,
            audio ? loadExactVersion(user, audio) : undefined,
          ]);
          assertCreatedBundleCompatible(requirement, version, fallbackVersion, audioVersion);
        },
      }, setProgress);
      const detail = await requestAdminCosmeticAssets(user, { assetId: primary.assetId });
      const publishedVersion = 'versions' in detail
        ? detail.versions.find((version) => version.assetVersionId === primary.assetVersionId)
        : undefined;
      onSelect({ audio, durationMs: publishedVersion?.durationMs || undefined, fallback, format, performanceTier, primary });
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally { setPublishing(false); setProgress(''); }
  }

  const animated = isAnimatedFormat(format);
  const safetyRequired = ['nameplate', 'cosmetic-badge'].includes(requirement.category);
  return <div className="asset-authoring-layer" role="presentation">
    <button aria-label="إغلاق" className="asset-authoring-backdrop" disabled={publishing} onClick={onClose} type="button" />
    <section aria-label={`اختيار ${requirement.label}`} aria-modal="true" className="asset-authoring-dialog" role="dialog" tabIndex={-1}>
      <header><div><small>تأليف أصل معتمد</small><h2>{requirement.label}</h2><p>اختر إصداراً منشوراً أو أنشئ حزمة كاملة دون مغادرة مسودة العنصر.</p></div><button aria-label="إغلاق" disabled={publishing} onClick={onClose} type="button">×</button></header>
      <nav><button className={tab === 'existing' ? 'active' : ''} disabled={publishing} onClick={() => setTab('existing')} type="button">الأصول المنشورة</button><button className={tab === 'create' ? 'active' : ''} disabled={publishing} onClick={() => setTab('create')} type="button">رفع ونشر جديد</button></nav>
      {error ? <div className="asset-authoring-error" role="alert">{error}</div> : null}
      {tab === 'existing' ? <div className="asset-option-list">
        {items.map((item) => <article key={`${item.assetId}:${item.assetVersionId}`}>
          <AssetOptionPreview item={item} />
          <div><strong>{item.assetId}</strong><code>{item.assetVersionId}</code><span>{item.format} · {dimensions(item)}{item.durationMs ? ` · ${item.durationMs}ms` : ''}</span>{item.fallbackAssetId ? <small>fallback: {item.fallbackAssetId}</small> : null}</div>
          <button disabled={publishing} onClick={() => choose(item)} type="button">اختيار</button>
        </article>)}
        {!loading && items.length === 0 ? <p className="asset-authoring-empty">لا توجد إصدارات منشورة متوافقة. أنشئ أول أصل من تبويب الرفع.</p> : null}
        {loading ? <p className="asset-authoring-empty">جارٍ تحميل الأصول…</p> : null}
        {page.hasNextPage ? <button disabled={loading || publishing} onClick={() => void load(true)} type="button">تحميل المزيد</button> : null}
      </div> : <form className="asset-create-form" onSubmit={(event) => void create(event)}>
        <label><span>معرّف الأصل</span><input disabled={publishing} dir="ltr" pattern="[a-z0-9][a-z0-9_-]{2,79}" required value={assetId} onChange={(event) => setAssetId(event.target.value.trim().toLowerCase())} /></label>
        <label><span>الصيغة</span><select disabled={publishing} value={format} onChange={(event) => setFormat(event.target.value as CosmeticAssetFormat)}>{requirement.formats.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>أقل إصدار عميل</span><input disabled={publishing} dir="ltr" pattern="[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" required value={minimumClientVersion} onChange={(event) => setMinimumClientVersion(event.target.value)} /></label>
        <label><span>مستوى الأداء</span><select disabled={publishing} value={performanceTier} onChange={(event) => setPerformanceTier(event.target.value as typeof performanceTier)}><option value="low">منخفض</option><option value="standard">قياسي</option><option value="high">مرتفع</option></select></label>
        <label><span>الملف الرئيسي</span><input accept={acceptForFormat(format)} disabled={publishing} required type="file" onChange={(event) => setPrimaryFile(event.target.files?.[0])} /></label>
        {animated ? <label><span>الصورة الاحتياطية</span><input accept={acceptForFallback(requirement.category)} disabled={publishing} required type="file" onChange={(event) => setFallbackFile(event.target.files?.[0])} /></label> : null}
        {['gift-effect', 'entry-effect'].includes(requirement.category) ? <label><span>صوت AAC اختياري</span><input accept="audio/mp4,audio/x-m4a" disabled={publishing} type="file" onChange={(event) => setAudioFile(event.target.files?.[0])} /></label> : null}
        {safetyRequired ? <div className="asset-safety-fields"><label><input checked={readableIdentityPassed} onChange={(event) => setReadableIdentityPassed(event.target.checked)} required type="checkbox" /> النص والهوية مقروءان</label><label><input checked={authoritySeparationPassed} onChange={(event) => setAuthoritySeparationPassed(event.target.checked)} required type="checkbox" /> لا يشبه شارات السلطة أو الثقة</label></div> : null}
        <label className="asset-reason"><span>سبب النشر</span><textarea disabled={publishing} minLength={3} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="asset-bundle-summary"><strong>الحزمة التي ستُنشر</strong><span>{assetId || 'asset'} · {format}</span>{animated ? <span>fallback · {fileStaticFormat(fallbackFile, requirement.category)}</span> : null}{audioFile ? <span>audio · m4a-aac</span> : null}</div>
        <footer><button disabled={publishing} onClick={onClose} type="button">إلغاء</button><button disabled={publishing} type="submit">{publishing ? progress || 'جارٍ النشر…' : 'تحقق، اعتمد، انشر واختر'}</button></footer>
      </form>}
    </section>
  </div>;
}

async function publishNewAsset(input: {
  assetId: string;
  assetVersionId?: string;
  audio?: CosmeticAssetReference;
  authoritySeparationPassed?: boolean;
  category: string;
  fallback?: CosmeticAssetReference;
  file: File;
  format: CosmeticAssetFormat;
  minimumClientVersion: string;
  performanceTier: 'low' | 'standard' | 'high';
  readableIdentityPassed?: boolean;
  reason: string;
  requirement: CosmeticAssetRequirement;
  usage: 'static' | 'looping' | 'one-shot';
  user: User;
  beforeApproval?: (version: AdminCosmeticAssetVersion) => Promise<void> | void;
}, report: (value: string) => void): Promise<CosmeticAssetReference> {
  const version = input.assetVersionId || nextVersionId();
  report(`رفع ${input.assetId}…`);
  const existing = await requestAdminCosmeticAssets(input.user, { assetId: input.assetId });
  const revision = 'asset' in existing ? existing.asset?.revision || 0 : 0;
  await uploadCosmeticAsset(input.user, { assetId: input.assetId, assetVersionId: version, file: input.file, format: input.format, ownerType: 'platform' });
  report(`التحقق من ${input.assetId}…`);
  const validated = await mutateAdminCosmeticAsset(input.user, {
    asset: {
      assetId: input.assetId, assetVersionId: version, category: input.category, format: input.format,
      loop: input.usage === 'looping', minimumClientVersion: input.minimumClientVersion,
      ownerType: 'platform', performanceTier: input.performanceTier,
      ...(assetSlotForCategory(input.category) ? { slot: assetSlotForCategory(input.category) } : {}),
      usage: input.usage,
      ...(input.fallback ? { fallbackAssetId: input.fallback.assetId, fallbackAssetVersionId: input.fallback.assetVersionId } : {}),
      ...(input.audio ? { audioAssetId: input.audio.assetId, audioAssetVersionId: input.audio.assetVersionId } : {}),
    },
    expectedRevision: revision, operation: 'validate-version', reason: input.reason.trim(),
  });
  if (input.beforeApproval) {
    const versionDetail = await requestAdminCosmeticAssets(input.user, { assetId: input.assetId });
    const inspectedVersion = 'versions' in versionDetail
      ? versionDetail.versions.find((candidate) => candidate.assetVersionId === version)
      : undefined;
    if (!inspectedVersion) throw new Error('تعذّر تحميل نتيجة التحقق قبل الاعتماد.');
    await input.beforeApproval(inspectedVersion);
  }
  report(`اعتماد ${input.assetId}…`);
  const approved = await mutateAdminCosmeticAsset(input.user, {
    assetId: input.assetId, assetVersionId: version, expectedRevision: validated.revision,
    operation: 'approve-version', reason: input.reason.trim(),
    ...(input.authoritySeparationPassed ? { authoritySeparationPassed: true } : {}),
    ...(input.readableIdentityPassed ? { readableIdentityPassed: true } : {}),
  });
  report(`نشر ${input.assetId}…`);
  await mutateAdminCosmeticAsset(input.user, {
    assetId: input.assetId, assetVersionId: version, expectedRevision: approved.revision,
    operation: 'publish-version', reason: input.reason.trim(),
  });
  return { assetId: input.assetId, assetVersionId: version };
}

function AssetOptionPreview({ item }: { item: AdminPublishedCosmeticAssetOption }) {
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => { let active = true; void getDownloadURL(ref(firebaseStorage, item.storagePath)).then((value) => { if (active) setUrl(value); }).catch(() => undefined); return () => { active = false; }; }, [item.storagePath]);
  useEffect(() => {
    if (!url || item.format !== 'lottie-json' || !host.current) return undefined;
    let animation: AnimationItem | undefined;
    animation = lottie.loadAnimation({ autoplay: true, container: host.current, loop: true, path: url, renderer: 'svg' });
    return () => animation?.destroy();
  }, [item.format, url]);
  if (item.format === 'lottie-json') return <div className="asset-option-preview" ref={host} />;
  if (item.format === 'mp4') return <video autoPlay className="asset-option-preview" loop muted playsInline src={url} />;
  return url ? <img alt="" className="asset-option-preview" src={url} /> : <div className="asset-option-preview placeholder">◇</div>;
}

function nextVersionId() { return `v1-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`; }
function normalizeSuggestedId(value: string, category: string) { const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); return normalized.length >= 3 ? normalized : `${category}-${crypto.randomUUID().slice(0, 8)}`; }
function acceptForFormat(format: CosmeticAssetFormat) { return ({ png: 'image/png', jpeg: 'image/jpeg', 'legacy-webp': 'image/webp', 'lottie-json': 'application/json', mp4: 'video/mp4', 'm4a-aac': 'audio/mp4,audio/x-m4a' } as const)[format]; }
function acceptForFallback(category: string) { return ['profile-skin', 'room-theme'].includes(category) ? 'image/png,image/jpeg' : 'image/png'; }
function fileStaticFormat(file: File | undefined, category: string): CosmeticAssetFormat { return file?.type === 'image/jpeg' && ['profile-skin', 'room-theme'].includes(category) ? 'jpeg' : 'png'; }
function isPerformanceTier(value: string): value is 'low' | 'standard' | 'high' { return ['low', 'standard', 'high'].includes(value); }
function dimensions(item: AdminPublishedCosmeticAssetOption) { return item.width && item.height ? `${item.width}×${item.height}` : 'audio'; }
async function loadExactVersion(user: User, reference: CosmeticAssetReference) {
  const detail = await requestAdminCosmeticAssets(user, { assetId: reference.assetId });
  const version = 'versions' in detail
    ? detail.versions.find((candidate) => candidate.assetVersionId === reference.assetVersionId)
    : undefined;
  if (!version) throw new Error('تعذّر تحميل أحد إصدارات الحزمة قبل الاعتماد.');
  return version;
}
function assertCreatedBundleCompatible(requirement: CosmeticAssetRequirement, version: AdminCosmeticAssetVersion, fallback?: AdminCosmeticAssetVersion, audio?: AdminCosmeticAssetVersion) {
  if (requirement.category === 'gift-effect' || requirement.category === 'entry-effect') {
    const gift = requirement.category === 'gift-effect';
    const minimum = gift ? 1500 : 3000;
    const maximum = gift ? 6000 : 5000;
    const fallbackFormats = gift ? ['png', 'jpeg', 'legacy-webp'] : ['png', 'legacy-webp'];
    if (version.width !== 1280 || version.height !== 720 || version.durationMs < minimum || version.durationMs > maximum
      || version.usage !== 'one-shot' || version.loop !== false
      || (version.format === 'lottie-json' && (version.transparent !== true || version.audioCodec !== '' || version.videoCodec !== ''))
      || (version.format === 'mp4' && (version.transparent !== false || version.audioCodec !== '' || version.videoCodec !== 'h264'))) {
      throw new Error(`تم تسجيل الإصدار كمسودة فقط؛ ملف ${gift ? 'الهدية' : 'الدخول'} غير متوافق مع عقد العرض.`);
    }
    if (!fallback || !fallbackFormats.includes(fallback.format) || fallback.width !== 1280 || fallback.height !== 720
      || fallback.durationMs !== 0 || fallback.usage !== 'static' || fallback.loop !== false) {
      throw new Error('تم تسجيل الإصدار كمسودة فقط؛ الصورة الاحتياطية غير متوافقة مع عقد العرض.');
    }
    if (audio && (audio.format !== 'm4a-aac' || audio.durationMs < 1 || audio.durationMs > version.durationMs
      || audio.usage !== 'one-shot' || audio.loop !== false || audio.audioCodec !== 'aac' || audio.videoCodec !== '')) {
      throw new Error('تم تسجيل الإصدار كمسودة فقط؛ صوت AAC غير متوافق مع مدة العرض.');
    }
  }
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'حدث خطأ غير متوقع.'; }
