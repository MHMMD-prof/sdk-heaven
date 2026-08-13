import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';

import { useAdminFeedback } from './AdminFeedback';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge, AdminSurface } from './AdminUi';
import { useAdminDialogFocus } from './useAdminDialogFocus';
import { readAdminRouteSnapshot, useAdminRouteSnapshot } from './adminRouteState';
import {
  UserWorkspaceSection,
  buildUserWorkspaceUrl,
  getUserWorkspaceCapabilities,
  parseUserWorkspaceSearch,
  userWorkspaceSections,
} from './adminWorkspacePolicy';
import {
  AdminDashboardRequestError,
  AdminPageInfo,
  AdminUserAction,
  AdminUserDetail,
  AdminUserFilters,
  AdminUserRow,
  AdminUserSummary,
  adjustAdminWallet,
  createAdminUserNote,
  dissolveAdminCouple,
  executeAdminUserAction,
  requestAdminUserDetail,
  requestAdminUsersPage,
  requestAdminUserSummary,
} from './adminDashboardApi';
import { useAdminUserHistory } from './useAdminUserHistory';
import { RepresentativePermissions } from './RepresentativePermissions';
import { DeletionOperationsPanel } from './DeletionOperationsPanel';

type UserQueueState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: AdminUserRow[]; pageInfo: AdminPageInfo };
const emptySummary: AdminUserSummary = { active: 0, pendingAvatars: 0, removed: 0, suspended: 0, total: 0 };
const UserOperationalContext = lazy(() => import('./UserOperationalContext'));

