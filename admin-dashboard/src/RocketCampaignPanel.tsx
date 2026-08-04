import type { User } from 'firebase/auth';
import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react';

import {
  AdminRocketAsset,
  AdminRocketCampaignDetail,
  AdminRocketRewardBundle,
  AdminRocketTemplate,
  mutateAdminRocketCampaign,
  requestAdminRocketCampaign,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';
import { uploadRoomRocketAsset } from './roomRocketAssets';
import { AttendanceShadowPanel } from './AttendanceShadowPanel';
import { PayrollPanel } from './PayrollPanel';

const RoomTargetPanel = lazy(() => import('./RoomTargetPanel').then((module) => ({ default: module.RoomTargetPanel })));
const WeeklyIncentiveIntegrityPanel = lazy(() => import('./WeeklyIncentiveIntegrityPanel').then((module) => ({ default: module.WeeklyIncentiveIntegrityPanel })));
const DailyLoginRewardsPanel = lazy(() => import('./DailyLoginRewardsPanel').then((module) => ({ default: module.DailyLoginRewardsPanel })));

type RankDraft = { coins: string; diamonds: string; enabled: boolean; itemIds: string };
type Draft = {
  approvalId: string;
  animationDurationMs: string;
  device: string;
  minimumClientVersion: string;
  nameAr: string;
  nameEn: string;
  ranks: Record<'1' | '2' | '3', RankDraft>;
  target: string;
  testedClientVersion: string;
};

export function RocketCampaignPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const [detail, setDetail] = useState<AdminRocketCampaignDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(() => createDraft());
  const [assets, setAssets] = useState<AdminRocketTemplate['appearance']>({ name: { ar: '', en: '' } });
  const [reason, setReason] = useState('');
  const [previewReducedMotion, setPreviewReducedMotion] = useState(false);
  const [previewPodiumPeriod, setPreviewPodiumPeriod] = useState<'today' | 'week'>('week');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const canManage = permissions.includes('incentives:manage');
  const revision = detail?.campaign?.revision || 0;
  const assetVersion = Math.max(1, revision + 1);

  async function load() {
    setError('');
    try {
      const value = await requestAdminRocketCampaign(user);
      setDetail(value);
      if (value.campaign?.draft) {
        setDraft(createDraft(value.campaign.draft));
        setAssets(value.campaign.draft.appearance);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل حملة الصاروخ.');
    }
  }

  useEffect(() => { void load(); }, [user.uid]);

  const enabledRankCount = useMemo(() => {
    if (draft.ranks['3'].enabled) return 3 as const;
    if (draft.ranks['2'].enabled) return 2 as const;
    return 1 as const;
  }, [draft.ranks]);
  const liability = useMemo(() => {
    const candidate = buildTemplate(draft, assets, 'save-draft');
    return candidate
      ? Object.values(candidate.rewards).reduce((total, reward) => ({
          coins: total.coins + (reward?.coins || 0),
          diamonds: total.diamonds + (reward?.diamonds || 0),
          items: total.items + (reward?.items.length || 0),
        }), { coins: 0, diamonds: 0, items: 0 })
      : null;
  }, [assets, draft]);

  async function upload(slot: 'animation' | 'sound' | 'static', file?: File) {
    if (!file) return;
    setBusy(`upload:${slot}`);
    try {
      const asset = await uploadRoomRocketAsset(file, slot, assetVersion);
      setAssets((current) => ({ ...current, [`${slot}Asset`]: asset }));
      notify('تم رفع أصل الصاروخ', { description: 'حُفظ الأصل في مسار ثابت غير قابل للاستبدال.', tone: 'success' });
    } catch (uploadError) {
      notify('تعذر رفع الأصل', { description: uploadError instanceof Error ? uploadError.message : '', tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function submit(event: FormEvent, operation: 'save-draft' | 'publish') {
    event.preventDefault();
    if (!canManage || reason.trim().length < 3) {
      notify('سبب التغيير مطلوب', { tone: 'error' });
      return;
    }
    const template = buildTemplate(draft, assets, operation);
    if (!template) {
      notify('بيانات الحملة غير مكتملة', { description: 'تحقق من الهدف والمكافآت والأصول واختبار الجهاز الفعلي.', tone: 'error' });
      return;
    }
    setBusy(operation);
    try {
      const result = await mutateAdminRocketCampaign(user, {
        expectedRevision: revision,
        operation,
        reason: reason.trim(),
        template,
      });
      notify(operation === 'publish' ? 'نُشرت حملة الصاروخ' : 'حُفظت المسودة', {
        description: result.effectiveFromCycleId
          ? `ستبدأ تلقائياً مع الدورة ${result.effectiveFromCycleId}.`
          : 'لم تتغير الدورة الأسبوعية الفعالة.',
        tone: 'success',
      });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر حفظ حملة الصاروخ', { description: mutationError instanceof Error ? mutationError.message : '', tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function mutateSimple(operation: 'emergency-disable' | 'rollback', rollbackRevision?: number) {
    if (!canManage || reason.trim().length < 3) {
      notify('سبب التغيير مطلوب', { tone: 'error' });
      return;
    }
    setBusy(operation);
    try {
      await mutateAdminRocketCampaign(user, {
        expectedRevision: revision,
        operation,
        reason: reason.trim(),
        ...(rollbackRevision ? { rollbackRevision } : {}),
      });
      notify(operation === 'rollback' ? 'تم إنشاء إصدار استرجاع جديد' : 'أوقِف عرض الصاروخ فوراً', { tone: 'success' });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تنفيذ الإجراء', { description: mutationError instanceof Error ? mutationError.message : '', tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (!detail) {
    return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={!error} loadingMessage="جارٍ تحميل حملة الصاروخ…" onRetry={() => void load()} />;
  }

  return (
    <div className="settings-page rocket-campaign-page">
      <AdminSectionHeader
        actions={<button className="secondary-button compact" onClick={() => void load()} type="button">تحديث</button>}
        description="قالب أسبوعي عالمي ثابت لكل الغرف. أي نشر جديد يبدأ من الأسبوع التالي ولا يغيّر دورة جارية."
        eyebrow="الحوافز الأسبوعية"
        title="حملة صاروخ الغرف"
      />

      <Suspense fallback={<AdminSurface className="settings-card"><p className="field-hint">جارٍ تحميل مكافآت الدخول اليومي…</p></AdminSurface>}>
        <DailyLoginRewardsPanel permissions={permissions} user={user} />
      </Suspense>
      <AttendanceShadowPanel permissions={permissions} user={user} />
      <PayrollPanel permissions={permissions} user={user} />
      <Suspense fallback={<AdminSurface className="settings-card"><p className="field-hint">جاري تحميل إعدادات هدف الغرفة…</p></AdminSurface>}>
        <RoomTargetPanel permissions={permissions} user={user} />
      </Suspense>
      <Suspense fallback={<AdminSurface className="settings-card"><p className="field-hint">جارٍ تحميل سلامة الحوافز…</p></AdminSurface>}>
        <WeeklyIncentiveIntegrityPanel permissions={permissions} user={user} />
      </Suspense>

      <div className="settings-kpis">
        <Metric label="الإصدار الإداري" value={String(revision)} />
        <Metric label="آخر إصدار منشور" value={String(detail.campaign?.lastPublishedRevision || 0)} />
        <Metric label="الدورة القادمة" value={detail.campaign?.nextEffectiveCycleId || '—'} />
        <Metric label="العرض" value={detail.campaign?.emergencyDisabled ? 'موقوف للطوارئ' : 'متاح'} danger={detail.campaign?.emergencyDisabled} />
      </div>

      <div className="settings-kpis rocket-operations-kpis">
        <Metric label="الغرف العامة المؤهلة" value={detail.operations.qualifyingRoomCount.toLocaleString('ar-IQ')} />
        <Metric label="دورات نشطة أو مفتوحة" value={detail.operations.activeCycleCount.toLocaleString('ar-IQ')} />
        <Metric label="تسويات مدفوعة" value={(detail.operations.settlementCounts.paid || 0).toLocaleString('ar-IQ')} />
        <Metric
          label="إجمالي الصرف المرصود"
          value={`${detail.operations.settledRewards.coins.toLocaleString('ar-IQ')} عملة · ${detail.operations.settledRewards.diamonds.toLocaleString('ar-IQ')} ماسة`}
        />
      </div>

      <form className="settings-grid" onSubmit={(event) => void submit(event, 'save-draft')}>
        <AdminSurface className="settings-card">
          <h3>الهدف والهوية</h3>
          <Field label="هدف نقاط الدعم"><input min="1" onChange={(event) => setDraft({ ...draft, target: event.target.value })} type="number" value={draft.target} /></Field>
          <Field label="اسم عربي"><input onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })} value={draft.nameAr} /></Field>
          <Field label="اسم إنجليزي"><input dir="ltr" onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} value={draft.nameEn} /></Field>
          <Field label="أقل إصدار عميل"><input dir="ltr" onChange={(event) => setDraft({ ...draft, minimumClientVersion: event.target.value })} value={draft.minimumClientVersion} /></Field>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>الأصول الثابتة</h3>
          <AssetInput asset={assets.staticAsset} accept="image/png,image/webp" busy={busy} label="صورة تقليل الحركة" onFile={(file) => void upload('static', file)} slot="static" />
          <AssetInput asset={assets.animationAsset} accept="image/webp" busy={busy} label="انفجار WebP متحرك" onFile={(file) => void upload('animation', file)} slot="animation" />
          <Field label="مدة الحركة بالمللي ثانية"><input min="500" max="12000" onChange={(event) => setDraft({ ...draft, animationDurationMs: event.target.value })} type="number" value={draft.animationDurationMs} /></Field>
          <AssetInput asset={assets.soundAsset} accept="audio/mpeg,audio/mp4,audio/x-m4a" busy={busy} label="صوت اختياري" onFile={(file) => void upload('sound', file)} slot="sound" />
          <p className="field-hint">الإصدار التالي للأصول: v{assetVersion}. لا يمكن استبدال ملف بعد رفعه.</p>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>اعتماد الحركة على جهاز فعلي</h3>
          <Field label="معرّف الاعتماد"><input dir="ltr" onChange={(event) => setDraft({ ...draft, approvalId: event.target.value })} value={draft.approvalId} /></Field>
          <Field label="الجهاز الفعلي"><input onChange={(event) => setDraft({ ...draft, device: event.target.value })} value={draft.device} /></Field>
          <Field label="إصدار العميل المختبَر"><input dir="ltr" onChange={(event) => setDraft({ ...draft, testedClientVersion: event.target.value })} value={draft.testedClientVersion} /></Field>
          <p className="field-hint">النشر يثبت أن الذاكرة، تقليل الحركة، والصورة البديلة اختُبرت على الجهاز المذكور.</p>
        </AdminSurface>

        <AdminSurface className="settings-card rocket-preview-card">
          <div className="rocket-preview-heading">
            <div><h3>معاينة داخل الغرفة</h3><p className="field-hint">المعاينة لا تنشر التغييرات ولا تشغّل صوتاً.</p></div>
            <label className="rocket-motion-toggle"><input checked={previewReducedMotion} onChange={(event) => setPreviewReducedMotion(event.target.checked)} type="checkbox" /> تقليل الحركة</label>
          </div>
          <RocketAppearancePreview
            appearance={{ ...assets, name: { ar: draft.nameAr, en: draft.nameEn } }}
            reducedMotion={previewReducedMotion}
            target={Number(draft.target) || 0}
          />
          <div className="rocket-preview-tabs" role="tablist">
            <button aria-selected={previewPodiumPeriod === 'week'} className={previewPodiumPeriod === 'week' ? 'is-active' : ''} onClick={() => setPreviewPodiumPeriod('week')} role="tab" type="button">هذا الأسبوع</button>
            <button aria-selected={previewPodiumPeriod === 'today'} className={previewPodiumPeriod === 'today' ? 'is-active' : ''} onClick={() => setPreviewPodiumPeriod('today')} role="tab" type="button">اليوم</button>
          </div>
          <div className="rocket-sample-podium">
            {(['2', '1', '3'] as const).filter((rank) => Number(rank) <= enabledRankCount).map((rank) => (
              <div className={rank === '1' ? 'is-first' : ''} key={rank}>
                <span>{rank}</span><b>{previewPodiumPeriod === 'today' ? 'داعم اليوم' : 'داعم الأسبوع'}</b><small>{rewardSummary(buildReward(draft.ranks[rank]))}</small>
              </div>
            ))}
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card rocket-ranks-card">
          <h3>مكافآت المراتب</h3>
          {(['1', '2', '3'] as const).map((rank) => (
            <RankEditor
              draft={draft.ranks[rank]}
              key={rank}
              locked={rank === '1'}
              onChange={(value) => setDraft({ ...draft, ranks: { ...draft.ranks, [rank]: value } })}
              rank={rank}
            />
          ))}
          <p className="field-hint">المراتب المفعلة: {enabledRankCount}. صيغة العنصر: item-id أو item-id|coins|100 لتحديد بديل التكرار.</p>
          <p className="field-hint">أقصى التزام للدورة لكل غرفة: {liability ? `${liability.coins} Coins · ${liability.diamonds} Diamonds · ${liability.items} items` : 'بيانات غير صالحة'}</p>
          <div className="rocket-cost-summary">
            <span><small>التكلفة القصوى المعيارية</small><b>{liability ? `${liability.coins.toLocaleString('ar-IQ')} عملة · ${liability.diamonds.toLocaleString('ar-IQ')} ماسة · ${liability.items.toLocaleString('ar-IQ')} عنصر` : '—'}</b></span>
            <span><small>عملات الجوائز نسبةً إلى الهدف</small><b>{liability && Number(draft.target) > 0 ? `${((liability.coins / Number(draft.target)) * 100).toFixed(2)}%` : '—'}</b></span>
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card rocket-publish-card">
          <h3>النشر والحوكمة</h3>
          <Field label="سبب التغيير"><textarea onChange={(event) => setReason(event.target.value)} rows={3} value={reason} /></Field>
          <div className="button-row">
            <button className="secondary-button" disabled={!canManage || Boolean(busy)} type="submit">حفظ مسودة</button>
            <button className="primary-button" disabled={!canManage || Boolean(busy)} onClick={(event) => void submit(event, 'publish')} type="button">نشر للأسبوع القادم</button>
            <button className="danger-button" disabled={!canManage || Boolean(busy) || !detail.campaign?.lastPublishedRevision} onClick={() => void mutateSimple('emergency-disable')} type="button">إيقاف عرض طارئ</button>
          </div>
          {!canManage && <AdminStatusBadge tone="warning">عرض فقط</AdminStatusBadge>}
        </AdminSurface>
      </form>

      <AdminSurface className="settings-card rocket-active-cycles">
        <h3>لقطة الدورات الحديثة</h3>
        <div className="settings-list">
          {detail.operations.activeCycles.map((cycle) => (
            <div className="settings-row" key={`${cycle.roomId}:${cycle.cycleId}`}>
              <div><strong dir="ltr">{cycle.roomId}</strong><small dir="ltr">{cycle.cycleId} · {cycle.state}</small></div>
              <b>{cycle.supportPoints.toLocaleString('ar-IQ')} / {cycle.targetSupportPoints.toLocaleString('ar-IQ')}</b>
            </div>
          ))}
          {detail.operations.activeCycles.length === 0 ? <p className="field-hint">لا توجد دورات صاروخ منشأة بعد.</p> : null}
        </div>
      </AdminSurface>

      <AdminSurface className="settings-card">
        <h3>الإصدارات المنشورة</h3>
        <div className="settings-list">
          {detail.versions.map((version) => (
            <div className="settings-row" key={version.revision}>
              <div><strong>v{version.revision}</strong><small>{version.effectiveFromCycleId}</small></div>
              <button className="secondary-button compact" disabled={!canManage || Boolean(busy) || version.revision === detail.campaign?.lastPublishedRevision} onClick={() => void mutateSimple('rollback', version.revision)} type="button">استرجاع كإصدار جديد</button>
            </div>
          ))}
          {detail.versions.length === 0 && <p className="field-hint">لا توجد نسخة منشورة بعد.</p>}
        </div>
      </AdminSurface>
    </div>
  );
}

function createDraft(template?: AdminRocketTemplate): Draft {
  const ranks = (['1', '2', '3'] as const).reduce((result, rank) => {
    const reward = template?.rewards[rank];
    result[rank] = {
      coins: String(reward?.coins || 0),
      diamonds: String(reward?.diamonds || 0),
      enabled: rank === '1' || Number(rank) <= (template?.enabledRankCount || 1),
      itemIds: reward?.items.map((item) => item.duplicateFallback
        ? `${item.itemId}|${item.duplicateFallback.currency}|${item.duplicateFallback.amount}`
        : item.itemId).join(', ') || '',
    };
    return result;
  }, {} as Draft['ranks']);
  return {
    approvalId: template?.animationApproval?.approvalId || '',
    animationDurationMs: String(template?.appearance.animationAsset?.durationMs || 3000),
    device: template?.animationApproval?.physicalAndroidDevice || '',
    minimumClientVersion: template?.minimumClientVersion || '1.0.0',
    nameAr: template?.appearance.name.ar || '',
    nameEn: template?.appearance.name.en || '',
    ranks,
    target: String(template?.targetSupportPoints || 100000),
    testedClientVersion: template?.animationApproval?.testedClientVersion || '1.0.0',
  };
}

function buildTemplate(draft: Draft, assets: AdminRocketTemplate['appearance'], operation: 'save-draft' | 'publish'): AdminRocketTemplate | undefined {
  const targetSupportPoints = Number(draft.target);
  const enabledRankCount = draft.ranks['3'].enabled ? 3 : draft.ranks['2'].enabled ? 2 : 1;
  const rewards: AdminRocketTemplate['rewards'] = {};
  for (let rank = 1; rank <= enabledRankCount; rank += 1) {
    const value = draft.ranks[String(rank) as '1' | '2' | '3'];
    const items = parseRewardItems(value.itemIds);
    if (!items) return undefined;
    const bundle: AdminRocketRewardBundle = {
      coins: Number(value.coins),
      diamonds: Number(value.diamonds),
      items,
      schemaVersion: 1,
    };
    if (![bundle.coins, bundle.diamonds].every((value) => Number.isSafeInteger(value) && value >= 0)
      || (bundle.coins === 0 && bundle.diamonds === 0 && bundle.items.length === 0)) return undefined;
    rewards[String(rank) as '1' | '2' | '3'] = bundle;
  }
  if (!Number.isSafeInteger(targetSupportPoints) || targetSupportPoints < 1 || !draft.nameAr.trim() || !draft.nameEn.trim()) return undefined;
  if (operation === 'publish' && (!assets.staticAsset || !assets.animationAsset || !draft.approvalId.trim() || !draft.device.trim())) return undefined;
  const animationDurationMs = Number(draft.animationDurationMs);
  const appearance = {
    ...assets,
    ...(assets.animationAsset ? {
      animationAsset: { ...assets.animationAsset, durationMs: animationDurationMs },
    } : {}),
    name: { ar: draft.nameAr.trim(), en: draft.nameEn.trim() },
  };
  if (assets.animationAsset && (!Number.isSafeInteger(animationDurationMs) || animationDurationMs < 1 || animationDurationMs > 12_000)) {
    return undefined;
  }
  return {
    ...(draft.approvalId.trim() && draft.device.trim() ? {
      animationApproval: {
        approvalId: draft.approvalId.trim(),
        fallbackVerified: true,
        memoryVerified: true,
        physicalAndroidDevice: draft.device.trim(),
        reducedMotionVerified: true,
        testedClientVersion: draft.testedClientVersion.trim(),
      },
    } : {}),
    appearance,
    enabledRankCount,
    minimumClientVersion: draft.minimumClientVersion.trim(),
    publicationStatus: operation === 'publish' ? 'published' : 'draft',
    rewards,
    schemaVersion: 1,
    targetSupportPoints,
    templateId: 'global-room-rocket',
    templateVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function parseRewardItems(value: string): AdminRocketRewardBundle['items'] | undefined {
  const items: AdminRocketRewardBundle['items'] = [];
  for (const token of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const [itemId, currency, amount, ...extra] = token.split('|').map((entry) => entry.trim());
    if (!itemId || extra.length > 0) return undefined;
    if (!currency && !amount) {
      items.push({ itemId });
      continue;
    }
    const fallbackAmount = Number(amount);
    if (!['coins', 'diamonds'].includes(currency || '') || !Number.isSafeInteger(fallbackAmount) || fallbackAmount < 1) return undefined;
    items.push({
      duplicateFallback: { amount: fallbackAmount, currency: currency as 'coins' | 'diamonds' },
      itemId,
    });
  }
  return items;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function AssetInput({ accept, asset, busy, label, onFile, slot }: {
  accept: string;
  asset?: AdminRocketAsset;
  busy: string;
  label: string;
  onFile: (file?: File) => void;
  slot: 'animation' | 'sound' | 'static';
}) {
  return <label className="field"><span>{label}</span><input accept={accept} disabled={Boolean(busy)} onChange={(event) => onFile(event.target.files?.[0])} type="file" /><small>{asset ? `${asset.format} · ${(asset.bytes / 1024).toFixed(0)} KB · v${asset.version}` : 'غير مرفوع'}</small></label>;
}

function RankEditor({ draft, locked, onChange, rank }: { draft: RankDraft; locked: boolean; onChange: (value: RankDraft) => void; rank: string }) {
  return <fieldset className="rocket-rank-editor"><legend>المرتبة {rank}</legend><label><input checked={draft.enabled} disabled={locked} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} type="checkbox" /> مفعلة</label><input aria-label={`Coins rank ${rank}`} min="0" onChange={(event) => onChange({ ...draft, coins: event.target.value })} placeholder="Coins" type="number" value={draft.coins} /><input aria-label={`Diamonds rank ${rank}`} min="0" onChange={(event) => onChange({ ...draft, diamonds: event.target.value })} placeholder="Diamonds" type="number" value={draft.diamonds} /><input aria-label={`Items rank ${rank}`} dir="ltr" onChange={(event) => onChange({ ...draft, itemIds: event.target.value })} placeholder="item-one, item-two" value={draft.itemIds} /></fieldset>;
}

function RocketAppearancePreview({
  appearance,
  reducedMotion,
  target,
}: {
  appearance: AdminRocketTemplate['appearance'];
  reducedMotion: boolean;
  target: number;
}) {
  const source = reducedMotion ? appearance.staticAsset?.uri : appearance.animationAsset?.uri || appearance.staticAsset?.uri;
  return <div className={`rocket-appearance-preview${reducedMotion ? ' is-reduced' : ''}`}>
    <div className="rocket-preview-rings" />
    {source ? <img alt="" src={source} /> : <span aria-label="صاروخ" className="rocket-preview-fallback">🚀</span>}
    <div><small>{reducedMotion ? 'بديل ثابت لتقليل الحركة' : 'انفجار الهدف الكامل'}</small><strong>{appearance.name.ar || 'اسم الصاروخ'}</strong><p>{target.toLocaleString('ar-IQ')} نقطة دعم</p></div>
  </div>;
}

function buildReward(value: RankDraft): AdminRocketRewardBundle {
  return {
    coins: Number(value.coins) || 0,
    diamonds: Number(value.diamonds) || 0,
    items: parseRewardItems(value.itemIds) || [],
    schemaVersion: 1,
  };
}

function rewardSummary(value: AdminRocketRewardBundle) {
  return [
    value.coins ? `${value.coins.toLocaleString('ar-IQ')} عملة` : '',
    value.diamonds ? `${value.diamonds.toLocaleString('ar-IQ')} ماسة` : '',
    value.items.length ? `${value.items.length.toLocaleString('ar-IQ')} عنصر` : '',
  ].filter(Boolean).join(' · ') || 'بدون مكافأة';
}

function Metric({ danger, label, value }: { danger?: boolean; label: string; value: string }) {
  return <div className="settings-kpi"><span>{label}</span><strong className={danger ? 'danger-text' : ''}>{value}</strong></div>;
}
