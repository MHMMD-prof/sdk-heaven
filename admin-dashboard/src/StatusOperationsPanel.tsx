import type { User } from 'firebase/auth';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import {
  type AdminRole,
  type AdminStatusInspection,
  type AdminStatusOperations,
  approveAdminStatusOperation,
  freezeAdminStatusFeatures,
  proposeAdminStatusOperation,
  reconcileAdminStatus,
  requestAdminStatusOperations,
  requestAdminStatusUserInspection,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';

type Props = { permissions: string[]; role: AdminRole; user: User };
const FREEZE_FLAGS = ['aristocracyShop', 'vipProgression', 'statusPresentation', 'statusAnimations', 'statusAnnouncements'] as const;
const RELEASE_FLAGS = ['vipProgression', 'aristocracyShop', 'statusPresentation', 'statusProjectionRepair', 'svipCard', 'aristocracyCard', 'statusAnimations', 'statusAnnouncements'] as const;
const SIGNOFFS = ['product', 'economy', 'security', 'support', 'qa'] as const;
type Operation = 'vip-point-correction' | 'activate-catalog' | 'set-feature-flags' | 'set-signoffs'
  | 'set-migration-state' | 'complimentary-grant' | 'revoke' | 'freeze' | 'unfreeze';

export function StatusOperationsPanel({ permissions, role, user }: Props) {
  const { confirm, notify } = useAdminFeedback();
  const canManage = permissions.includes('status:manage');
  const owner = role === 'owner';
  const canReconcile = owner || role === 'auditor';
  const [operations, setOperations] = useState<AdminStatusOperations>();
  const [inspection, setInspection] = useState<AdminStatusInspection>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [targetUid, setTargetUid] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [pointDelta, setPointDelta] = useState(0);
  const [catalogKind, setCatalogKind] = useState<'vip-svip' | 'aristocracy'>('vip-svip');
  const [catalogVersion, setCatalogVersion] = useState('');
  const [rankId, setRankId] = useState('');
  const [durationDays, setDurationDays] = useState(30);
  const [aristocracyAction, setAristocracyAction] = useState<'complimentary-grant' | 'revoke' | 'freeze' | 'unfreeze'>('complimentary-grant');
  const [flagChanges, setFlagChanges] = useState<Record<string, boolean>>({});
  const [signoffChanges, setSignoffChanges] = useState<Record<string, boolean>>({});
  const [migrationUserCount, setMigrationUserCount] = useState(0);
  const [migrationHash, setMigrationHash] = useState('');
  const [migrationVerified, setMigrationVerified] = useState(false);
  const [freezeFlags, setFreezeFlags] = useState<Record<string, false>>({ aristocracyShop: false });

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setOperations(await requestAdminStatusOperations(user)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل مركز عمليات الحالة.'); }
    finally { setBusy(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  async function inspect(event: FormEvent) {
    event.preventDefault(); if (!targetUid.trim()) return;
    setBusy(true); setError('');
    try { setInspection(await requestAdminStatusUserInspection(user, targetUid.trim())); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر فحص حالة المستخدم.'); }
    finally { setBusy(false); }
  }

  async function propose(kind: Operation) {
    if (!canManage || reason.trim().length < 8 || evidenceRef.trim().length < 3) return;
    const approved = await confirm({
      confirmLabel: 'إنشاء طلب مراجعة',
      description: 'لن يُطبّق التغيير الآن. يجب أن يوافق مالك مستقل لا يكون هو المنشئ.',
      title: 'إرسال العملية للموافقة المزدوجة؟',
    });
    if (!approved) return;
    setBusy(true);
    try {
      const common = { reason: reason.trim(), evidenceRef: evidenceRef.trim() };
      const input = kind === 'vip-point-correction'
        ? { operation: kind, targetUid: targetUid.trim(), pointDelta, ...common }
        : kind === 'activate-catalog'
          ? { operation: kind, catalogKind, catalogVersion: catalogVersion.trim().toLowerCase(), ...common }
          : kind === 'set-feature-flags'
            ? { operation: kind, flags: flagChanges, ...common }
            : kind === 'set-signoffs'
              ? { operation: kind, signoffs: signoffChanges, ...common }
              : kind === 'set-migration-state'
                ? { operation: kind, migration: { required: migrationUserCount > 0, verified: migrationVerified, userCount: migrationUserCount, snapshotHash: migrationUserCount > 0 ? migrationHash.trim().toLowerCase() : '', catalogVersion: catalogVersion.trim().toLowerCase() }, ...common }
                : kind === 'complimentary-grant'
                  ? { operation: kind, targetUid: targetUid.trim(), catalogVersion: catalogVersion.trim().toLowerCase(), rankId: rankId.trim().toLowerCase(), durationDays, ...common }
                  : { operation: kind, targetUid: targetUid.trim(), ...common };
      const result = await proposeAdminStatusOperation(user, input);
      notify('تم إنشاء طلب موافقة', { description: result.proposalId, tone: 'success' });
      await load();
    } catch (cause) { notify('تعذر إنشاء الطلب', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' }); }
    finally { setBusy(false); }
  }

  async function approve(proposalId: string) {
    if (!owner) return;
    const confirmed = await confirm({ confirmLabel: 'موافقة وتطبيق', description: 'ستتم إعادة التحقق من السلطة والكتالوج والحالة داخل معاملة خادم واحدة.', title: 'اعتماد العملية المستقلة؟' });
    if (!confirmed) return;
    setBusy(true);
    try { await approveAdminStatusOperation(user, proposalId); notify('تم تطبيق العملية', { tone: 'success' }); await load(); }
    catch (cause) { notify('تعذرت الموافقة', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' }); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!canReconcile) return;
    const note = reason.trim() || 'manual status reconciliation';
    setBusy(true);
    try { await reconcileAdminStatus(user, note); notify('اكتملت المصالحة', { description: 'راجع حالة الانحراف والتنبيهات بعد التحديث.', tone: 'success' }); await load(); }
    catch (cause) { notify('تعذرت المصالحة', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' }); }
    finally { setBusy(false); }
  }

  async function freeze() {
    if (!owner || reason.trim().length < 8 || !Object.keys(freezeFlags).length) return;
    const confirmed = await confirm({ confirmLabel: 'إيقاف فوري', description: 'هذا الإجراء يطفئ الميزات المختارة فقط. لا يحذف العضويات أو السجلات أو الأرصدة.', destructive: true, title: 'تنفيذ تجميد طارئ؟' });
    if (!confirmed) return;
    setBusy(true);
    try { await freezeAdminStatusFeatures(user, freezeFlags, reason.trim()); notify('تم التجميد الطارئ', { tone: 'success' }); await load(); }
    catch (cause) { notify('تعذر التجميد', { description: cause instanceof Error ? cause.message : undefined, tone: 'error' }); }
    finally { setBusy(false); }
  }

  if (!operations && (busy || error)) return <AdminCollectionState children={null} empty={false} emptyMessage="" error={error || undefined} loading={busy} loadingMessage="جاري تحميل مركز عمليات الحالة…" onRetry={() => void load()} />;
  if (!operations) return null;

  return <div className="status-operations-page">
    <AdminSectionHeader actions={<button className="secondary-button compact" disabled={busy} onClick={() => void load()} type="button">تحديث</button>} description="مراقبة السلطة والصفوف والمصالحة، دعم المستخدم، والتغييرات عالية المخاطر بموافقة شخصين." eyebrow="VIP · SVIP · الأرستقراطية" title="مركز عمليات الحالة" />
    <section className="status-ops-kpis">
      <StatusMetric label="جاهزية التفعيل" tone={operations.readiness.canActivate ? 'success' : 'danger'} value={operations.readiness.canActivate ? 'جاهز' : `${operations.readiness.blockers.length} مانع`} />
      <StatusMetric label="الرسائل الميتة" tone={operations.queues.deadLetterCount ? 'danger' : 'success'} value={String(operations.queues.deadLetterCount)} />
      <StatusMetric label="تشغيلات الانحراف" tone={operations.reconciliation.consecutiveDriftRuns ? 'danger' : 'success'} value={String(operations.reconciliation.consecutiveDriftRuns)} />
      <StatusMetric label="الطلبات المعلقة" tone={operations.pendingProposals.length ? 'warning' : 'success'} value={String(operations.pendingProposals.length)} />
      <StatusMetric label="تنبيهات مفتوحة" tone={operations.alerts.length ? 'danger' : 'success'} value={String(operations.alerts.length)} />
    </section>

    <div className="status-ops-grid">
      <AdminSurface className="status-ops-card"><CardHeading label="حالة النظام" /><DefinitionRows rows={[
        ['كتالوج VIP/SVIP', operations.catalogs.vip || 'غير منشور'], ['كتالوج الأرستقراطية', operations.catalogs.aristocracy || 'غير منشور'],
        ['صف تقدم VIP', `${operations.queues.sourceQueued} معلّق`], ['صف العرض العام', `${operations.queues.projectionQueued} معلّق`],
        ['أقدم انتظار', formatDuration(operations.queues.oldestQueuedAgeMs)], ['العينة', operations.queues.sampled ? 'محدودة؛ راجع التقرير الكامل' : 'ضمن الحد'],
      ]} />{canReconcile ? <button disabled={busy} onClick={() => void reconcile()} type="button">تشغيل مصالحة كاملة</button> : <p className="status-ops-note">تشغيل المصالحة متاح للمالك والمدقق فقط.</p>}</AdminSurface>

      <AdminSurface className="status-ops-card"><CardHeading label="بوابة التفعيل" />
        <div className="status-signoffs">{Object.entries(operations.signoffs).map(([key, value]) => <AdminStatusBadge key={key} tone={value ? 'success' : 'danger'}>{signoffLabel(key)}: {value ? 'معتمد' : 'مطلوب'}</AdminStatusBadge>)}</div>
        <DefinitionRows rows={[["حصر الهجرة", operations.migration.assessed ? (operations.migration.verified ? 'موثق' : 'بانتظار التحقق') : 'لم يُسجّل'], ['عدد الحسابات القديمة', String(operations.migration.userCount)], ['آخر مصالحة', operations.reconciliation.completedAtMillis ? formatDate(operations.reconciliation.completedAtMillis) : 'لم تُشغّل']]} />
        {operations.readiness.blockers.length ? <ul className="status-blockers">{operations.readiness.blockers.map((item) => <li key={item}>{blockerLabel(item)}</li>)}</ul> : <p className="status-ready-copy">جميع بوابات التشغيل المسجلة مكتملة.</p>}
        {canManage ? <><div className="status-freeze-flags">{SIGNOFFS.map((signoff) => <label key={signoff}><input checked={signoff in signoffChanges ? signoffChanges[signoff] : operations.signoffs[signoff]} onChange={(event) => setSignoffChanges((current) => ({ ...current, [signoff]: event.target.checked }))} type="checkbox" />{signoffLabel(signoff)}</label>)}</div><button disabled={busy || !Object.keys(signoffChanges).length || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose('set-signoffs')} type="button">اقتراح تحديث الموافقات</button></> : null}
        <p className="status-ops-note">لا تُفعّل الأعلام من هذه الشاشة مباشرة. التفعيل طلب إصدار مزدوج المراجعة، والتجميد الطارئ إيقاف فقط.</p>
      </AdminSurface>
    </div>

    <AdminSurface className="status-ops-card"><CardHeading label="توزيع الحالة" /><div className="status-ops-grid"><DefinitionRows rows={distributionRows(operations.authority.vipDistribution, 'لا توجد حسابات VIP في العينة')} /><DefinitionRows rows={distributionRows(operations.authority.aristocracyDistribution, 'لا توجد رتب أرستقراطية في العينة')} /></div><p className="status-ops-note">عينة تشغيلية محدودة حتى {operations.authority.sampleLimit.toLocaleString('ar-IQ')} سجلاً لكل سلطة، وليست تقرير اقتصاد كامل.</p></AdminSurface>

    <div className="status-ops-grid">
      <AdminSurface className="status-ops-card"><CardHeading label="فحص دعم المستخدم" /><form className="status-inline-form" onSubmit={inspect}><input dir="ltr" maxLength={128} placeholder="UID" value={targetUid} onChange={(event) => setTargetUid(event.target.value)} /><button disabled={busy || !targetUid.trim()} type="submit">فحص</button></form>{inspection ? <UserInspection inspection={inspection} /> : <p className="status-ops-note">يعرض السلطة والسجل والأوامر الأخيرة دون كشف مراجع المحفظة الداخلية.</p>}</AdminSurface>

      <AdminSurface className="status-ops-card"><CardHeading label="تغيير موثق" />
        {canManage ? <div className="status-operation-form"><label>السبب<textarea minLength={8} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label>مرجع الدليل<input dir="ltr" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} /></label><div className="status-split"><label>تصحيح نقاط VIP<input max={1000000} min={-1000000} type="number" value={pointDelta} onChange={(event) => setPointDelta(Number(event.target.value))} /></label><button disabled={busy || !targetUid.trim() || !pointDelta || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose('vip-point-correction')} type="button">اقتراح تصحيح</button></div><div className="status-split"><label>نوع الكتالوج<select value={catalogKind} onChange={(event) => setCatalogKind(event.target.value as typeof catalogKind)}><option value="vip-svip">VIP/SVIP</option><option value="aristocracy">الأرستقراطية</option></select></label><label>الإصدار<input dir="ltr" value={catalogVersion} onChange={(event) => setCatalogVersion(event.target.value)} /></label><button disabled={busy || catalogVersion.trim().length < 3 || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose('activate-catalog')} type="button">اقتراح تفعيل/رجوع</button></div><div className="status-split"><label>إجراء الأرستقراطية<select value={aristocracyAction} onChange={(event) => setAristocracyAction(event.target.value as typeof aristocracyAction)}><option value="complimentary-grant">منحة مجانية محددة</option><option value="freeze">تجميد استحقاق</option><option value="unfreeze">إلغاء التجميد</option><option value="revoke">سحب الاستحقاق</option></select></label>{aristocracyAction === 'complimentary-grant' ? <><label>معرّف الرتبة<input dir="ltr" value={rankId} onChange={(event) => setRankId(event.target.value)} /></label><label>المدة بالأيام<input max={365} min={1} type="number" value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} /></label></> : null}<button disabled={busy || !targetUid.trim() || (aristocracyAction === 'complimentary-grant' && (!catalogVersion.trim() || !rankId.trim() || durationDays < 1)) || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose(aristocracyAction)} type="button">اقتراح إجراء الرتبة</button></div></div> : <p className="status-ops-note">هذا الدور للعرض والفحص فقط.</p>}
      </AdminSurface>
    </div>

    {canManage ? <AdminSurface className="status-ops-card"><CardHeading label="دليل الهجرة" /><div className="status-operation-form"><div className="status-split"><label>عدد الحسابات القديمة<input min={0} type="number" value={migrationUserCount} onChange={(event) => setMigrationUserCount(Math.max(0, Number(event.target.value)))} /></label><label>إصدار كتالوج VIP<input dir="ltr" value={catalogVersion} onChange={(event) => setCatalogVersion(event.target.value)} /></label>{migrationUserCount > 0 ? <label>SHA-256 للمعاينة<input dir="ltr" maxLength={64} value={migrationHash} onChange={(event) => setMigrationHash(event.target.value)} /></label> : null}<label><input checked={migrationVerified} onChange={(event) => setMigrationVerified(event.target.checked)} type="checkbox" />تمت المصالحة والتحقق</label><button disabled={busy || !migrationVerified || !catalogVersion.trim() || (migrationUserCount > 0 && !/^[a-f0-9]{64}$/i.test(migrationHash.trim())) || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose('set-migration-state')} type="button">اقتراح تسجيل دليل الهجرة</button></div></div><p className="status-ops-note">صفر يعني أن الحصر الموثق لم يجد مستخدمين يحتاجون للهجرة. أي عدد أكبر يحتاج تقرير المعاينة المطابق والمصالحة النظيفة.</p></AdminSurface> : null}

    {canManage ? <AdminSurface className="status-ops-card"><CardHeading label="أعلام الإصدار المستقلة" /><div className="status-freeze-flags">{RELEASE_FLAGS.map((flag) => <label key={flag}><input checked={flag in flagChanges ? flagChanges[flag] : operations.flags[flag] === true} onChange={(event) => setFlagChanges((current) => ({ ...current, [flag]: event.target.checked }))} type="checkbox" />{flagLabel(flag)}</label>)}</div><button disabled={busy || !Object.keys(flagChanges).length || reason.trim().length < 8 || evidenceRef.trim().length < 3} onClick={() => void propose('set-feature-flags')} type="button">اقتراح إصدار الأعلام المختارة</button><p className="status-ops-note">التشغيل يحتاج موافقة مالك ثانٍ واكتمال بوابات التوقيع. الإيقاف الطارئ أدناه لا يحتاج انتظار الموافقة.</p></AdminSurface> : null}

    <AdminSurface className="status-ops-card"><CardHeading label="طلبات الموافقة" /><div className="status-proposals">{operations.pendingProposals.length ? operations.pendingProposals.map((proposal) => <article key={proposal.proposalId}><div><strong>{operationLabel(proposal.operation)}</strong><small dir="ltr">{proposal.proposalId}</small><span>{proposal.targetUid || 'تغيير نظامي'} · {formatDate(proposal.createdAtMillis)}</span></div>{owner ? <button disabled={busy} onClick={() => void approve(proposal.proposalId)} type="button">مراجعة وموافقة</button> : <AdminStatusBadge tone="warning">بانتظار المالك</AdminStatusBadge>}</article>) : <p className="status-ops-note">لا توجد طلبات معلقة.</p>}</div></AdminSurface>

    {owner ? <AdminSurface className="status-ops-card status-emergency"><CardHeading label="تجميد طارئ" /><p>إيقاف فوري فقط. لا يمكن استخدامه للتفعيل أو منح نقاط أو رتب.</p><div className="status-freeze-flags">{FREEZE_FLAGS.map((flag) => <label key={flag}><input checked={flag in freezeFlags} onChange={(event) => setFreezeFlags((current) => event.target.checked ? { ...current, [flag]: false } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== flag)) as Record<string, false>)} type="checkbox" />{flagLabel(flag)}</label>)}</div><button className="danger-button" disabled={busy || reason.trim().length < 8 || !Object.keys(freezeFlags).length} onClick={() => void freeze()} type="button">إيقاف الميزات المختارة</button></AdminSurface> : null}
    {error ? <p className="form-alert" role="alert">{error}</p> : null}
  </div>;
}

function StatusMetric({ label, tone, value }: { label: string; tone: 'success' | 'warning' | 'danger'; value: string }) { return <article><span>{label}</span><strong>{value}</strong><AdminStatusBadge tone={tone}>{tone === 'success' ? 'سليم' : tone === 'warning' ? 'مراجعة' : 'انتباه'}</AdminStatusBadge></article>; }
function CardHeading({ label }: { label: string }) { return <header className="status-card-heading"><p className="eyebrow">تشغيل موثوق</p><h3>{label}</h3></header>; }
function DefinitionRows({ rows }: { rows: Array<[string, string]> }) { return <dl className="status-definition-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir={value.includes('-') ? 'ltr' : undefined}>{value}</dd></div>)}</dl>; }
function distributionRows(value: Record<string, number>, empty: string): Array<[string, string]> { const rows: Array<[string, string]> = Object.entries(value).map(([key, count]) => [key, count.toLocaleString('ar-IQ')]); return rows.length ? rows : [[empty, '0']]; }
function UserInspection({ inspection }: { inspection: AdminStatusInspection }) { return <div className="status-inspection"><strong>{inspection.profile?.displayName || 'مستخدم'} · {inspection.profile?.publicId || 'بلا رقم عام'}</strong><DefinitionRows rows={[["الظهور", inspection.visibility === 'public' ? 'عام' : 'مخفي'], ['رصيد العملات', inspection.wallet.coins.toLocaleString('ar-IQ')], ['VIP/SVIP', inspection.vip ? String(inspection.vip.levelId || 'بدون مستوى') : 'لا يوجد'], ['الأرستقراطية', inspection.aristocracy ? `${String(inspection.aristocracy.rankId)} · ${String(inspection.aristocracy.state)}` : 'لا توجد'], ['سجل النقاط', String(inspection.histories.contributions.length)], ['الانتقالات', String(inspection.histories.transitions.length)], ['عروض الشراء', String(inspection.histories.quotes.length)], ['سجل الرتب', String(inspection.histories.aristocracy.length)], ['أوامر الحالة', String(inspection.histories.commands.length)]]} /></div>; }
function formatDuration(value: number) { if (!value) return 'لا يوجد انتظار'; const minutes = Math.ceil(value / 60000); return minutes < 60 ? `${minutes} دقيقة` : `${Math.ceil(minutes / 60)} ساعة`; }
function formatDate(value: number) { return value ? new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function signoffLabel(value: string) { return ({ product: 'المنتج', economy: 'الاقتصاد', security: 'الأمن', support: 'الدعم', qa: 'الجودة' } as Record<string, string>)[value] || value; }
function operationLabel(value: string) { const labels: Record<string, string> = { 'vip-point-correction': 'تصحيح نقاط VIP', 'activate-catalog': 'تفعيل/رجوع كتالوج', 'set-feature-flags': 'تغيير أعلام الإصدار', 'set-signoffs': 'تحديث موافقات الإطلاق', 'set-migration-state': 'تسجيل دليل الهجرة', 'complimentary-grant': 'منحة أرستقراطية', revoke: 'سحب رتبة أرستقراطية', freeze: 'تجميد رتبة أرستقراطية', unfreeze: 'إلغاء تجميد رتبة' }; return labels[value] || value || 'عملية أرستقراطية'; }
function blockerLabel(value: string) { const labels: Record<string, string> = { VIP_CATALOG_MISSING: 'كتالوج VIP/SVIP النشط مفقود', ARISTOCRACY_CATALOG_MISSING: 'كتالوج الأرستقراطية النشط مفقود', QUEUE_SCAN_TRUNCATED: 'فحص الصف بلغ حد العينة ويحتاج تقريراً كاملاً', DEAD_LETTERS_PRESENT: 'توجد رسائل ميتة', QUEUE_SLO_BREACH: 'أقدم عنصر تجاوز خمس دقائق', RECONCILIATION_NOT_RUN: 'لم تُشغّل المصالحة بعد', RECONCILIATION_DRIFT: 'توجد نتيجة مصالحة منحرفة', MIGRATION_NOT_ASSESSED: 'حصر الهجرة غير مسجل', MIGRATION_NOT_VERIFIED: 'الهجرة غير موثقة', PRODUCT_SIGNOFF_MISSING: 'موافقة المنتج مفقودة', ECONOMY_SIGNOFF_MISSING: 'موافقة الاقتصاد مفقودة', SECURITY_SIGNOFF_MISSING: 'موافقة الأمن مفقودة', SUPPORT_SIGNOFF_MISSING: 'موافقة الدعم مفقودة', QA_SIGNOFF_MISSING: 'موافقة الجودة مفقودة' }; return labels[value] || value; }
function flagLabel(value: string) { const labels: Record<string, string> = { aristocracyShop: 'شراء الأرستقراطية', vipProgression: 'تقدم VIP/SVIP', statusPresentation: 'العرض العام', statusProjectionRepair: 'معالجة إصلاح العرض', svipCard: 'بطاقة SVIP', aristocracyCard: 'بطاقة الأرستقراطية', statusAnimations: 'الحركة', statusAnnouncements: 'الإعلانات' }; return labels[value] || value; }