export function UsersPanel({ permissions, user }: { permissions: string[]; user: User }) {
  const { notify } = useAdminFeedback();
  const initialRoute = parseUserWorkspaceSearch(window.location.search);
  const restored = useRef(readAdminRouteSnapshot<{ filters: AdminUserFilters; queue: UserQueueState; searchDraft: string; summary: AdminUserSummary }>('users')).current;
  const [filters, setFilters] = useState<AdminUserFilters>(restored?.value.filters || { search: '' });
  const [searchDraft, setSearchDraft] = useState(restored?.value.searchDraft || '');
  const [queue, setQueue] = useState<UserQueueState>(restored?.value.queue?.status === 'ready' ? restored.value.queue : { status: 'loading' });
  const [summary, setSummary] = useState<AdminUserSummary>(restored?.value.summary || emptySummary);
  const [selectedUid, setSelectedUid] = useState(initialRoute.uid);
  const [selectedSection, setSelectedSection] = useState<UserWorkspaceSection>(initialRoute.section);
  const version = useRef(0);
  const skipRestoredLoad = useRef(restored?.value.queue?.status === 'ready');

  const loadUsers = useCallback(async (append = false, cursor = '') => {
    const currentVersion = ++version.current;
    if (!append) setQueue({ status: 'loading' });
    try {
      const page = await requestAdminUsersPage(user, { ...filters, cursor });
      if (currentVersion !== version.current) return;
      setQueue((current) => ({ status: 'ready', items: append && current.status === 'ready' ? [...current.items, ...page.items] : page.items, pageInfo: page.pageInfo }));
    } catch (error) {
      if (currentVersion !== version.current) return;
      setQueue({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل المستخدمين.' });
    }
  }, [filters, user]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await requestAdminUserSummary(user)); }
    catch (error) { notify('تعذّر تحديث مؤشرات المستخدمين', { description: error instanceof Error ? error.message : undefined, tone: 'error' }); }
  }, [notify, user]);

  useEffect(() => { if (skipRestoredLoad.current) { skipRestoredLoad.current = false; return; } void loadUsers(); }, [loadUsers]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => {
    const onPopState = () => {
      const route = parseUserWorkspaceSearch(window.location.search);
      setSelectedUid(route.uid);
      setSelectedSection(route.section);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function updateFilter<K extends keyof AdminUserFilters>(key: K, value: AdminUserFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, cursor: '' }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateFilter('search', searchDraft.trim());
  }

  function openUser(uid: string, section: UserWorkspaceSection = 'overview') {
    setSelectedUid(uid);
    setSelectedSection(section);
    writeUserRoute(uid, section);
  }

  function closeUser() {
    setSelectedUid('');
    writeUserRoute('', 'overview');
  }

  function changeSection(section: UserWorkspaceSection) {
    setSelectedSection(section);
    writeUserRoute(selectedUid, section);
  }

  const rows = queue.status === 'ready' ? queue.items : [];
  const routeSnapshot = useMemo(() => ({ filters, queue, searchDraft, summary }), [filters, queue, searchDraft, summary]);
  useAdminRouteSnapshot('users', routeSnapshot, restored?.scrollY || 0);
  const selectedIndex = rows.findIndex((row) => row.uid === selectedUid);
  const previousUid = selectedIndex > 0 ? rows[selectedIndex - 1]!.uid : '';
  const nextUid = selectedIndex >= 0 && selectedIndex < rows.length - 1 ? rows[selectedIndex + 1]!.uid : '';

  return (
    <div className="users-workspace">
      <AdminSectionHeader actions={<button className="secondary-button compact" onClick={() => void Promise.all([loadUsers(), loadSummary()])} type="button">تحديث البيانات</button>} description="إدارة الحسابات والهوية والإشراف والاقتصاد والعلاقات من ملف تشغيلي واحد." eyebrow="إدارة المجتمع" title="مركز عمليات المستخدمين" />
      <UserKpis summary={summary} />
      {permissions.includes('deletions:manage') ? <DeletionOperationsPanel user={user} /> : null}
      <AdminSurface className="user-directory-surface">
        <form className="user-filter-bar" onSubmit={submitSearch}>
          <label className="user-search"><span aria-hidden="true">⌕</span><input aria-label="البحث عن المستخدمين" onChange={(event) => setSearchDraft(event.target.value)} placeholder="الاسم، البريد، UID، Public ID أو الرقم المميز…" value={searchDraft} /></label>
          <select aria-label="حالة الحساب" onChange={(event) => updateFilter('moderationStatus', event.target.value as AdminUserFilters['moderationStatus'])} value={filters.moderationStatus || ''}><option value="">كل حالات الحساب</option><option value="active">نشط</option><option value="suspended">معلّق</option><option value="removed">محظور</option></select>
          <select aria-label="جاهزية الملف" onChange={(event) => updateFilter('profileStatus', event.target.value as AdminUserFilters['profileStatus'])} value={filters.profileStatus || ''}><option value="">كل الملفات</option><option value="ready">جاهز</option><option value="missing">مفقود</option><option value="invalid">يحتاج إصلاحاً</option></select>
          <input aria-label="رمز الدولة" className="user-country-filter" maxLength={2} onChange={(event) => updateFilter('countryCode', event.target.value.toUpperCase())} placeholder="الدولة" value={filters.countryCode || ''} />
          <button className="primary-button compact" type="submit">بحث</button>
        </form>
        <div className="user-advanced-filters">
          <span>تصفية إضافية</span>
          <select aria-label="حالة الصورة" onChange={(event) => updateFilter('avatarStatus', event.target.value as AdminUserFilters['avatarStatus'])} value={filters.avatarStatus || ''}><option value="">كل الصور</option><option value="pending">بانتظار المراجعة</option><option value="clear">معتمدة</option><option value="removed">مرفوضة</option></select>
          <select aria-label="حالة العلاقة" onChange={(event) => updateFilter('relationship', event.target.value as AdminUserFilters['relationship'])} value={filters.relationship || ''}><option value="">كل العلاقات</option><option value="coupled">مرتبط</option><option value="single">غير مرتبط</option></select>
        </div>
        <AdminCollectionState empty={queue.status === 'ready' && rows.length === 0} emptyMessage="لا يوجد مستخدمون مطابقون" error={queue.status === 'error' ? queue.message : undefined} loading={queue.status === 'loading'} loadingMessage="جارٍ تجهيز دليل المستخدمين…" onRetry={() => void loadUsers()}>
          {queue.status === 'ready' ? <>
            <div className="user-table-wrap"><table className="user-directory-table"><thead><tr><th>المستخدم</th><th>حالة الحساب</th><th>الدولة</th><th>Public ID</th><th>المحفظة</th><th>العلاقات</th><th>آخر نشاط</th><th /></tr></thead><tbody>{rows.map((row) => <UserTableRow key={row.uid} onOpen={() => openUser(row.uid)} row={row} />)}</tbody></table></div>
            <div className="user-mobile-list">{rows.map((row) => <UserMobileCard key={row.uid} onOpen={() => openUser(row.uid)} row={row} />)}</div>
            {queue.pageInfo.hasNextPage && queue.pageInfo.nextCursor ? <button className="report-load-more secondary-button" onClick={() => void loadUsers(true, queue.pageInfo.nextCursor || '')} type="button">تحميل المزيد من المستخدمين</button> : null}
          </> : null}
        </AdminCollectionState>
      </AdminSurface>
      {selectedUid ? <UserWorkspace nextUid={nextUid} onChanged={() => Promise.all([loadUsers(), loadSummary()]).then(() => undefined)} onClose={closeUser} onNavigate={(uid) => openUser(uid, selectedSection)} onSectionChange={changeSection} permissions={permissions} previousUid={previousUid} section={selectedSection} targetUid={selectedUid} user={user} /> : null}
    </div>
  );
}

function UserKpis({ summary }: { summary: AdminUserSummary }) {
  const items = [{ label: 'إجمالي المستخدمين', value: summary.total, tone: 'gold', detail: 'حساب مسجل' }, { label: 'حسابات نشطة', value: summary.active, tone: 'green', detail: 'وصول طبيعي' }, { label: 'قيود نشطة', value: summary.suspended + summary.removed, tone: 'red', detail: `${summary.suspended.toLocaleString('ar-IQ')} معلّق` }, { label: 'صور تحتاج مراجعة', value: summary.pendingAvatars, tone: 'purple', detail: 'طابور الهوية' }];
  return <div className="user-kpi-grid">{items.map((item) => <article className={`user-kpi tone-${item.tone}`} key={item.label}><span className="user-kpi-icon" /><div><small>{item.label}</small><strong>{item.value.toLocaleString('ar-IQ')}</strong><p>{item.detail}</p></div></article>)}</div>;
}

function UserTableRow({ onOpen, row }: { onOpen: () => void; row: AdminUserRow }) {
  return <tr onDoubleClick={onOpen}><td><button className="user-identity-cell" onClick={onOpen} type="button"><Avatar row={row} /><span><strong>{row.displayName || 'مستخدم بلا اسم'}</strong><small dir="ltr">{row.email || row.uid}</small></span></button></td><td><UserStatus status={row.moderationStatus} /><small className={`profile-readiness readiness-${row.publicProfileStatus}`}>{profileStatusLabel(row.publicProfileStatus)}</small></td><td>{row.countryCode || '—'}</td><td><span className="user-public-id" dir="ltr">{row.specialId || row.publicId || '—'}</span></td><td><span className="wallet-inline">{row.walletCoins.toLocaleString('ar-IQ')} ◈</span><small>{row.walletDiamonds.toLocaleString('ar-IQ')} ماسة</small></td><td><span>{row.friendCount.toLocaleString('ar-IQ')} صديق</span><small>{row.coupleLevel > 0 ? 'مرتبط' : 'غير مرتبط'}</small></td><td><time dateTime={row.updatedAt}>{relativeTime(row.updatedAt)}</time></td><td><button aria-label={`فتح ملف ${row.displayName || row.uid}`} className="report-open-button" onClick={onOpen} type="button">←</button></td></tr>;
}

function UserMobileCard({ onOpen, row }: { onOpen: () => void; row: AdminUserRow }) {
  return <button className="user-mobile-card" onClick={onOpen} type="button"><Avatar row={row} /><span><strong>{row.displayName || 'مستخدم بلا اسم'}</strong><small>{row.publicId || row.uid}</small></span><UserStatus status={row.moderationStatus} /><b>←</b></button>;
}

function UserWorkspace({ nextUid, onChanged, onClose, onNavigate, onSectionChange, permissions, previousUid, section, targetUid, user }: { nextUid: string; onChanged: () => Promise<void>; onClose: () => void; onNavigate: (uid: string) => void; onSectionChange: (section: UserWorkspaceSection) => void; permissions: string[]; previousUid: string; section: UserWorkspaceSection; targetUid: string; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: AdminUserDetail }>({ status: 'loading' });
  const [moderationReason, setModerationReason] = useState('');
  const [durationHours, setDurationHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const { canAddNotes, canManageEconomy, canManageRepresentative, canManageUsers } = getUserWorkspaceCapabilities(permissions);
  useAdminDialogFocus(true, onClose, '.user-drawer');

  const loadDetail = useCallback(async () => {
    setState({ status: 'loading' });
    try { setState({ status: 'ready', detail: await requestAdminUserDetail(user, targetUid) }); }
    catch (error) { setState({ status: 'error', message: error instanceof Error ? error.message : 'تعذّر تحميل ملف المستخدم.' }); }
  }, [targetUid, user]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function runUserAction(userAction: AdminUserAction) {
    if (state.status !== 'ready' || !canManageUsers) return;
    if (moderationReason.trim().length < 2) { notify('اكتب سبباً واضحاً للإجراء', { tone: 'error' }); return; }
    const destructive = ['ban', 'force-sign-out', 'suspend', 'avatar-reject'].includes(userAction);
    const approved = await confirm({ confirmLabel: actionLabel(userAction), description: `سيُطبق الإجراء على ${state.detail.profile.displayName || targetUid} وسيُسجل السبب: ${moderationReason.trim()}`, destructive, title: `${actionLabel(userAction)}؟` });
    if (!approved) return;
    setBusy(true);
    try {
      await executeAdminUserAction(user, { durationHours: Number(durationHours), expectedUpdatedAt: state.detail.profile.updatedAt, reason: moderationReason.trim(), targetUid, userAction });
      setModerationReason('');
      notify('تم تحديث ملف المستخدم', { description: actionLabel(userAction), tone: 'success' });
      await Promise.all([loadDetail(), onChanged()]);
    } catch (error) {
      const conflict = error instanceof AdminDashboardRequestError && error.status === 409;
      notify(conflict ? 'تغير الملف بواسطة مشرف آخر' : 'تعذّر تنفيذ الإجراء', { description: error instanceof Error ? error.message : undefined, tone: 'error' });
      if (conflict) await loadDetail();
    } finally { setBusy(false); }
  }

  async function copyValue(label: string, value: string) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); notify(`تم نسخ ${label}`, { tone: 'success' }); }
    catch { notify('تعذّر النسخ', { tone: 'error' }); }
  }

  return <div className="user-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside aria-label="ملف المستخدم" aria-modal="true" className="user-drawer" role="dialog">
    <header className="user-drawer-header"><div><p className="eyebrow">ملف تشغيلي موحّد</p><h3>مساحة المستخدم</h3><small dir="ltr">{targetUid}</small></div><div className="user-workspace-controls"><button aria-label="المستخدم السابق" disabled={!previousUid} onClick={() => onNavigate(previousUid)} type="button">→</button><button aria-label="المستخدم التالي" disabled={!nextUid} onClick={() => onNavigate(nextUid)} type="button">←</button><button aria-label="إغلاق ملف المستخدم" onClick={onClose} type="button">×</button></div></header>
    {state.status === 'loading' ? <div className="user-drawer-state"><span className="state-spinner" /> جارٍ تحميل الملف…</div> : null}
    {state.status === 'error' ? <div className="user-drawer-state error"><strong>تعذّر فتح الملف</strong><p>{state.message}</p><button className="secondary-button compact" onClick={() => void loadDetail()} type="button">إعادة المحاولة</button></div> : null}
    {state.status === 'ready' ? <div className="user-dossier-body">
      <UserIdentityRail detail={state.detail} onCopy={copyValue} />
      <main className="user-dossier-main"><nav className="user-drawer-tabs" aria-label="أقسام ملف المستخدم">{userWorkspaceSections.map((item) => <button className={section === item ? 'selected' : ''} key={item} onClick={() => onSectionChange(item)} type="button">{sectionLabel(item)}</button>)}</nav><div className="user-tab-content">
        {section === 'overview' ? <><UserDataWarning message={state.detail.context.errors.notifications} /><OverviewSection detail={state.detail} onCopy={copyValue} onOpenRepresentative={() => onSectionChange('representative')} /></> : null}
        {section === 'moderation' ? <ModerationSection busy={busy} canManage={canManageUsers} detail={state.detail} durationHours={durationHours} onAction={runUserAction} onDurationChange={setDurationHours} onReasonChange={setModerationReason} reason={moderationReason} /> : null}
        {section === 'economy' ? <><UserDataWarning message={state.detail.context.errors.economy} /><EconomySection canManage={canManageEconomy} detail={state.detail} onChanged={async () => { await Promise.all([loadDetail(), onChanged()]); }} user={user} /></> : null}
        {section === 'representative' ? <RepresentativeSection canManage={canManageRepresentative} detail={state.detail} onChanged={async () => { await Promise.all([loadDetail(), onChanged()]); }} user={user} /> : null}
        {section === 'social' ? <SocialSection canManage={canManageUsers} detail={state.detail} onChanged={async () => { await Promise.all([loadDetail(), onChanged()]); }} onOpenUser={onNavigate} user={user} /> : null}
        {section === 'notes' ? <><UserDataWarning message={state.detail.context.errors.notes} /><NotesSection canAdd={canAddNotes} detail={state.detail} onChanged={loadDetail} user={user} /></> : null}
        {section === 'activity' ? <><UserDataWarning message={state.detail.context.errors.activity} /><ActivitySection detail={state.detail} /></> : null}
      </div></main>
    </div> : null}
  </aside></div>;
}

