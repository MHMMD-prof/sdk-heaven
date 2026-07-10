import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  createAdminUserNote,
  executeAdminReportAction,
  executeAdminRoomAction,
  requestAdminAuditEvents,
  requestAdminDashboardSession,
  requestAdminOverview,
  requestAdminReports,
  requestAdminRooms,
  requestAdminUsers,
  AdminAuditEventRow,
  AdminDashboardSession,
  AdminOverviewMetrics,
  AdminReportAction,
  AdminReportRow,
  AdminReportStatusFilter,
  AdminRoomAction,
  AdminRoomRow,
  AdminRoomStatusFilter,
  AdminUserRow,
} from './adminDashboardApi';
import { firebaseAuth } from './firebase';

type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'verifying'; user: User }
  | { status: 'admin'; session: AdminDashboardSession; user: User }
  | { status: 'denied'; message: string; user: User };

const routes = [
  {
    key: 'overview',
    label: 'Overview',
    path: '/',
    title: 'Overview',
    detail: 'No operational summaries are loaded.',
  },
  {
    key: 'users',
    label: 'Users',
    path: '/users',
    title: 'Users',
    detail: 'No user records are loaded.',
  },
  {
    key: 'rooms',
    label: 'Rooms',
    path: '/rooms',
    title: 'Rooms',
    detail: 'No room records are loaded.',
  },
  {
    key: 'reports',
    label: 'Reports',
    path: '/reports',
    title: 'Reports',
    detail: 'No reports are loaded.',
  },
  {
    key: 'audit',
    label: 'Audit',
    path: '/audit',
    title: 'Audit',
    detail: 'No audit events are loaded.',
  },
];

type DashboardRoute = (typeof routes)[number];
const defaultRoute = routes[0] as DashboardRoute;

