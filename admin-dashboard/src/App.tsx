import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { FormEvent, lazy, ReactNode, Suspense, useEffect, useMemo, useState } from 'react';

import { getAdminRouteByKey, getAdminRouteFromPath, primaryAdminRoutes } from './adminRoutes';
import { useAdminFeedback } from './AdminFeedback';
import { AdminErrorBoundary } from './AdminErrorBoundary';
import { AdminCollectionState, AdminSectionHeader, AdminStatusBadge } from './AdminUi';
import {
  requestAdminAuditEvents,
  requestAdminDashboardSession,
  reportAdminClientError,
  requestAdminOverview,
  requestAdminReports,
  requestAdminRooms,
  AdminAuditEventRow,
  AdminDashboardSession,
  AdminOverviewMetrics,
  AdminReportRow,
  AdminRoomAction,
  AdminRoomRow,
  AdminRoomStatusFilter,
  AdminUserRow,
} from './adminDashboardApi';
import { firebaseAuth } from './firebase';

const SettingsPanel = lazy(() => import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel })));
const StoreCatalogPanel = lazy(() => import('./StoreCatalogPanel').then((module) => ({ default: module.StoreCatalogPanel })));
const CosmeticsAssetRegistryPanel = lazy(() => import('./CosmeticsAssetRegistryPanel').then((module) => ({ default: module.CosmeticsAssetRegistryPanel })));
const AuditWorkspace = lazy(() => import('./AuditPanel').then((module) => ({ default: module.AuditWorkspace })));
const ReportsPanel = lazy(() => import('./ReportsPanel').then((module) => ({ default: module.ReportsPanel })));
const RoomsPanel = lazy(() => import('./RoomsPanel').then((module) => ({ default: module.RoomsPanel })));
const UsersPanel = lazy(() => import('./UsersPanel').then((module) => ({ default: module.UsersPanel })));
const RepresentativeOperationsPanel = lazy(() => import('./RepresentativeOperationsPanel').then((module) => ({ default: module.RepresentativeOperationsPanel })));
const IncentivesWorkspacePanel = lazy(() => import('./IncentivesWorkspacePanel').then((module) => ({ default: module.IncentivesWorkspacePanel })));
const AdminPushPanel = lazy(() => import('./AdminPushPanel').then((module) => ({ default: module.AdminPushPanel })));

type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'verifying'; user: User }
  | { status: 'admin'; session: AdminDashboardSession; user: User }
  | { status: 'denied'; message: string; user: User };

type OverviewReportBreakdownState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; open: number; reports: AdminReportRow[]; resolved: number; triage: number }
  | { status: 'error'; message: string };