function UserIdentityRail({ detail, onCopy }: { detail: AdminUserDetail; onCopy: (label: string, value: string) => Promise<void> }) {
  const profile = detail.profile;
  const attention = [profile.publicProfileStatus !== 'ready' ? profileHealthLabel(profile.profileHealthReason) : '', detail.account.disabled ? 'الحساب معطّل' : '', profile.avatarModerationStatus === 'pending' ? 'الصورة بانتظار المراجعة' : '', detail.restrictions.mutedUntil && new Date(detail.restrictions.mutedUntil).getTime() > Date.now() ? 'كتم صوت نشط' : ''].filter(Boolean);
  return <aside className="user-identity-rail"><div className="user-identity-portrait"><Avatar large row={profile} /><UserStatus status={profile.moderationStatus} /></div><h4>{profile.displayName || 'مستخدم بلا اسم'}</h4><p dir="ltr">{profile.email || '—'}</p><div className="user-identity-facts"><CopyFact label="UID" onCopy={onCopy} value={profile.uid} /><CopyFact label="Public ID" onCopy={onCopy} value={profile.publicId} /><CopyFact label="الرقم المميز" onCopy={onCopy} value={profile.specialId} /><span><small>الدولة</small><strong>{profile.countryCode || '—'}</strong></span><span><small>عمر الحساب</small><strong>{accountAge(detail.account.createdAt || profile.createdAt)}</strong></span><span><small>آخر تسجيل دخول</small><strong>{relativeTime(detail.account.lastSignInAt)}</strong></span><span><small>الوكيل المعتمد</small><strong>{detail.representative.active ? representativeCurrencyLabel(detail) : 'غير معيّن'}</strong></span></div><div className={`user-attention-panel${attention.length ? ' has-alerts' : ''}`}><strong>{attention.length ? 'يحتاج انتباهاً' : 'لا توجد إشارات حرجة'}</strong>{attention.map((item) => <small key={item}>{item}</small>)}</div></aside>;
}

