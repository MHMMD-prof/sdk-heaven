import { describe, expect, it } from 'vitest';

import { getAdminRouteByKey, getAdminRouteFromPath, primaryAdminRoutes } from './adminRoutes';

describe('admin routes', () => {
  it('resolves direct and trailing-slash paths', () => {
    expect(getAdminRouteFromPath('/reports').key).toBe('reports');
    expect(getAdminRouteFromPath('/settings/').key).toBe('settings');
  });

  it('falls back to overview for unknown paths', () => {
    expect(getAdminRouteFromPath('/missing').key).toBe('overview');
  });

  it('keeps settings in the footer navigation', () => {
    expect(primaryAdminRoutes.some((route) => route.key === 'settings')).toBe(false);
    expect(getAdminRouteByKey('settings').path).toBe('/settings');
  });

  it('exposes the room incentives workspace as a direct primary route', () => {
    expect(getAdminRouteFromPath('/incentives').key).toBe('incentives');
    expect(primaryAdminRoutes.some((route) => route.key === 'incentives')).toBe(true);
  });

  it('exposes the cosmetics registry as a direct primary route', () => {
    expect(getAdminRouteFromPath('/cosmetics').key).toBe('cosmetics');
    expect(primaryAdminRoutes.some((route) => route.key === 'cosmetics')).toBe(true);
  });
});
