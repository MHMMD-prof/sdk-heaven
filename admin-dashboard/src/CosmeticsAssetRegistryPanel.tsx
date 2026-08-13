import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';

import {
  AdminCosmeticAssetDetail,
  AdminCosmeticAssetSummary,
  AdminCustomEligibility,
  AdminCustomSubmission,
  mutateAdminCosmeticAsset,
  requestAdminCosmeticAssets,
  requestAdminCustomEligibility,
  requestAdminCustomSubmissionPreview,
  requestAdminCustomSubmissions,
} from './adminDashboardApi';
import { readAdminQueryParameter, setAdminQueryParameter } from './adminDeepLinks';
import { useAdminFeedback } from './AdminFeedback';
import {
  COSMETICS_TAB_KEYS,
  cosmeticsCategoryLabels,
  cosmeticsFormatLabels,
  cosmeticsModerationLabels,
  cosmeticsPublicationLabels,
  cosmeticsSubmissionStatusLabels,
  cosmeticsTabDescriptions,
  cosmeticsTabLabels,
  CosmeticsTab,
  labelOf,
  parseCosmeticsTab,
} from './cosmeticsTabs';
import { uploadCosmeticAsset } from './storeAssets';
import './CosmeticsAssetRegistryPanel.css';

const categories = [
  'avatar-frame', 'profile-skin', 'chat-bubble', 'nameplate',
  'cosmetic-badge', 'entry-effect', 'seat-effect', 'gift-effect',
  'room-theme', 'room-reaction', 'couple-effect', 'effect-audio',
] as const;
const formats = ['png', 'jpeg', 'lottie-json', 'mp4', 'm4a-aac'] as const;
const customCategories = ['avatar-frame', 'profile-skin', 'entry-effect'] as const;
const categorySlots: Record<string, string> = {
  'avatar-frame': 'avatar-frame',
  'chat-bubble': 'chat-bubble',
  'cosmetic-badge': 'cosmetic-badge',
  'entry-effect': 'entry-effect',
  nameplate: 'nameplate',
  'profile-skin': 'profile-skin',
  'seat-effect': 'seat-effect',
};

type Draft = {
  assetId: string;
  assetVersionId: string;
  audioAssetId: string;
  audioAssetVersionId: string;
  category: (typeof categories)[number];
  fallbackAssetId: string;
  fallbackAssetVersionId: string;
  format: (typeof formats)[number];
  loop: boolean;
  minimumClientVersion: string;
  ownerType: 'platform' | 'user';
  ownerUid: string;
  performanceTier: 'low' | 'standard' | 'high';
};

