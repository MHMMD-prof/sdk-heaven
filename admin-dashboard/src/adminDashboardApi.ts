import { User } from 'firebase/auth';

export type AdminDashboardSession = {
  admin: true;
  email: string;
  uid: string;
};

export type AdminOverviewMetrics = {
  activeRooms: number;
  adminAuditEvents: number;
  generatedAt: string;
  moderationEvents: number;
  privateRooms: number;
  reports: number;
  users: number;
};

type AdminDashboardResponse = AdminDashboardSession & {
  error?: string;
  ok: boolean;
};

type AdminOverviewResponse = {
  error?: string;
  ok: boolean;
  overview?: Partial<AdminOverviewMetrics>;
};

function getFunctionsBaseUrl() {
  const baseUrl = import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL;

  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error('Missing VITE_FIREBASE_FUNCTIONS_BASE_URL.');
  }

  return baseUrl.replace(/\/$/, '');
}

export async function requestAdminDashboardSession(user: User): Promise<AdminDashboardSession> {
  const payload = await requestAdminDashboard<Partial<AdminDashboardResponse>>(user, { action: 'session' });

  if (payload.ok !== true || payload.admin !== true || !payload.uid) {
    throw new Error(payload.error || 'Admin dashboard access was denied.');
  }

  return {
    admin: true,
    email: payload.email || user.email || '',
    uid: payload.uid,
  };
}

export async function requestAdminOverview(user: User): Promise<AdminOverviewMetrics> {
  const payload = await requestAdminDashboard<AdminOverviewResponse>(user, { action: 'overview' });
  const overview = payload.overview;

  if (payload.ok !== true || !isOverviewMetrics(overview)) {
    throw new Error(payload.error || 'Admin overview is unavailable.');
  }

  return overview;
}

async function requestAdminDashboard<T extends { error?: string; ok?: boolean }>(
  user: User,
  body: { action: 'overview' | 'session' },
): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${getFunctionsBaseUrl()}/adminDashboard`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const payload = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    throw new Error(payload.error || 'Admin dashboard request failed.');
  }

  return payload;
}

function isOverviewMetrics(value: unknown): value is AdminOverviewMetrics {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metrics = value as Record<string, unknown>;
  return (
    typeof metrics.activeRooms === 'number' &&
    typeof metrics.adminAuditEvents === 'number' &&
    typeof metrics.generatedAt === 'string' &&
    typeof metrics.moderationEvents === 'number' &&
    typeof metrics.privateRooms === 'number' &&
    typeof metrics.reports === 'number' &&
    typeof metrics.users === 'number'
  );
}
