import { User } from 'firebase/auth';

export type AdminDashboardSession = {
  admin: true;
  email: string;
  uid: string;
};

type AdminDashboardResponse = AdminDashboardSession & {
  ok: boolean;
};

function getFunctionsBaseUrl() {
  const baseUrl = import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL;

  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error('Missing VITE_FIREBASE_FUNCTIONS_BASE_URL.');
  }

  return baseUrl.replace(/\/$/, '');
}

export async function requestAdminDashboardSession(user: User): Promise<AdminDashboardSession> {
  const token = await user.getIdToken();
  const response = await fetch(`${getFunctionsBaseUrl()}/adminDashboard`, {
    body: JSON.stringify({ action: 'session' }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<AdminDashboardResponse> & {
    error?: string;
  };

  if (!response.ok || payload.ok !== true || payload.admin !== true || !payload.uid) {
    throw new Error(payload.error || 'Admin dashboard access was denied.');
  }

  return {
    admin: true,
    email: payload.email || user.email || '',
    uid: payload.uid,
  };
}
