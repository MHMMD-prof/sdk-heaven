import { User } from 'firebase/auth';
import { FormEvent, useEffect, useState } from 'react';

import {
  AdminAdministrator,
  AdminDashboardSession,
  AdminPreferences,
  AdminRole,
  AdminSettings,
  executeAdministratorAction,
  requestAdminAdministrators,
  requestAdminSettings,
  updateAdminFeatureFlag,
  updateAdminSettings,
} from './adminDashboardApi';
import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';
import { useAdminDialogFocus } from './useAdminDialogFocus';

const roleLabels: Record<AdminRole, string> = {
  'super-moderator': 'مشرف إقليمي أعلى',
  owner: 'مالك النظام', moderator: 'مشرف المحتوى', support: 'دعم المستخدمين',
  'catalog-manager': 'مدير الكتالوج', auditor: 'مدقق النظام',
};
const roles = Object.keys(roleLabels) as AdminRole[];
const flagLabels: Record<keyof AdminSettings['featureFlags'], { description: string; label: string }> = {
  usersDiscovery: { label: 'اكتشاف المستخدمين', description: 'إظهار ملفات المجتمع في البحث والاكتشاف.' },
  friends: { label: 'نظام الأصدقاء', description: 'طلبات الصداقة والعلاقات الاجتماعية.' },
  wallet: { label: 'المحفظة والمتجر', description: 'الأرصدة والمشتريات والتحويلات.' },
  gifts: { label: 'الهدايا', description: 'إرسال الهدايا واحتساب نقاطها.' },
  couples: { label: 'الارتباط', description: 'ميزات الارتباط ومستوياته.' },
  pushNotifications: { label: 'الإشعارات الفورية', description: 'تسليم الإشعارات خارج التطبيق.' },
  representativeTransfers: { label: 'بوابة الوكلاء', description: 'إظهار بوابة الوكلاء والسماح بإنشاء جلسات تحويل جديدة.' },
};

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; administrators: AdminAdministrator[]; settings: AdminSettings };
type PendingGovernanceAction =
  | { action: 'change-role' | 'remove-admin' | 'revoke-sessions'; administrator: AdminAdministrator; kind: 'administrator'; role: AdminRole }
  | { enabled: boolean; flag: keyof AdminSettings['featureFlags']; kind: 'feature' };

