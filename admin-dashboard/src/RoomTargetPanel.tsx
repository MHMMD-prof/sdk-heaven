import type { User } from 'firebase/auth';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';

import {
  AdminRoomTargetCampaignDetail,
  AdminRoomTargetTemplate,
  mutateAdminRoomTargetCampaign,
  mutateAdminRoomTargetMemberHold,
  requestAdminRoomTargetCampaign,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminStatusBadge, AdminSurface } from './AdminUi';

type Draft = {
  conversionDenominator: string;
  conversionNumerator: string;
  diamondValueCoins: string;
  enabled: boolean;
  itemValues: string;
  maxSelectedUsers: string;
  minimumGift: string;
  payoutCurrency: 'coins' | 'diamonds';
  perRoomCap: string;
  perUserCap: string;
  returnPercent: string;
  target: string;
};

const DEFAULT_DRAFT: Draft = {
  conversionDenominator: '1',
  conversionNumerator: '1',
  diamondValueCoins: '100',
  enabled: true,
  itemValues: '',
  maxSelectedUsers: '20',
  minimumGift: '1',
  payoutCurrency: 'coins',
  perRoomCap: '1000000',
  perUserCap: '250000',
  returnPercent: '5',
  target: '500000',
};

export function RoomTargetPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const [detail, setDetail] = useState<AdminRoomTargetCampaignDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [hold, setHold] = useState({ cycleId: '', roomId: '', targetUid: '' });
  const canManage = permissions.includes('incentives:manage');

  async function load() {
    setError('');
    try {
      const value = await requestAdminRoomTargetCampaign(user);
      setDetail(value);
      if (value.campaign?.draft) setDraft(toDraft(value.campaign.draft));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل إعدادات هدف الغرفة.');
    }
  }

  useEffect(() => { void load(); }, [user.uid]);

  const conversionExample = useMemo(() => {
    const spend = 10_000;
    const returnedCoins = Math.floor(spend * (Number(draft.returnPercent) || 0) / 100);
    return Math.floor(
      returnedCoins
      * (Number(draft.conversionNumerator) || 0)
      / Math.max(1, Number(draft.conversionDenominator) || 1),
    );
  }, [draft.conversionDenominator, draft.conversionNumerator, draft.returnPercent]);
  const latestRisk = detail?.versions[0]?.riskSnapshot;

  async function submit(event: FormEvent, operation: 'save-draft' | 'publish') {
    event.preventDefault();
    const template = buildTemplate(draft, operation);
    if (!canManage || reason.trim().length < 3 || !template) {
      notify('راجع الإعدادات وسبب التغيير', { description: 'كل القيم والسبب مطلوبة قبل الحفظ.', tone: 'error' });
      return;
    }
    setBusy(operation);
    try {
      const result = await mutateAdminRoomTargetCampaign(user, {
        expectedRevision: detail?.campaign?.revision || 0,
        operation,
        reason: reason.trim(),
        template,
      });
      notify(operation === 'publish' ? 'نُشر قالب هدف الغرفة' : 'حُفظت مسودة هدف الغرفة', {
        description: result.effectiveFromCycleId
          ? `سيبدأ في الدورة ${result.effectiveFromCycleId}.`
          : 'لم تتغير الدورة الحالية.',
        tone: 'success',
      });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تحديث هدف الغرفة', {
        description: mutationError instanceof Error ? mutationError.message : '',
        tone: 'error',
      });
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
      await mutateAdminRoomTargetCampaign(user, {
        expectedRevision: detail?.campaign?.revision || 0,
        operation,
        reason: reason.trim(),
        ...(rollbackRevision ? { rollbackRevision } : {}),
      });
      notify(operation === 'rollback' ? 'تم إنشاء إصدار استرجاع جديد' : 'أُوقف عرض هدف الغرفة فوراً', { tone: 'success' });
      setReason('');
      await load();
    } catch (mutationError) {
      notify('تعذر تنفيذ الإجراء', { description: mutationError instanceof Error ? mutationError.message : '', tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function updateHold(operation: 'apply' | 'release') {
    if (!canManage || reason.trim().length < 3 || !hold.roomId || !hold.cycleId || !hold.targetUid) {
      notify('بيانات الحجز وسبب التدقيق مطلوبة', { tone: 'error' });
      return;
    }
    setBusy(`hold:${operation}`);
    try {
      await mutateAdminRoomTargetMemberHold(user, { ...hold, operation, reason: reason.trim() });
      notify(operation === 'apply' ? 'تم تعليق عائد العضو' : 'تم رفع تعليق العضو', { tone: 'success' });
      await load();
    } catch (mutationError) {
      notify('تعذر تحديث الحجز', { description: mutationError instanceof Error ? mutationError.message : '', tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (!detail) {
    return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={!error} loadingMessage="جاري تحميل هدف الغرفة…" onRetry={() => void load()} />;
  }

  return (
    <section className="room-target-section">
      <div className="rocket-preview-heading">
        <div>
          <p className="section-kicker">هدف المالك الأسبوعي</p>
          <h2>هدف الغرفة والعوائد</h2>
          <p className="field-hint">القائمة الحالية مقفلة. أي نشر جديد يبدأ من الأسبوع التالي ويحفظ نسخة تاريخية كاملة.</p>
        </div>
        <AdminStatusBadge tone={detail.campaign?.emergencyDisabled ? 'danger' : 'success'}>{detail.campaign?.emergencyDisabled ? 'موقوف للطوارئ' : 'متاح'}</AdminStatusBadge>
      </div>

      <div className="settings-kpis">
        <Metric label="الغرف العامة المؤهلة" value={detail.operations.qualifyingRoomCount.toLocaleString('ar-IQ')} />
        <Metric label="الدورات النشطة" value={detail.operations.activeCycleCount.toLocaleString('ar-IQ')} />
        <Metric label="حجوزات التدقيق" value={detail.operations.activeHoldCount.toLocaleString('ar-IQ')} danger={detail.operations.activeHoldCount > 0} />
        <Metric label="الدورة القادمة" value={detail.campaign?.nextEffectiveCycleId || '—'} />
      </div>

      <form className="settings-grid" onSubmit={(event) => void submit(event, 'save-draft')}>
        <AdminSurface className="settings-card">
          <h3>الهدف والعائد</h3>
          <Field label="هدف نقاط الدعم"><input min="1" onChange={(event) => setDraft({ ...draft, target: event.target.value })} type="number" value={draft.target} /></Field>
          <Field label="نسبة الإرجاع"><div className="input-with-suffix"><input max="100" min="0.01" onChange={(event) => setDraft({ ...draft, returnPercent: event.target.value })} step="0.01" type="number" value={draft.returnPercent} /><span>٪</span></div></Field>
          <Field label="أقصى عائد للفرد"><input min="1" onChange={(event) => setDraft({ ...draft, perUserCap: event.target.value })} type="number" value={draft.perUserCap} /></Field>
          <Field label="أقصى عائد للغرفة"><input min="1" onChange={(event) => setDraft({ ...draft, perRoomCap: event.target.value })} type="number" value={draft.perRoomCap} /></Field>
          <Field label="أقصى عدد مختار"><input max="20" min="0" onChange={(event) => setDraft({ ...draft, maxSelectedUsers: event.target.value })} type="number" value={draft.maxSelectedUsers} /></Field>
          <Field label="أقل هدية مؤهلة"><input min="1" onChange={(event) => setDraft({ ...draft, minimumGift: event.target.value })} type="number" value={draft.minimumGift} /></Field>
          <label className="rocket-motion-toggle"><input checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" /> تفعيل القالب للدورة القادمة</label>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>تحويل العملة</h3>
          <Field label="عملة العائد"><select onChange={(event) => setDraft({ ...draft, payoutCurrency: event.target.value as 'coins' | 'diamonds' })} value={draft.payoutCurrency}><option value="coins">Coins</option><option value="diamonds">Diamonds</option></select></Field>
          <Field label="بسط التحويل"><input min="1" onChange={(event) => setDraft({ ...draft, conversionNumerator: event.target.value })} type="number" value={draft.conversionNumerator} /></Field>
          <Field label="مقام التحويل"><input min="1" onChange={(event) => setDraft({ ...draft, conversionDenominator: event.target.value })} type="number" value={draft.conversionDenominator} /></Field>
          <Field label="قيمة الماسة بالعملات"><input min="1" onChange={(event) => setDraft({ ...draft, diamondValueCoins: event.target.value })} type="number" value={draft.diamondValueCoins} /></Field>
          <Field label="قيم العناصر (itemId=coins)"><textarea dir="ltr" onChange={(event) => setDraft({ ...draft, itemValues: event.target.value })} rows={4} value={draft.itemValues} /></Field>
          <div className="target-example">
            <b>مثال مؤكد قبل النشر</b>
            <span>إنفاق 10,000 عملة يعيد {conversionExample.toLocaleString('ar-IQ')} {draft.payoutCurrency === 'diamonds' ? 'ماسة' : 'عملة'} قبل حدود السقف.</span>
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>المخاطر والهامش</h3>
          {latestRisk ? (
            <>
              <Metric label="عمولة الهدف المقدرة" value={(latestRisk.targetCommissionCoins || 0).toLocaleString('ar-IQ')} />
              <Metric label="التزام الهدف" value={(latestRisk.roomTargetLiabilityCoins || 0).toLocaleString('ar-IQ')} />
              <Metric label="التزام الصاروخ + الهدف" value={(latestRisk.stackedLiabilityCoins || 0).toLocaleString('ar-IQ')} />
              <Metric label="الهامش المتبقي" value={(latestRisk.marginCoins || 0).toLocaleString('ar-IQ')} danger={latestRisk.viable === false || Number(latestRisk.marginCoins || 0) <= 0} />
            </>
          ) : <p className="field-hint">ستظهر لقطة المخاطر بعد أول نشر. الخادم يمنع النشر إذا تجاوزت التزامات الصاروخ وهدف الغرفة عمولة المنصة.</p>}
          <p className="field-hint">هذه الأرقام تخص أسوأ سيناريو للقالب المنشور، وليست وعداً بصرف الدورة الحالية.</p>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>النشر المحكوم</h3>
          <Field label="سبب التغيير"><textarea minLength={3} onChange={(event) => setReason(event.target.value)} rows={4} value={reason} /></Field>
          <div className="settings-actions">
            <button className="secondary-button" disabled={!canManage || Boolean(busy)} type="submit">حفظ مسودة</button>
            <button className="primary-button" disabled={!canManage || Boolean(busy)} onClick={(event) => void submit(event, 'publish')} type="button">نشر للأسبوع القادم</button>
            <button className="danger-button" disabled={!canManage || Boolean(busy)} onClick={() => void mutateSimple('emergency-disable')} type="button">إيقاف العرض فوراً</button>
          </div>
        </AdminSurface>
      </form>

      <div className="settings-grid">
        <AdminSurface className="settings-card">
          <h3>حجز عائد عضو للتدقيق</h3>
          <Field label="Room ID"><input dir="ltr" onChange={(event) => setHold({ ...hold, roomId: event.target.value.trim() })} value={hold.roomId} /></Field>
          <Field label="Cycle ID"><input dir="ltr" onChange={(event) => setHold({ ...hold, cycleId: event.target.value.trim() })} value={hold.cycleId} /></Field>
          <Field label="User UID"><input dir="ltr" onChange={(event) => setHold({ ...hold, targetUid: event.target.value.trim() })} value={hold.targetUid} /></Field>
          <div className="settings-actions">
            <button className="danger-button" disabled={!canManage || Boolean(busy)} onClick={() => void updateHold('apply')} type="button">تعليق العائد</button>
            <button className="secondary-button" disabled={!canManage || Boolean(busy)} onClick={() => void updateHold('release')} type="button">رفع التعليق</button>
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <h3>تقرير التسويات</h3>
          <Metric label="مدفوع" value={(detail.operations.settlementCounts.paid || 0).toLocaleString('ar-IQ')} />
          <Metric label="معلق" value={(detail.operations.settlementCounts.held || 0).toLocaleString('ar-IQ')} danger={(detail.operations.settlementCounts.held || 0) > 0} />
          <Metric label="إجمالي العملات" value={detail.operations.settledReturns.coins.toLocaleString('ar-IQ')} />
          <Metric label="إجمالي الماس" value={detail.operations.settledReturns.diamonds.toLocaleString('ar-IQ')} />
          {detail.operations.settlementSampleLimited ? <p className="field-hint">التقرير يعرض عينة محدودة من أحدث 500 تسوية.</p> : null}
        </AdminSurface>
      </div>

      <AdminSurface className="settings-card">
        <h3>الدورات الأخيرة</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>الغرفة</th><th>الدورة</th><th>الحالة</th><th>التقدم</th><th>القائمة</th><th>إنفاق مؤهل</th></tr></thead>
            <tbody>
              {detail.operations.activeCycles.map((cycle) => (
                <tr key={`${cycle.roomId}:${cycle.cycleId}`}>
                  <td dir="ltr">{cycle.roomId}</td><td dir="ltr">{cycle.cycleId}</td>
                  <td><AdminStatusBadge tone={cycle.state === 'held' ? 'danger' : 'neutral'}>{cycle.state || 'unknown'}</AdminStatusBadge></td>
                  <td>{cycle.supportPoints.toLocaleString('ar-IQ')} / {cycle.targetSupportPoints.toLocaleString('ar-IQ')}</td>
                  <td>{cycle.rosterSize.toLocaleString('ar-IQ')}</td>
                  <td>{cycle.eligibleSpendCoins.toLocaleString('ar-IQ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSurface>

      <AdminSurface className="settings-card">
        <h3>سجل الإصدارات</h3>
        <div className="settings-actions">
          {detail.versions.map((version) => (
            <button className="secondary-button compact" disabled={!canManage || Boolean(busy)} key={version.revision} onClick={() => void mutateSimple('rollback', version.revision)} type="button">
              v{version.revision} · {version.effectiveFromCycleId} · {version.template.returnBps / 100}٪
            </button>
          ))}
        </div>
      </AdminSurface>
    </section>
  );
}

function buildTemplate(draft: Draft, operation: 'save-draft' | 'publish'): AdminRoomTargetTemplate | undefined {
  const integers = {
    conversionDenominator: Number(draft.conversionDenominator),
    conversionNumerator: Number(draft.conversionNumerator),
    diamondValueCoins: Number(draft.diamondValueCoins),
    maxSelectedUsers: Number(draft.maxSelectedUsers),
    minimumGift: Number(draft.minimumGift),
    perRoomCap: Number(draft.perRoomCap),
    perUserCap: Number(draft.perUserCap),
    returnBps: Math.round(Number(draft.returnPercent) * 100),
    target: Number(draft.target),
  };
  if (
    Object.values(integers).some((value) => !Number.isSafeInteger(value) || value < 0)
    || integers.target < 1
    || integers.minimumGift < 1
    || integers.perUserCap < 1
    || integers.perRoomCap < integers.perUserCap
    || integers.maxSelectedUsers > 20
    || integers.returnBps < 1
    || integers.returnBps > 10_000
    || integers.conversionNumerator < 1
    || integers.conversionDenominator < 1
    || (draft.payoutCurrency === 'coins' && (integers.conversionNumerator !== 1 || integers.conversionDenominator !== 1))
  ) return undefined;
  const itemValuesCoins: Record<string, number> = {};
  for (const line of draft.itemValues.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const [itemId, rawValue, ...rest] = line.split('=');
    const value = Number(rawValue);
    if (rest.length || !/^[A-Za-z0-9_-]{1,128}$/.test(itemId || '') || !Number.isSafeInteger(value) || value < 1) return undefined;
    itemValuesCoins[itemId as string] = value;
  }
  return {
    conversion: {
      denominator: integers.conversionDenominator,
      numerator: integers.conversionNumerator,
      payoutCurrency: draft.payoutCurrency,
      rounding: 'floor',
      sourceCurrency: 'coins',
    },
    eligibleGiftRules: { committedOnly: true, excludeSelfGifts: true, minimumDebitedCoins: integers.minimumGift },
    enabled: draft.enabled,
    maxSelectedUsers: integers.maxSelectedUsers,
    perRoomReturnCap: integers.perRoomCap,
    perUserReturnCap: integers.perUserCap,
    publicationStatus: operation === 'publish' ? 'published' : 'draft',
    returnBps: integers.returnBps,
    riskValuation: { diamondValueCoins: integers.diamondValueCoins, itemValuesCoins },
    schemaVersion: 1,
    targetSupportPoints: integers.target,
    templateId: 'global-room-target',
    templateVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function toDraft(template: AdminRoomTargetTemplate): Draft {
  return {
    conversionDenominator: String(template.conversion.denominator),
    conversionNumerator: String(template.conversion.numerator),
    diamondValueCoins: String(template.riskValuation.diamondValueCoins),
    enabled: template.enabled,
    itemValues: Object.entries(template.riskValuation.itemValuesCoins).map(([id, value]) => `${id}=${value}`).join('\n'),
    maxSelectedUsers: String(template.maxSelectedUsers),
    minimumGift: String(template.eligibleGiftRules.minimumDebitedCoins),
    payoutCurrency: template.conversion.payoutCurrency,
    perRoomCap: String(template.perRoomReturnCap),
    perUserCap: String(template.perUserReturnCap),
    returnPercent: String(template.returnBps / 100),
    target: String(template.targetSupportPoints),
  };
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Metric({ danger = false, label, value }: { danger?: boolean; label: string; value: string }) {
  return <div className={`settings-kpi ${danger ? 'is-danger' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}