function CopyFact({ label, onCopy, value }: { label: string; onCopy: (label: string, value: string) => Promise<void>; value: string }) {
  return <span><small>{label}</small><button disabled={!value} onClick={() => void onCopy(label, value)} title={`نسخ ${label}`} type="button"><b dir="ltr">{value || '—'}</b><i aria-hidden="true">⧉</i></button></span>;
}

function OverviewSection({ detail, onCopy, onOpenRepresentative }: { detail: AdminUserDetail; onCopy: (label: string, value: string) => Promise<void>; onOpenRepresentative: () => void }) {
  const p = detail.profile;
  const preferences = detail.notifications.preferences;
  const representative = detail.representative;
  return <div className="user-overview-layout"><section className="user-profile-health"><div><p className="eyebrow">صحة الملف</p><h4>{profileHealthLabel(p.profileHealthReason)}</h4><span>{profileHealthDescription(p.profileHealthReason)}</span></div><AdminStatusBadge tone={p.publicProfileStatus === 'ready' ? 'success' : 'warning'}>{profileStatusLabel(p.publicProfileStatus)}</AdminStatusBadge></section><section className="user-action-card representative-overview-card"><div className="user-card-heading"><div><p className="eyebrow">الوكلاء المعتمدون</p><h4>{representative.active ? 'هذا الحساب وكيل نشط' : 'هذا الحساب ليس وكيلاً'}</h4><span>{representative.active ? `العملات المسموحة: ${representativeCurrencyLabel(detail)}` : 'افتح تبويب الوكيل لتعيينه أو مراجعة الصلاحيات.'}</span></div><AdminStatusBadge tone={representative.active ? 'success' : 'neutral'}>{representative.active ? 'وكيل نشط' : 'غير معيّن'}</AdminStatusBadge></div><button className="secondary-button compact" onClick={onOpenRepresentative} type="button">{representative.active ? 'إدارة صلاحية الوكيل' : 'تعيين وكيل'}</button></section><div className="user-detail-grid"><DetailCard title="الهوية العامة" rows={[["النبذة", p.bio || 'لا توجد نبذة'], ['الجنس', genderLabel(p.gender)], ['حالة الصورة', avatarStatusLabel(p.avatarModerationStatus)], ['آخر تحديث', formatDateTime(p.updatedAt)]]} /><DetailCard title="الحساب والوصول" rows={[["البريد موثّق", detail.account.emailVerified ? 'نعم' : 'لا'], ['الحساب معطّل', detail.account.disabled ? 'نعم' : 'لا'], ['إنشاء الحساب', formatDateTime(detail.account.createdAt)], ['صلاحية الرموز بعد', formatDateTime(detail.account.tokensValidAfterAt)]]} /><DetailCard title="المجتمع" rows={[["الأصدقاء", p.friendCount.toLocaleString('ar-IQ')], ['نقاط الهدايا', p.giftScore.toLocaleString('ar-IQ')], ['العلاقة', p.coupleLevel > 0 ? 'مرتبط' : 'غير مرتبط'], ['مستوى الارتباط', p.coupleLevel.toLocaleString('ar-IQ')]]} /><DetailCard title="الإشعارات والأجهزة" rows={[["طلبات الصداقة", enabledLabel(preferences.friendRequests)], ['طلبات الارتباط', enabledLabel(preferences.coupleRequests)], ['الهدايا', enabledLabel(preferences.gifts)], ['تحويلات المحفظة', enabledLabel(preferences.walletTransfers)], ['الأجهزة المسجلة', detail.notifications.registeredDeviceCount.toLocaleString('ar-IQ')]]} /></div><section className="user-quick-identifiers"><div><span>UID</span><b dir="ltr">{p.uid}</b><button onClick={() => void onCopy('UID', p.uid)} type="button">نسخ</button></div><div><span>Public ID</span><b dir="ltr">{p.publicId || '—'}</b><button disabled={!p.publicId} onClick={() => void onCopy('Public ID', p.publicId)} type="button">نسخ</button></div></section></div>;
}