export function App() {
  const { confirm } = useAdminFeedback();
  const [authState, setAuthState] = useState<AuthState>({ status: 'checking' });
  const [activeRoute, setActiveRoute] = useState(() => getAdminRouteFromPath(window.location.pathname));
  const [overviewState, setOverviewState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; metrics: AdminOverviewMetrics }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [roomsState, setRoomsState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; rooms: AdminRoomRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [overviewReportBreakdown, setOverviewReportBreakdown] = useState<OverviewReportBreakdownState>({ status: 'idle' });
  const [auditState, setAuditState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; auditEvents: AdminAuditEventRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        setAuthState({ status: 'signed-out' });
        return;
      }

      setAuthState({ status: 'verifying', user });

      try {
        const session = await requestAdminDashboardSession(user);
        setAuthState({ status: 'admin', session, user });
      } catch (error) {
        setAuthState({
          status: 'denied',
          message: error instanceof Error ? error.message : 'تم رفض الوصول إلى لوحة الإدارة.',
          user,
        });
      }
    });
  }, []);

  useEffect(() => {
    document.title = `${activeRoute.title} · SDK Heaven`;
  }, [activeRoute.title]);

  useEffect(() => {
    function handlePopState() {
      setActiveRoute(getAdminRouteFromPath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navItems = useMemo(() => primaryAdminRoutes, []);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'overview') {
      return;
    }

    void Promise.all([
      loadOverview(authState.user),
      loadRooms(authState.user, 'active'),
      loadOverviewReportBreakdown(authState.user),
      loadAuditEvents(authState.user, '', ''),
    ]);
  }, [activeRoute.key, authState]);

  function navigateToRoute(route: ReturnType<typeof getAdminRouteByKey>) {
    if (route.path !== window.location.pathname) {
      window.history.pushState({}, '', route.path);
    }

    setActiveRoute(route);
  }

  async function handleSignOut() {
    const confirmed = await confirm({
      confirmLabel: 'تسجيل الخروج',
      description: 'ستنتهي جلسة الإدارة الحالية وستحتاج إلى تسجيل الدخول مرة أخرى.',
      destructive: true,
      title: 'هل تريد تسجيل الخروج؟',
    });
    if (confirmed) await signOut(firebaseAuth);
  }

  async function loadOverview(user: User) {
    setOverviewState({ status: 'loading' });

    try {
      const metrics = await requestAdminOverview(user);
      setOverviewState({ status: 'ready', metrics });
    } catch (error) {
      setOverviewState({
        status: 'error',
        message: error instanceof Error ? error.message : 'ملخص لوحة الإدارة غير متاح.',
      });
    }
  }

  async function loadRooms(user: User, status: AdminRoomStatusFilter) {
    setRoomsState({ status: 'loading' });

    try {
      const rooms = await requestAdminRooms(user, status);
      setRoomsState({ status: 'ready', rooms });
    } catch (error) {
      setRoomsState({
        status: 'error',
        message: error instanceof Error ? error.message : 'بيانات الغرف غير متاحة.',
      });
    }
  }

  async function loadOverviewReportBreakdown(user: User) {
    setOverviewReportBreakdown({ status: 'loading' });
    try {
      const [openReports, triageReports, resolvedReports] = await Promise.all([
        requestAdminReports(user, 'open'),
        requestAdminReports(user, 'triage'),
        requestAdminReports(user, 'resolved'),
      ]);
      setOverviewReportBreakdown({
        status: 'ready',
        open: openReports.length,
        reports: [...openReports, ...triageReports].slice(0, 5),
        resolved: resolvedReports.length,
        triage: triageReports.length,
      });
    } catch (error) {
      setOverviewReportBreakdown({
        status: 'error',
        message: error instanceof Error ? error.message : 'تعذّر تحميل توزيع البلاغات.',
      });
    }
  }

  async function loadAuditEvents(user: User, actorUid: string, kind: string) {
    setAuditState({ status: 'loading' });

    try {
      const auditEvents = await requestAdminAuditEvents(user, { actorUid, kind });
      setAuditState({ status: 'ready', auditEvents });
    } catch (error) {
      setAuditState({
        status: 'error',
        message: error instanceof Error ? error.message : 'أحداث سجل التدقيق غير متاحة.',
      });
    }
  }

  if (authState.status === 'checking' || authState.status === 'verifying') {
    return <StatusScreen title="جارٍ التحقق من الصلاحية" detail="نتحقق من جلسة Firebase وصلاحيات حساب الإدارة." />;
  }

  if (authState.status === 'signed-out') {
    return <LoginScreen />;
  }

  if (authState.status === 'denied') {
    return (
      <StatusScreen
        title="الوصول مرفوض"
        detail={authState.message}
        actionLabel="تسجيل الخروج"
        onAction={() => void signOut(firebaseAuth)}
      />
    );
  }

  const allowedNavItems = navItems.filter((item) => canAccessAdminRoute(authState.session, item.key));
  const routeAllowed = canAccessAdminRoute(authState.session, activeRoute.key);

  return (
    <main className="dashboard-shell" dir="rtl">
      <a className="skip-link" href="#admin-main">تخطّي إلى المحتوى الرئيسي</a>
      <aside className="sidebar">
        <div className="brand-lockup">
          <BrandCrown />
          <div>
            <p className="eyebrow">SDK Heaven</p>
          </div>
        </div>

        <nav aria-label="أقسام لوحة الإدارة">
          {allowedNavItems.map((item) => (
            <button
              className={item.key === activeRoute.key ? 'nav-item active' : 'nav-item'}
              aria-current={item.key === activeRoute.key ? 'page' : undefined}
              key={item.key}
              onClick={() => navigateToRoute(item)}
              type="button"
            >
              <NavIcon routeKey={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            aria-current={activeRoute.key === 'settings' ? 'page' : undefined}
            className={activeRoute.key === 'settings' ? 'nav-item mobile-settings-nav active' : 'nav-item mobile-settings-nav'}
            onClick={() => navigateToRoute(getAdminRouteByKey('settings'))}
            type="button"
          >
            <NavIcon routeKey="settings" />
            <span>الإعدادات</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button aria-current={activeRoute.key === 'settings' ? 'page' : undefined} className={activeRoute.key === 'settings' ? 'settings-button active' : 'settings-button'} onClick={() => navigateToRoute(getAdminRouteByKey('settings'))} type="button">
            <NavIcon routeKey="settings" />
            <span>الإعدادات</span>
          </button>
          <button className="signout-button" onClick={() => void handleSignOut()} type="button">
            <NavIcon routeKey="signout" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="page-title">
            <h2>{activeRoute.title}</h2>
            <p>{activeRoute.subtitle}</p>
            {activeRoute.key === 'overview' && overviewState.status === 'ready' ? <small>آخر تحديث {formatDateTime(overviewState.metrics.generatedAt)}</small> : null}
          </div>
          <div className="topbar-actions">
            <div className="date-chip">{new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium' }).format(new Date())}</div>
            <div className="session-card">
              <div className="session-avatar" aria-hidden="true">م</div>
              <div>
                <span>{translateAdminRole(authState.session.role)}</span>
                <small dir="ltr">{authState.session.email || authState.session.uid}</small>
              </div>
            </div>
          </div>
        </header>

        <section className="panel" id="admin-main" tabIndex={-1}>
          <AdminErrorBoundary onError={(error, info) => { void reportAdminClientError(authState.user, { message: error.message, route: activeRoute.path, source: 'react-error-boundary', stack: `${error.stack || ''}\n${info.componentStack || ''}` }).catch(() => undefined); }} resetKey={activeRoute.key}>
          <Suspense fallback={<AdminCollectionState children={null} empty={false} emptyMessage="" loading loadingMessage="جارٍ تحميل قسم الإدارة…" />}>
          {!routeAllowed ? (
            <AdminCollectionState
              children={null}
              empty
              emptyMessage="هذا القسم غير متاح لدورك الإداري الحالي."
              loading={false}
              loadingMessage=""
            />
          ) : activeRoute.key === 'overview' ? (
            <OverviewPanel
              auditState={auditState}
              onRefresh={() => void Promise.all([
                loadOverview(authState.user),
                loadRooms(authState.user, 'active'),
                loadOverviewReportBreakdown(authState.user),
                loadAuditEvents(authState.user, '', ''),
              ])}
              overviewReportBreakdown={overviewReportBreakdown}
              overviewState={overviewState}
              roomsState={roomsState}
            />
          ) : activeRoute.key === 'users' ? (
            <UsersPanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'rooms' ? (
            <RoomsPanel user={authState.user} />
          ) : activeRoute.key === 'reports' ? (
            <ReportsPanel user={authState.user} />
          ) : activeRoute.key === 'store' ? (
            <StoreCatalogPanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'cosmetics' ? (
            <CosmeticsAssetRegistryPanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'incentives' ? (
            <IncentivesWorkspacePanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'representatives' ? (
            <RepresentativeOperationsPanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'notifications' ? (
            <AdminPushPanel permissions={authState.session.permissions} user={authState.user} />
          ) : activeRoute.key === 'audit' ? (
            <AuditWorkspace user={authState.user} />
          ) : activeRoute.key === 'settings' ? (
            <SettingsPanel session={authState.session} user={authState.user} />
          ) : (
            <>
              <div>
                <p className="eyebrow">الجلسة جاهزة</p>
                <h3>{activeRoute.title}</h3>
                <p>{activeRoute.detail}</p>
              </div>
              <div className="status-grid">
                <StatusTile label="بوابة الدخول" value="فعّالة" />
                <StatusTile label="مصدر الصلاحية" value="Firebase" />
                <StatusTile label="كتابة العميل" value="مرفوضة" />
              </div>
            </>
          )}
          </Suspense>
          </AdminErrorBoundary>
        </section>
      </section>
    </main>
  );
}

function NavIcon({ routeKey }: { routeKey: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect height="7" rx="1" width="7" x="3" y="3" /><rect height="7" rx="1" width="7" x="14" y="3" /><rect height="7" rx="1" width="7" x="3" y="14" /><rect height="7" rx="1" width="7" x="14" y="14" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    rooms: <><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h7v18M14 8h5v13" /><path d="M9 9h1M9 13h1M9 17h1" /></>,
    reports: <><path d="M5 22V4a2 2 0 0 1 2-2h8l4 4v16" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    store: <><path d="M3 9h18l-1 12H4L3 9Z" /><path d="M7 9a5 5 0 0 1 10 0M8 13v4M16 13v4" /></>,
    cosmetics: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
    incentives: <><path d="M12 2c3 3 5 6 5 10a5 5 0 0 1-10 0c0-2 1-4 3-6 0 3 1 4 2 5 1-2 1-5 0-9Z" /><path d="M8 20h8M10 16h4" /></>,
    representatives: <><path d="M4 7h16M7 4l-3 3 3 3M17 14h3v6H4v-6h3" /><circle cx="12" cy="10" r="3" /><path d="M8 17a4 4 0 0 1 8 0" /></>,
    notifications: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    audit: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.39.36.73.66 1 .3.26.68.4 1.07.4H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.5-2.6L20 11M4 13l2.4 4.6A7 7 0 0 0 17.9 15" /></>,
    signout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></>,
  };

  return <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[routeKey]}</svg>;
}

function canAccessAdminRoute(session: AdminDashboardSession, routeKey: string) {
  const permissionByRoute: Record<string, string> = {
    overview: 'overview', users: 'users:view', rooms: 'rooms:view', reports: 'reports:view',
    store: 'store:view', cosmetics: 'store:view', incentives: 'incentives:view', representatives: 'store:view', notifications: 'flags:manage', audit: 'audit:view', settings: 'settings:manage',
  };
  return session.permissions.includes(permissionByRoute[routeKey] || 'overview');
}

function translateAdminRole(role: AdminDashboardSession['role']) {
  if (role === 'super-moderator') return 'مشرف إقليمي أعلى';
  return { owner: 'مالك النظام', moderator: 'مشرف المحتوى', support: 'دعم المستخدمين', 'catalog-manager': 'مدير الكتالوج', auditor: 'مدقق النظام' }[role];
}

function BrandCrown() {
  return (
    <div className="brand-crown" aria-hidden="true">
      <svg fill="none" viewBox="0 0 48 48">
        <path d="M6 15 15 24 19 7l5 15L29 7l4 17 9-9-5 23H11L6 15Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2.4" />
        <path d="M12 38h24M14 42h20" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
        <circle cx="6" cy="14" fill="currentColor" r="1.6" />
        <circle cx="19" cy="6" fill="currentColor" r="1.6" />
        <circle cx="29" cy="6" fill="currentColor" r="1.6" />
        <circle cx="42" cy="14" fill="currentColor" r="1.6" />
      </svg>
    </div>
  );
}

function LegacyAuditPanel({
  actorFilter,
  auditState,
  kindFilter,
  onActorFilterChange,
  onKindFilterChange,
  onRefresh,
}: {
  actorFilter: string;
  auditState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; auditEvents: AdminAuditEventRow[] }
    | { status: 'error'; message: string };
  kindFilter: string;
  onActorFilterChange: (value: string) => void;
  onKindFilterChange: (value: string) => void;
  onRefresh: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRefresh();
  }

  return (
    <div className="audit-management">
      <AdminSectionHeader
        actions={<form className="audit-filters" onSubmit={handleSubmit}>
          <input
            aria-label="معرّف منفّذ الإجراء"
            onChange={(event) => onActorFilterChange(event.target.value)}
            placeholder="معرّف المنفّذ"
            value={actorFilter}
          />
          <input
            aria-label="نوع حدث التدقيق"
            onChange={(event) => onKindFilterChange(event.target.value)}
            placeholder="نوع الحدث"
            value={kindFilter}
          />
          <button className="secondary-button compact" type="submit">
            تصفية
          </button>
        </form>}
        description="راجع إجراءات الإدارة حسب المنفّذ والهدف ونوع العملية."
        eyebrow="التدقيق والأمان"
        title="سجل المساءلة"
      />

      <AdminCollectionState
        empty={auditState.status === 'ready' && auditState.auditEvents.length === 0}
        emptyMessage="لا توجد أحداث تدقيق مطابقة"
        error={auditState.status === 'error' ? auditState.message : undefined}
        loading={auditState.status === 'loading' || auditState.status === 'idle'}
        loadingMessage="جارٍ تحميل أحداث التدقيق…"
        onRetry={onRefresh}
      >
        {auditState.status === 'ready' ? (
        <div className="audit-list">
          {auditState.auditEvents.map((event) => (
            <AuditEventRow event={event} key={event.id} />
          ))}
        </div>
        ) : null}
      </AdminCollectionState>
    </div>
  );
}

function AuditEventRow({ event }: { event: AdminAuditEventRow }) {
  return (
    <article className="audit-row">
      <div className="audit-main">
        <div>
          <p className="eyebrow">{translateStatus(event.kind || 'تدقيق')}</p>
          <strong>{event.action || event.id}</strong>
        </div>
        <div className="room-meta">
          <span>{event.actorUid || 'منفّذ غير معروف'}</span>
          <span>{event.targetUid || event.reportId || event.roomId || 'بلا هدف'}</span>
          {event.publicId ? <span>#{event.publicId}</span> : null}
          <span>{event.createdAt ? formatDateTime(event.createdAt) : event.id}</span>
        </div>
        <small>{event.actorEmail || event.eventPath || event.note || 'لا توجد تفاصيل إضافية'}</small>
      </div>
    </article>
  );
}

function LegacyRoomsPanel({
  onAction,
  onRefresh,
  onStatusChange,
  roomsState,
  status,
}: {
  onAction: (roomId: string, roomAction: AdminRoomAction, targetUid: string, reason: string) => Promise<string>;
  onRefresh: () => void;
  onStatusChange: (status: AdminRoomStatusFilter) => void;
  roomsState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; rooms: AdminRoomRow[] }
    | { status: 'error'; message: string };
  status: AdminRoomStatusFilter;
}) {
  return (
    <div className="room-management">
      <AdminSectionHeader
        actions={<div className="toolbar">
          <div className="segmented-control" aria-label="حالة الغرفة">
            {(['active', 'closed'] as AdminRoomStatusFilter[]).map((option) => (
              <button
                className={status === option ? 'selected' : ''}
                key={option}
                onClick={() => onStatusChange(option)}
                type="button"
              >
                {option === 'active' ? 'نشطة' : 'مغلقة'}
              </button>
            ))}
          </div>
          <button className="secondary-button compact" onClick={onRefresh} type="button">
            تحديث
          </button>
        </div>}
        description="راقب حالة الغرف ووثّق إجراءات الإشراف الحساسة."
        eyebrow="المجتمع المباشر"
        title="إشراف الغرف"
      />

      <AdminCollectionState
        empty={roomsState.status === 'ready' && roomsState.rooms.length === 0}
        emptyMessage="لا توجد غرف مطابقة"
        error={roomsState.status === 'error' ? roomsState.message : undefined}
        loading={roomsState.status === 'loading' || roomsState.status === 'idle'}
        loadingMessage="جارٍ تحميل الغرف…"
        onRetry={onRefresh}
      >
        {roomsState.status === 'ready' ? (
        <div className="room-list">
          {roomsState.rooms.map((room) => (
            <RoomReviewRow key={room.id} onAction={onAction} onRefresh={onRefresh} room={room} />
          ))}
        </div>
        ) : null}
      </AdminCollectionState>
    </div>
  );
}

function RoomReviewRow({
  onAction,
  onRefresh,
  room,
}: {
  onAction: (roomId: string, roomAction: AdminRoomAction, targetUid: string, reason: string) => Promise<string>;
  onRefresh: () => void;
  room: AdminRoomRow;
}) {
  const { confirm, notify } = useAdminFeedback();
  const [reason, setReason] = useState('');
  const [targetUid, setTargetUid] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function runAction(roomAction: AdminRoomAction) {
    const confirmed = await confirm({
      confirmLabel: roomAction === 'close-room' ? 'إغلاق الغرفة' : 'إزالة العضو',
      description: roomAction === 'close-room'
        ? `سيتم إغلاق غرفة «${room.title || room.id}» وتسجيل الإجراء في سجل التدقيق.`
        : `سيتم إخراج العضو المحدد من غرفة «${room.title || room.id}».`,
      destructive: true,
      title: roomAction === 'close-room' ? 'تأكيد إغلاق الغرفة' : 'تأكيد إزالة العضو',
    });
    if (!confirmed) return;
    setStatus('saving');

    try {
      await onAction(room.id, roomAction, roomAction === 'remove-member' ? targetUid : '', reason);
      setReason('');
      setTargetUid('');
      setStatus('saved');
      notify(roomAction === 'close-room' ? 'تم إغلاق الغرفة' : 'تمت إزالة العضو', { tone: 'success' });
      onRefresh();
    } catch {
      setStatus('error');
      notify('تعذّر تنفيذ إجراء الغرفة', { tone: 'error' });
    }
  }

  const canClose = room.status === 'active';
  const canRemove = room.status === 'active' && targetUid.trim().length > 0 && targetUid.trim() !== room.hostId;

  return (
    <article className="room-row">
      <div className="room-main">
        <div>
          <p className="eyebrow">{translateStatus(room.type || 'غرفة')}</p>
          <strong>{room.title || room.id}</strong>
        </div>
        <div className="room-meta">
          <span>{translateStatus(room.status || 'غير معروف')}</span>
          <span>{translateStatus(room.visibility || 'غير معروف')}</span>
          <span>{formatCount(room.participantCount)} مشارك</span>
          <span>{room.updatedAt ? `آخر تحديث ${formatDateTime(room.updatedAt)}` : room.id}</span>
        </div>
        <small>المضيف: {room.hostDisplayName || room.hostId || 'غير معروف'}</small>
      </div>
      <div className="room-actions">
        <input
          aria-label={`العضو المستهدف في ${room.title || room.id}`}
          onChange={(event) => setTargetUid(event.target.value)}
          placeholder="معرّف العضو"
          value={targetUid}
        />
        <input
          aria-label={`سبب الإشراف في ${room.title || room.id}`}
          onChange={(event) => setReason(event.target.value)}
          placeholder="سبب الإجراء"
          value={reason}
        />
        <div className="action-buttons">
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canClose}
            onClick={() => void runAction('close-room')}
            type="button"
          >
            إغلاق الغرفة
          </button>
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canRemove}
            onClick={() => void runAction('remove-member')}
            type="button"
          >
            إزالة العضو
          </button>
          {status === 'saved' ? <span className="note-status">تم الحفظ</span> : null}
          {status === 'error' ? <span className="note-status error-text">تعذّر الحفظ</span> : null}
        </div>
      </div>
    </article>
  );
}

function LegacyUsersPanel({
  onCredit,
  onCreateNote,
  onDissolveCouple,
  onRefresh,
  onSearchChange,
  onUpsertSpecialId,
  onUpsertGift,
  search,
  usersState,
}: {
  onCredit: (targetUid: string, amount: number, note: string) => Promise<string>;
  onCreateNote: (targetUid: string, note: string) => Promise<string>;
  onDissolveCouple: (targetUid: string) => Promise<string>;
  onUpsertGift: (input: {
    giftId: string;
    iconKey: 'rose' | 'crown' | 'diamond' | 'heart' | 'star';
    nameAr: string;
    price: number;
    scoreValue: number;
    status: 'available' | 'disabled';
  }) => Promise<string>;
  onUpsertSpecialId: (specialId: string, price: number, status: 'available' | 'disabled') => Promise<string>;
  onRefresh: () => void;
  onSearchChange: (search: string) => void;
  search: string;
  usersState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; users: AdminUserRow[] }
    | { status: 'error'; message: string };
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRefresh();
  }

  return (
    <div className="user-management">
      <SpecialIdCatalogForm onSubmit={onUpsertSpecialId} />
      <GiftCatalogForm onSubmit={onUpsertGift} />
      <AdminSectionHeader
        actions={<form className="search-form" onSubmit={handleSubmit}>
          <input
            aria-label="البحث عن المستخدمين"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="الاسم، البريد، المعرّف أو الرقم المميز"
            value={search}
          />
          <button className="secondary-button compact" type="submit">
            بحث
          </button>
        </form>}
        description="ابحث في الملفات الشخصية وأضف الملاحظات الداخلية بأمان."
        eyebrow="إدارة المجتمع"
        title="مراجعة المستخدمين"
      />

      <AdminCollectionState
        empty={usersState.status === 'ready' && usersState.users.length === 0}
        emptyMessage="لا يوجد مستخدمون مطابقون"
        error={usersState.status === 'error' ? usersState.message : undefined}
        loading={usersState.status === 'loading' || usersState.status === 'idle'}
        loadingMessage="جارٍ تحميل المستخدمين…"
        onRetry={onRefresh}
      >
        {usersState.status === 'ready' ? (
        <div className="user-list">
          {usersState.users.map((userRow) => (
            <UserReviewRow key={userRow.uid} onCredit={onCredit} onCreateNote={onCreateNote} onDissolveCouple={onDissolveCouple} userRow={userRow} />
          ))}
        </div>
        ) : null}
      </AdminCollectionState>
    </div>
  );
}

function UserReviewRow({
  onCredit,
  onCreateNote,
  onDissolveCouple,
  userRow,
}: {
  onCredit: (targetUid: string, amount: number, note: string) => Promise<string>;
  onCreateNote: (targetUid: string, note: string) => Promise<string>;
  onDissolveCouple: (targetUid: string) => Promise<string>;
  userRow: AdminUserRow;
}) {
  const { confirm, notify } = useAdminFeedback();
  const [note, setNote] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');

    try {
      await onCreateNote(userRow.uid, note);
      setNote('');
      setStatus('saved');
      notify('تم حفظ الملاحظة', { tone: 'success' });
    } catch {
      setStatus('error');
      notify('تعذّر حفظ الملاحظة', { tone: 'error' });
    }
  }

  async function handleCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    try {
      await onCredit(userRow.uid, Number(creditAmount), note);
      setCreditAmount('');
      setNote('');
      setStatus('saved');
      notify('تمت إضافة الرصيد', { description: 'تم تسجيل العملية في سجل التدقيق.', tone: 'success' });
    } catch {
      setStatus('error');
      notify('تعذّر تعديل الرصيد', { tone: 'error' });
    }
  }

  async function handleDissolveCouple() {
    const confirmed = await confirm({
      confirmLabel: 'فك الارتباط',
      description: `سيتم إنهاء الارتباط النشط للمستخدم ${userRow.displayName || userRow.uid} وتسجيل العملية.`,
      destructive: true,
      title: 'تأكيد فك الارتباط',
    });
    if (!confirmed) return;
    setStatus('saving');
    try {
      await onDissolveCouple(userRow.uid);
      setStatus('saved');
      notify('تم فك الارتباط', { tone: 'success' });
    } catch {
      setStatus('error');
      notify('تعذّر فك الارتباط', { tone: 'error' });
    }
  }

  return (
    <article className="user-row">
      <div className="avatar-chip">{userRow.avatarLabel || '?'}</div>
      <div className="user-main">
        <strong>{userRow.displayName || 'مستخدم بلا اسم'}</strong>
        <span>{userRow.email || userRow.uid}</span>
        <div className="user-meta">
          <span className={`status-badge status-${userRow.publicProfileStatus}`}>
            الملف {translateStatus(userRow.publicProfileStatus)}
          </span>
          {userRow.publicId ? <span>#{userRow.publicId}</span> : null}
          {userRow.specialId ? <span>الرقم المميز {userRow.specialId}</span> : null}
          {userRow.countryCode ? <span>{userRow.countryCode}</span> : null}
          {userRow.moderationStatus ? <span>الحساب {translateStatus(userRow.moderationStatus)}</span> : null}
          <span>الإشعارات {userRow.notificationPreferencesConfigured ? 'مخصّصة' : 'افتراضية'}</span>
          {userRow.avatarModerationStatus ? <span>الصورة {translateStatus(userRow.avatarModerationStatus)}</span> : null}
          <span>نقاط الهدايا {userRow.giftScore}</span>
          <span>مستوى الارتباط {userRow.coupleLevel}</span>
        </div>
        <small>{userRow.updatedAt ? `آخر تحديث ${formatDateTime(userRow.updatedAt)}` : userRow.uid}</small>
      </div>
      <form className="note-form" onSubmit={handleSubmit}>
        <input
          aria-label={`ملاحظة إدارية للمستخدم ${userRow.displayName || userRow.uid}`}
          onChange={(event) => setNote(event.target.value)}
          placeholder="أضف ملاحظة داخلية"
          value={note}
        />
        <button className="secondary-button compact" disabled={status === 'saving' || note.trim().length < 2} type="submit">
          حفظ
        </button>
        {status === 'saved' ? <span className="note-status">تم الحفظ</span> : null}
        {status === 'error' ? <span className="note-status error-text">تعذّر الحفظ</span> : null}
      </form>
      <form className="note-form" onSubmit={handleCredit}>
        <input aria-label={`رصيد المحفظة للمستخدم ${userRow.uid}`} min="1" onChange={(event) => setCreditAmount(event.target.value)} placeholder="عدد العملات" type="number" value={creditAmount} />
        <button className="secondary-button compact" disabled={status === 'saving' || Number(creditAmount) < 1} type="submit">إضافة للمحفظة</button>
      </form>
      <button className="danger-button compact" disabled={status === 'saving' || userRow.coupleLevel < 1} onClick={() => void handleDissolveCouple()} type="button">فك الارتباط</button>
    </article>
  );
}

function SpecialIdCatalogForm({
  onSubmit,
}: {
  onSubmit: (specialId: string, price: number, status: 'available' | 'disabled') => Promise<string>;
}) {
  const [specialId, setSpecialId] = useState('');
  const [price, setPrice] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<'available' | 'disabled'>('available');
  const [requestStatus, setRequestStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestStatus('saving');

    try {
      await onSubmit(specialId, Number(price), catalogStatus);
      setSpecialId('');
      setPrice('');
      setRequestStatus('saved');
    } catch {
      setRequestStatus('error');
    }
  }

  return (
    <form className="search-form catalog-form" onSubmit={submit}>
      <span className="form-label">كتالوج الأرقام المميزة</span>
      <input aria-label="الرقم المميز" inputMode="numeric" onChange={(event) => setSpecialId(event.target.value)} placeholder="الرقم المميز" value={specialId} />
      <input aria-label="سعر الرقم المميز" min="1" onChange={(event) => setPrice(event.target.value)} placeholder="السعر" type="number" value={price} />
      <select
        aria-label="حالة الرقم المميز"
        onChange={(event) => setCatalogStatus(event.target.value as 'available' | 'disabled')}
        value={catalogStatus}
      >
        <option value="available">متاح</option>
        <option value="disabled">معطّل</option>
      </select>
      <button
        className="secondary-button compact"
        disabled={requestStatus === 'saving' || !specialId || Number(price) < 1}
        type="submit"
      >
        حفظ الرقم
      </button>
      {requestStatus === 'saved' ? <span className="note-status">تم الحفظ</span> : null}
      {requestStatus === 'error' ? <span className="note-status error-text">تعذّر الحفظ</span> : null}
    </form>
  );
}

function GiftCatalogForm({
  onSubmit,
}: {
  onSubmit: (input: {
    giftId: string;
    iconKey: 'rose' | 'crown' | 'diamond' | 'heart' | 'star';
    nameAr: string;
    price: number;
    scoreValue: number;
    status: 'available' | 'disabled';
  }) => Promise<string>;
}) {
  const [giftId, setGiftId] = useState('');
  const [iconKey, setIconKey] = useState<'rose' | 'crown' | 'diamond' | 'heart' | 'star'>('rose');
  const [nameAr, setNameAr] = useState('');
  const [price, setPrice] = useState('');
  const [scoreValue, setScoreValue] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<'available' | 'disabled'>('available');
  const [requestStatus, setRequestStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestStatus('saving');
    try {
      await onSubmit({
        giftId,
        iconKey,
        nameAr,
        price: Number(price),
        scoreValue: Number(scoreValue),
        status: catalogStatus,
      });
      setGiftId('');
      setNameAr('');
      setPrice('');
      setScoreValue('');
      setRequestStatus('saved');
    } catch {
      setRequestStatus('error');
    }
  }

  return (
    <form className="search-form catalog-form" onSubmit={submit}>
      <span className="form-label">كتالوج الهدايا</span>
      <input aria-label="معرّف الهدية" onChange={(event) => setGiftId(event.target.value)} placeholder="معرّف الهدية" value={giftId} />
      <input aria-label="اسم الهدية" dir="rtl" onChange={(event) => setNameAr(event.target.value)} placeholder="اسم الهدية" value={nameAr} />
      <input aria-label="سعر الهدية" min="1" onChange={(event) => setPrice(event.target.value)} placeholder="السعر" type="number" value={price} />
      <input aria-label="نقاط الهدية" min="1" onChange={(event) => setScoreValue(event.target.value)} placeholder="النقاط" type="number" value={scoreValue} />
      <select aria-label="أيقونة الهدية" onChange={(event) => setIconKey(event.target.value as typeof iconKey)} value={iconKey}>
        <option value="rose">وردة</option>
        <option value="crown">تاج</option>
        <option value="diamond">ماسة</option>
        <option value="heart">قلب</option>
        <option value="star">نجمة</option>
      </select>
      <select aria-label="حالة الهدية" onChange={(event) => setCatalogStatus(event.target.value as typeof catalogStatus)} value={catalogStatus}>
        <option value="available">متاحة</option>
        <option value="disabled">معطّلة</option>
      </select>
      <button
        className="secondary-button compact"
        disabled={requestStatus === 'saving' || giftId.length < 2 || nameAr.trim().length < 2 || Number(price) < 1 || Number(scoreValue) < 1}
        type="submit"
      >
        حفظ الهدية
      </button>
      {requestStatus === 'saved' ? <span className="note-status">تم الحفظ</span> : null}
      {requestStatus === 'error' ? <span className="note-status error-text">تعذّر الحفظ</span> : null}
    </form>
  );
}

function OverviewPanel({
  auditState,
  onRefresh,
  overviewReportBreakdown,
  overviewState,
  roomsState,
}: {
  auditState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; auditEvents: AdminAuditEventRow[] }
    | { status: 'error'; message: string };
  onRefresh: () => void;
  overviewReportBreakdown: OverviewReportBreakdownState;
  overviewState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; metrics: AdminOverviewMetrics }
    | { status: 'error'; message: string };
  roomsState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; rooms: AdminRoomRow[] }
    | { status: 'error'; message: string };
}) {
  if (overviewState.status === 'error') {
    return (
      <div className="overview-dashboard">
        <div className="overview-heading">
          <div>
            <p className="eyebrow">مركز العمليات</p>
            <h3>تعذّر تحميل المؤشرات</h3>
          <p>{overviewState.message}</p>
          </div>
          <button className="secondary-button compact" onClick={onRefresh} type="button">إعادة المحاولة</button>
        </div>
      </div>
    );
  }

  if (overviewState.status !== 'ready') {
    return (
      <div className="overview-dashboard">
        <div className="overview-heading">
          <div>
            <p className="eyebrow">مركز العمليات</p>
            <h3>جارٍ تجهيز ملخص اليوم</h3>
            <p>نحمّل المؤشرات التشغيلية الخاصة بحساب الإدارة.</p>
          </div>
        </div>
        <div className="metric-grid loading-grid" aria-busy="true">
          {['إجمالي المستخدمين', 'الغرف النشطة', 'البلاغات', 'أحداث الإشراف'].map((label) => (
            <MetricCard icon="overview" key={label} label={label} value="…" tone="gold" />
          ))}
        </div>
      </div>
    );
  }

  const { metrics } = overviewState;
  const growth = metrics.growthHealth;

  return (
    <div className="overview-dashboard">
      <div className="metric-grid">
        <MetricCard detail="بيانات مباشرة" icon="users" label="إجمالي المستخدمين" value={formatCount(metrics.users)} tone="gold" />
        <MetricCard detail="بيانات مباشرة" icon="rooms" label="الغرف النشطة" value={formatCount(metrics.activeRooms)} tone="green" />
        <MetricCard detail="تحتاج متابعة" icon="reports" label="البلاغات المفتوحة" value={formatCount(metrics.reports)} tone="red" />
        <MetricCard detail="موثّقة في النظام" icon="audit" label="أحداث الإشراف" value={formatCount(metrics.moderationEvents)} tone="blue" />
      </div>

      <section className="overview-growth-health" aria-label="صحة النمو">
        <div className="overview-heading">
          <div>
            <p className="eyebrow">النمو التنافسي — الموجة 0</p>
            <h3>مؤشرات صحة النمو</h3>
            <p>مرحلة الإطلاق الحالية والعدادات الاحتياطية (قد تكون صفراً قبل تفعيل الأحداث).</p>
          </div>
          <AdminStatusBadge tone={growth.stageName === 'dark' ? 'neutral' : 'success'}>
            {growthStageLabel(growth.stageName)}
          </AdminStatusBadge>
        </div>
        <div className="metric-grid">
          <MetricCard detail={`مرحلة ${growth.stageId}`} icon="overview" label="مرحلة النمو" value={growthStageLabel(growth.stageName)} tone="gold" />
          <MetricCard detail="انضمام لغرفة فارغة" icon="rooms" label="معدل الغرف الفارغة" value={formatPercent(growth.emptyRoomJoinRate)} tone="red" />
          <MetricCard detail="محاولات → غرفة" icon="users" label="تحويل المطابقة" value={formatPercent(growth.matchToRoomRate)} tone="green" />
          <MetricCard detail="محاولات → اقتران" icon="users" label="اقتران الصوت السريع" value={formatPercent(growth.softMatchPairRate)} tone="green" />
          <MetricCard detail={`عملات ${formatCount(growth.giftGmvCoins)} · ماس ${formatCount(growth.giftGmvDiamonds)}`} icon="store" label="حجم هدايا تقريبي" value={formatCount(growth.giftGmvCoins + growth.giftGmvDiamonds)} tone="blue" />
        </div>
      </section>

      <div className="overview-middle">
        <OperationsChart metrics={metrics} />
        <OverviewReports reportsState={overviewReportBreakdown} />
        <ReportDistribution reportsState={overviewReportBreakdown} />
      </div>

      <OverviewActivityTable auditState={auditState} roomsState={roomsState} />
      <footer className="dashboard-footer"><span>SDK Heaven © {new Date().getFullYear()}</span><span>جميع الحقوق محفوظة</span><NavIcon routeKey="audit" /></footer>
    </div>
  );
}

function MetricCard({ detail = 'محدث الآن', icon, label, tone, value }: { detail?: string; icon: string; label: string; tone: 'gold' | 'green' | 'red' | 'blue'; value: string }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon"><NavIcon routeKey={icon} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <div className="metric-foot"><i /> محدث الآن</div>
    </article>
  );
}

