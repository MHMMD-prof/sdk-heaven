import { describe, expect, it } from 'vitest';

import { buildUserWorkspaceUrl, canManageStoreWorkspace, getUserWorkspaceCapabilities, parseUserWorkspaceSearch, readAuditTarget } from './adminWorkspacePolicy';

describe('admin workspace policy', () => {
  it('restores valid user dossier routes and rejects unknown sections', () => {
    expect(parseUserWorkspaceSearch('?user=user-1&section=economy')).toEqual({ section: 'economy', uid: 'user-1' });
    expect(parseUserWorkspaceSearch('?user=user-1&section=unknown')).toEqual({ section: 'overview', uid: 'user-1' });
  });

  it('preserves unrelated query state when opening and closing a dossier', () => {
    const opened = buildUserWorkspaceUrl('https://admin.example/users?country=IQ#directory', 'user/a', 'social');
    expect(opened).toBe('/users?country=IQ&user=user%2Fa&section=social#directory');
    expect(buildUserWorkspaceUrl(`https://admin.example${opened}`, '', 'overview')).toBe('/users?country=IQ#directory');
    expect(readAuditTarget('?target=%20user-1%20')).toBe('user-1');
  });

  it('separates support, moderation, and economy capabilities', () => {
    expect(getUserWorkspaceCapabilities(['users:view', 'users:note'])).toEqual({
      canAddNotes: true,
      canManageEconomy: false,
      canManageRepresentative: false,
      canManageUsers: false,
    });
    expect(getUserWorkspaceCapabilities(['users:view', 'users:manage'])).toEqual({
      canAddNotes: true,
      canManageEconomy: false,
      canManageRepresentative: false,
      canManageUsers: true,
    });
    expect(getUserWorkspaceCapabilities(['users:view', 'store:manage'])).toEqual({
      canAddNotes: false,
      canManageEconomy: true,
      canManageRepresentative: true,
      canManageUsers: false,
    });
    expect(parseUserWorkspaceSearch('?user=user-1&section=representative')).toEqual({
      section: 'representative',
      uid: 'user-1',
    });
    expect(canManageStoreWorkspace(['store:view'])).toBe(false);
    expect(canManageStoreWorkspace(['store:view', 'store:manage'])).toBe(true);
  });
});