function ModerationSection({ busy, canManage, detail, durationHours, onAction, onDurationChange, onReasonChange, reason }: { busy: boolean; canManage: boolean; detail: AdminUserDetail; durationHours: string; onAction: (action: AdminUserAction) => Promise<void>; onDurationChange: (value: string) => void; onReasonChange: (value: string) => void; reason: string }) {
  const status = detail.profile.moderationStatus;
  const isMuted = Boolean(detail.restrictions.mutedUntil && new Date(detail.restrictions.mutedUntil).getTime() > Date.now());
  const pendingAvatar = detail.avatarSubmission;
  return <div className="user-moderation-page"><div className="user-moderation-layout"><section className="user-action-card"><div className="user-card-heading"><div><p className="eyebrow">قرار الإشراف</p><h4>إجراءات الحساب</h4></div><UserStatus status={status} /></div>{canManage ? <><label>سبب الإجراء<textarea onChange={(event) => onReasonChange(event.target.value)} placeholder="اكتب السبب والسياق الذي يبرر القرار…" rows={4} value={reason} /></label><label>مدة الكتم<select disabled={isMuted} onChange={(event) => onDurationChange(event.target.value)} value={durationHours}><option value="1">ساعة</option><option value="6">6 ساعات</option><option value="24">24 ساعة</option><option value="72">3 أيام</option><option value="168">7 أيام</option><option value="720">30 يوماً</option></select></label><div className="user-moderation-actions"><button disabled={busy} onClick={() => void onAction('warn')} type="button">تسجيل تنبيه داخلي</button>{isMuted ? <button className="warning" disabled={busy} onClick={() => void onAction('unmute')} type="button">رفع كتم الصوت</button> : <button disabled={busy} onClick={() => void onAction('mute')} type="button">كتم الصوت</button>}{status === 'active' ? <button className="warning" disabled={busy} onClick={() => void onAction('suspend')} type="button">تعليق الحساب</button> : null}{status === 'suspended' ? <button disabled={busy} onClick={() => void onAction('unsuspend')} type="button">رفع التعليق</button> : null}{status !== 'removed' ? <button className="danger" disabled={busy} onClick={() => void onAction('ban')} type="button">حظر الحساب</button> : <button className="warning" disabled={busy} onClick={() => void onAction('unban')} type="button">رفع الحظر</button>}<button className="danger-outline" disabled={busy} onClick={() => void onAction('force-sign-out')} type="button">إنهاء الجلسات</button></div></> : <ReadOnlyNotice />}</section><section className="user-action-card"><div className="user-card-heading"><div><p className="eyebrow">الصورة الشخصية</p><h4>مراجعة الهوية البصرية</h4></div><AdminStatusBadge tone={pendingAvatar ? 'warning' : 'success'}>{pendingAvatar ? 'بانتظار المراجعة' : 'لا يوجد طلب معلّق'}</AdminStatusBadge></div><div className="avatar-review-preview">{pendingAvatar?.previewUrl ? <img alt="الصورة الشخصية المعلّقة" className="user-avatar large" src={pendingAvatar.previewUrl} /> : <Avatar large row={detail.profile} />}<p>{pendingAvatar ? `الفاحص: ${pendingAvatar.scanner} · السبب: ${pendingAvatar.moderationReason || 'نتيجة غير حاسمة'} · ${Math.ceil(pendingAvatar.sizeBytes / 1024)} KB` : detail.profile.avatarUrl ? 'الصورة المعتمدة الحالية.' : 'لا توجد صورة معلّقة أو معتمدة.'}</p></div>{canManage && pendingAvatar ? <div className="user-moderation-actions"><button disabled={busy} onClick={() => void onAction('avatar-approve')} type="button">اعتماد الصورة</button><button className="danger-outline" disabled={busy || !reason.trim()} onClick={() => void onAction('avatar-reject')} type="button">رفض الصورة مع السبب</button></div> : null}</section></div><OperationalContextFallback><UserOperationalContext detail={detail} section="moderation" /></OperationalContextFallback></div>;
}