function OperationsChart({ metrics }: { metrics: AdminOverviewMetrics }) {
  const values = [metrics.users, metrics.activeRooms, metrics.gameRooms, metrics.privateRooms, metrics.reports, metrics.moderationEvents];
  const maximum = Math.max(...values.map((value) => Math.log1p(value)), 1);
  const labels = ['المستخدمون', 'النشطة', 'الألعاب', 'الخاصة', 'البلاغات', 'الإشراف'];
  return (
    <section className="overview-card operations-chart">
      <div className="card-heading"><h4>عمليات اليوم</h4><span>مقياس نسبي</span></div>
      <div className="chart-legend"><span><i className="legend-green" /> النشاط</span><span><i className="legend-gold" /> المتابعة</span></div>
      <div className="bar-chart" aria-label="توزيع المؤشرات التشغيلية">
        {values.map((value, index) => (
          <div className="chart-column" key={labels[index]}>
            <div className="chart-track"><span className={index > 3 ? 'followup-bar' : ''} style={{ height: `${Math.max(8, Math.round((Math.log1p(value) / maximum) * 100))}%` }} /></div>
            <small>{labels[index]}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewReports({ reportsState }: { reportsState: OverviewReportBreakdownState }) {
  const reports = reportsState.status === 'ready' ? reportsState.reports.slice(0, 5) : [];
  return (
    <section className="overview-card overview-reports">
      <div className="card-heading"><h4>بلاغات تحتاج مراجعة</h4><span>{reportsState.status === 'ready' ? `${formatCount(reportsState.reports.length)} بلاغ` : 'جارٍ التحميل'}</span></div>
      <div className="overview-report-list">
        {reports.map((report) => (
          <article key={report.id}>
            <span className={`report-state report-state-${report.status || 'open'}`}>{translateStatus(report.status || 'open')}</span>
            <div><strong>{report.reason || 'بلاغ دون وصف'}</strong><small>{translateStatus(report.subjectType || report.source || 'بلاغ')} · {report.updatedAt ? formatRelativeTime(report.updatedAt) : report.id}</small></div>
            <i className="report-avatar">{getInitial(report.reporterUid || 'م')}</i>
          </article>
        ))}
        {reports.length === 0 ? <p className="overview-empty">{reportsState.status === 'error' ? 'تعذّر تحميل البلاغات.' : reportsState.status === 'ready' ? 'لا توجد بلاغات مفتوحة.' : 'جارٍ تحميل البلاغات…'}</p> : null}
      </div>
    </section>
  );
}

function ReportDistribution({ reportsState }: { reportsState: OverviewReportBreakdownState }) {
  const values: [number, number, number] = reportsState.status === 'ready'
    ? [reportsState.open, reportsState.triage, reportsState.resolved]
    : [0, 0, 0];
  const total = Math.max(values.reduce((sum, value) => sum + value, 0), 1);
  const openEnd = Math.round((values[0] / total) * 100);
  const triageEnd = openEnd + Math.round((values[1] / total) * 100);
  const chartStyle = {
    background: `conic-gradient(#a94b51 0 ${openEnd}%, #d39a43 ${openEnd}% ${triageEnd}%, #82946f ${triageEnd}% 100%)`,
  };

  return (
    <section className="overview-card distribution-card">
      <div className="card-heading"><h4>توزيع البلاغات حسب الحالة</h4><span>مباشر</span></div>
      <div className="distribution-content">
        <div className="donut-chart" style={chartStyle}>
          <div><strong>{reportsState.status === 'ready' ? formatCount(values.reduce((sum, value) => sum + value, 0)) : '…'}</strong><small>إجمالي</small></div>
        </div>
        <div className="distribution-legend">
          <span><i className="dot-open" /><b>مفتوح</b><strong>{formatCount(values[0])}</strong></span>
          <span><i className="dot-triage" /><b>قيد الفرز</b><strong>{formatCount(values[1])}</strong></span>
          <span><i className="dot-resolved" /><b>تم الحل</b><strong>{formatCount(values[2])}</strong></span>
        </div>
      </div>
      <div className="resolution-note"><span className="resolution-icon">✓</span><div><strong>{formatCount(values[2])} بلاغاً تم حله</strong><small>ضمن دورة المراجعة الحالية</small></div></div>
    </section>
  );
}

function OverviewActivityTable({ auditState, roomsState }: {
  auditState: { status: 'idle' } | { status: 'loading' } | { status: 'ready'; auditEvents: AdminAuditEventRow[] } | { status: 'error'; message: string };
  roomsState: { status: 'idle' } | { status: 'loading' } | { status: 'ready'; rooms: AdminRoomRow[] } | { status: 'error'; message: string };
}) {
  const events = auditState.status === 'ready' ? auditState.auditEvents.slice(0, 6) : [];
  const rooms = roomsState.status === 'ready' ? roomsState.rooms : [];
  return (
    <section className="overview-card activity-card">
      <div className="card-heading"><h4>آخر الأنشطة</h4><span>عرض الكل</span></div>
      <div className="activity-table" role="table">
        <div className="activity-head" role="row"><span>الوقت</span><span>النوع</span><span>الوصف</span><span>المنفّذ</span><span>الغرفة</span><span aria-hidden="true" /></div>
        {events.map((event, index) => (
          <div className="activity-line" role="row" key={event.id}>
            <time>{formatTime(event.createdAt)}</time>
            <span className={`activity-kind kind-${index % 4}`}>{translateStatus(event.kind || 'إجراء')}</span>
            <strong>{event.action || event.note || 'إجراء إداري موثّق'}</strong>
            <span className="actor-cell"><i>{getInitial(event.actorEmail || event.actorUid || 'ن')}</i><b>{event.actorEmail || event.actorUid || 'النظام'}</b></span>
            <span>{event.roomId || rooms[index]?.title || '—'}</span>
            <span className={`activity-row-icon kind-${index % 4}`}><NavIcon routeKey={index % 2 === 0 ? 'audit' : 'reports'} /></span>
          </div>
        ))}
        {events.length === 0 ? <p className="overview-empty">{auditState.status === 'ready' ? 'لا توجد أنشطة حديثة.' : 'جارٍ تحميل سجل النشاط…'}</p> : null}
      </div>
    </section>
  );
}

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || 'ن';
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  const difference = Date.now() - time;
  if (!Number.isFinite(time) || difference < 0) return formatDateTime(value);
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${formatCount(minutes)} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${formatCount(hours)} س`;
  return formatDateTime(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar-IQ').format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('ar-IQ', { style: 'percent', maximumFractionDigits: 1 }).format(value || 0);
}

function growthStageLabel(stageName: string) {
  if (stageName === 'closed-beta') return 'تجربة مغلقة';
  if (stageName === 'public-partial') return 'عام جزئي';
  if (stageName === 'public') return 'عام';
  return 'مظلم';
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ar-IQ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function translateStatus(value: string) {
  const translations: Record<string, string> = {
    active: 'نشط', closed: 'مغلق', open: 'مفتوح', triage: 'قيد الفرز', resolved: 'تم الحل',
    public: 'عام', private: 'خاص', ready: 'جاهز', missing: 'غير مكتمل', invalid: 'غير صالح',
    available: 'متاح', disabled: 'معطّل', configured: 'مخصّصة', default: 'افتراضية',
    game: 'لعبة', voice: 'صوتية', room: 'غرفة', report: 'بلاغ', unknown: 'غير معروف',
  };
  return translations[value.toLowerCase()] ?? value;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    } catch (nextError) {
      setError(translateAuthenticationError(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-shell">
        <aside className="auth-story">
          <div className="auth-brand"><BrandCrown /><span>SDK Heaven</span></div>
          <div><p className="eyebrow">بوابة العمليات المحمية</p><h2>إدارة دقيقة.<br />قرارات موثّقة.</h2><p>مساحة الإدارة المركزية للمجتمع والغرف والاقتصاد، محمية بصلاحيات خادمية وسجل تدقيق كامل.</p></div>
          <ul><li>صلاحيات حسب الدور</li><li>جلسات Firebase موثّقة</li><li>كل إجراء حساس قابل للتتبع</li></ul>
        </aside>
        <form className="login-panel" onSubmit={handleSubmit}>
          <div className="auth-form-seal"><BrandCrown /></div>
          <div><p className="eyebrow">لوحة الإدارة</p><h1>مرحبًا بعودتك</h1><p>استخدم حساب الإدارة الموثّق للمتابعة.</p></div>
          <label>البريد الإلكتروني<input autoComplete="email" dir="ltr" onChange={(event) => setEmail(event.target.value)} placeholder="admin@sdkheaven.com" required type="email" value={email} /></label>
          <label>كلمة المرور<input autoComplete="current-password" dir="ltr" onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" required type="password" value={password} /></label>
          {error ? <div className="auth-error" role="alert"><span>!</span><p>{error}</p></div> : null}
          <button disabled={submitting} type="submit"><span>{submitting ? 'جارٍ التحقق…' : 'دخول آمن'}</span><span aria-hidden="true">←</span></button>
          <small className="auth-legal">الدخول مخصص للمسؤولين المخوّلين فقط. تُسجّل محاولات الوصول.</small>
        </form>
      </section>
    </main>
  );
}

function StatusScreen({
  actionLabel,
  detail,
  onAction,
  title,
}: {
  actionLabel?: string;
  detail: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-status-card">
        <div className="auth-form-seal"><BrandCrown /></div>
        <p className="eyebrow">SDK Heaven · بوابة الإدارة</p>
        <h1>{title}</h1><p>{detail}</p>
        <div className="auth-status-line"><i /><span>{title.includes('التحقق') ? 'جارٍ فحص الهوية والدور' : 'تم إيقاف الانتقال إلى لوحة العمليات'}</span></div>
        {actionLabel && onAction ? <button onClick={onAction} type="button">{actionLabel}</button> : null}
      </section>
    </main>
  );
}

function translateAuthenticationError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('invalid-credential') || message.includes('wrong-password') || message.includes('user-not-found')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (message.includes('too-many-requests')) return 'تكررت المحاولات. انتظر قليلًا ثم أعد المحاولة.';
  if (message.includes('network-request-failed')) return 'تعذّر الاتصال بالخدمة. تحقق من الشبكة وحاول مجددًا.';
  return 'تعذّر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.';
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
