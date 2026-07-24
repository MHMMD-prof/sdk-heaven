import { ProfileStatus } from './types';

export type AuthGateRoute = 'login' | 'profile-setup' | 'main' | 'loading';

type ResolveAuthGateRouteInput = {
  initializing: boolean;
  userExists: boolean;
  profileStatus: ProfileStatus;
};

export function resolveAuthGateRoute({
  initializing,
  profileStatus,
  userExists,
}: ResolveAuthGateRouteInput): AuthGateRoute {
  if (initializing) {
    return 'loading';
  }

  if (!userExists) {
    return 'login';
  }

  if (profileStatus === 'loading') {
    return 'loading';
  }

  if (profileStatus !== 'complete') {
    return 'profile-setup';
  }

  return 'main';
}