const initialDraft: Draft = {
  assetId: '',
  assetVersionId: `v1-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
  audioAssetId: '',
  audioAssetVersionId: '',
  category: 'avatar-frame',
  fallbackAssetId: '',
  fallbackAssetVersionId: '',
  format: 'png',
  loop: false,
  minimumClientVersion: '1.0.0',
  ownerType: 'platform',
  ownerUid: '',
  performanceTier: 'low',
};

export function CosmeticsAssetRegistryPanel({
  permissions,
  user,
}: {
  permissions: string[];
  user: User;
}) {
  const { confirm, notify } = useAdminFeedback();
  const canManage = permissions.includes('store:manage');
  const initialTab = useMemo(
    () => parseCosmeticsTab(readAdminQueryParameter(window.location.search, 'tab', 40)),
    [],
  );
  const [tab, setTab] = useState<CosmeticsTab>(initialTab);
  const [assets, setAssets] = useState<AdminCosmeticAssetSummary[]>([]);
  const [category, setCategory] = useState('');
  const [moderationStatus, setModerationStatus] = useState('');
  const [publicationStatus, setPublicationStatus] = useState('');
  const [selected, setSelected] = useState<AdminCosmeticAssetDetail>();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [authoritySeparationPassed, setAuthoritySeparationPassed] = useState(false);
  const [readableIdentityPassed, setReadableIdentityPassed] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const registry = await requestAdminCosmeticAssets(user, {
        category,
        moderationStatus,
        publicationStatus,
      });
      setAssets('assets' in registry ? registry.assets || [] : []);
      setState('ready');
    } catch (cause) {
      setError(message(cause));
      setState('error');
    }
  }, [category, moderationStatus, publicationStatus, user]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchTab(next: CosmeticsTab) {
    setTab(next);
    setAdminQueryParameter('tab', next === 'registry' ? '' : next);
  }

  async function open(assetId: string) {
    setBusy(true);
    try {
      const registry = await requestAdminCosmeticAssets(user, { assetId });
      if ('asset' in registry) setSelected(registry);
    } catch (cause) {
      notify('تعذر تحميل الأصل', { description: message(cause), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!file || reason.trim().length < 3) {
      setError('اختر ملف المصدر وأدخل سبب مراجعة من 3 أحرف على الأقل.');
      return;
    }
    if (draft.category === 'couple-effect' && (
      !['png', 'lottie-json'].includes(draft.format)
      || Boolean(draft.audioAssetId || draft.audioAssetVersionId)
      || (draft.format === 'png' && Boolean(draft.fallbackAssetId || draft.fallbackAssetVersionId))
      || (draft.format === 'lottie-json' && !(draft.fallbackAssetId && draft.fallbackAssetVersionId))
    )) {
      setError('تأثيرات الارتباط تسمح بـ PNG، أو Lottie مع بديل PNG واحد فقط، ودون صوت.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const existing = await requestAdminCosmeticAssets(user, { assetId: draft.assetId });
      const expectedRevision = 'asset' in existing ? existing.asset?.revision || 0 : 0;
      await uploadCosmeticAsset(user, {
        assetId: draft.assetId,
        assetVersionId: draft.assetVersionId,
        file,
        format: draft.format,
        ownerType: draft.ownerType,
        ownerUid: draft.ownerUid || undefined,
      });
      await mutateAdminCosmeticAsset(user, {
        asset: {
          assetId: draft.assetId,
          assetVersionId: draft.assetVersionId,
          ...(draft.audioAssetId ? {
            audioAssetId: draft.audioAssetId,
            audioAssetVersionId: draft.audioAssetVersionId,
          } : {}),
          category: draft.category,
          ...(draft.fallbackAssetId ? {
            fallbackAssetId: draft.fallbackAssetId,
            fallbackAssetVersionId: draft.fallbackAssetVersionId,
          } : {}),
          format: draft.format,
          loop: draft.loop,
          minimumClientVersion: draft.minimumClientVersion,
          ownerType: draft.ownerType,
          ...(draft.ownerUid ? { ownerUid: draft.ownerUid } : {}),
          performanceTier: draft.performanceTier,
          ...(categorySlots[draft.category] ? { slot: categorySlots[draft.category] } : {}),
          usage: staticFormat(draft.format) ? 'static' : draft.loop ? 'looping' : 'one-shot',
        },
        expectedRevision,
        operation: 'validate-version',
        reason: reason.trim(),
      });
      notify('تم التحقق من الإصدار', {
        description: 'النسخة غير القابلة للاستبدال بانتظار المراجعة وليست عامة بعد.',
        tone: 'success',
      });
      setFile(undefined);
      setReason('');
      setDraft({
        ...initialDraft,
        assetVersionId: `v1-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      });
      await load();
      switchTab('registry');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    operation:
      | 'approve-version'
      | 'reject-version'
      | 'publish-version'
      | 'emergency-disable'
      | 'suspend'
      | 'rollback-version',
    assetVersionId = '',
  ) {
    const asset = selected?.asset;
    if (!asset || reason.trim().length < 3) {
      setError('اختر أصلاً وأدخل سبب التغيير قبل تعديل حالته.');
      return;
    }
    if (['reject-version', 'emergency-disable', 'suspend', 'rollback-version'].includes(operation)) {
      const accepted = await confirm({
        confirmLabel: operation === 'rollback-version' ? 'استرجاع ونشر' : 'متابعة',
        description: 'سيُسجَّل الإجراء في التدقيق وقد يغيّر التوفر العام فوراً عند الاقتضاء.',
        destructive: true,
        title: operationLabel(operation),
      });
      if (!accepted) return;
    }
    setBusy(true);
    setError('');
    try {
      await mutateAdminCosmeticAsset(user, {
        assetId: asset.assetId,
        assetVersionId,
        ...(operation === 'rollback-version'
          ? { confirmation: `ROLLBACK ${asset.assetId} ${assetVersionId}` }
          : operation === 'suspend'
            ? { confirmation: `SUSPEND ${asset.assetId}` }
            : {}),
        expectedRevision: asset.revision,
        operation,
        reason: reason.trim(),
        ...(operation === 'approve-version' && ['nameplate', 'cosmetic-badge'].includes(asset.category) ? {
          authoritySeparationPassed,
          readableIdentityPassed,
        } : {}),
      });
      setReason('');
      setAuthoritySeparationPassed(false);
      setReadableIdentityPassed(false);
      await open(asset.assetId);
      await load();
      notify('تم تحديث حالة الأصل', { tone: 'success' });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const expectedPath = useMemo(() => {
    const extension = {
      jpeg: 'jpg',
      'lottie-json': 'json',
      'm4a-aac': 'm4a',
      mp4: 'mp4',
      png: 'png',
    }[draft.format];
    const owner = draft.ownerType === 'platform' ? 'platform' : `users/${draft.ownerUid || '{uid}'}`;
    return `cosmetic-assets/${owner}/${draft.assetId || '{assetId}'}/${draft.assetVersionId}/source.${extension}`;
  }, [draft]);

  return (
    <div className="economy-page cosmetics-page" dir="rtl">
      <header className="economy-hero">
        <div>
          <span className="economy-eyebrow">سجل الأصول الثابتة</span>
          <h1>أصول التجميل</h1>
          <p>{cosmeticsTabDescriptions[tab]}</p>
        </div>
        <button
          className="economy-refresh"
          disabled={tab === 'registry' && state === 'loading'}
          onClick={() => {
            if (tab === 'registry') void load();
            else window.dispatchEvent(new CustomEvent('cosmetics-tab-refresh', { detail: tab }));
          }}
          type="button"
        >
          <span>↻</span> تحديث البيانات
        </button>
      </header>

      <section className="economy-workspace cosmetics-workspace">
        <div className="economy-tabs" role="tablist" aria-label="أقسام أصول التجميل">
          {COSMETICS_TAB_KEYS.map((key) => (
            <button
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              key={key}
              onClick={() => switchTab(key)}
              role="tab"
              type="button"
            >
              <span>{tabIcon(key)}</span>
              {cosmeticsTabLabels[key]}
            </button>
          ))}
        </div>

        <div className="cosmetics-tab-panel" role="tabpanel">
          <div className="economy-list-head">
            <div>
              <h2>{cosmeticsTabLabels[tab]}</h2>
              <p>{cosmeticsTabDescriptions[tab]}</p>
            </div>
          </div>

          {tab === 'registry' ? (
            <>
              <section className="cosmetics-registry-toolbar">
                <label className="field cosmetics-filter-field">
                  <span>التصنيف</span>
                  <select aria-label="التصنيف" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">كل التصنيفات</option>
                    {categories.map((value) => (
                      <option key={value} value={value}>{labelOf(cosmeticsCategoryLabels, value)}</option>
                    ))}
                  </select>
                </label>
                <label className="field cosmetics-filter-field">
                  <span>حالة المراجعة</span>
                  <select aria-label="حالة المراجعة" value={moderationStatus} onChange={(event) => setModerationStatus(event.target.value)}>
                    <option value="">كل حالات المراجعة</option>
                    {['pending', 'approved', 'rejected', 'suspended'].map((value) => (
                      <option key={value} value={value}>{labelOf(cosmeticsModerationLabels, value)}</option>
                    ))}
                  </select>
                </label>
                <label className="field cosmetics-filter-field">
                  <span>حالة النشر</span>
                  <select aria-label="حالة النشر" value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value)}>
                    <option value="">كل حالات النشر</option>
                    {['unpublished', 'published', 'disabled'].map((value) => (
                      <option key={value} value={value}>{labelOf(cosmeticsPublicationLabels, value)}</option>
                    ))}
                  </select>
                </label>
              </section>

              {error ? <div className="economy-error"><strong>فشلت عملية السجل</strong><span>{error}</span></div> : null}

              <section className="cosmetics-registry-grid">
                <div className="cosmetics-registry-list">
                  <h3>المخزون</h3>
                  {state === 'loading' ? <p>جارٍ تحميل السجل…</p> : null}
                  {state === 'ready' && assets.length === 0 ? <p>لا توجد أصول مطابقة لعوامل التصفية.</p> : null}
                  {assets.map((asset) => (
                    <button className="cosmetics-registry-row" key={asset.assetId} onClick={() => void open(asset.assetId)} type="button">
                      <span>
                        <strong dir="ltr">{asset.assetId}</strong>
                        <small>{labelOf(cosmeticsCategoryLabels, asset.category)} · ر{asset.revision}</small>
                      </span>
                      <span>
                        <b>{labelOf(cosmeticsModerationLabels, asset.moderationStatus)}</b>
                        <small>{labelOf(cosmeticsPublicationLabels, asset.publicationStatus)}</small>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="cosmetics-registry-detail">
                  <h3>سجل الإصدارات والموافقة</h3>
                  {!selected?.asset ? <p>اختر أصلاً لمراجعة إصداراته غير القابلة للاستبدال.</p> : (
                    <>
                      <div className="cosmetics-registry-summary">
                        <strong dir="ltr">{selected.asset.assetId}</strong>
                        <span>
                          {labelOf(cosmeticsModerationLabels, selected.asset.moderationStatus)}
                          {' / '}
                          {labelOf(cosmeticsPublicationLabels, selected.asset.publicationStatus)}
                        </span>
                        <span>المنشور: <b dir="ltr">{selected.asset.publishedVersionId || '—'}</b></span>
                      </div>
                      <label className="field">
                        <span>سبب التدقيق</span>
                        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
                      </label>
                      {['nameplate', 'cosmetic-badge'].includes(selected.asset.category) ? (
                        <div className="cosmetics-safety-attestations">
                          <label>
                            <input checked={readableIdentityPassed} onChange={(event) => setReadableIdentityPassed(event.target.checked)} type="checkbox" />
                            الاسم يبقى مقروءاً وقابلاً للاختيار
                          </label>
                          <label>
                            <input checked={authoritySeparationPassed} onChange={(event) => setAuthoritySeparationPassed(event.target.checked)} type="checkbox" />
                            لا يشبه صلاحيات الموظفين أو المشرفين أو التحقق أو الوكلاء أو حالة الأمان
                          </label>
                        </div>
                      ) : null}
                      <div className="cosmetics-registry-actions">
                        <button disabled={!canManage || busy || selected.asset.moderationStatus !== 'pending' || !selected.asset.currentVersionId || (['nameplate', 'cosmetic-badge'].includes(selected.asset.category) && (!authoritySeparationPassed || !readableIdentityPassed))} onClick={() => void mutate('approve-version', selected.asset?.currentVersionId)} type="button">اعتماد الحالي</button>
                        <button disabled={!canManage || busy || selected.asset.moderationStatus !== 'pending' || !selected.asset.currentVersionId} onClick={() => void mutate('reject-version', selected.asset?.currentVersionId)} type="button">رفض الحالي</button>
                        <button disabled={!canManage || busy || !selected.asset.approvedVersionId} onClick={() => void mutate('publish-version', selected.asset?.approvedVersionId)} type="button">نشر المعتمد</button>
                        <button disabled={!canManage || busy} onClick={() => void mutate('emergency-disable')} type="button">إيقاف طارئ</button>
                        <button disabled={!canManage || busy} onClick={() => void mutate('suspend')} type="button">تعليق</button>
                      </div>
                      <div className="cosmetics-version-list">
                        {selected.versions.map((version) => (
                          <article key={version.assetVersionId}>
                            <strong dir="ltr">{version.assetVersionId}</strong>
                            <small dir="ltr">{labelOf(cosmeticsFormatLabels, version.format)} · {formatBytes(version.byteSize)} · {version.width}×{version.height} · {version.durationMs}ms</small>
                            <code dir="ltr">{version.sha256}</code>
                            <small>البديل: {version.fallbackAssetId ? <b dir="ltr">{`${version.fallbackAssetId}/${version.fallbackAssetVersionId}`}</b> : '—'}</small>
                            {version.assetVersionId !== selected.asset?.publishedVersionId
                              && selected.approvals.some((approval) =>
                                approval.assetVersionId === version.assetVersionId
                                && approval.decision === 'approved') ? (
                              <button disabled={!canManage || busy} onClick={() => void mutate('rollback-version', version.assetVersionId)} type="button">نشر هذا الإصدار المعتمد</button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </section>
            </>
          ) : null}

          {tab === 'upload' ? (
            canManage ? (
              <form className="cosmetics-register-form" onSubmit={(event) => void register(event)}>
                <header>
                  <h3>رفع والتحقق من إصدار ثابت</h3>
                  <p>يبقى الرفع خاصاً حتى ينجح التحقق والموافقة والنشر.</p>
                </header>
                {error ? <div className="economy-error"><strong>فشل الرفع</strong><span>{error}</span></div> : null}
                <div className="cosmetics-form-grid">
                  <label className="field"><span>معرّف الأصل</span><input dir="ltr" required value={draft.assetId} onChange={(event) => setDraft({ ...draft, assetId: event.target.value.trim().toLowerCase() })} /></label>
                  <label className="field"><span>معرّف الإصدار</span><input dir="ltr" required value={draft.assetVersionId} onChange={(event) => setDraft({ ...draft, assetVersionId: event.target.value.trim().toLowerCase() })} /></label>
                  <label className="field">
                    <span>التصنيف</span>
                    <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Draft['category'] })}>
                      {categories.map((value) => <option key={value} value={value}>{labelOf(cosmeticsCategoryLabels, value)}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>الصيغة</span>
                    <select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as Draft['format'] })}>
                      {formats.filter((value) => draft.category !== 'couple-effect' || value === 'png' || value === 'lottie-json').map((value) => (
                        <option key={value} value={value}>{labelOf(cosmeticsFormatLabels, value)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>المالك</span>
                    <select value={draft.ownerType} onChange={(event) => setDraft({ ...draft, ownerType: event.target.value as Draft['ownerType'] })}>
                      <option value="platform">المنصة</option>
                      <option value="user">مستخدم معتمد</option>
                    </select>
                  </label>
                  {draft.ownerType === 'user' ? (
                    <label className="field"><span>معرّف المالك</span><input dir="ltr" required value={draft.ownerUid} onChange={(event) => setDraft({ ...draft, ownerUid: event.target.value.trim() })} /></label>
                  ) : null}
                  <label className="field"><span>أقل إصدار عميل</span><input dir="ltr" required value={draft.minimumClientVersion} onChange={(event) => setDraft({ ...draft, minimumClientVersion: event.target.value.trim() })} /></label>
                  <label className="field">
                    <span>مستوى الأداء</span>
                    <select value={draft.performanceTier} onChange={(event) => setDraft({ ...draft, performanceTier: event.target.value as Draft['performanceTier'] })}>
                      <option value="low">منخفض</option>
                      <option value="standard">قياسي</option>
                      <option value="high">مرتفع</option>
                    </select>
                  </label>
                  {!staticFormat(draft.format) && draft.format !== 'm4a-aac' ? (
                    <label className="field cosmetics-check-field">
                      <span>تكرار الحركة</span>
                      <span className="cosmetics-check-row">
                        <input checked={draft.loop} type="checkbox" onChange={(event) => setDraft({ ...draft, loop: event.target.checked })} />
                        تفعيل التكرار
                      </span>
                    </label>
                  ) : null}
                  {(draft.format === 'lottie-json' || draft.format === 'mp4') ? (
                    <>
                      <label className="field"><span>معرّف الأصل البديل</span><input dir="ltr" required value={draft.fallbackAssetId} onChange={(event) => setDraft({ ...draft, fallbackAssetId: event.target.value.trim() })} /></label>
                      <label className="field"><span>معرّف الإصدار البديل</span><input dir="ltr" required value={draft.fallbackAssetVersionId} onChange={(event) => setDraft({ ...draft, fallbackAssetVersionId: event.target.value.trim() })} /></label>
                    </>
                  ) : null}
                  {draft.format !== 'm4a-aac' && draft.category !== 'couple-effect' ? (
                    <>
                      <label className="field"><span>معرّف صوت اختياري</span><input dir="ltr" value={draft.audioAssetId} onChange={(event) => setDraft({ ...draft, audioAssetId: event.target.value.trim() })} /></label>
                      <label className="field"><span>إصدار الصوت الاختياري</span><input dir="ltr" value={draft.audioAssetVersionId} onChange={(event) => setDraft({ ...draft, audioAssetVersionId: event.target.value.trim() })} /></label>
                    </>
                  ) : null}
                  <label className="field"><span>ملف المصدر</span><input required type="file" onChange={(event) => setFile(event.target.files?.[0])} /></label>
                  <label className="field cosmetics-span-2"><span>سبب التحقق</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                </div>
                <code className="cosmetics-storage-path" dir="ltr">{expectedPath}</code>
                <button className="primary-button" disabled={busy} type="submit">{busy ? 'جارٍ التحقق…' : 'رفع وإنشاء إيصال تحقق'}</button>
              </form>
            ) : (
              <div className="cosmetics-permission-empty">
                <h3>صلاحية الرفع غير متاحة</h3>
                <p>يتطلب رفع الأصول صلاحية إدارة المتجر.</p>
              </div>
            )
          ) : null}

          {tab === 'custom' ? <CustomSubmissionQueue canManage={canManage} user={user} /> : null}
        </div>
      </section>
    </div>
  );
}

function CustomSubmissionQueue({
  canManage,
  user,
}: {
  canManage: boolean;
  user: User;
}) {
  const { confirm, notify } = useAdminFeedback();
  const [status, setStatus] = useState('pending');
  const [submissions, setSubmissions] = useState<AdminCustomSubmission[]>([]);
  const [selected, setSelected] = useState<AdminCustomSubmission>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [eligibilityUid, setEligibilityUid] = useState('');
  const [eligibility, setEligibility] = useState<AdminCustomEligibility>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const rows = await requestAdminCustomSubmissions(user, { status });
      setSubmissions(rows);
      setSelected((current) => rows.find((row) => row.submissionId === current?.submissionId) || rows[0]);
      setPreviewUrl('');
      setState('ready');
    } catch (cause) {
      setError(message(cause));
      setState('error');
    }
  }, [status, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onRefresh(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === 'custom') void load();
    }
    window.addEventListener('cosmetics-tab-refresh', onRefresh);
    return () => window.removeEventListener('cosmetics-tab-refresh', onRefresh);
  }, [load]);

  async function decide(
    operation: 'approve-custom-submission' | 'reject-custom-submission' | 'suspend-custom-submission',
  ) {
    if (!selected || reason.trim().length < 3) {
      setError('اختر طلباً وأدخل سبب المراجعة.');
      return;
    }
    if (operation !== 'approve-custom-submission') {
      const accepted = await confirm({
        confirmLabel: operation === 'suspend-custom-submission' ? 'تعليق' : 'رفض',
        description: 'سيُسجَّل القرار في التدقيق وقد يؤثر فوراً على أهلية العرض عند وجود أصول معتمدة.',
        destructive: true,
        title: operation === 'suspend-custom-submission' ? 'تأكيد التعليق' : 'تأكيد الرفض',
      });
      if (!accepted) return;
    }
    setBusy(true);
    setError('');
    try {
      await mutateAdminCosmeticAsset(user, {
        expectedRevision: selected.revision,
        operation,
        reason: reason.trim(),
        submissionId: selected.submissionId,
      });
      setReason('');
      setPreviewUrl('');
      notify('تم تحديث الطلب المخصص', { tone: 'success' });
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    if (!selected || reason.trim().length < 3) {
      setError('أدخل سبب تدقيق قبل طلب دليل الحجر.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const preview = await requestAdminCustomSubmissionPreview(user, {
        reason: reason.trim(),
        submissionId: selected.submissionId,
      });
      setPreviewUrl(preview.previewUrl);
      notify('تم تجهيز معاينة الدليل', {
        description: 'الرابط موقّع وقصير العمر ولا يظهر في جدول الطابور.',
        tone: 'success',
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loadEligibility() {
    if (!eligibilityUid.trim()) return;
    setBusy(true);
    setError('');
    try {
      setEligibility(await requestAdminCustomEligibility(user, eligibilityUid.trim()));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function mutateEligibility(operation: 'grant-custom-eligibility' | 'revoke-custom-eligibility') {
    if (!eligibilityUid.trim() || reason.trim().length < 3) {
      setError('أدخل معرّف المستخدم وسبب التغيير قبل تعديل الأهلية.');
      return;
    }
    if (operation === 'revoke-custom-eligibility') {
      const accepted = await confirm({
        confirmLabel: 'سحب',
        description: 'السحب يزيل التجهيزات المخصصة فقط ولا يمس مشتريات المتجر.',
        destructive: true,
        title: 'سحب أهلية التخصيص',
      });
      if (!accepted) return;
    }
    setBusy(true);
    setError('');
    try {
      await mutateAdminCosmeticAsset(user, {
        ...(operation === 'grant-custom-eligibility'
          ? { categories: [...customCategories], dailyUploadLimit: 5, maxPending: 3 }
          : {}),
        operation,
        reason: reason.trim(),
        uid: eligibilityUid.trim(),
      });
      setEligibility(await requestAdminCustomEligibility(user, eligibilityUid.trim()));
      notify(operation === 'grant-custom-eligibility' ? 'تم منح الأهلية' : 'تم سحب الأهلية', { tone: 'success' });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cosmetics-custom-queue">
      <div className="cosmetics-custom-toolbar">
        <label className="field cosmetics-filter-field">
          <span>حالة الطلب</span>
          <select aria-label="حالة الطلب" value={status} onChange={(event) => setStatus(event.target.value)}>
            {['pending', 'processed', 'approved', 'rejected', 'suspended'].map((value) => (
              <option key={value} value={value}>{labelOf(cosmeticsSubmissionStatusLabels, value)}</option>
            ))}
          </select>
        </label>
        <button className="secondary-button compact" disabled={state === 'loading'} onClick={() => void load()} type="button">تحديث الطابور</button>
      </div>

      {error ? <div className="economy-error"><strong>فشل طابور الطلبات</strong><span>{error}</span></div> : null}

      <div className="cosmetics-registry-grid">
        <div className="cosmetics-registry-list">
          <h3>الطابور</h3>
          {state === 'loading' ? <p>جارٍ تحميل الطلبات…</p> : null}
          {state === 'ready' && submissions.length === 0 ? <p>لا توجد طلبات في هذه الحالة.</p> : null}
          {submissions.map((row) => (
            <button
              className="cosmetics-registry-row"
              key={row.submissionId}
              onClick={() => {
                setSelected(row);
                setPreviewUrl('');
                setEligibilityUid(row.ownerUid);
              }}
              type="button"
            >
              <span>
                <strong dir="ltr">{row.submissionId}</strong>
                <small><span dir="ltr">{row.ownerUid}</span> · {labelOf(cosmeticsCategoryLabels, row.category)} · ر{row.revision}</small>
              </span>
              <span>
                <b>{labelOf(cosmeticsSubmissionStatusLabels, row.status)}</b>
                <small dir="ltr">{labelOf(cosmeticsFormatLabels, row.format)} · {row.width}×{row.height}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="cosmetics-registry-detail">
          <h3>تفاصيل المراجعة</h3>
          {!selected ? <p>اختر طلباً لمراجعة التحقق والإقرار.</p> : (
            <>
              <div className="cosmetics-registry-summary">
                <strong dir="ltr">{selected.submissionId}</strong>
                <span>{labelOf(cosmeticsSubmissionStatusLabels, selected.status)} · المالك <b dir="ltr">{selected.ownerUid}</b></span>
                <span>{labelOf(cosmeticsCategoryLabels, selected.category)} / {labelOf(cosmeticsFormatLabels, selected.format)} / <b dir="ltr">{selected.contentType}</b></span>
                <span>
                  التحقق: {selected.width}×{selected.height}
                  {selected.byteSize ? ` · ${formatBytes(selected.byteSize)}` : ''}
                  {selected.sha256 ? <> · sha256 <b dir="ltr">{selected.sha256.slice(0, 12)}…</b></> : ''}
                </span>
                <span>الإيصال: <b dir="ltr">{selected.validationReceiptId || '—'}</b></span>
                <span>الإقرار: {selected.attestation || 'غير موجود'}</span>
                {selected.decisionReason ? <span>القرار: {selected.decisionReason}</span> : null}
                {selected.approvedAssetId ? (
                  <span>الأصل المعتمد: <b dir="ltr">{selected.approvedAssetId}/{selected.approvedVersionId}</b></span>
                ) : null}
              </div>
              <label className="field">
                <span>سبب التدقيق</span>
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="cosmetics-registry-actions">
                <button disabled={!canManage || busy || selected.status !== 'pending'} onClick={() => void decide('approve-custom-submission')} type="button">اعتماد للمالك</button>
                <button disabled={!canManage || busy || selected.status !== 'pending'} onClick={() => void decide('reject-custom-submission')} type="button">رفض</button>
                <button disabled={!canManage || busy || !['pending', 'approved', 'processed'].includes(selected.status)} onClick={() => void decide('suspend-custom-submission')} type="button">تعليق</button>
                <button disabled={!canManage || busy} onClick={() => void openPreview()} type="button">معاينة الدليل</button>
              </div>
              {previewUrl ? (
                <div className="cosmetics-custom-preview">
                  <p>معاينة دليل محدودة (ليست رابط كتالوج)</p>
                  {selected.format === 'lottie-json' ? (
                    <a href={previewUrl} rel="noreferrer" target="_blank">فتح دليل Lottie الموقّع</a>
                  ) : (
                    <img alt="دليل الطلب المخصص" src={previewUrl} />
                  )}
                </div>
              ) : null}
            </>
          )}

          <div className="cosmetics-eligibility">
            <h3>قائمة أهلية التخصيص</h3>
            <label className="field">
              <span>معرّف المستخدم</span>
              <input dir="ltr" value={eligibilityUid} onChange={(event) => setEligibilityUid(event.target.value.trim())} />
            </label>
            <div className="cosmetics-registry-actions">
              <button disabled={busy || !eligibilityUid} onClick={() => void loadEligibility()} type="button">استعلام</button>
              <button disabled={!canManage || busy || !eligibilityUid} onClick={() => void mutateEligibility('grant-custom-eligibility')} type="button">منح</button>
              <button disabled={!canManage || busy || !eligibilityUid} onClick={() => void mutateEligibility('revoke-custom-eligibility')} type="button">سحب</button>
            </div>
            {eligibility ? (
              <p>
                <b dir="ltr">{eligibility.uid}</b>: {eligibility.active ? 'نشط' : 'غير نشط'}
                {' · '}
                {(eligibility.categories || []).map((value) => labelOf(cosmeticsCategoryLabels, value)).join('، ') || 'بدون تصنيفات'}
                {' · '}
                يومياً {eligibility.dailyUploadLimit} / معلّق {eligibility.maxPending}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function tabIcon(tab: CosmeticsTab) {
  switch (tab) {
    case 'registry':
      return '◎';
    case 'upload':
      return '↑';
    case 'custom':
      return '◇';
    default:
      return '·';
  }
}

function operationLabel(operation: string) {
  switch (operation) {
    case 'reject-version':
      return 'تأكيد رفض الإصدار';
    case 'emergency-disable':
      return 'تأكيد الإيقاف الطارئ';
    case 'suspend':
      return 'تأكيد التعليق';
    case 'rollback-version':
      return 'تأكيد استرجاع الإصدار';
    default:
      return 'تأكيد العملية';
  }
}

function staticFormat(format: Draft['format']) {
  return format === 'png' || format === 'jpeg';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return 'حجم غير معروف';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} ميبيبايت`
    : `${(bytes / 1024).toFixed(1)} كيبيبايت`;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'فشلت عملية السجل.';
}
