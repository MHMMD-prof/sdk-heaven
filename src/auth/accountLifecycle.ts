import { AuthUser } from './types';

export type AccountDeletionRequestInput = {
  reason?: string;
};

export type AccountDeletionRequestPayload = {
  uid: string;
  email: string;
  displayName: string;
  avatarLabel: string;
  status: 'requested';
  reason?: string;
};

export type AccountDeletionRequestValidation =
  | {
      ok: true;
      value: {
        reason?: string;
      };
    }
  | {
      ok: false;
      message: string;
    };

export function validateAccountDeletionRequest(
  input: AccountDeletionRequestInput,
): AccountDeletionRequestValidation {
  const reason = input.reason?.trim();

  if (reason && reason.length > 240) {
    return {
      ok: false,
      message: 'سبب حذف الحساب يجب ألا يتجاوز 240 حرفا.',
    };
  }

  return {
    ok: true,
    value: reason ? { reason } : {},
  };
}

export function createAccountDeletionRequestPayload(
  authUser: AuthUser,
  input: AccountDeletionRequestInput,
): AccountDeletionRequestPayload | null {
  const validation = validateAccountDeletionRequest(input);

  if (!validation.ok) {
    return null;
  }

  return {
    uid: authUser.uid,
    email: authUser.email,
    displayName: authUser.displayName,
    avatarLabel: authUser.avatarLabel,
    status: 'requested',
    ...validation.value,
  };
}
