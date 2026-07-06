import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import { requestAdminDashboardSession, AdminDashboardSession } from './adminDashboardApi';
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

  function navigateToRoute(route: DashboardRoute) {
    if (route.path !== window.location.pathname) {
      window.history.pushState({}, '', route.path);
    }

    setActiveRoute(route);
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
        </section>
      </section>
    </main>
  );
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