function EconomySection({ canManage, detail, onChanged, user }: { canManage: boolean; detail: AdminUserDetail; onChanged: () => Promise<void>; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'coins' | 'diamonds'>('coins');
  const [mutationType, setMutationType] = useState<'credit' | 'debit'>('credit');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    const approved = await confirm({ confirmLabel: mutationType === 'credit' ? 'إضافة الرصيد' : 'خصم الرصيد', description: `سيتم ${mutationType === 'credit' ? 'إضافة' : 'خصم'} ${Number(amount).toLocaleString('ar-IQ')} من ${currency === 'coins' ? 'العملات' : 'الماس'} وتسجيل الرصيد قبل/بعد.`, destructive: mutationType === 'debit', title: 'تأكيد تعديل المحفظة؟' });
    if (!approved) return;
    setBusy(true);
    try { await adjustAdminWallet(user, { amount: Number(amount), currency, expectedUpdatedAt: detail.wallet.updatedAt, mutationType, note: note.trim(), targetUid: detail.profile.uid }); setAmount(''); setNote(''); notify('تم تعديل المحفظة', { tone: 'success' }); await onChanged(); }
    catch (error) { notify('تعذّر تعديل المحفظة', { description: error instanceof Error ? error.message : undefined, tone: 'error' }); }
    finally { setBusy(false); }
  }
  return <div className="economy-tab"><div className="wallet-balance-grid"><article><small>العملات</small><strong>{detail.wallet.balances.coins.toLocaleString('ar-IQ')}</strong><p>الداخل {detail.wallet.lifetimeCredit.coins.toLocaleString('ar-IQ')} · الخارج {detail.wallet.lifetimeDebit.coins.toLocaleString('ar-IQ')}</p></article><article><small>الماس</small><strong>{detail.wallet.balances.diamonds.toLocaleString('ar-IQ')}</strong><p>الداخل {detail.wallet.lifetimeCredit.diamonds.toLocaleString('ar-IQ')} · الخارج {detail.wallet.lifetimeDebit.diamonds.toLocaleString('ar-IQ')}</p></article></div>{canManage ? <form className="wallet-adjustment-form" onSubmit={submit}><div className="user-card-heading"><div><p className="eyebrow">قيد مالي موثّق</p><h4>تعديل المحفظة</h4></div></div><select onChange={(event) => setMutationType(event.target.value as 'credit' | 'debit')} value={mutationType}><option value="credit">إضافة</option><option value="debit">خصم</option></select><select onChange={(event) => setCurrency(event.target.value as 'coins' | 'diamonds')} value={currency}><option value="coins">عملات</option><option value="diamonds">ماس</option></select><input min="1" onChange={(event) => setAmount(event.target.value)} placeholder="المبلغ" type="number" value={amount} /><input onChange={(event) => setNote(event.target.value)} placeholder="سبب التعديل (إلزامي)" value={note} /><button className={mutationType === 'debit' ? 'danger' : ''} disabled={busy || Number(amount) < 1 || note.trim().length < 2} type="submit">تنفيذ التعديل</button></form> : <ReadOnlyNotice />}<TransactionList transactions={detail.wallet.transactions} /><OperationalContextFallback><UserOperationalContext detail={detail} section="economy" /></OperationalContextFallback></div>;
}

function RepresentativeSection({ canManage, detail, onChanged, user }: { canManage: boolean; detail: AdminUserDetail; onChanged: () => Promise<void>; user: User }) {
  return <div className="representative-tab"><RepresentativePermissions canManage={canManage} detail={detail} onChanged={onChanged} user={user} /></div>;
}

function SocialSection({ canManage, detail, onChanged, onOpenUser, user }: { canManage: boolean; detail: AdminUserDetail; onChanged: () => Promise<void>; onOpenUser: (uid: string) => void; user: User }) {
  const { confirm, notify } = useAdminFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function dissolve() { if (!canManage || reason.trim().length < 2) return; const approved = await confirm({ confirmLabel: 'فك الارتباط', description: `سيتم إنهاء العلاقة بين المستخدم و${detail.couple.partner?.displayName || 'الطرف الآخر'}. السبب: ${reason.trim()}`, destructive: true, title: 'تأكيد فك الارتباط؟' }); if (!approved) return; setBusy(true); try { await dissolveAdminCouple(user, detail.profile.uid, reason.trim()); setReason(''); notify('تم فك الارتباط', { tone: 'success' }); await onChanged(); } catch (error) { notify('تعذّر فك الارتباط', { description: error instanceof Error ? error.message : undefined, tone: 'error' }); } finally { setBusy(false); } }
  return <div className="social-tab"><section className="user-action-card"><div className="user-card-heading"><div><p className="eyebrow">العلاقات</p><h4>حالة الارتباط</h4></div><AdminStatusBadge tone={detail.couple.partner ? 'info' : 'neutral'}>{detail.couple.partner ? 'مرتبط' : 'غير مرتبط'}</AdminStatusBadge></div>{detail.couple.partner ? <div className="partner-card"><div><strong>{detail.couple.partner.displayName || 'طرف بلا اسم'}</strong><small>Public ID: {detail.couple.partner.publicId || '—'}</small><button className="user-link-button" dir="ltr" onClick={() => onOpenUser(detail.couple.partner!.uid)} type="button">{detail.couple.partner.uid}</button></div>{canManage ? <div className="partner-danger-zone"><input onChange={(event) => setReason(event.target.value)} placeholder="سبب فك الارتباط (إلزامي)" value={reason} /><button className="danger-button compact" disabled={busy || reason.trim().length < 2} onClick={() => void dissolve()} type="button">فك الارتباط</button></div> : null}</div> : <p className="user-empty-copy">لا توجد علاقة نشطة لهذا المستخدم.</p>}</section><section className="user-action-card"><div className="user-card-heading"><div><p className="eyebrow">شبكة المستخدم</p><h4>ملخص المجتمع</h4></div></div><div className="social-stat-row"><span>الأصدقاء <strong>{detail.profile.friendCount.toLocaleString('ar-IQ')}</strong></span><span>نقاط الهدايا <strong>{detail.profile.giftScore.toLocaleString('ar-IQ')}</strong></span><span>مستوى الارتباط <strong>{detail.profile.coupleLevel.toLocaleString('ar-IQ')}</strong></span></div></section><OperationalContextFallback><UserOperationalContext detail={detail} onOpenUser={onOpenUser} section="social" /></OperationalContextFallback></div>;
}