function getRouteFromPath(pathname: string) {
  return routes.find((route) => route.path === pathname) ?? defaultRoute;
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'checking' });
  const [activeRoute, setActiveRoute] = useState(() => getRouteFromPath(window.location.pathname));
  const [overviewState, setOverviewState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; metrics: AdminOverviewMetrics }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [usersState, setUsersState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; users: AdminUserRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [userSearch, setUserSearch] = useState('');
  const [roomsState, setRoomsState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; rooms: AdminRoomRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [roomStatusFilter, setRoomStatusFilter] = useState<AdminRoomStatusFilter>('active');
  const [reportsState, setReportsState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; reports: AdminReportRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [reportStatusFilter, setReportStatusFilter] = useState<AdminReportStatusFilter>('open');
  const [auditState, setAuditState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; auditEvents: AdminAuditEventRow[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditKindFilter, setAuditKindFilter] = useState('');

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
          message: error instanceof Error ? error.message : 'Admin dashboard access was denied.',
          user,
        });
      }
    });
  }, []);

  useEffect(() => {
    function handlePopState() {
      setActiveRoute(getRouteFromPath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navItems = useMemo(() => routes, []);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'overview') {
      return;
    }

    void loadOverview(authState.user);
  }, [activeRoute.key, authState]);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'rooms') {
      return;
    }

    void loadRooms(authState.user, roomStatusFilter);
  }, [activeRoute.key, authState, roomStatusFilter]);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'reports') {
      return;
    }

    void loadReports(authState.user, reportStatusFilter);
  }, [activeRoute.key, authState, reportStatusFilter]);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'audit') {
      return;
    }

    void loadAuditEvents(authState.user, auditActorFilter, auditKindFilter);
  }, [activeRoute.key, authState]);

  useEffect(() => {
    if (authState.status !== 'admin' || activeRoute.key !== 'users') {
      return;
    }

    void loadUsers(authState.user, userSearch);
  }, [activeRoute.key, authState]);

  function navigateToRoute(route: DashboardRoute) {
    if (route.path !== window.location.pathname) {
      window.history.pushState({}, '', route.path);
    }

    setActiveRoute(route);
  }

  async function loadOverview(user: User) {
    setOverviewState({ status: 'loading' });

    try {
      const metrics = await requestAdminOverview(user);
      setOverviewState({ status: 'ready', metrics });
    } catch (error) {
      setOverviewState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Admin overview is unavailable.',
      });
    }
  }

  async function loadUsers(user: User, search: string) {
    setUsersState({ status: 'loading' });

    try {
      const users = await requestAdminUsers(user, search);
      setUsersState({ status: 'ready', users });
    } catch (error) {
      setUsersState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Admin users are unavailable.',
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
        message: error instanceof Error ? error.message : 'Admin rooms are unavailable.',
      });
    }
  }

  async function loadReports(user: User, status: AdminReportStatusFilter) {
    setReportsState({ status: 'loading' });

    try {
      const reports = await requestAdminReports(user, status);
      setReportsState({ status: 'ready', reports });
    } catch (error) {
      setReportsState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Admin reports are unavailable.',
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
        message: error instanceof Error ? error.message : 'Admin audit events are unavailable.',
      });
    }
  }

  if (authState.status === 'checking' || authState.status === 'verifying') {
    return <StatusScreen title="Checking admin access" detail="Validating Firebase session and custom claims." />;
  }

  if (authState.status === 'signed-out') {
    return <LoginScreen />;
  }

  if (authState.status === 'denied') {
    return (
      <StatusScreen
        title="Access denied"
        detail={authState.message}
        actionLabel="Sign out"
        onAction={() => void signOut(firebaseAuth)}
      />
    );
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">SDK Heaven</p>
          <h1>Admin</h1>
        </div>

        <nav aria-label="Admin sections">
          {navItems.map((item) => (
            <button
              className={item.key === activeRoute.key ? 'nav-item active' : 'nav-item'}
              key={item.key}
              onClick={() => navigateToRoute(item)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="secondary-button" onClick={() => void signOut(firebaseAuth)} type="button">
          Sign out
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Admin session</p>
            <h2>{activeRoute.title}</h2>
          </div>
          <div className="session-pill">{authState.session.email || authState.session.uid}</div>
        </header>

        <section className="panel">
          {activeRoute.key === 'overview' ? (
            <OverviewPanel
              onRefresh={() => void loadOverview(authState.user)}
              overviewState={overviewState}
            />
          ) : activeRoute.key === 'users' ? (
            <UsersPanel
              onCreateNote={(targetUid, note) => createAdminUserNote(authState.user, targetUid, note)}
              onRefresh={() => void loadUsers(authState.user, userSearch)}
              onSearchChange={setUserSearch}
              search={userSearch}
              usersState={usersState}
            />
          ) : activeRoute.key === 'rooms' ? (
            <RoomsPanel
              onAction={(roomId, roomAction, targetUid, reason) => executeAdminRoomAction(
                authState.user,
                roomId,
                roomAction,
                targetUid,
                reason,
              )}
              onRefresh={() => void loadRooms(authState.user, roomStatusFilter)}
              onStatusChange={setRoomStatusFilter}
              roomsState={roomsState}
              status={roomStatusFilter}
            />
          ) : activeRoute.key === 'reports' ? (
            <ReportsPanel
              onAction={(reportId, reportAction, assigneeUid, note) => executeAdminReportAction(
                authState.user,
                reportId,
                reportAction,
                assigneeUid,
                note,
              )}
              onRefresh={() => void loadReports(authState.user, reportStatusFilter)}
              onStatusChange={setReportStatusFilter}
              reportsState={reportsState}
              status={reportStatusFilter}
            />
          ) : activeRoute.key === 'audit' ? (
            <AuditPanel
              actorFilter={auditActorFilter}
              auditState={auditState}
              kindFilter={auditKindFilter}
              onActorFilterChange={setAuditActorFilter}
              onKindFilterChange={setAuditKindFilter}
              onRefresh={() => void loadAuditEvents(authState.user, auditActorFilter, auditKindFilter)}
            />
          ) : (
            <>
              <div>
                <p className="eyebrow">Session ready</p>
                <h3>{activeRoute.title}</h3>
                <p>{activeRoute.detail}</p>
              </div>
              <div className="status-grid">
                <StatusTile label="Auth gate" value="Live" />
                <StatusTile label="Claim source" value="Firebase" />
                <StatusTile label="Client writes" value="Denied" />
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function AuditPanel({
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
      <div className="section-header">
        <div>
          <p className="eyebrow">Audit</p>
          <h3>Accountability log</h3>
          <p>Review immutable admin actions by actor, target, and workflow.</p>
        </div>
        <form className="audit-filters" onSubmit={handleSubmit}>
          <input
            aria-label="Audit actor UID"
            onChange={(event) => onActorFilterChange(event.target.value)}
            placeholder="Actor UID"
            value={actorFilter}
          />
          <input
            aria-label="Audit kind"
            onChange={(event) => onKindFilterChange(event.target.value)}
            placeholder="Kind"
            value={kindFilter}
          />
          <button className="secondary-button compact" type="submit">
            Filter
          </button>
        </form>
      </div>

      {auditState.status === 'error' ? <p className="error-text">{auditState.message}</p> : null}
      {auditState.status === 'loading' || auditState.status === 'idle' ? (
        <p className="muted-text">Loading audit events.</p>
      ) : null}
      {auditState.status === 'ready' && auditState.auditEvents.length === 0 ? (
        <p className="muted-text">No matching audit events.</p>
      ) : null}
      {auditState.status === 'ready' && auditState.auditEvents.length > 0 ? (
        <div className="audit-list">
          {auditState.auditEvents.map((event) => (
            <AuditEventRow event={event} key={event.id} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuditEventRow({ event }: { event: AdminAuditEventRow }) {
  return (
    <article className="audit-row">
      <div className="audit-main">
        <div>
          <p className="eyebrow">{event.kind || 'Audit'}</p>
          <strong>{event.action || event.id}</strong>
        </div>
        <div className="room-meta">
          <span>{event.actorUid || 'unknown actor'}</span>
          <span>{event.targetUid || event.reportId || event.roomId || 'no target'}</span>
          <span>{event.createdAt ? formatDateTime(event.createdAt) : event.id}</span>
        </div>
        <small>{event.actorEmail || event.eventPath || event.note || 'No additional context'}</small>
      </div>
    </article>
  );
}

function ReportsPanel({
  onAction,
  onRefresh,
  onStatusChange,
  reportsState,
  status,
}: {
  onAction: (reportId: string, reportAction: AdminReportAction, assigneeUid: string, note: string) => Promise<string>;
  onRefresh: () => void;
  onStatusChange: (status: AdminReportStatusFilter) => void;
  reportsState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; reports: AdminReportRow[] }
    | { status: 'error'; message: string };
  status: AdminReportStatusFilter;
}) {
  return (
    <div className="report-management">
      <div className="section-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h3>Abuse workflow</h3>
          <p>Assign report intake and record resolution decisions.</p>
        </div>
        <div className="toolbar">
          <div className="segmented-control" aria-label="Report status">
            {(['open', 'triage', 'resolved'] as AdminReportStatusFilter[]).map((option) => (
              <button
                className={status === option ? 'selected' : ''}
                key={option}
                onClick={() => onStatusChange(option)}
                type="button"
              >
                {option === 'triage' ? 'Triage' : option === 'resolved' ? 'Resolved' : 'Open'}
              </button>
            ))}
          </div>
          <button className="secondary-button compact" onClick={onRefresh} type="button">
            Refresh
          </button>
        </div>
      </div>

      {reportsState.status === 'error' ? <p className="error-text">{reportsState.message}</p> : null}
      {reportsState.status === 'loading' || reportsState.status === 'idle' ? (
        <p className="muted-text">Loading report records.</p>
      ) : null}
      {reportsState.status === 'ready' && reportsState.reports.length === 0 ? (
        <p className="muted-text">No matching reports.</p>
      ) : null}
      {reportsState.status === 'ready' && reportsState.reports.length > 0 ? (
        <div className="report-list">
          {reportsState.reports.map((report) => (
            <ReportReviewRow key={report.id} onAction={onAction} onRefresh={onRefresh} report={report} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReportReviewRow({
  onAction,
  onRefresh,
  report,
}: {
  onAction: (reportId: string, reportAction: AdminReportAction, assigneeUid: string, note: string) => Promise<string>;
  onRefresh: () => void;
  report: AdminReportRow;
}) {
  const [assigneeUid, setAssigneeUid] = useState(report.assignedTo);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function runAction(reportAction: AdminReportAction) {
    setStatus('saving');

    try {
      await onAction(report.id, reportAction, assigneeUid, note);
      setNote('');
      setStatus('saved');
      onRefresh();
    } catch {
      setStatus('error');
    }
  }

  const canAssign = report.status !== 'resolved';
  const canResolve = note.trim().length >= 2;

  return (
    <article className="report-row">
      <div className="report-main">
        <div>
          <p className="eyebrow">{report.subjectType || 'Report'}</p>
          <strong>{report.reason || 'No report note'}</strong>
        </div>
        <div className="room-meta">
          <span>{report.status || 'unknown'}</span>
          <span>{report.source || 'unknown'}</span>
          <span>{report.roomId || 'no room'}</span>
          <span>{report.updatedAt ? `Updated ${formatDateTime(report.updatedAt)}` : report.id}</span>
        </div>
        <small>
          Reporter {report.reporterUid || 'unknown'} / Target {report.targetUid || 'unknown'}
        </small>
      </div>
      <div className="report-actions">
        <input
          aria-label={`Assignee for ${report.id}`}
          onChange={(event) => setAssigneeUid(event.target.value)}
          placeholder="Assignee UID"
          value={assigneeUid}
        />
        <input
          aria-label={`Resolution note for ${report.id}`}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Resolution note"
          value={note}
        />
        <div className="action-buttons">
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canAssign}
            onClick={() => void runAction('assign')}
            type="button"
          >
            Assign
          </button>
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canResolve}
            onClick={() => void runAction('resolve')}
            type="button"
          >
            Resolve
          </button>
          {status === 'saved' ? <span className="note-status">Saved</span> : null}
          {status === 'error' ? <span className="note-status error-text">Failed</span> : null}
        </div>
      </div>
    </article>
  );
}

function RoomsPanel({
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
      <div className="section-header">
        <div>
          <p className="eyebrow">Rooms</p>
          <h3>Room moderation</h3>
          <p>Inspect room state and record audited moderation actions.</p>
        </div>
        <div className="toolbar">
          <div className="segmented-control" aria-label="Room status">
            {(['active', 'closed'] as AdminRoomStatusFilter[]).map((option) => (
              <button
                className={status === option ? 'selected' : ''}
                key={option}
                onClick={() => onStatusChange(option)}
                type="button"
              >
                {option === 'active' ? 'Active' : 'Closed'}
              </button>
            ))}
          </div>
          <button className="secondary-button compact" onClick={onRefresh} type="button">
            Refresh
          </button>
        </div>
      </div>

      {roomsState.status === 'error' ? <p className="error-text">{roomsState.message}</p> : null}
      {roomsState.status === 'loading' || roomsState.status === 'idle' ? (
        <p className="muted-text">Loading room records.</p>
      ) : null}
      {roomsState.status === 'ready' && roomsState.rooms.length === 0 ? (
        <p className="muted-text">No matching rooms.</p>
      ) : null}
      {roomsState.status === 'ready' && roomsState.rooms.length > 0 ? (
        <div className="room-list">
          {roomsState.rooms.map((room) => (
            <RoomReviewRow key={room.id} onAction={onAction} onRefresh={onRefresh} room={room} />
          ))}
        </div>
      ) : null}
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
  const [reason, setReason] = useState('');
  const [targetUid, setTargetUid] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function runAction(roomAction: AdminRoomAction) {
    setStatus('saving');

    try {
      await onAction(room.id, roomAction, roomAction === 'remove-member' ? targetUid : '', reason);
      setReason('');
      setTargetUid('');
      setStatus('saved');
      onRefresh();
    } catch {
      setStatus('error');
    }
  }

  const canClose = room.status === 'active';
  const canRemove = room.status === 'active' && targetUid.trim().length > 0 && targetUid.trim() !== room.hostId;

  return (
    <article className="room-row">
      <div className="room-main">
        <div>
          <p className="eyebrow">{room.type || 'Room'}</p>
          <strong>{room.title || room.id}</strong>
        </div>
        <div className="room-meta">
          <span>{room.status || 'unknown'}</span>
          <span>{room.visibility || 'unknown'}</span>
          <span>{formatCount(room.participantCount)} participants</span>
          <span>{room.updatedAt ? `Updated ${formatDateTime(room.updatedAt)}` : room.id}</span>
        </div>
        <small>{room.hostDisplayName || room.hostId || 'Unknown host'}</small>
      </div>
      <div className="room-actions">
        <input
          aria-label={`Target member for ${room.title || room.id}`}
          onChange={(event) => setTargetUid(event.target.value)}
          placeholder="Member UID"
          value={targetUid}
        />
        <input
          aria-label={`Moderation reason for ${room.title || room.id}`}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason"
          value={reason}
        />
        <div className="action-buttons">
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canClose}
            onClick={() => void runAction('close-room')}
            type="button"
          >
            Close
          </button>
          <button
            className="secondary-button compact"
            disabled={status === 'saving' || !canRemove}
            onClick={() => void runAction('remove-member')}
            type="button"
          >
            Remove
          </button>
          {status === 'saved' ? <span className="note-status">Saved</span> : null}
          {status === 'error' ? <span className="note-status error-text">Failed</span> : null}
        </div>
      </div>
    </article>
  );
}

function UsersPanel({
  onCreateNote,
  onRefresh,
  onSearchChange,
  search,
  usersState,
}: {
  onCreateNote: (targetUid: string, note: string) => Promise<string>;
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
      <div className="section-header">
        <div>
          <p className="eyebrow">Users</p>
          <h3>User review</h3>
          <p>Review matching profile records and preserve internal notes.</p>
        </div>
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            aria-label="Search users"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search email, uid, or name"
            value={search}
          />
          <button className="secondary-button compact" type="submit">
            Search
          </button>
        </form>
      </div>

      {usersState.status === 'error' ? <p className="error-text">{usersState.message}</p> : null}
      {usersState.status === 'loading' || usersState.status === 'idle' ? (
        <p className="muted-text">Loading user records.</p>
      ) : null}
      {usersState.status === 'ready' && usersState.users.length === 0 ? (
        <p className="muted-text">No matching users.</p>
      ) : null}
      {usersState.status === 'ready' && usersState.users.length > 0 ? (
        <div className="user-list">
          {usersState.users.map((userRow) => (
            <UserReviewRow key={userRow.uid} onCreateNote={onCreateNote} userRow={userRow} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserReviewRow({
  onCreateNote,
  userRow,
}: {
  onCreateNote: (targetUid: string, note: string) => Promise<string>;
  userRow: AdminUserRow;
}) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');

    try {
      await onCreateNote(userRow.uid, note);
      setNote('');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <article className="user-row">
      <div className="avatar-chip">{userRow.avatarLabel || '?'}</div>
      <div className="user-main">
        <strong>{userRow.displayName || 'Unnamed user'}</strong>
        <span>{userRow.email || userRow.uid}</span>
        <small>{userRow.updatedAt ? `Updated ${formatDateTime(userRow.updatedAt)}` : userRow.uid}</small>
      </div>
      <form className="note-form" onSubmit={handleSubmit}>
        <input
          aria-label={`Admin note for ${userRow.displayName || userRow.uid}`}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add note"
          value={note}
        />
        <button className="secondary-button compact" disabled={status === 'saving' || note.trim().length < 2} type="submit">
          Save
        </button>
        {status === 'saved' ? <span className="note-status">Saved</span> : null}
        {status === 'error' ? <span className="note-status error-text">Failed</span> : null}
      </form>
    </article>
  );
}

function OverviewPanel({
  onRefresh,
  overviewState,
}: {
  onRefresh: () => void;
  overviewState:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; metrics: AdminOverviewMetrics }
    | { status: 'error'; message: string };
}) {
  if (overviewState.status === 'error') {
    return (
      <>
        <div>
          <p className="eyebrow">Overview</p>
          <h3>Metrics unavailable</h3>
          <p>{overviewState.message}</p>
        </div>
        <button className="secondary-button compact" onClick={onRefresh} type="button">
          Refresh
        </button>
      </>
    );
  }

  if (overviewState.status !== 'ready') {
    return (
      <>
        <div>
          <p className="eyebrow">Overview</p>
          <h3>Loading metrics</h3>
          <p>Fetching admin-only aggregate counts.</p>
        </div>
        <div className="status-grid">
          <StatusTile label="Users" value="..." />
          <StatusTile label="Active rooms" value="..." />
          <StatusTile label="Reports" value="..." />
        </div>
      </>
    );
  }

  const { metrics } = overviewState;

  return (
    <>
      <div>
        <p className="eyebrow">Overview</p>
        <h3>Operational summary</h3>
        <p>Generated {formatDateTime(metrics.generatedAt)}</p>
        <button className="secondary-button compact" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>
      <div className="status-grid">
        <StatusTile label="Users" value={formatCount(metrics.users)} />
        <StatusTile label="Active rooms" value={formatCount(metrics.activeRooms)} />
        <StatusTile label="Game rooms" value={formatCount(metrics.gameRooms)} />
        <StatusTile label="Private rooms" value={formatCount(metrics.privateRooms)} />
        <StatusTile label="Moderation events" value={formatCount(metrics.moderationEvents)} />
        <StatusTile label="Reports" value={formatCount(metrics.reports)} />
        <StatusTile label="Audit events" value={formatCount(metrics.adminAuditEvents)} />
        <StatusTile label="System" value={metrics.systemStatus === 'ok' ? 'Online' : 'Check'} />
      </div>
    </>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
      setError(nextError instanceof Error ? nextError.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <p className="eyebrow">SDK Heaven</p>
        <h1>Admin sign in</h1>
        <label>
          Email
          <input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button disabled={submitting} type="submit">
          {submitting ? 'Signing in' : 'Sign in'}
        </button>
      </form>
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
    <main className="auth-page">
      <section className="login-panel">
        <p className="eyebrow">Admin dashboard</p>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actionLabel && onAction ? (
          <button onClick={onAction} type="button">
            {actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
