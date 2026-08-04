import type { User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';

import {
  AdminDailyLoginCampaignDetail,
  AdminDailyLoginRewardBundle,
  AdminDailyLoginTemplate,
  mutateAdminDailyLoginCampaign,
  requestAdminDailyLoginCampaign,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';

type RewardDraft = {
  coins: string;
  diamonds: string;
  items: string;
};

type Draft = {
  minimumClientVersion: string;
  rewards: RewardDraft[];
};

const SAMPLE_AUDIENCES = [100, 1_000, 10_000] as const;

export function DailyLoginRewardsPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const [detail, setDetail] = useState<AdminDailyLoginCampaignDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(() => createDraft());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const canManage = permissions.includes('incentives:manage');

  async function load() {
    setError('');
    try {
      const value = await requestAdminDailyLoginCampaign(user);
      setDetail(value);
      setDraft(createDraft(value.draft?.template || value.effective || undefined));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مكافآت الدخول اليومي.');
    }
  }

  useEffect(() => {
    void load();
  }, [user.uid]);

  const template = useMemo(() => buildTemplate(draft), [draft]);
  const liabilities = useMemo(() => SAMPLE_AUDIENCES.map((claimants) => {
    const total = template?.rewards.reduce((sum, entry) => ({
      coins: sum.coins + entry.reward.coins,
      diamonds: sum.diamonds + entry.reward.diamonds,
      items: sum.items + entry.reward.items.length,
    }), { coins: 0, diamonds: 0, items: 0 }) || { coins: 0, diamonds: 0, items: 0 };
    return {
      claimants,
      coins: total.coins * claimants,
      diamonds: total.diamonds * claimants,
      items: total.items * claimants,
    };
  }), [template]);

  async function mutate(
    operation:
      | 'emergency-disable'
      | 'emergency-enable'
      | 'publish'
      | 'rollback'
      | 'save-draft'
      | 'set-claims-paused'
      | 'set-presentation-visible',
    options: { enabled?: boolean; rollbackRevision?: number } = {},
  ) {
    if (!detail || !canManage) return;
    if (reason.trim().length < 3) {
      notify('سبب التغيير مطلوب', { description: 'أدخل سبباً من 3 أحرف على الأقل لسجل التدقيق.', tone: 'error' });
      return;
    }
    if (['save-draft', 'publish'].includes(operation) && !template) {
      notify('جدول المكافآت غير صالح', { description: 'تحقق من إصدار العميل والقيم والعناصر في الأيام السبعة.', tone: 'error' });
      return;
    }
    setBusy(operation);
    try {
      const result = await mutateAdminDailyLoginCampaign(user, {
        expectedRevision: detail.revision,
        operation,
        reason: reason.trim(),
        ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
        ...(options.rollbackRevision ? { rollbackRevision: options.rollbackRevision } : {}),
        ...(['save-draft', 'publish'].includes(operation) && template ? { template } : {}),
      });
      notify(successTitle(operation), {
        description: result.effectiveAtMillis
          ? `سيصبح الإصدار v${result.publishedRevision} فعالاً عند منتصف الليل بتوقيت بغداد: ${formatDate(result.effectiveAtMillis)}.`
          : 'تم تطبيق الإجراء وتسجيله في سجل التدقيق.',
        tone: 'success',
      });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تنفيذ الإجراء', {
        description: mutationError instanceof Error ? mutationError.message : '',
        tone: 'error',
      });
    } finally {
      setBusy('');
    }
  }

  if (!detail) {
    return (
      <AdminCollectionState
        children={null}
        empty={false}
        emptyMessage=""
        error={error || undefined}
        loading={!error}
        loadingMessage="جارٍ تحميل مكافآت الدخول اليومي…"
        onRetry={() => void load()}
      />
    );
  }

  const pointer = detail.current;
  return (
    <section className="daily-login-admin" aria-labelledby="daily-login-admin-title">
      <AdminSurface className="settings-card daily-login-hero">
        <div>
          <p className="section-eyebrow">حافز الاحتفاظ اليومي</p>
          <h2 id="daily-login-admin-title">مكافآت الدخول اليومي</h2>
          <p className="field-hint">دورة ثابتة من 7 أيام. النشر يبدأ في منتصف الليل التالي بتوقيت بغداد، بينما مفاتيح السلامة تعمل فوراً.</p>
        </div>
        <div className="daily-login-statuses">
          <AdminStatusBadge tone={detail.features.rewardsEnabled ? 'success' : 'warning'}>
            {detail.features.rewardsEnabled ? 'العلم مفعّل' : 'العلم مغلق'}
          </AdminStatusBadge>
          <AdminStatusBadge tone={pointer?.claimsPaused ? 'warning' : 'success'}>
            {pointer?.claimsPaused ? 'المطالبات متوقفة' : 'المطالبات متاحة'}
          </AdminStatusBadge>
          <button className="secondary-button compact" onClick={() => void load()} type="button">تحديث</button>
        </div>
      </AdminSurface>

      <div className="settings-kpis">
        <Metric label="الإصدار الإداري" value={String(detail.revision)} />
        <Metric label="الإصدار الفعّال" value={pointer?.activeRevision ? `v${pointer.activeRevision}` : '—'} />
        <Metric label="مطالبات مرصودة" value={detail.metrics.claimCount.toLocaleString('ar-IQ')} />
        <Metric label="مطالبات فاشلة" value={detail.metrics.failedClaimCount.toLocaleString('ar-IQ')} danger={detail.metrics.failedClaimCount > 0} />
        <Metric
          label="نسبة الإعادة الآمنة"
          value={`${detail.metrics.claimCount + detail.metrics.replayCount > 0
            ? ((detail.metrics.replayCount / (detail.metrics.claimCount + detail.metrics.replayCount)) * 100).toFixed(2)
            : '0.00'}% · ${detail.metrics.replayCount.toLocaleString('ar-IQ')}`}
        />
        <Metric label="حسابات محجوزة" value={detail.metrics.heldUserCount.toLocaleString('ar-IQ')} danger={detail.metrics.heldUserCount > 0} />
        <Metric
          label="آخر مطابقة"
          value={detail.metrics.lastReconciliationAtMillis ? formatDate(detail.metrics.lastReconciliationAtMillis) : 'لم تُشغّل بعد'}
          danger={!detail.metrics.lastReconciliationAtMillis}
        />
      </div>

      {pointer?.scheduledRevision ? (
        <AdminSurface className="settings-card daily-login-schedule">
          <strong>إصدار مجدول: v{pointer.scheduledRevision}</strong>
          <span>{formatDate(pointer.scheduledAtMillis)}</span>
        </AdminSurface>
      ) : null}

      <div className="settings-grid daily-login-grid">
        <AdminSurface className="settings-card daily-login-editor">
          <div className="daily-login-card-heading">
            <div>
              <h3>جدول الأيام السبعة</h3>
              <p className="field-hint">صيغة العنصر: item-id أو item-id|coins|100. افصل عدة عناصر بفاصلة.</p>
            </div>
            {!canManage ? <AdminStatusBadge tone="warning">عرض فقط</AdminStatusBadge> : null}
          </div>
          <label className="field">
            <span>أقل إصدار عميل</span>
            <input
              dir="ltr"
              disabled={!canManage}
              onChange={(event) => setDraft({ ...draft, minimumClientVersion: event.target.value })}
              value={draft.minimumClientVersion}
            />
          </label>
          <div className="daily-login-days">
            {draft.rewards.map((reward, index) => (
              <div className="daily-login-day-editor" key={index}>
                <strong>اليوم {index + 1}</strong>
                <label>
                  <span>Coins</span>
                  <input min="0" disabled={!canManage} onChange={(event) => updateDay(index, 'coins', event.target.value, draft, setDraft)} type="number" value={reward.coins} />
                </label>
                <label>
                  <span>Diamonds</span>
                  <input min="0" disabled={!canManage} onChange={(event) => updateDay(index, 'diamonds', event.target.value, draft, setDraft)} type="number" value={reward.diamonds} />
                </label>
                <label className="daily-login-items-input">
                  <span>العناصر</span>
                  <input dir="ltr" disabled={!canManage} onChange={(event) => updateDay(index, 'items', event.target.value, draft, setDraft)} value={reward.items} />
                </label>
              </div>
            ))}
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card daily-login-preview">
          <h3>معاينة داخل التطبيق</h3>
          <div className="daily-login-preview-strip" aria-label="معاينة أيام المكافآت">
            {(template?.rewards || []).map((entry) => (
              <div className={entry.day === 7 ? 'is-finale' : ''} key={entry.day}>
                <span>{entry.day}</span>
                <strong>{rewardSummary(entry.reward)}</strong>
              </div>
            ))}
          </div>
          {!template ? <p className="danger-text">أكمل القيم الصحيحة لرؤية المعاينة.</p> : null}
        </AdminSurface>

        <AdminSurface className="settings-card daily-login-liability">
          <h3>الالتزام الأقصى لدورة كاملة</h3>
          <p className="field-hint">هذه الأرقام تفترض أن كل مستخدم يطالب بالأيام السبعة.</p>
          <div className="settings-list">
            {liabilities.map((entry) => (
              <div className="settings-row" key={entry.claimants}>
                <div><strong>{entry.claimants.toLocaleString('ar-IQ')} مستخدم</strong></div>
                <b>{entry.coins.toLocaleString('ar-IQ')} Coins · {entry.diamonds.toLocaleString('ar-IQ')} Diamonds · {entry.items.toLocaleString('ar-IQ')} Items</b>
              </div>
            ))}
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card daily-login-governance">
          <h3>النشر والسلامة</h3>
          <label className="field">
            <span>سبب التغيير</span>
            <textarea disabled={!canManage} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
          </label>
          <div className="button-row">
            <button className="secondary-button" disabled={!canManage || Boolean(busy)} onClick={() => void mutate('save-draft')} type="button">حفظ مسودة</button>
            <button className="primary-button" disabled={!canManage || Boolean(busy)} onClick={() => void mutate('publish')} type="button">نشر لمنتصف الليل التالي</button>
            <button className="secondary-button" disabled={!canManage || Boolean(busy) || !pointer} onClick={() => void mutate('set-claims-paused', { enabled: !pointer?.claimsPaused })} type="button">
              {pointer?.claimsPaused ? 'استئناف المطالبات' : 'إيقاف المطالبات'}
            </button>
            <button className="secondary-button" disabled={!canManage || Boolean(busy) || !pointer} onClick={() => void mutate('set-presentation-visible', { enabled: !pointer?.presentationVisible })} type="button">
              {pointer?.presentationVisible ? 'إخفاء العرض' : 'إظهار العرض'}
            </button>
            <button className={pointer?.emergencyDisabled ? 'secondary-button' : 'danger-button'} disabled={!canManage || Boolean(busy) || !pointer} onClick={() => void mutate(pointer?.emergencyDisabled ? 'emergency-enable' : 'emergency-disable')} type="button">
              {pointer?.emergencyDisabled ? 'إلغاء إيقاف الطوارئ' : 'إيقاف طارئ كامل'}
            </button>
          </div>
        </AdminSurface>
      </div>

      <AdminSurface className="settings-card">
        <h3>الإصدارات المنشورة</h3>
        <div className="settings-list">
          {detail.versions.map((version) => (
            <div className="settings-row" key={version.revision}>
              <div>
                <strong>v{version.revision}</strong>
                <small>{version.startsAtMillis ? formatDate(version.startsAtMillis) : 'بدون وقت بداية'}</small>
              </div>
              <button
                className="secondary-button compact"
                disabled={!canManage || Boolean(busy) || version.revision === pointer?.lastPublishedRevision}
                onClick={() => void mutate('rollback', { rollbackRevision: version.revision })}
                type="button"
              >
                استرجاع كإصدار جديد
              </button>
            </div>
          ))}
          {detail.versions.length === 0 ? <p className="field-hint">لا توجد نسخة منشورة بعد.</p> : null}
        </div>
      </AdminSurface>
    </section>
  );
}

