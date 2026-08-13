import type { User } from 'firebase/auth';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  AdminPushAudienceEstimate,
  AdminPushCampaign,
  AdminPushRole,
  AdminPushRoute,
  estimateAdminPushAudience,
  listAdminPushCampaigns,
  sendAdminPushNotification,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';

const ROLE_OPTIONS: { description: string; key: AdminPushRole; label: string }[] = [
  { description: 'المسجلون في الرواتب بحالة نشطة.', key: 'staff', label: 'الموظفون' },
  { description: 'مالكو الغرف الحاليون.', key: 'room-owners', label: 'مالكو الغرف' },
  { description: 'حسابات لوحة الإدارة (مشرفون ومالكون).', key: 'admins', label: 'المشرفون' },
  { description: 'الوكلاء النشطون.', key: 'representatives', label: 'الوكلاء' },
];

const ROUTE_OPTIONS: { label: string; value: AdminPushRoute }[] = [
  { label: 'بدون توجيه (فتح التطبيق فقط)', value: '' },
  { label: 'الأصدقاء', value: 'Friends' },
  { label: 'الأزواج', value: 'Couples' },
  { label: 'الهدايا', value: 'Gifts' },
  { label: 'المتجر', value: 'Store' },
  { label: 'تحويل الوكيل', value: 'RepresentativeTransfer' },
  { label: 'محفظة المتجر', value: 'WalletStore' },
];

