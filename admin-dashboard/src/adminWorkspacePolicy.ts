export type UserWorkspaceSection = 'overview' | 'moderation' | 'economy' | 'social' | 'notes' | 'activity';

export const userWorkspaceSections: readonly UserWorkspaceSection[] = ['overview', 'moderation', 'economy', 'social', 'notes', 'activity'];

export type UserWorkspaceCapabilities = {
  canAddNotes: boolean;
  canManageEconomy: boolean;
  canManageUsers: boolean;
};

export function getUserWorkspaceCapabilities(permissions: readonly string[]): UserWorkspaceCapabilities {
  const canManageUsers = permissions.includes('users:manage');
  return {
    canAddNotes: canManageUsers || permissions.includes('users:note'),
    canManageEconomy: permissions.includes('store:manage'),
    canManageUsers,
  };
}

export function canManageStoreWorkspace(permissions: readonly string[]) {
  return permissions.includes('store:manage');
}

export function parseUserWorkspaceSearch(search: string): { section: UserWorkspaceSection; uid: string } {
  const params = new URLSearchParams(search);
  const candidate = params.get('section') as UserWorkspaceSection | null;
  return {
    section: candidate && userWorkspaceSections.includes(candidate) ? candidate : 'overview',
    uid: params.get('user')?.trim() || '',
  };
}

export function buildUserWorkspaceUrl(href: string, uid: string, section: UserWorkspaceSection) {
  const url = new URL(href);
  if (uid) {
    url.searchParams.set('user', uid);
    url.searchParams.set('section', section);
  } else {
    url.searchParams.delete('user');
    url.searchParams.delete('section');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readAuditTarget(search: string) {
  return new URLSearchParams(search).get('target')?.trim().slice(0, 160) || '';
}
