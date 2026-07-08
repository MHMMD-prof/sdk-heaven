import { User } from 'firebase/auth';

export type AdminDashboardSession = {
  admin: true;
  email: string;
  uid: string;
};

export type AdminOverviewMetrics = {
  activeRooms: number;
  adminAuditEvents: number;
  gameRooms: number;
  generatedAt: string;
  moderationEvents: number;
  privateRooms: number;
  reports: number;
  systemStatus: 'ok';
  users: number;
};

export type AdminUserRow = {
  avatarLabel: string;
  displayName: string;
  email: string;
  uid: string;
  updatedAt: string;
};

export type AdminRoomRow = {
  createdAt: string;
  currentGameId: string;
  hostAvatarLabel: string;
  hostDisplayName: string;
  hostId: string;
  id: string;
  participantCount: number;
  status: string;
  title: string;
  type: string;
  updatedAt: string;
  visibility: string;
};

export type AdminRoomStatusFilter = 'active' | 'closed';
export type AdminRoomAction = 'close-room' | 'remove-member';

type AdminDashboardResponse = AdminDashboardSession & {
  error?: string;
  ok: boolean;
};

type AdminOverviewResponse = {
  error?: string;
  ok: boolean;
  overview?: Partial<AdminOverviewMetrics>;
};

type AdminUsersResponse = {
  error?: string;
  ok: boolean;
  users?: unknown;
};

type AdminUserNoteResponse = {
  error?: string;
  noteId?: string;
  ok: boolean;
};

type AdminRoomsResponse = {
  error?: string;
  ok: boolean;
  rooms?: unknown;
};

type AdminRoomActionResponse = {
  error?: string;
  eventId?: string;
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

export async function requestAdminUsers(user: User, search: string): Promise<AdminUserRow[]> {
  const payload = await requestAdminDashboard<AdminUsersResponse>(user, {
    action: 'users',
    search,
  });

  if (payload.ok !== true || !Array.isArray(payload.users)) {
    throw new Error(payload.error || 'Admin users are unavailable.');
  }

  return payload.users.filter(isAdminUserRow);
}

export async function createAdminUserNote(user: User, targetUid: string, note: string): Promise<string> {
  const payload = await requestAdminDashboard<AdminUserNoteResponse>(user, {
    action: 'user-note',
    note,
    targetUid,
  });

  if (payload.ok !== true || !payload.noteId) {
    throw new Error(payload.error || 'Admin user note could not be saved.');
  }

  return payload.noteId;
}

export async function requestAdminRooms(user: User, status: AdminRoomStatusFilter): Promise<AdminRoomRow[]> {
  const payload = await requestAdminDashboard<AdminRoomsResponse>(user, {
    action: 'rooms',
    status,
  });

  if (payload.ok !== true || !Array.isArray(payload.rooms)) {
    throw new Error(payload.error || 'Admin rooms are unavailable.');
  }

  return payload.rooms.filter(isAdminRoomRow);
}

export async function executeAdminRoomAction(
  user: User,
  roomId: string,
  roomAction: AdminRoomAction,
  targetUid: string,
  reason: string,
): Promise<string> {
  const payload = await requestAdminDashboard<AdminRoomActionResponse>(user, {
    action: 'room-action',
    reason,
    roomAction,
    roomId,
    targetUid,
  });

  if (payload.ok !== true || !payload.eventId) {
    throw new Error(payload.error || 'Admin room action failed.');
  }

  return payload.eventId;
}

async function requestAdminDashboard<T extends { error?: string; ok?: boolean }>(
  user: User,
  body:
    | { action: 'overview' | 'session' }
    | { action: 'rooms'; status: AdminRoomStatusFilter }
    | { action: 'room-action'; reason: string; roomAction: AdminRoomAction; roomId: string; targetUid: string }
    | { action: 'users'; search: string }
    | { action: 'user-note'; note: string; targetUid: string },
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

function isAdminUserRow(value: unknown): value is AdminUserRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.avatarLabel === 'string' &&
    typeof row.displayName === 'string' &&
    typeof row.email === 'string' &&
    typeof row.uid === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

function isAdminRoomRow(value: unknown): value is AdminRoomRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.createdAt === 'string' &&
    typeof row.currentGameId === 'string' &&
    typeof row.hostAvatarLabel === 'string' &&
    typeof row.hostDisplayName === 'string' &&
    typeof row.hostId === 'string' &&
    typeof row.id === 'string' &&
    typeof row.participantCount === 'number' &&
    typeof row.status === 'string' &&
    typeof row.title === 'string' &&
    typeof row.type === 'string' &&
    typeof row.updatedAt === 'string' &&
    typeof row.visibility === 'string'
  );
}

function isOverviewMetrics(value: unknown): value is AdminOverviewMetrics {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metrics = value as Record<string, unknown>;
  return (
    typeof metrics.activeRooms === 'number' &&
    typeof metrics.adminAuditEvents === 'number' &&
    typeof metrics.gameRooms === 'number' &&
    typeof metrics.generatedAt === 'string' &&
    typeof metrics.moderationEvents === 'number' &&
    typeof metrics.privateRooms === 'number' &&
    typeof metrics.reports === 'number' &&
    metrics.systemStatus === 'ok' &&
    typeof metrics.users === 'number'
  );
}