function createDraft(template?: AdminDailyLoginTemplate): Draft {
  return {
    minimumClientVersion: template?.minimumClientVersion || '1.0.0',
    rewards: Array.from({ length: 7 }, (_, index) => {
      const reward = template?.rewards[index]?.reward;
      return {
        coins: String(reward?.coins || 0),
        diamonds: String(reward?.diamonds || 0),
        items: reward?.items.map((item) => item.duplicateFallback
          ? `${item.itemId}|${item.duplicateFallback.currency}|${item.duplicateFallback.amount}`
          : item.itemId).join(', ') || '',
      };
    }),
  };
}

function buildTemplate(draft: Draft): AdminDailyLoginTemplate | undefined {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(draft.minimumClientVersion.trim())) return undefined;
  const rewards: AdminDailyLoginTemplate['rewards'] = [];
  for (let index = 0; index < 7; index += 1) {
    const source = draft.rewards[index];
    const coins = Number(source.coins);
    const diamonds = Number(source.diamonds);
    const items = parseItems(source.items);
    if (!Number.isSafeInteger(coins) || coins < 0 || !Number.isSafeInteger(diamonds) || diamonds < 0 || !items) {
      return undefined;
    }
    rewards.push({
      day: index + 1,
      reward: { coins, diamonds, items, schemaVersion: 1 },
    });
  }
  return {
    minimumClientVersion: draft.minimumClientVersion.trim(),
    rewards,
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function parseItems(value: string): AdminDailyLoginRewardBundle['items'] | undefined {
  if (!value.trim()) return [];
  const items: AdminDailyLoginRewardBundle['items'] = [];
  for (const token of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const [itemId, currency, rawAmount, ...extra] = token.split('|').map((entry) => entry.trim());
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId) || extra.length > 0) return undefined;
    if (currency === undefined && rawAmount === undefined) {
      items.push({ itemId });
      continue;
    }
    const amount = Number(rawAmount);
    if (!['coins', 'diamonds'].includes(currency) || !Number.isSafeInteger(amount) || amount < 1) return undefined;
    items.push({
      duplicateFallback: { amount, currency: currency as 'coins' | 'diamonds' },
      itemId,
    });
  }
  return items;
}

