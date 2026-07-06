import { ProfileStatus } from './types';

export type AuthGateRoute = 'login' | 'email-verification' | 'profile-setup' | 'main' | 'loading';

type ResolveAuthGateRouteInput = {
  initializing: boolean;
  userExists: boolean;
  isEmailVerified: boolean;
  profileStatus: ProfileStatus;
};

export function resolveAuthGateRoute({
  initializing,
  isEmailVerified,
  profileStatus,
  userExists,
}: ResolveAuthGateRouteInput): AuthGateRoute {
  if (initializing) {
    return 'loading';
  }

  if (!userExists) {
    return 'login';
  }

  if (!isEmailVerified) {
    return 'email-verification';
  }

  if (profileStatus === 'loading') {
    return 'loading';
  }

  if (profileStatus !== 'complete') {
    return 'profile-setup';
  }

  return 'main';
}
