import type { User } from 'firebase/auth';
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useState } from 'react';

import {
  type AdminUserDetail,
  resetAdminRepresentativePin,
  updateAdminRepresentative,
  updateAdminRepresentativeOverride,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminStatusBadge } from './AdminUi';

type Props = {
  canManage: boolean;
  detail: AdminUserDetail;
  onChanged(): Promise<void>;
  user: User;
};

type OverrideValues = {
  coinsDay: string;
  coinsHourly: string;
  coinsTransfer: string;
  diamondsDay: string;
  diamondsHourly: string;
  diamondsTransfer: string;
};

export function RepresentativePermissions({ canManage, detail, onChanged, user }: Props) {
  const { confirm, notify } = useAdminFeedback();
  const [active, setActive] = useState(detail.representative.active);
  const [coins, setCoins] = useState(detail.representative.currencies.coins);
  const [diamonds, setDiamonds] = useState(detail.representative.currencies.diamonds);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [pinReason, setPinReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [overrideValues, setOverrideValues] = useState<OverrideValues>(() => readOverrideValues(detail));
  const currentlyActive = detail.representative.active;
  const appointing = active && !currentlyActive;
  const revoking = !active && currentlyActive;

  useEffect(() => {
    setActive(detail.representative.active);
    setCoins(detail.representative.currencies.coins);
    setDiamonds(detail.representative.currencies.diamonds);
    setOverrideValues(readOverrideValues(detail));
    setReason('');
    setOverrideReason('');
    setPinReason('');
  }, [detail]);

  async function savePermissions(event: FormEvent) {
    event.preventDefault();
    if (!canManage || reason.trim().length < 3 || (active && !coins && !diamonds)) return;
    const approved = await confirm({
      confirmLabel: appointing ? 'تعيين الوكيل' : revoking ? 'إلغاء التعيين' : 'حفظ الصلاحيات',
      description: appointing
        ? `سيتم تعيين ${detail.profile.displayName || detail.profile.uid} وكيلاً معتمداً. السبب: ${reason.trim()}`
        : revoking
          ? `سيتم إلغاء صفة الوكيل عن ${detail.profile.displayName || detail.profile.uid}. السبب: ${reason.trim()}`
          : `تحديث عملات التحويل المسموحة لهذا الوكيل. السبب: ${reason.trim()}`,
      destructive: revoking,
      title: appointing ? 'تعيين وكيل معتمد؟' : revoking ? 'إلغاء تعيين الوكيل؟' : 'تأكيد صلاحيات الوكيل؟',
    });
    if (!approved) return;
    await runMutation(
      () => updateAdminRepresentative(user, {
        active, coins, diamonds, expectedUpdatedAt: detail.representative.updatedAt,
        reason: reason.trim(), targetUid: detail.profile.uid,
      }),
      appointing ? 'تم تعيين الوكيل' : revoking ? 'تم إلغاء تعيين الوكيل' : 'تم تحديث صلاحيات الوكيل',
      'تعذّر تحديث صلاحيات الوكيل',
    );
  }

  async function saveOverrides(event: FormEvent) {
    event.preventDefault();
    const limits = buildOverrideLimits(overrideValues);
    if (!limits) {
      notify('قيم الحدود غير صالحة', { description: 'أكمل الحقول الثلاثة للعملة أو اتركها كلها فارغة.', tone: 'error' });
      return;
    }
    if (!canManage || overrideReason.trim().length < 3) return;
    const approved = await confirm({
      confirmLabel: 'حفظ الحدود',
      description: 'سيتم استبدال حدود هذا الوكيل فقط مع إبقاء السياسة العامة كما هي.',
      title: 'تأكيد حدود الوكيل؟',
    });
    if (!approved) return;
    await runMutation(
      () => updateAdminRepresentativeOverride(user, {
        expectedUpdatedAt: detail.representative.updatedAt,
        limits,
        reason: overrideReason.trim(),
        targetUid: detail.profile.uid,
      }),
      'تم تحديث حدود الوكيل',
      'تعذّر تحديث حدود الوكيل',
    );
  }

  async function resetPin() {
    if (!canManage || !detail.representative.pin.configured || pinReason.trim().length < 3) return;
    const approved = await confirm({
      confirmLabel: 'فرض إعادة الإعداد',
      description: 'سيتوقف التحويل حتى ينشئ الوكيل رمزاً جديداً بعد مصادقة حديثة.',
      destructive: true,
      title: 'إعادة إعداد رمز التحويل؟',
    });
    if (!approved) return;
    await runMutation(
      () => resetAdminRepresentativePin(user, {
        expectedUpdatedAt: detail.representative.pin.updatedAt,
        reason: pinReason.trim(),
        targetUid: detail.profile.uid,
      }),
      'تم فرض إعادة إعداد الرمز',
      'تعذّر فرض إعادة إعداد الرمز',
    );
  }

  async function runMutation(operation: () => Promise<unknown>, success: string, failure: string) {
    setBusy(true);
    try {
      await operation();
      notify(success, { tone: 'success' });
      await onChanged();
    } catch (error) {
      notify(failure, { description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return <section className="representative-user-controls">
    <form className="wallet-adjustment-form" onSubmit={savePermissions}>
      <div className="user-card-heading">
        <div>
          <p className="eyebrow">تعيين من ملف المستخدم</p>
          <h4>{currentlyActive ? 'إدارة صلاحية الوكيل' : 'تعيين وكيل معتمد'}</h4>
        </div>
        <AdminStatusBadge tone={currentlyActive ? 'success' : 'neutral'}>
          {currentlyActive ? 'وكيل نشط' : 'ليس وكيلاً'}
        </AdminStatusBadge>
      </div>
      <p className="user-empty-copy">
        التعيين يمنح شارة «وكيل معتمد» ويسمح بفتح بوابة التحويل عند تفعيل الميزة، ضمن عملات المحفظة المشتركة فقط.
      </p>
      {canManage ? <>
        <label><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /> تعيين كوكيل نشط</label>
        <label><input checked={coins} disabled={!active} onChange={(event) => setCoins(event.target.checked)} type="checkbox" /> يسمح بإرسال العملات</label>
        <label><input checked={diamonds} disabled={!active} onChange={(event) => setDiamonds(event.target.checked)} type="checkbox" /> يسمح بإرسال الماس</label>
        <input minLength={3} onChange={(event) => setReason(event.target.value)} placeholder="سبب التعيين أو الإلغاء (إلزامي)" value={reason} />
        <button disabled={busy || reason.trim().length < 3 || (active && !coins && !diamonds)} type="submit">
          {appointing ? 'تعيين الوكيل' : revoking ? 'إلغاء التعيين' : 'حفظ صلاحيات الوكيل'}
        </button>
      </> : <p className="user-empty-copy">هذه البيانات للعرض فقط حسب دورك الإداري.</p>}
    </form>

    {canManage && detail.representative.active ? <form className="wallet-adjustment-form representative-limit-form" onSubmit={saveOverrides}>
      <div className="user-card-heading"><div><p className="eyebrow">حدود خاصة اختيارية</p><h4>تجاوز الحدود العامة</h4></div></div>
      <LimitFields currency="coins" label="العملات" values={overrideValues} onChange={setOverrideValues} />
      <LimitFields currency="diamonds" label="الماس" values={overrideValues} onChange={setOverrideValues} />
      <input minLength={3} onChange={(event) => setOverrideReason(event.target.value)} placeholder="سبب تغيير الحدود (إلزامي)" value={overrideReason} />
      <button disabled={busy || overrideReason.trim().length < 3} type="submit">حفظ الحدود الخاصة</button>
    </form> : null}

    {canManage && detail.representative.active ? <div className="wallet-adjustment-form">
      <div className="user-card-heading"><div><p className="eyebrow">رمز التحويل</p><h4>{pinLabel(detail)}</h4></div></div>
      <input minLength={3} onChange={(event) => setPinReason(event.target.value)} placeholder="سبب فرض إعادة الإعداد" value={pinReason} />
      <button className="danger" disabled={busy || !detail.representative.pin.configured || detail.representative.pin.resetRequired || pinReason.trim().length < 3} onClick={() => void resetPin()} type="button">فرض إعادة إعداد الرمز</button>
    </div> : null}
  </section>;
}

function LimitFields({ currency, label, onChange, values }: {
  currency: 'coins' | 'diamonds';
  label: string;
  onChange: Dispatch<SetStateAction<OverrideValues>>;
  values: OverrideValues;
}) {
  return <fieldset className="representative-limit-fields"><legend>{label}</legend>
    <input min="1" placeholder="حد العملية" type="number" value={values[`${currency}Transfer`]} onChange={(event) => onChange((current) => ({ ...current, [`${currency}Transfer`]: event.target.value }))} />
    <input min="1" placeholder="حد اليوم" type="number" value={values[`${currency}Day`]} onChange={(event) => onChange((current) => ({ ...current, [`${currency}Day`]: event.target.value }))} />
    <input min="1" placeholder="عدد العمليات/ساعة" type="number" value={values[`${currency}Hourly`]} onChange={(event) => onChange((current) => ({ ...current, [`${currency}Hourly`]: event.target.value }))} />
  </fieldset>;
}

function buildOverrideLimits(values: OverrideValues): AdminUserDetail['representative']['limits'] | undefined {
  const limits: AdminUserDetail['representative']['limits'] = {};
  for (const currency of ['coins', 'diamonds'] as const) {
    const raw = [values[`${currency}Transfer`], values[`${currency}Day`], values[`${currency}Hourly`]];
    if (raw.every((value) => !value)) continue;
    if (raw.some((value) => !Number.isSafeInteger(Number(value)) || Number(value) < 1)) return undefined;
    const maxPerTransfer = Number(raw[0]);
    const maxPerDay = Number(raw[1]);
    const maxTransfersPerHour = Number(raw[2]);
    if (maxPerDay < maxPerTransfer) return undefined;
    limits[currency] = { maxPerDay, maxPerTransfer, maxTransfersPerHour };
  }
  return limits;
}

function readOverrideValues(detail: AdminUserDetail): OverrideValues {
  return {
    coinsDay: String(detail.representative.limits.coins?.maxPerDay || ''),
    coinsHourly: String(detail.representative.limits.coins?.maxTransfersPerHour || ''),
    coinsTransfer: String(detail.representative.limits.coins?.maxPerTransfer || ''),
    diamondsDay: String(detail.representative.limits.diamonds?.maxPerDay || ''),
    diamondsHourly: String(detail.representative.limits.diamonds?.maxTransfersPerHour || ''),
    diamondsTransfer: String(detail.representative.limits.diamonds?.maxPerTransfer || ''),
  };
}

function pinLabel(detail: AdminUserDetail) {
  if (!detail.representative.pin.configured) return 'لم يُعد الرمز';
  return detail.representative.pin.resetRequired ? 'إعادة الإعداد مطلوبة' : 'الرمز معدّ';
}