function OperationalContextFallback({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="user-context-loading"><span className="state-spinner" /> جارٍ تجهيز السياق التشغيلي…</div>}>{children}</Suspense>;
}

function NotesSection({ canAdd, detail, onChanged, user }: { canAdd: boolean; detail: AdminUserDetail; onChanged: () => Promise<void>; user: User }) {
  const { notify } = useAdminFeedback();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useAdminUserHistory({ initialItems: detail.notes, mayHaveMore: detail.notes.length >= detail.context.limits.perSection, section: 'notes', targetUid: detail.profile.uid });
  async function save() { if (!canAdd || note.trim().length < 2) return; setBusy(true); try { await createAdminUserNote(user, detail.profile.uid, note.trim()); setNote(''); notify('تم حفظ الملاحظة الداخلية', { tone: 'success' }); await onChanged(); } catch (error) { notify('تعذّر حفظ الملاحظة', { description: error instanceof Error ? error.message : undefined, tone: 'error' }); } finally { setBusy(false); } }
  return <div className="notes-tab">{canAdd ? <section className="user-action-card"><div className="user-card-heading"><div><p className="eyebrow">ملاحظة داخلية</p><h4>إضافة ملاحظة</h4></div></div><textarea onChange={(event) => setNote(event.target.value)} placeholder="اكتب ملاحظة لفريق العمليات فقط…" rows={4} value={note} /><button disabled={busy || note.trim().length < 2} onClick={() => void save()} type="button">حفظ الملاحظة</button></section> : <ReadOnlyNotice />}<ol className="user-timeline">{history.items.map((item) => <li key={item.id}><span /><div><strong>{item.actorEmail || item.actorUid || 'مشرف'}</strong><p>{item.note}</p><small>{formatDateTime(item.createdAt)}</small></div></li>)}</ol>{history.items.length === 0 ? <p className="user-empty-copy">لا توجد ملاحظات داخلية بعد.</p> : null}<UserTimelinePagination {...history} /></div>;
}

function ActivitySection({ detail }: { detail: AdminUserDetail }) {
  const history = useAdminUserHistory({ initialItems: detail.activity, mayHaveMore: detail.activity.length >= detail.context.limits.perSection, section: 'activity', targetUid: detail.profile.uid });
  return <div><div className="activity-section-heading"><div><p className="eyebrow">سجل موثّق</p><h4>آخر النشاطات الإدارية</h4></div><a href={`/audit?target=${encodeURIComponent(detail.profile.uid)}`}>فتح سجل التدقيق الكامل ←</a></div><ol className="user-timeline">{history.items.map((event) => <li key={event.id}><span /><div><a className="user-timeline-event-link" href={`/audit?event=${encodeURIComponent(event.id)}`}>{activityLabel(event.action)}</a><p>{event.note || event.kind || 'إجراء إداري'}</p><small>{event.actorEmail || event.actorUid || 'مشرف'} · {formatDateTime(event.createdAt)}</small></div></li>)}</ol>{history.items.length === 0 ? <p className="user-empty-copy">لا توجد أحداث إدارية لهذا المستخدم.</p> : null}<UserTimelinePagination {...history} /></div>;
}

function UserTimelinePagination({ error, hasNextPage, loadMore, status }: { error: string; hasNextPage: boolean; loadMore: () => Promise<void>; status: 'idle' | 'loading' | 'error' }) {
  if (!hasNextPage && !error) return null;
  return <div aria-busy={status === 'loading'} aria-live="polite" className={`user-timeline-pagination${error ? ' has-error' : ''}`}><span>{error || 'يُحمّل السجل الأقدم عند الطلب فقط.'}</span><button disabled={status === 'loading'} onClick={() => void loadMore()} type="button">{status === 'loading' ? 'جارٍ التحميل…' : error ? 'إعادة المحاولة' : 'تحميل الأقدم'}</button></div>;
}

function TransactionList({ transactions }: { transactions: AdminUserDetail['wallet']['transactions'] }) {
  return <section className="transaction-list"><div className="user-card-heading"><div><p className="eyebrow">حركة موثّقة</p><h4>آخر القيود</h4></div><span>{transactions.length.toLocaleString('ar-IQ')}</span></div>{transactions.map((item) => { const storeItem = ['store', 'store-gift'].includes(item.source) && item.referenceId; const href = storeItem ? `/store?item=${encodeURIComponent(item.referenceId)}` : `/audit?target=${encodeURIComponent(item.uid)}`; return <article key={item.id}><span className={`transaction-type type-${item.type}`}>{item.type === 'debit' || item.type === 'purchase' ? '−' : '+'}</span><div><strong>{item.amount.toLocaleString('ar-IQ')} {item.currency === 'diamonds' ? 'ماسة' : 'عملة'}</strong><small>{item.note || item.source}</small></div><div><b>{item.balanceAfter.toLocaleString('ar-IQ')}</b><small>{formatDateTime(item.createdAt)}</small><a href={href}>{storeItem ? 'فتح العنصر' : 'سجل التدقيق'} ←</a></div></article>; })}{transactions.length === 0 ? <p className="user-empty-copy">لا توجد قيود مالية.</p> : null}</section>;
}