export function AdminPushPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const canManage = permissions.includes('flags:manage');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [route, setRoute] = useState<AdminPushRoute>('');
  const [uidsText, setUidsText] = useState('');
  const [roles, setRoles] = useState<AdminPushRole[]>([]);
  const [reason, setReason] = useState('');
  const [sendRequestId, setSendRequestId] = useState(() => crypto.randomUUID());
  const [estimate, setEstimate] = useState<AdminPushAudienceEstimate | null>(null);
  const [campaigns, setCampaigns] = useState<AdminPushCampaign[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const audience = useMemo(() => ({
    roles,
    uids: parseUidList(uidsText),
  }), [roles, uidsText]);

  const hasAudience = audience.uids.length > 0 || audience.roles.length > 0;
  const hasActiveCampaigns = campaigns.some((campaign) => campaign.status === 'queued' || campaign.status === 'sending');

  async function loadCampaigns() {
    setLoadingCampaigns(true);
    setError('');
    try {
      setCampaigns(await listAdminPushCampaigns(user));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل الحملات.');
    } finally {
      setLoadingCampaigns(false);
    }
  }

  useEffect(() => { void loadCampaigns(); }, [user.uid]);

  useEffect(() => {
    if (!hasActiveCampaigns) return undefined;
    const timer = window.setInterval(() => {
      void listAdminPushCampaigns(user)
        .then((rows) => setCampaigns(rows))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveCampaigns, user]);

  useEffect(() => {
    if (!canManage || !hasAudience) {
      setEstimate(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void estimateAdminPushAudience(user, audience)
        .then((value) => { if (!cancelled) setEstimate(value); })
        .catch(() => { if (!cancelled) setEstimate(null); });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audience, canManage, hasAudience, user]);

  function toggleRole(role: AdminPushRole) {
    setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    if (title.trim().length < 2 || body.trim().length < 2) {
      notify('أكمل العنوان والنص', { tone: 'error' });
      return;
    }
    if (!hasAudience) {
      notify('اختر جمهوراً واحداً على الأقل', { tone: 'error' });
      return;
    }
    if (reason.trim().length < 3) {
      notify('اكتب سبباً واضحاً للإرسال', { tone: 'error' });
      return;
    }

    const countLabel = estimate
      ? estimate.recipientCount.toLocaleString('ar-IQ')
      : 'غير محسوب';
    const approved = await confirm({
      confirmLabel: 'إرسال الإشعار',
      description: `سيُرسل الإشعار إلى حوالي ${countLabel} مستلم. لا يمكن التراجع بعد الإرسال.`,
      destructive: true,
      title: 'تأكيد إرسال الإشعار',
    });
    if (!approved) return;

    setBusy('send');
    try {
      const campaign = await sendAdminPushNotification(user, {
        audience,
        body: body.trim(),
        reason: reason.trim(),
        requestId: sendRequestId,
        route,
        title: title.trim(),
      });
      notify('تم طابور حملة الإشعار', {
        description: `المستهدفون: ${campaign.counts.targeted.toLocaleString('ar-IQ')} · الحالة: ${statusLabel(campaign.status)}`,
        tone: 'success',
      });
      setReason('');
      setSendRequestId(crypto.randomUUID());
      await loadCampaigns();
    } catch (sendError) {
      notify('تعذر إرسال الإشعار', {
        description: sendError instanceof Error ? sendError.message : 'حاول مجدداً.',
        tone: 'error',
      });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="economy-page admin-push-page">
      <div className="economy-hero">
        <div>
          <p className="economy-eyebrow">التواصل التشغيلي</p>
          <h1>إرسال إشعار فوري</h1>
          <p>اكتب العنوان والنص، اختر مستخدمين أو أدواراً منفصلة أو مجتمعة، وعاين شكل الإشعار على الهاتف قبل الإرسال.</p>
        </div>
        <button className="secondary-button economy-refresh" disabled={loadingCampaigns} onClick={() => void loadCampaigns()} type="button">
          تحديث السجل
        </button>
      </div>

      <div className="admin-push-layout">
        <form className="admin-push-form" onSubmit={(event) => void onSubmit(event)}>
          <AdminSurface className="settings-card">
            <h3>نص الإشعار</h3>
            <label className="field">
              <span>العنوان</span>
              <input
                disabled={!canManage || Boolean(busy)}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثال: صيانة مجدولة"
                value={title}
              />
            </label>
            <label className="field">
              <span>النص</span>
              <textarea
                disabled={!canManage || Boolean(busy)}
                maxLength={240}
                onChange={(event) => setBody(event.target.value)}
                placeholder="سيظهر هذا النص داخل بانر الإشعار على الجهاز."
                rows={4}
                value={body}
              />
            </label>
            <label className="field">
              <span>عند الضغط</span>
              <select
                disabled={!canManage || Boolean(busy)}
                onChange={(event) => setRoute(event.target.value as AdminPushRoute)}
                value={route}
              >
                {ROUTE_OPTIONS.map((option) => (
                  <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </AdminSurface>

          <AdminSurface className="settings-card">
            <h3>الجمهور</h3>
            <p className="field-hint">يمكن الجمع بين المعرّفات اليدوية وأي أدوار. النتيجة اتحاد بدون تكرار.</p>
            <label className="field">
              <span>معرّفات المستخدمين (سطر أو فاصلة لكل UID)</span>
              <textarea
                className="admin-push-uids"
                dir="ltr"
                disabled={!canManage || Boolean(busy)}
                onChange={(event) => setUidsText(event.target.value)}
                placeholder="uid_one&#10;uid_two"
                rows={4}
                value={uidsText}
              />
            </label>
            <div className="admin-push-roles">
              {ROLE_OPTIONS.map((option) => (
                <label className="setting-toggle-row" key={option.key}>
                  <div>
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </div>
                  <input
                    checked={roles.includes(option.key)}
                    disabled={!canManage || Boolean(busy)}
                    onChange={() => toggleRole(option.key)}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
            <div className="admin-push-estimate">
              <span>التقدير الحالي</span>
              <strong>{hasAudience && estimate ? estimate.recipientCount.toLocaleString('ar-IQ') : '—'}</strong>
              {estimate?.truncated ? <em>تم الاقتطاع عند الحد الأقصى</em> : null}
            </div>
          </AdminSurface>

          <AdminSurface className="settings-card">
            <h3>التدقيق</h3>
            <label className="field required-reason">
              <span>سبب الإرسال</span>
              <textarea
                disabled={!canManage || Boolean(busy)}
                maxLength={300}
                minLength={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="لماذا يُرسل هذا الإشعار الآن؟"
                rows={3}
                value={reason}
              />
            </label>
            <div className="settings-actions">
              <button className="primary-button" disabled={!canManage || Boolean(busy)} type="submit">
                {busy === 'send' ? 'جارٍ الإرسال…' : 'إرسال الإشعار'}
              </button>
            </div>
            {!canManage ? <p className="field-hint">يتطلب صلاحية إدارة مفاتيح المنصة.</p> : null}
          </AdminSurface>
        </form>

        <aside className="admin-push-preview-pane" aria-label="معاينة الهاتف">
          <PhoneNotificationPreview body={body} title={title} />
        </aside>
      </div>

      <AdminSurface className="settings-card admin-push-history">
        <h3>الحملات الأخيرة</h3>
        <AdminCollectionState
          empty={campaigns.length === 0}
          emptyMessage="لا توجد حملات إشعارات بعد."
          error={error}
          loading={loadingCampaigns}
          loadingMessage="جارٍ تحميل سجل الإرسال…"
          onRetry={() => void loadCampaigns()}
        >
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>العنوان</th>
                  <th>الحالة</th>
                  <th>المستهدفون</th>
                  <th>أُرسل</th>
                  <th>بدون جهاز</th>
                  <th>فشل</th>
                  <th>الفاعل</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.campaignId}>
                    <td>
                      <strong>{campaign.title}</strong>
                      <div className="field-hint">{campaign.body}</div>
                    </td>
                    <td><AdminStatusBadge tone={statusTone(campaign.status)}>{statusLabel(campaign.status)}</AdminStatusBadge></td>
                    <td>{campaign.counts.targeted.toLocaleString('ar-IQ')}</td>
                    <td>{campaign.counts.submitted.toLocaleString('ar-IQ')}</td>
                    <td>{campaign.counts.noDevices.toLocaleString('ar-IQ')}</td>
                    <td>{campaign.counts.failed.toLocaleString('ar-IQ')}</td>
                    <td dir="ltr">{campaign.actorEmail || campaign.actorUid}</td>
                    <td>{formatWhen(campaign.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCollectionState>
      </AdminSurface>
    </div>
  );
}

function PhoneNotificationPreview({ body, title }: { body: string; title: string }) {
  const previewTitle = title.trim() || 'عنوان الإشعار';
  const previewBody = body.trim() || 'سيظهر نص الإشعار هنا أثناء الكتابة.';
  return (
    <div className="admin-push-phone">
      <div className="admin-push-phone-bezel">
        <div className="admin-push-phone-notch" aria-hidden="true" />
        <div className="admin-push-phone-screen">
          <div className="admin-push-phone-status">
            <span>٩:٤١</span>
            <span>LTE</span>
          </div>
          <div className="admin-push-banner" dir="rtl">
            <div className="admin-push-banner-icon" aria-hidden="true">H</div>
            <div className="admin-push-banner-copy">
              <div className="admin-push-banner-meta">
                <strong>Heaven</strong>
                <span>الآن</span>
              </div>
              <p className="admin-push-banner-title">{previewTitle}</p>
              <p className="admin-push-banner-body">{previewBody}</p>
            </div>
          </div>
          <p className="admin-push-phone-caption">معاينة شكل الإشعار على الجهاز</p>
        </div>
      </div>
    </div>
  );
}

function parseUidList(value: string) {
  return [...new Set(value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function statusLabel(status: string) {
  if (status === 'queued') return 'في الانتظار';
  if (status === 'sending') return 'جارٍ الإرسال';
  if (status === 'completed') return 'مكتمل';
  if (status === 'failed') return 'فشل';
  return status;
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'sending' || status === 'queued') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function formatWhen(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('ar-IQ');
}
