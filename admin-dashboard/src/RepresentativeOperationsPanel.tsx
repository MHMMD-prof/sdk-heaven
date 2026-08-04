import type { User } from 'firebase/auth';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import {
  type AdminRepresentativeOperations,
  type RepresentativeCurrencyLimits,
  requestAdminRepresentativeOperations,
  reverseAdminRepresentativeTransfer,
  updateAdminRepresentativePolicy,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';

type Props = { permissions: string[]; user: User };

export function RepresentativeOperationsPanel({ permissions, user }: Props) {
  const { confirm, notify } = useAdminFeedback();
  const canManage = permissions.includes('store:manage');
  const [operations, setOperations] = useState<AdminRepresentativeOperations>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [policyReason, setPolicyReason] = useState('');
  const [limits, setLimits] = useState<Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>>({
    coins: { maxPerDay: 1_000_000, maxPerTransfer: 100_000, maxTransfersPerHour: 20 },
    diamonds: { maxPerDay: 100_000, maxPerTransfer: 10_000, maxTransfersPerHour: 10 },
  });

  const load = useCallback(async (publicReference = '') => {
    setBusy(true);
    setError('');
    try {
      const result = await requestAdminRepresentativeOperations(user, publicReference);
      setOperations(result);
      if (result.policy.limits) setLimits(result.policy.limits);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل عمليات الوكلاء.');
    } finally {
      setBusy(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function searchReceipt(event: FormEvent) {
    event.preventDefault();
    if (reference && !/^RPT-[0-9A-HJKMNP-TV-Z]{16}$/.test(reference)) return;
    await load(reference);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !operations || policyReason.trim().length < 3 || !validPolicy(limits)) return;
    const approved = await confirm({
      confirmLabel: 'حفظ الحدود العامة',
      description: 'ستؤثر هذه الحدود في جميع الوكلاء الذين لا يملكون حدوداً خاصة.',
      title: 'تأكيد سياسة تحويلات الوكلاء؟',
    });
    if (!approved) return;
    setBusy(true);
    try {
      await updateAdminRepresentativePolicy(user, {
        expectedUpdatedAt: operations.policy.updatedAt,
        limits,
        reason: policyReason.trim(),
      });
      notify('تم تحديث السياسة العامة', { tone: 'success' });
      setPolicyReason('');
      await load(reference);
    } catch (cause) {
      notify('تعذّر تحديث السياسة العامة', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' });
    } finally { setBusy(false); }
  }

  async function reverseReceipt() {
    const receipt = operations?.receipt;
    if (!receipt?.eligibleForReversal || reason.trim().length < 3) return;
    const approved = await confirm({
      confirmLabel: 'عكس العملية',
      description: `سيُخصم ${receipt.amount.toLocaleString('ar-IQ')} من المستلم ويُعاد إلى الوكيل. لا يمكن التراجع عن هذا الإجراء.`,
      destructive: true,
      title: 'تأكيد العكس الكامل؟',
    });
    if (!approved) return;
    setBusy(true);
    try {
      await reverseAdminRepresentativeTransfer(user, {
        expectedAmount: receipt.amount,
        expectedCurrency: receipt.currency,
        publicReference: receipt.publicReference,
        reason: reason.trim(),
      });
      notify('تم عكس العملية', { description: 'حُفظت القيود التعويضية والإيصالات وسجل التدقيق.', tone: 'success' });
      setReason('');
      await load(receipt.publicReference);
    } catch (cause) {
      notify('تعذّر عكس العملية', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' });
    } finally { setBusy(false); }
  }

  if (!operations && (busy || error)) {
    return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={busy} loadingMessage="جارٍ تحميل مركز عمليات الوكلاء…" onRetry={() => void load()} />;
  }
  if (!operations) return null;

  return <div className="representative-operations-page">
    <AdminSectionHeader
      actions={<button className="secondary-button compact" disabled={busy} onClick={() => void load(reference)} type="button">تحديث البيانات</button>}
      description="إدارة حدود التحويل، فحص الإيصالات، العكس الموثق، ومراجعة إشارات الأمان دون التحكم بعنوان البوابة."
      eyebrow="الاقتصاد والتدقيق"
      title="مركز عمليات الوكلاء"
    />

    <div className="representative-ops-grid">
      <AdminSurface className="representative-policy-card">
        <header><div><p className="eyebrow">السياسة العامة</p><h3>حدود التحويل</h3></div><AdminStatusBadge tone={operations.policy.configured ? 'success' : 'danger'}>{operations.policy.configured ? 'مضبوطة' : 'غير مكتملة'}</AdminStatusBadge></header>
        <form onSubmit={savePolicy}>
          <PolicyCurrency currency="coins" disabled={!canManage || busy} label="العملات" limits={limits} onChange={setLimits} />
          <PolicyCurrency currency="diamonds" disabled={!canManage || busy} label="الماس" limits={limits} onChange={setLimits} />
          <label>سبب التغيير<textarea disabled={!canManage || busy} minLength={3} required value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} /></label>
          {canManage ? <button disabled={busy || policyReason.trim().length < 3 || !validPolicy(limits)} type="submit">حفظ الحدود العامة</button> : <p className="user-empty-copy">للعرض فقط حسب دورك الإداري.</p>}
        </form>
      </AdminSurface>

      <AdminSurface className="representative-receipt-card">
        <header><div><p className="eyebrow">فحص آمن</p><h3>الإيصال والعكس</h3></div></header>
        <form className="representative-reference-search" onSubmit={searchReceipt}>
          <input dir="ltr" maxLength={20} placeholder="RPT-0000000000000000" value={reference} onChange={(event) => setReference(event.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, ''))} />
          <button disabled={busy || Boolean(reference) && !/^RPT-[0-9A-HJKMNP-TV-Z]{16}$/.test(reference)} type="submit">فحص المرجع</button>
        </form>
        {operations.receipt ? <div className="representative-receipt-detail">
          <div className="representative-receipt-title"><strong>{operations.receipt.recipientDisplayName || 'مستخدم'}</strong><AdminStatusBadge tone={operations.receipt.status === 'completed' ? 'success' : operations.receipt.status === 'reversed' ? 'info' : 'neutral'}>{statusLabel(operations.receipt.status)}</AdminStatusBadge></div>
          <dl>
            <div><dt>المرجع</dt><dd dir="ltr">{operations.receipt.publicReference}</dd></div>
            <div><dt>القيمة</dt><dd>{operations.receipt.amount.toLocaleString('ar-IQ')} {operations.receipt.currency === 'coins' ? 'عملة' : 'ماسة'}</dd></div>
            <div><dt>المستلم</dt><dd dir="ltr">ID {operations.receipt.recipientPublicId}</dd></div>
            <div><dt>الوكيل</dt><dd>{operations.receipt.representativeDisplayName || operations.receipt.representativeUid}</dd></div>
          </dl>
          {operations.receipt.eligibleForReversal && canManage ? <>
            <textarea minLength={3} placeholder="سبب العكس الكامل (إلزامي)" value={reason} onChange={(event) => setReason(event.target.value)} />
            <button className="danger-button" disabled={busy || reason.trim().length < 3} onClick={() => void reverseReceipt()} type="button">عكس العملية بالكامل</button>
          </> : <p className="user-empty-copy">{operations.receipt.status === 'reversed' ? `عُكست العملية: ${operations.receipt.reversalReason}` : 'العملية غير مؤهلة للعكس.'}</p>}
        </div> : reference ? <p className="user-empty-copy">لم يُعثر على إيصال بهذا المرجع.</p> : <p className="user-empty-copy">أدخل المرجع العام لفحص أهلية العكس.</p>}
      </AdminSurface>
    </div>

    <section className="representative-activity-grid">
      <OperationsList title="أحدث التحويلات" items={operations.recentTransfers.map((item) => ({ createdAt: item.createdAt, id: item.transferId, label: `${item.recipientDisplayName || item.recipientPublicId} · ${item.amount.toLocaleString('ar-IQ')}`, meta: item.publicReference }))} />
      <OperationsList title="أحدث عمليات العكس" items={operations.recentReversals.map((item) => ({ createdAt: item.createdAt, id: item.id, label: item.kind || 'عكس تحويل', meta: item.publicReference || item.representativeUid }))} />
      <OperationsList title="إشارات الأمان" items={operations.recentSecurityEvents.map((item) => ({ createdAt: item.createdAt, id: item.id, label: item.kind, meta: item.representativeUid }))} />
      <OperationsList title="سجل الإدارة" items={operations.auditHistory.map((item) => ({ createdAt: item.createdAt, id: item.id, label: item.kind, meta: item.actorUid }))} />
    </section>
    {error ? <p className="form-alert" role="alert">{error}</p> : null}
  </div>;
}

function PolicyCurrency({ currency, disabled, label, limits, onChange }: {
  currency: 'coins' | 'diamonds';
  disabled: boolean;
  label: string;
  limits: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>;
  onChange(value: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>): void;
}) {
  const current = limits[currency];
  const update = (key: keyof RepresentativeCurrencyLimits, value: number) => onChange({ ...limits, [currency]: { ...current, [key]: value } });
  return <fieldset className="representative-policy-fields" disabled={disabled}><legend>{label}</legend>
    <label>حد العملية<input min="1" type="number" value={current.maxPerTransfer} onChange={(event) => update('maxPerTransfer', Number(event.target.value))} /></label>
    <label>حد اليوم<input min="1" type="number" value={current.maxPerDay} onChange={(event) => update('maxPerDay', Number(event.target.value))} /></label>
    <label>العمليات/ساعة<input min="1" type="number" value={current.maxTransfersPerHour} onChange={(event) => update('maxTransfersPerHour', Number(event.target.value))} /></label>
  </fieldset>;
}

function OperationsList({ items, title }: { items: Array<{ createdAt: string; id: string; label: string; meta: string }>; title: string }) {
  return <AdminSurface><h3>{title}</h3><div className="representative-event-list">
    {items.length ? items.slice(0, 12).map((item) => <article key={item.id}><div><strong>{item.label}</strong><small dir="ltr">{item.meta || item.id}</small></div><time>{formatDate(item.createdAt)}</time></article>) : <p className="user-empty-copy">لا توجد سجلات حديثة.</p>}
  </div></AdminSurface>;
}

function validPolicy(limits: Record<'coins' | 'diamonds', RepresentativeCurrencyLimits>) {
  return Object.values(limits).every((item) => Number.isSafeInteger(item.maxPerDay) && item.maxPerDay >= item.maxPerTransfer
    && Number.isSafeInteger(item.maxPerTransfer) && item.maxPerTransfer > 0
    && Number.isSafeInteger(item.maxTransfersPerHour) && item.maxTransfersPerHour > 0);
}

function statusLabel(status: string) {
  return status === 'completed' ? 'مكتملة' : status === 'reversed' ? 'مسترجعة' : 'انتهت المهلة';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