function DetailCard({ rows, title }: { rows: Array<[string, string]>; title: string }) { return <section className="user-detail-card"><h4>{title}</h4><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>; }
function ReadOnlyNotice() { return <div className="user-readonly-notice"><strong>عرض فقط</strong><span>دورك يتيح مراجعة البيانات ولا يتيح تنفيذ هذا الإجراء.</span></div>; }
function UserDataWarning({ message }: { message?: string }) { return message ? <div className="user-data-warning" role="status"><span>!</span><p>{message}</p></div> : null; }
function Avatar({ large = false, row }: { large?: boolean; row: AdminUserRow }) { return row.avatarUrl ? <img alt="" className={`user-avatar${large ? ' large' : ''}`} src={row.avatarUrl} /> : <span className={`user-avatar fallback${large ? ' large' : ''}`}>{row.avatarLabel || row.displayName.slice(0, 1) || '?'}</span>; }
function UserStatus({ status }: { status: string }) { const label = status === 'suspended' ? 'معلّق' : status === 'removed' ? 'محظور' : status === 'active' ? 'نشط' : 'غير معروف'; const tone = status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'danger'; return <AdminStatusBadge tone={tone}>{label}</AdminStatusBadge>; }
function profileStatusLabel(status: AdminUserRow['publicProfileStatus']) { return status === 'ready' ? 'جاهز' : status === 'missing' ? 'مفقود' : 'يحتاج إصلاحاً'; }
function profileHealthLabel(reason: AdminUserRow['profileHealthReason']) { return ({ 'invalid-profile': 'بيانات الملف غير مكتملة', 'invalid-reservation': 'حجز Public ID غير صالح', 'missing-profile': 'الملف العام مفقود', ready: 'الهوية سليمة ومترابطة' } as const)[reason]; }
function profileHealthDescription(reason: AdminUserRow['profileHealthReason']) { return ({ 'invalid-profile': 'راجع حقول الملف العام وصيغ البيانات المطلوبة.', 'invalid-reservation': 'Public ID لا يطابق حجز الهوية أو أن الحجز مفقود.', 'missing-profile': 'الحساب موجود لكن الملف العام لم يُنشأ بعد.', ready: 'الملف العام وحجز الهوية متوافقان.' } as const)[reason]; }
function avatarStatusLabel(status: string) { return status === 'clear' ? 'معتمدة' : status === 'pending' ? 'بانتظار المراجعة' : status === 'removed' ? 'مرفوضة' : 'غير معروفة'; }
function sectionLabel(section: UserWorkspaceSection) { return ({ overview: 'نظرة عامة', moderation: 'السلامة', economy: 'الاقتصاد', representative: 'الوكيل', social: 'العلاقات', notes: 'الملاحظات', activity: 'النشاط' } as Record<UserWorkspaceSection, string>)[section]; }
function representativeCurrencyLabel(detail: AdminUserDetail) {
  const currencies = [
    detail.representative.currencies.coins ? 'عملات' : '',
    detail.representative.currencies.diamonds ? 'ماس' : '',
  ].filter(Boolean);
  return currencies.length ? currencies.join(' · ') : 'بدون عملة';
}
function actionLabel(action: AdminUserAction) { return ({ 'avatar-approve': 'اعتماد الصورة', 'avatar-reject': 'رفض الصورة', ban: 'حظر الحساب', 'force-sign-out': 'إنهاء الجلسات', mute: 'كتم الصوت', note: 'حفظ الملاحظة', suspend: 'تعليق الحساب', unban: 'رفع الحظر', unmute: 'رفع كتم الصوت', unsuspend: 'رفع التعليق', warn: 'تسجيل تنبيه داخلي' } as Record<AdminUserAction, string>)[action]; }
function activityLabel(action: string) { return action.startsWith('user-') ? actionLabel(action.slice(5) as AdminUserAction) : action || 'إجراء إداري'; }
function genderLabel(value: AdminUserRow['gender']) { return value === 'male' ? 'ذكر' : value === 'female' ? 'أنثى' : 'غير محدد'; }
function enabledLabel(value: boolean) { return value ? 'مفعّلة' : 'متوقفة'; }
function relativeTime(value: string) { if (!value) return 'غير معروف'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'غير معروف'; const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000)); if (minutes < 60) return `منذ ${minutes.toLocaleString('ar-IQ')} د`; const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours.toLocaleString('ar-IQ')} س`; return `منذ ${Math.floor(hours / 24).toLocaleString('ar-IQ')} ي`; }
function accountAge(value: string) { if (!value) return 'غير معروف'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'غير معروف'; const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000)); if (days < 30) return `${days.toLocaleString('ar-IQ')} يوم`; const months = Math.floor(days / 30); return months < 12 ? `${months.toLocaleString('ar-IQ')} شهر` : `${Math.floor(months / 12).toLocaleString('ar-IQ')} سنة`; }
function formatDateTime(value: string) { if (!value) return 'غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function writeUserRoute(uid: string, section: UserWorkspaceSection) { window.history.replaceState({}, '', buildUserWorkspaceUrl(window.location.href, uid, section)); }
