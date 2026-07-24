import { describe, expect, it } from 'vitest';

import {
  createAccountDeletionRequestPayload,
  validateAccountDeletionRequest,
} from '../accountLifecycle';

const authUser = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.com',
  uid: 'uid-1',
};

describe('accountLifecycle', () => {
  it('creates a minimal account deletion request payload from trusted auth user data', () => {
    expect(createAccountDeletionRequestPayload(authUser, { reason: '  Done for now  ' })).toEqual({
      uid: 'uid-1',
      email: 'salem@example.com',
      displayName: 'Salem',
      avatarLabel: 'S',
      status: 'requested',
      reason: 'Done for now',
    });
  });

  it('allows empty reasons and rejects overly long reasons', () => {
    expect(validateAccountDeletionRequest({ reason: '   ' })).toEqual({
      ok: true,
      value: {},
    });
    expect(validateAccountDeletionRequest({ reason: 'x'.repeat(241) })).toMatchObject({
      ok: false,
    });
  });
});