export function SettingsPanel({ session, user }: { session: AdminDashboardSession; user: User }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<AdminRole>('support');
  const [reason, setReason] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingGovernanceAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const { notify } = useAdminFeedback();
  const canManageAdmins = session.permissions.includes('admins:manage');
  const canManageFlags = session.permissions.includes('flags:manage');

  async function load() {
    setState({ status: 'loading' });
    try {
      const [settings, administrators] = await Promise.all([requestAdminSettings(user), requestAdminAdministrators(user)]);
      setState({ status: 'ready', administrators, settings });
      applyDisplayPreferences(settings.preferences);
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل إعدادات الإدارة.' });
    }
  }

  useEffect(() => { void load(); }, [user.uid]);

  async function savePreferences(next: AdminPreferences) {
    if (state.status !== 'ready') return;
    setState({ ...state, settings: { ...state.settings, preferences: next } });
    applyDisplayPreferences(next);
    setBusyKey('preferences');
    try {
      await updateAdminSettings(user, { density: next.density, notifications: next.notifications, reduceMotion: next.reduceMotion });
      notify('حُفظت تفضيلاتك', { description: 'ستتبعك هذه الإعدادات عند استخدام متصفح آخر.', tone: 'success' });
    } catch (error) {
      notify('تعذّر حفظ التفضيلات', { description: error instanceof Error ? error.message : '', tone: 'error' });
      void load();
    } finally { setBusyKey(''); }
  }

  async function grantAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) { notify('سبب الإضافة مطلوب', { tone: 'error' }); return; }
    setBusyKey('grant');
    try {
      await executeAdministratorAction(user, { administratorAction: 'grant-role', email, reason, role: newRole });
      setEmail(''); setReason('');
      notify('مُنحت صلاحية الإدارة', { description: 'يجب على المسؤول تسجيل الدخول مجددًا لتحديث الصلاحيات.', tone: 'success' });
      await load();
    } catch (error) { notify('تعذّرت إضافة المسؤول', { description: error instanceof Error ? error.message : '', tone: 'error' }); }
    finally { setBusyKey(''); }
  }

  async function runAdministratorAction(administrator: AdminAdministrator, action: 'change-role' | 'remove-admin' | 'revoke-sessions', role = administrator.role) {
    setActionReason('');
    setPendingAction({ action, administrator, kind: 'administrator', role });
  }

  async function submitGovernanceAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingAction || actionReason.trim().length < 3) return;
    if (pendingAction.kind === 'feature') {
      const { enabled, flag } = pendingAction;
      setBusyKey(`flag:${flag}`);
      try {
        await updateAdminFeatureFlag(user, { enabled, flag, reason: actionReason.trim() });
        if (state.status === 'ready') setState({ ...state, settings: { ...state.settings, featureFlags: { ...state.settings.featureFlags, [flag]: enabled } } });
        notify('حُدّث مفتاح الميزة', { description: 'سُجّل التغيير مع حالته السابقة والجديدة.', tone: 'success' });
        setPendingAction(null);
      } catch (error) { notify('تعذّر تحديث الميزة', { description: error instanceof Error ? error.message : '', tone: 'error' }); }
      finally { setBusyKey(''); }
      return;
    }
    const { action, administrator, role } = pendingAction;
    setBusyKey(`${action}:${administrator.uid}`);
    try {
      await executeAdministratorAction(user, { administratorAction: action, reason: actionReason.trim(), role, targetUid: administrator.uid });
      notify('تم تنفيذ إجراء الأمان', { tone: 'success' });
      setPendingAction(null);
      if (action === 'revoke-sessions' && administrator.uid === session.uid) window.setTimeout(() => window.location.reload(), 500);
      else await load();
    } catch (error) { notify('تعذّر تنفيذ الإجراء', { description: error instanceof Error ? error.message : '', tone: 'error' }); }
    finally { setBusyKey(''); }
  }

  async function toggleFeature(flag: keyof AdminSettings['featureFlags'], enabled: boolean) {
    setActionReason('');
    setPendingAction({ enabled, flag, kind: 'feature' });
  }

  if (state.status !== 'ready') {
    return <AdminCollectionState children={null} empty={false} emptyMessage="" error={state.status === 'error' ? state.message : undefined} loading={state.status === 'loading'} loadingMessage="جارٍ تحميل مركز الإعدادات…" onRetry={() => void load()} />;
  }

  const { administrators, settings } = state;
  return (
    <div className="settings-page settings-command-center">
      <AdminSectionHeader
        actions={<button className="secondary-button compact" onClick={() => void load()} type="button">تحديث البيانات</button>}
        description="إدارة الصلاحيات، الجلسات، التنبيهات ومفاتيح المنصة من مركز واحد موثّق."
        eyebrow="الحوكمة والأمان"
        title="مركز إعدادات الإدارة"
      />

      <div className="settings-kpis">
        <SettingsKpi label="المسؤولون" value={String(administrators.length)} hint="حسابات بصلاحية فعّالة" />
        <SettingsKpi label="المالكون" value={String(administrators.filter((item) => item.role === 'owner').length)} hint="حماية من إزالة آخر مالك" />
        <SettingsKpi label="دورك الحالي" value={roleLabels[session.role]} hint={`${session.permissions.length} صلاحية خادمية`} />
        <SettingsKpi label="حالة الجلسة" value={settings.session.emailVerified ? 'موثّقة' : 'غير موثّقة'} hint={formatDate(settings.session.lastSignInAt)} />
      </div>

      <div className="settings-grid settings-primary-grid">
        <AdminSurface className="settings-card settings-account-card">
          <SettingsHeading icon="♙" title="ملف المسؤول" description="هوية الجلسة والدور الفعلي من Firebase." />
          <dl className="settings-details">
            <div><dt>البريد</dt><dd dir="ltr">{session.email || user.email || '—'}</dd></div>
            <div><dt>الدور</dt><dd><AdminStatusBadge tone="success">{roleLabels[session.role]}</AdminStatusBadge></dd></div>
            <div><dt>آخر دخول</dt><dd>{formatDate(settings.session.lastSignInAt)}</dd></div>
            <div><dt>إنشاء الحساب</dt><dd>{formatDate(settings.session.createdAt)}</dd></div>
          </dl>
          <button className="security-action" disabled={Boolean(busyKey)} onClick={() => void runAdministratorAction(administrators.find((item) => item.uid === session.uid) || selfAdministrator(session), 'revoke-sessions')} type="button">سحب جلساتي المفتوحة</button>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <SettingsHeading icon="◈" title="تجربة العرض" description="تُحفظ على حسابك وتطبّق فورًا." />
          <div className="settings-list">
            <SettingToggle checked={settings.preferences.density === 'compact'} disabled={busyKey === 'preferences'} description="زيادة كثافة الجداول والقوائم التشغيلية." label="كثافة مدمجة" onChange={(checked) => void savePreferences({ ...settings.preferences, density: checked ? 'compact' : 'comfortable' })} />
            <SettingToggle checked={settings.preferences.reduceMotion} disabled={busyKey === 'preferences'} description="تقليل الانتقالات والحركات الزخرفية." label="تقليل الحركة" onChange={(checked) => void savePreferences({ ...settings.preferences, reduceMotion: checked })} />
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card">
          <SettingsHeading icon="◇" title="تنبيهات العمليات" description="اختَر الأحداث التي تظهر كتنبيهات إدارية." />
          <div className="settings-list">
            <SettingToggle checked={settings.preferences.notifications.urgentReports} disabled={busyKey === 'preferences'} description="بلاغات الخطورة العالية والحرجة." label="البلاغات العاجلة" onChange={(checked) => void savePreferences({ ...settings.preferences, notifications: { ...settings.preferences.notifications, urgentReports: checked } })} />
            <SettingToggle checked={settings.preferences.notifications.flaggedRooms} disabled={busyKey === 'preferences'} description="الغرف التي تحتاج تدخّلًا أو مراجعة." label="الغرف المعلّمة" onChange={(checked) => void savePreferences({ ...settings.preferences, notifications: { ...settings.preferences.notifications, flaggedRooms: checked } })} />
            <SettingToggle checked={settings.preferences.notifications.operationalFailures} disabled={busyKey === 'preferences'} description="أخطاء الخدمات والعمليات الإدارية." label="الإخفاقات التشغيلية" onChange={(checked) => void savePreferences({ ...settings.preferences, notifications: { ...settings.preferences.notifications, operationalFailures: checked } })} />
          </div>
        </AdminSurface>

        <AdminSurface className="settings-card settings-security-card">
          <SettingsHeading icon="⌾" title="حدود الحماية" description="الضوابط المفعّلة على كل طلب إداري." />
          <ul className="security-checks">
            <SecurityCheck title="صلاحيات على الخادم" detail="يُرفض الإجراء قبل قراءة البيانات إن لم يسمح به الدور." />
            <SecurityCheck title="سجل تغييرات غير قابل للكتابة من العميل" detail="تُحفظ تغييرات الدور والجلسات والميزات مع المنفّذ والسبب." />
            <SecurityCheck title="حماية مالك النظام" detail="لا يمكن للمالك إزالة نفسه أو إزالة آخر مالك." />
          </ul>
        </AdminSurface>
      </div>

      <AdminSurface className="settings-card settings-admin-roster">
        <SettingsHeading icon="♜" title="المسؤولون والأدوار" description="صلاحيات بأقل امتياز؛ أي تغيير يسحب الجلسات القديمة ويُسجّل فورًا." />
        {canManageAdmins ? (
          <form className="admin-invite-form" onSubmit={grantAdministrator}>
            <input aria-label="بريد الحساب" dir="ltr" onChange={(event) => setEmail(event.target.value)} placeholder="operator@example.com" required type="email" value={email} />
            <select aria-label="الدور" onChange={(event) => setNewRole(event.target.value as AdminRole)} value={newRole}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
            <input aria-label="سبب منح الصلاحية" onChange={(event) => setReason(event.target.value)} placeholder="سبب منح الصلاحية" required value={reason} />
            <button className="secondary-button compact" disabled={busyKey === 'grant'} type="submit">منح الدور لحساب موجود</button>
          </form>
        ) : <p className="settings-permission-note">يمكنك مراجعة الفريق، بينما تغيير الأدوار محصور بمالك النظام.</p>}
        <div className="administrator-table" role="table">
          <div className="administrator-row administrator-head" role="row"><span>المسؤول</span><span>الدور</span><span>آخر دخول</span><span>الأمان</span></div>
          {administrators.map((administrator) => <AdministratorRow administrator={administrator} busyKey={busyKey} canManage={canManageAdmins} currentUid={session.uid} key={administrator.uid} onAction={runAdministratorAction} />)}
        </div>
      </AdminSurface>

      <div className="settings-grid settings-lower-grid">
        <AdminSurface className="settings-card settings-flags-card">
          <SettingsHeading icon="⚑" title="مفاتيح المنصة المعتمدة" description="لا تظهر هنا إلا الميزات المدرجة صراحة في قائمة الخادم الآمنة." />
          <div className="feature-flag-list">
            {(Object.keys(flagLabels) as Array<keyof AdminSettings['featureFlags']>).map((flag) => (
              <SettingToggle key={flag} checked={settings.featureFlags[flag]} disabled={!canManageFlags || busyKey === `flag:${flag}`} description={flagLabels[flag].description} label={flagLabels[flag].label} onChange={(enabled) => void toggleFeature(flag, enabled)} />
            ))}
          </div>
          {!canManageFlags ? <p className="settings-permission-note">تعديل مفاتيح المنصة محصور بمالك النظام.</p> : null}
        </AdminSurface>

        <AdminSurface className="settings-card settings-history-card">
          <SettingsHeading icon="↺" title="آخر تغييرات الحوكمة" description="أحدث تغييرات الأدوار والجلسات والتفضيلات ومفاتيح المنصة." />
          <ol className="settings-history">
            {settings.history.slice(0, 8).map((event) => <li key={event.id}><i /><div><strong>{translateEvent(event.action)}</strong><span>{event.actorEmail || event.actorUid || 'مسؤول غير معروف'}</span><small>{formatDate(event.createdAt)} · {event.note || event.status}</small></div></li>)}
            {settings.history.length === 0 ? <li className="history-empty">لا توجد تغييرات مسجّلة بعد.</li> : null}
          </ol>
        </AdminSurface>
      </div>
      {pendingAction ? <GovernanceDialog action={pendingAction} busy={Boolean(busyKey)} onCancel={() => setPendingAction(null)} onReasonChange={setActionReason} onSubmit={submitGovernanceAction} reason={actionReason} /> : null}
    </div>
  );
}

