import type { User } from 'firebase/auth';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';

import {
  AdminPayrollOverview,
  AdminPayrollPlan,
  mutateAdminPayroll,
  requestAdminPayroll,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';
import './PayrollPanel.css';

const WEEKDAYS = [
  [1, 'الاثنين'],
  [2, 'الثلاثاء'],
  [3, 'الأربعاء'],
  [4, 'الخميس'],
  [5, 'الجمعة'],
  [6, 'السبت'],
  [7, 'الأحد'],
] as const;

export function PayrollPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const [data, setData] = useState<AdminPayrollOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('female-hosts');
  const [uid, setUid] = useState('');
  const [amount, setAmount] = useState('');
  const [exceptionUid, setExceptionUid] = useState('');
  const [exceptionDayId, setExceptionDayId] = useState('');
  const [planDraft, setPlanDraft] = useState(() => initialPlanDraft());
  const canManage = permissions.includes('payroll:manage');

  async function load() {
    setError('');
    try {
      const overview = await requestAdminPayroll(user);
      setData(overview);
      const firstPlan = overview.plans[0]?.pendingConfig || overview.plans[0]?.currentConfig;
      if (firstPlan) {
        setSelectedPlanId(firstPlan.planId);
        setPlanDraft(toDraft(firstPlan));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل نظام الرواتب.');
    }
  }

  useEffect(() => { void load(); }, [user.uid]);

  const selectedPlan = useMemo(() => data?.plans
    .map((item) => item.pendingConfig || item.currentConfig)
    .find((plan) => plan?.planId === selectedPlanId) || null, [data, selectedPlanId]);
  const projected = useMemo(() => (data?.projected || []).reduce((total, item) => ({
    coins: total.coins + (item.currency === 'coins' ? item.amount : 0),
    diamonds: total.diamonds + (item.currency === 'diamonds' ? item.amount : 0),
    people: total.people + item.enrollmentCount,
  }), { coins: 0, diamonds: 0, people: 0 }), [data]);
  const cycleDays = useMemo(() => data ? payrollCycleDays(data.cycle.startAtMillis) : [], [data]);

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!data || !canManage || reason.trim().length < 3) return notify('سبب التغيير مطلوب', { tone: 'error' });
    const existing = data.plans.find((item) => item.planId === planDraft.planId);
    const currentRevision = Math.max(existing?.currentConfig?.revision || 0, existing?.pendingConfig?.revision || 0);
    const plan = buildPlan(planDraft, data.nextCycle.cycleId, currentRevision + 1);
    if (!plan) return notify('بيانات الخطة غير مكتملة', { tone: 'error' });
    setBusy('plan');
    try {
      await mutateAdminPayroll(user, { operation: 'upsert-plan', plan, reason: reason.trim() });
      notify('حُفظت خطة الراتب للأسبوع القادم', { description: data.nextCycle.cycleId, tone: 'success' });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر حفظ خطة الراتب', { description: message(mutationError), tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!data || !selectedPlan || !canManage || reason.trim().length < 3 || !uid.trim()) {
      return notify('اختر خطة وأدخل UID وسبباً', { tone: 'error' });
    }
    const override = amount.trim() ? Number(amount) : 0;
    if (!Number.isSafeInteger(override) || override < 0) return notify('قيمة الراتب غير صحيحة', { tone: 'error' });
    setBusy('enroll');
    try {
      await mutateAdminPayroll(user, {
        enrollment: {
          effectiveFromCycleId: data.nextCycle.cycleId,
          endAtMillis: 0,
          planId: selectedPlan.planId,
          schemaVersion: 1,
          startAtMillis: data.nextCycle.startAtMillis,
          state: 'active',
          uid: uid.trim(),
          weeklyAmountOverride: override,
        },
        operation: 'enroll',
        reason: reason.trim(),
        uid: uid.trim(),
      });
      notify('أُضيف الموظف للأسبوع القادم', { tone: 'success' });
      setUid('');
      setAmount('');
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر إضافة الموظف', { description: message(mutationError), tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function changeState(targetUid: string, operation: 'suspend' | 'resume' | 'end' | 'hold' | 'release-hold') {
    if (!canManage || reason.trim().length < 3) return notify('اكتب سبب الإجراء أولاً', { tone: 'error' });
    setBusy(`${operation}:${targetUid}`);
    try {
      await mutateAdminPayroll(user, { operation, reason: reason.trim(), uid: targetUid });
      notify('تم تسجيل إجراء الراتب', { tone: 'success' });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تنفيذ الإجراء', { description: message(mutationError), tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function excuseDay(event: FormEvent) {
    event.preventDefault();
    if (!data || !canManage || reason.trim().length < 3 || !exceptionUid.trim() || !exceptionDayId) {
      return notify('UID واليوم وسبب الاستثناء مطلوبة', { tone: 'error' });
    }
    setBusy('exception');
    try {
      await mutateAdminPayroll(user, {
        cycleId: data.cycle.cycleId,
        dayId: exceptionDayId,
        operation: 'excuse-day',
        reason: reason.trim(),
        uid: exceptionUid.trim(),
      });
      notify('سُجل استثناء اليوم مع أثر تدقيق', { tone: 'success' });
      setExceptionUid('');
      setExceptionDayId('');
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تسجيل الاستثناء', { description: message(mutationError), tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (!data) {
    return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={!error} loadingMessage="جارٍ تحميل الرواتب…" onRetry={() => void load()} />;
  }

  return (
    <section className="payroll-panel incentives-embedded-panel" dir="rtl">
      <div className="incentives-panel-toolbar">
        <p className="field-hint">الدوام المحتسب: متصل، على مقعد متحدث، والوقت يتوقف بعد خمس دقائق كتم متواصل. أي تعديل مالي يبدأ من دورة بغداد القادمة.</p>
        <button className="secondary-button compact" onClick={() => void load()} type="button">تحديث</button>
      </div>

      <div className="settings-kpis">
        <Metric label="المسجلون" value={String(projected.people)} />
        <Metric label="التزام العملات" value={projected.coins.toLocaleString('ar-IQ')} />
        <Metric label="التزام الماس" value={projected.diamonds.toLocaleString('ar-IQ')} />
        <Metric label="الدورة القادمة" value={data.nextCycle.cycleId.replace('weekly_', '').replace('_asia-baghdad', '')} />
      </div>

      <div className="settings-grid">
        <AdminSurface className="settings-card">
          <h3>إضافة سريعة إلى كشف الرواتب</h3>
          <form onSubmit={(event) => void enroll(event)}>
            <Field label="الخطة">
              <select onChange={(event) => setSelectedPlanId(event.target.value)} value={selectedPlanId}>
                {data.plans.map((item) => {
                  const plan = item.pendingConfig || item.currentConfig;
                  return plan ? <option key={plan.planId} value={plan.planId}>{plan.name.ar}</option> : null;
                })}
              </select>
            </Field>
            <Field label="UID الموظف"><input dir="ltr" onChange={(event) => setUid(event.target.value)} value={uid} /></Field>
            <Field label={`المبلغ الأسبوعي (${selectedPlan?.currency === 'diamonds' ? 'ماس' : 'كوينز'})`}>
              <input min="0" onChange={(event) => setAmount(event.target.value)} placeholder={`الافتراضي ${selectedPlan?.weeklyAmount || 0}`} type="number" value={amount} />
            </Field>
            <button className="primary-button" disabled={!canManage || busy === 'enroll'} type="submit">إضافة من الأسبوع القادم</button>
          </form>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>سبب التغيير والتدقيق</h3>
          <Field label="سبب إلزامي لكل إجراء">
            <textarea onChange={(event) => setReason(event.target.value)} placeholder="مثال: عقد الموظف المعتمد" value={reason} />
          </Field>
          <p className="field-hint">الإيقاف وحجز الدفع فوريان للحماية. الاستئناف والإنهاء وتغيير المبلغ تبدأ في الدورة القادمة. التسجيل في الرواتب لا يمنح صلاحيات إدارية.</p>
          <form onSubmit={(event) => void excuseDay(event)}>
            <Field label="UID لاستثناء يوم"><input dir="ltr" onChange={(event) => setExceptionUid(event.target.value)} value={exceptionUid} /></Field>
            <Field label="اليوم في الدورة الحالية">
              <select onChange={(event) => setExceptionDayId(event.target.value)} value={exceptionDayId}>
                <option value="">اختر اليوم</option>
                {cycleDays.map((day) => <option key={day.dayId} value={day.dayId}>{day.label}</option>)}
              </select>
            </Field>
            <button className="secondary-button" disabled={!canManage || busy === 'exception'} type="submit">اعتماد يوم بعذر</button>
          </form>
        </AdminSurface>
      </div>

      <AdminSurface className="settings-card payroll-plan-card">
        <h3>خطط الرواتب</h3>
        <form className="payroll-plan-grid" onSubmit={(event) => void savePlan(event)}>
          <Field label="معرّف الخطة"><input dir="ltr" onChange={(event) => setPlanDraft({ ...planDraft, planId: event.target.value })} value={planDraft.planId} /></Field>
          <Field label="الاسم العربي"><input onChange={(event) => setPlanDraft({ ...planDraft, nameAr: event.target.value })} value={planDraft.nameAr} /></Field>
          <Field label="الاسم الإنجليزي"><input dir="ltr" onChange={(event) => setPlanDraft({ ...planDraft, nameEn: event.target.value })} value={planDraft.nameEn} /></Field>
          <Field label="الفئة"><select onChange={(event) => setPlanDraft({ ...planDraft, category: event.target.value as AdminPayrollPlan['category'] })} value={planDraft.category}><option value="super-admin">Super Admin</option><option value="employee">موظف</option><option value="female-host">مضيفة</option></select></Field>
          <Field label="العملة"><select onChange={(event) => setPlanDraft({ ...planDraft, currency: event.target.value as AdminPayrollPlan['currency'] })} value={planDraft.currency}><option value="diamonds">ماس</option><option value="coins">كوينز</option></select></Field>
          <Field label="الراتب الأسبوعي"><input min="1" onChange={(event) => setPlanDraft({ ...planDraft, weeklyAmount: event.target.value })} type="number" value={planDraft.weeklyAmount} /></Field>
          <Field label="الحد اليومي بالدقائق"><input min="1" max="1440" onChange={(event) => setPlanDraft({ ...planDraft, dailyMinimumMinutes: event.target.value })} type="number" value={planDraft.dailyMinimumMinutes} /></Field>
          <div className="payroll-weekdays">
            <span>الأيام المطلوبة</span>
            {WEEKDAYS.map(([value, label]) => <label key={value}><input checked={planDraft.requiredWeekdays.includes(value)} onChange={() => setPlanDraft({ ...planDraft, requiredWeekdays: toggleDay(planDraft.requiredWeekdays, value) })} type="checkbox" /> {label}</label>)}
          </div>
          <label className="payroll-enabled"><input checked={planDraft.enabled} onChange={(event) => setPlanDraft({ ...planDraft, enabled: event.target.checked })} type="checkbox" /> الخطة مفعلة</label>
          <button className="primary-button" disabled={!canManage || busy === 'plan'} type="submit">حفظ للدورة القادمة</button>
        </form>
      </AdminSurface>

      <AdminSurface className="settings-card">
        <h3>قائمة الرواتب والحالة</h3>
        <div className="payroll-roster">
          {data.enrollments.length === 0 ? <p className="field-hint">لا يوجد موظفون مسجلون بعد.</p> : data.enrollments.map((row) => {
            const enrollment = row.pendingConfig || row.currentConfig;
            if (!enrollment) return null;
            const plan = data.plans.map((item) => item.pendingConfig || item.currentConfig).find((item) => item?.planId === enrollment.planId);
            return (
              <article className="payroll-roster-row" key={row.uid}>
                <div><b dir="ltr">{row.uid}</b><small>{plan?.name.ar || enrollment.planId} · {enrollment.weeklyAmountOverride || plan?.weeklyAmount || 0} {plan?.currency === 'diamonds' ? 'ماس' : 'كوينز'}</small></div>
                <AdminStatusBadge tone={enrollment.state === 'active' ? 'success' : enrollment.state === 'suspended' ? 'danger' : 'neutral'}>{enrollment.state}</AdminStatusBadge>
                {canManage ? <div className="payroll-row-actions">
                  {enrollment.state === 'suspended'
                    ? <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => void changeState(row.uid, 'resume')} type="button">استئناف</button>
                    : <button className="danger-button compact" disabled={Boolean(busy)} onClick={() => void changeState(row.uid, 'suspend')} type="button">إيقاف</button>}
                  <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => void changeState(row.uid, 'hold')} type="button">حجز دفع</button>
                  <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => void changeState(row.uid, 'release-hold')} type="button">رفع الحجز</button>
                  <button className="danger-button compact" disabled={Boolean(busy)} onClick={() => void changeState(row.uid, 'end')} type="button">إنهاء</button>
                </div> : null}
              </article>
            );
          })}
        </div>
      </AdminSurface>

      <AdminSurface className="settings-card">
        <h3>آخر نتائج التسوية</h3>
        <div className="payroll-roster">
          {data.outcomes.length === 0 ? <p className="field-hint">لا توجد تسويات مغلقة بعد.</p> : data.outcomes.map((outcome) => (
            <article className="payroll-roster-row" key={outcome.outcomeId}>
              <div><b dir="ltr">{outcome.uid}</b><small>{outcome.cycleId} · {outcome.amount} {outcome.currency}</small></div>
              <AdminStatusBadge tone={outcome.state === 'paid' ? 'success' : ['failed', 'missed-day', 'insufficient-time', 'device-conflict', 'profile-ineligible'].includes(outcome.state) ? 'danger' : 'warning'}>{outcome.state}</AdminStatusBadge>
              <small>{outcome.daily.filter((day) => day.met).length}/{outcome.daily.length} أيام · {outcome.state === 'paid' ? outcome.ledgerBalanced ? 'دفتر متوازن' : 'مراجعة دفتر مطلوبة' : outcome.failureCode || '—'}</small>
            </article>
          ))}
        </div>
      </AdminSurface>
    </section>
  );
}

