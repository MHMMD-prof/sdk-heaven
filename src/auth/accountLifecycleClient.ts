import { EmailAuthProvider, reauthenticateWithCredential } from '@firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp, firebaseAuth } from './firebase';

export type AccountLifecycleState = 'active' | 'deletion-pending' | 'purging';
export type AccountDeletionStatus = {
  canCancel?: boolean;
  purgeAfterMillis?: number;
  requestedAtMillis?: number;
  state: AccountLifecycleState | 'cancelled' | 'completed' | 'failed' | 'held';
};

const functions = getFunctions(firebaseApp, 'us-central1');

export async function reauthenticateCurrentUser(password: string) {
  const user = firebaseAuth.currentUser;
  if (!user?.email || !password) throw new Error('RECENT_LOGIN_REQUIRED');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

export async function requestDeletionCommand(reason = '') {
  return callLifecycle('request-account-deletion', { reason });
}

export async function cancelDeletionCommand() {
  return callLifecycle('cancel-account-deletion');
}

export async function getDeletionStatusCommand() {
  return callLifecycle('get-account-deletion-status');
}

async function callLifecycle(action: string, payload?: Record<string, unknown>) {
  const callable = httpsCallable<
    { action: string; payload?: Record<string, unknown>; requestId: string; version: 1 },
    { ok: true; result: AccountDeletionStatus }
  >(functions, 'accountLifecycleCommand');
  const result = await callable({
    action,
    ...(payload ? { payload } : {}),
    requestId: `account_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`,
    version: 1,
  });
  return result.data.result;
}
