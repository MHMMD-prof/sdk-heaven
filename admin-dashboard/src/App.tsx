import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  createAdminUserNote,
  requestAdminDashboardSession,
  requestAdminOverview,
  requestAdminUsers,
  AdminDashboardSession,
  AdminOverviewMetrics,
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