function updateDay(
  index: number,
  field: keyof RewardDraft,
  value: string,
  draft: Draft,
  setDraft: (value: Draft) => void,
) {
  const rewards = draft.rewards.map((entry, entryIndex) => (
    entryIndex === index ? { ...entry, [field]: value } : entry
  ));
  setDraft({ ...draft, rewards });
}

function rewardSummary(reward: AdminDailyLoginRewardBundle) {
  return [
    reward.coins ? `${reward.coins.toLocaleString('ar-IQ')} C` : '',
    reward.diamonds ? `${reward.diamonds.toLocaleString('ar-IQ')} D` : '',
    reward.items.length ? `${reward.items.length.toLocaleString('ar-IQ')} item` : '',
  ].filter(Boolean).join(' · ') || '—';
}

function successTitle(operation: string) {
  if (operation === 'save-draft') return 'حُفظت المسودة';
  if (operation === 'publish') return 'تم جدولة الإصدار';
  if (operation === 'rollback') return 'تم إنشاء إصدار الاسترجاع';
  return 'تم تحديث التحكم المباشر';
}

function formatDate(value?: number) {
  return value
    ? new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(value)
    : '—';
}

function Metric({ danger, label, value }: { danger?: boolean; label: string; value: string }) {
  return <div className="settings-kpi"><span>{label}</span><strong className={danger ? 'danger-text' : ''}>{value}</strong></div>;
}
