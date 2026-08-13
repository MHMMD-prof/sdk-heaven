import { describe, expect, it } from 'vitest';

import {
  disabledPersonalChatFrontendRollout,
  isPersonalChatFrontendEnabled,
  mapPersonalChatFrontendRollout,
  stableRolloutBucket,
} from '../personalChatFrontendRollout';

describe('personal chat frontend Wave 6 rollout', () => {
  it('maps missing and malformed configuration fail-closed', () => {
    expect(mapPersonalChatFrontendRollout(undefined)).toEqual(disabledPersonalChatFrontendRollout);
    expect(mapPersonalChatFrontendRollout({ schemaVersion: 2, stage: 'global' })).toEqual(disabledPersonalChatFrontendRollout);
    expect(mapPersonalChatFrontendRollout({ percentage: 500, salt: 'short', schemaVersion: 1, stage: 'percentage' })).toEqual({
      percentage: 0,
      salt: '',
      schemaVersion: 1,
      stage: 'percentage',
    });
  });

  it('requires the independent master switch for every stage', () => {
    const global = { percentage: 100, salt: '', schemaVersion: 1 as const, stage: 'global' as const };
    expect(isPersonalChatFrontendEnabled({ internalPreview: true, masterEnabled: false, rollout: global, uid: 'u1' })).toBe(false);
    expect(isPersonalChatFrontendEnabled({ internalPreview: true, masterEnabled: 'true', rollout: global, uid: 'u1' })).toBe(false);
    expect(isPersonalChatFrontendEnabled({ internalPreview: false, masterEnabled: true, rollout: global, uid: 'u1' })).toBe(true);
  });

  it('limits internal stage to internal-preview builds', () => {
    const rollout = { percentage: 0, salt: '', schemaVersion: 1 as const, stage: 'internal' as const };
    expect(isPersonalChatFrontendEnabled({ internalPreview: false, masterEnabled: true, rollout, uid: 'u1' })).toBe(false);
    expect(isPersonalChatFrontendEnabled({ internalPreview: true, masterEnabled: true, rollout, uid: 'u1' })).toBe(true);
  });

  it('assigns stable percentage cohorts and rejects anonymous users', () => {
    const rollout = { percentage: 30, salt: 'royal-wave6', schemaVersion: 1 as const, stage: 'percentage' as const };
    const first = stableRolloutBucket('user-42', rollout.salt);
    expect(stableRolloutBucket('user-42', rollout.salt)).toBe(first);
    expect(isPersonalChatFrontendEnabled({ internalPreview: false, masterEnabled: true, rollout })).toBe(false);
    expect(isPersonalChatFrontendEnabled({ internalPreview: false, masterEnabled: true, rollout, uid: 'user-42' })).toBe(first < 30);
  });

  it('rolls back immediately when either gate goes dark', () => {
    const off = disabledPersonalChatFrontendRollout;
    expect(isPersonalChatFrontendEnabled({ internalPreview: true, masterEnabled: true, rollout: off, uid: 'u1' })).toBe(false);
  });
});