function AdministratorRow({ administrator, busyKey, canManage, currentUid, onAction }: { administrator: AdminAdministrator; busyKey: string; canManage: boolean; currentUid: string; onAction: (administrator: AdminAdministrator, action: 'change-role' | 'remove-admin' | 'revoke-sessions', role?: AdminRole) => Promise<void> }) {
  const [role, setRole] = useState(administrator.role);
  const isSelf = administrator.uid === currentUid;
  return <div className="administrator-row" role="row">
    <div className="administrator-identity"><span className="administrator-avatar">{(administrator.displayName || administrator.email || 'م').slice(0, 1)}</span><span><strong>{administrator.displayName || 'مسؤول'}</strong><small dir="ltr">{administrator.email || administrator.uid}</small></span></div>
    <div>{canManage && !isSelf ? <select aria-label="دور المسؤول" onChange={(event) => setRole(event.target.value as AdminRole)} value={role}>{roles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}</select> : <AdminStatusBadge tone={administrator.role === 'owner' ? 'warning' : 'info'}>{roleLabels[administrator.role]}</AdminStatusBadge>}</div>
    <span className="administrator-date">{formatDate(administrator.lastSignInAt)}</span>
    <div className="administrator-actions">
      {canManage && !isSelf && role !== administrator.role ? <button disabled={Boolean(busyKey)} onClick={() => void onAction(administrator, 'change-role', role)} type="button">حفظ الدور</button> : null}
      {(canManage || isSelf) ? <button disabled={Boolean(busyKey)} onClick={() => void onAction(administrator, 'revoke-sessions')} type="button">سحب الجلسات</button> : null}
      {canManage && !isSelf ? <button className="danger" disabled={Boolean(busyKey)} onClick={() => void onAction(administrator, 'remove-admin')} type="button">إزالة</button> : null}
    </div>
  </div>;
}

