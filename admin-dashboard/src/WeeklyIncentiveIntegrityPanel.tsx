import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import {
  AdminWeeklyIncentiveIntegrity,
  mutateAdminWeeklyIncentiveIntegrity,
  reconcileAdminWeeklyIncentives,
  requestAdminWeeklyIncentiveIntegrity,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';

export function WeeklyIncentiveIntegrityPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const [value, setValue] = useState<AdminWeeklyIncentiveIntegrity | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState('');
  const canManage = permissions.includes('incentives:manage');

  async function load() {
    setError('');
    try { setValue(await requestAdminWeeklyIncentiveIntegrity(user)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل سلامة الحوافز.'); }
  }
  useEffect(() => { void load(); }, [user.uid]);

  async function review(operation: 'approve-settlement' | 'reject-settlement', assessment: AdminWeeklyIncentiveIntegrity['assessments'][number]) {
    if (reason.trim().length < 4 || !assessment.settlementId) return;
    setBusy(assessment.id);
    try {
      await mutateAdminWeeklyIncentiveIntegrity(user, {
        assessmentId: assessment.assessmentId || assessment.id,
        operation,
        reason,
        settlementId: assessment.settlementId,
      });
      notify('تم تسجيل قرار المراجعة.', { tone: 'success' });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'فشلت المراجعة.'); }
    finally { setBusy(''); }
  }

  async function reconcile(apply: boolean) {
    if (apply && reason.trim().length < 4) return;
    setBusy(apply ? 'apply' : 'dry-run');
    try {
      const result = await reconcileAdminWeeklyIncentives(user, { apply, reason });
      setPreview(`${result.scanned} مفحوص · ${result.unbalanced} انحراف`);
      if (apply) await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'فشلت المطابقة.'); }
    finally { setBusy(''); }
  }

  if (!value) return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={!error} loadingMessage="جارٍ تحميل مراقبة الحوافز…" onRetry={() => void load()} />;
  const health = value.health;
  return (
    <section className="incentives-embedded-panel">
      <AdminSurface className="settings-card">
      <div className="settings-row"><div><h3>مراقبة المطابقة والمخاطر</h3><small>مطابقة الدفاتر، احتجاز المخاطر، وتأخر العمال المجدولة</small></div><button className="secondary-button compact" onClick={() => void load()} type="button">تحديث</button></div>
      <div className="settings-kpis">
        <Metric label="تسويات محتجزة" value={health.heldPayoutCount} danger={health.heldPayoutCount > 0} />
        <Metric label="قيمة محتجزة" value={health.heldValueCoins} danger={health.heldValueCoins > 0} />
        <Metric label="فشل دفع" value={health.failedPayoutCount} danger={health.failedPayoutCount > 0} />
        <Metric label="انحراف المطابقة" value={health.reconciliationDriftCount} danger={health.reconciliationDriftCount > 0} />
        <Metric label="الالتزام التقديري" value={health.estimatedLiabilityCoins} />
      </div>
      <div className="settings-list">
        {health.schedulers.map((scheduler) => <div className="settings-row" key={scheduler.id}><span dir="ltr">{scheduler.id}</span><AdminStatusBadge tone={scheduler.status === 'ok' ? 'success' : 'warning'}>{scheduler.lagMillis < 0 ? 'لم يعمل' : `${Math.round(scheduler.lagMillis / 60000)} min`}</AdminStatusBadge></div>)}
      </div>
      <label className="field"><span>سبب المراجعة أو التطبيق</span><textarea onChange={(event) => setReason(event.target.value)} rows={2} value={reason} /></label>
      <div className="button-row">
        <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void reconcile(false)} type="button">فحص تجريبي</button>
        <button className="primary-button" disabled={!canManage || Boolean(busy) || reason.trim().length < 4} onClick={() => void reconcile(true)} type="button">تطبيق وتسجيل</button>
        {preview && <small>{preview}</small>}
      </div>
      {value.assessments.map((assessment) => <div className="settings-row" key={assessment.id}><div><strong dir="ltr">{assessment.settlementId}</strong><small>المخاطر {assessment.riskScore || 0} · {(assessment.signals || []).map((signal) => signal.code).join(', ')}</small></div><div className="button-row"><button className="secondary-button compact" disabled={!canManage || Boolean(busy) || reason.trim().length < 4} onClick={() => void review('approve-settlement', assessment)} type="button">اعتماد</button><button className="danger-button compact" disabled={!canManage || Boolean(busy) || reason.trim().length < 4} onClick={() => void review('reject-settlement', assessment)} type="button">رفض</button></div></div>)}
      {value.assessments.length === 0 && <p className="field-hint">لا توجد تسويات بانتظار المراجعة.</p>}
      {error && <p className="danger-text">{error}</p>}
      </AdminSurface>
    </section>
  );
}

function Metric({ danger, label, value }: { danger?: boolean; label: string; value: number }) {
  return <div className="settings-kpi"><span>{label}</span><strong className={danger ? 'danger-text' : ''}>{value.toLocaleString('ar-IQ')}</strong></div>;
}