type PlanDraft = {
  category: AdminPayrollPlan['category'];
  currency: AdminPayrollPlan['currency'];
  dailyMinimumMinutes: string;
  enabled: boolean;
  nameAr: string;
  nameEn: string;
  planId: string;
  requiredWeekdays: number[];
  weeklyAmount: string;
};

function initialPlanDraft(): PlanDraft {
  return {
    category: 'female-host',
    currency: 'diamonds',
    dailyMinimumMinutes: '120',
    enabled: true,
    nameAr: 'راتب المضيفات',
    nameEn: 'Female hosts',
    planId: 'female-hosts',
    requiredWeekdays: [1, 2, 3, 4, 5, 6, 7],
    weeklyAmount: '700',
  };
}

function toDraft(plan: AdminPayrollPlan): PlanDraft {
  return {
    category: plan.category,
    currency: plan.currency,
    dailyMinimumMinutes: String(plan.dailyMinimumMinutes),
    enabled: plan.enabled,
    nameAr: plan.name.ar,
    nameEn: plan.name.en,
    planId: plan.planId,
    requiredWeekdays: plan.requiredWeekdays,
    weeklyAmount: String(plan.weeklyAmount),
  };
}

function buildPlan(draft: PlanDraft, effectiveFromCycleId: string, revision: number): AdminPayrollPlan | null {
  const dailyMinimumMinutes = Number(draft.dailyMinimumMinutes);
  const weeklyAmount = Number(draft.weeklyAmount);
  if (!draft.planId.trim() || !draft.nameAr.trim() || !draft.nameEn.trim() || !Number.isSafeInteger(dailyMinimumMinutes) || !Number.isSafeInteger(weeklyAmount) || weeklyAmount <= 0) return null;
  return {
    category: draft.category,
    currency: draft.currency,
    dailyMinimumMinutes,
    enabled: draft.enabled,
    effectiveFromCycleId,
    muteGraceMinutes: 5,
    name: { ar: draft.nameAr.trim(), en: draft.nameEn.trim() },
    planId: draft.planId.trim(),
    requiredWeekdays: [...draft.requiredWeekdays].sort((a, b) => a - b),
    revision,
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
    weeklyAmount,
  };
}

function toggleDay(days: number[], day: number) {
  return days.includes(day) ? days.filter((value) => value !== day) : [...days, day].sort((a, b) => a - b);
}

function payrollCycleDays(startAtMillis: number) {
  return WEEKDAYS.map(([weekday, label], index) => {
    const date = new Date(startAtMillis + index * 24 * 60 * 60 * 1000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Baghdad',
      year: 'numeric',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return {
      dayId: `day_${parts.year}-${parts.month}-${parts.day}_asia-baghdad`,
      label: `${label} ${parts.year}-${parts.month}-${parts.day}`,
      weekday,
    };
  });
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <AdminSurface className="settings-kpi"><span>{label}</span><strong>{value}</strong></AdminSurface>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '';
}