function SettingsKpi({ hint, label, value }: { hint: string; label: string; value: string }) { return <article className="settings-kpi"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>; }
function SettingsHeading({ description, icon, title }: { description: string; icon: string; title: string }) { return <div className="settings-card-heading"><span className="settings-icon" aria-hidden="true">{icon}</span><div><h4>{title}</h4><p>{description}</p></div></div>; }
function SecurityCheck({ detail, title }: { detail: string; title: string }) { return <li><span>✓</span><div><strong>{title}</strong><small>{detail}</small></div></li>; }
function SettingToggle({ checked, description, disabled, label, onChange }: { checked: boolean; description: string; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) { return <label className={`setting-toggle-row${disabled ? ' disabled' : ''}`}><span><strong>{label}</strong><small>{description}</small></span><input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><i aria-hidden="true" /></label>; }
function applyDisplayPreferences(preferences: AdminPreferences) { document.documentElement.dataset.density = preferences.density; document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full'; }
function formatDate(value: string) { if (!value) return 'لا يوجد'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function translateEvent(action: string) { return ({ 'administrator-grant-role': 'منح دور إداري', 'administrator-change-role': 'تغيير دور إداري', 'administrator-remove-admin': 'إزالة مسؤول', 'administrator-revoke-sessions': 'سحب جلسات', 'admin-settings-update': 'تحديث التفضيلات', 'feature-flag-update': 'تحديث مفتاح ميزة' } as Record<string, string>)[action] || action; }
function selfAdministrator(session: AdminDashboardSession): AdminAdministrator { return { createdAt: '', disabled: false, displayName: '', email: session.email, lastSignInAt: '', role: session.role, tokensValidAfterAt: '', uid: session.uid }; }

function GovernanceDialog({ action, busy, onCancel, onReasonChange, onSubmit, reason }: { action: PendingGovernanceAction; busy: boolean; onCancel: () => void; onReasonChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; reason: string }) {
  const dialogRef = useAdminDialogFocus<HTMLFormElement>(true, onCancel);
  const destructive = action.kind === 'administrator' && action.action !== 'change-role';
  const title = action.kind === 'feature'
    ? `${action.enabled ? 'تفعيل' : 'إيقاف'} «${flagLabels[action.flag].label}»`
    : action.action === 'remove-admin' ? 'إزالة صلاحية الإدارة' : action.action === 'revoke-sessions' ? 'سحب الجلسات المفتوحة' : 'تغيير الدور الإداري';
  const detail = action.kind === 'feature'
    ? 'سيؤثر التغيير في تجربة التطبيق للمستخدمين، وسيُحفظ الوضع السابق والجديد في سجل التدقيق.'
    : `الحساب المستهدف: ${action.administrator.email || action.administrator.uid}. ستُبطل الجلسات القديمة عند تغيير الوصول.`;
  return <div className="settings-dialog-layer" role="presentation"><button aria-label="إغلاق" className="settings-dialog-backdrop" onClick={onCancel} type="button" /><form aria-label={title} aria-modal="true" className="settings-governance-dialog" onSubmit={onSubmit} ref={dialogRef} role="dialog" tabIndex={-1}><header><span className={destructive ? 'danger' : ''}>{destructive ? 'إجراء أمني حساس' : 'تغيير موثّق'}</span><h3>{title}</h3><p>{detail}</p></header><label>سبب الإجراء<textarea autoFocus maxLength={300} minLength={3} onChange={(event) => onReasonChange(event.target.value)} placeholder="اكتب سببًا واضحًا سيظهر في سجل التدقيق…" required value={reason} /></label><footer><button className="dialog-cancel" onClick={onCancel} type="button">إلغاء</button><button className={destructive ? 'dialog-confirm danger' : 'dialog-confirm'} disabled={busy || reason.trim().length < 3} type="submit">{busy ? 'جارٍ التنفيذ…' : 'تأكيد وتسجيل الإجراء'}</button></footer></form></div>;
}
