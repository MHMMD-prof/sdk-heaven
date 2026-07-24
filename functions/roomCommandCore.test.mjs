import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRoomCommandFingerprint,
  buildRoomCommandMutationPlan,
  normalizeRoomCommandBody,
  normalizeRoomSettingsPatch,
  resolveMemberAuthority,
  resolveRoomCommand,
  resolveStaffRoomAuthority,
} = require('./roomCommandCore');

const decodedToken = { email: 'salem@example.com', uid: 'owner-1' };
const profile = { avatarLabel: 'S', displayName: 'Salem', email: 'salem@example.com', uid: 'owner-1' };
const room = {
  availability: 'active',
  countryCode: 'IQ',
  hostId: 'owner-1',
  id: 'room-1',
  moderatorCount: 0,
  ownerUid: 'owner-1',
  participantCount: 3,
  revision: 7,
  schemaVersion: 2,
  status: 'active',
};
const ownerMembership = { authorityRole: 'owner', role: 'host', status: 'active', uid: 'owner-1' };
const memberMembership = {
  avatarLabel: 'D',
  authorityRole: 'member',
  canPublishAudio: false,
  displayName: 'Dana',
  privileges: { canManageMusic: false },
  role: 'listener',
  schemaVersion: 2,
  seatId: null,
  status: 'active',
  uid: 'member-1',
};

function body(action, extra = {}) {
  return {
    action,
    expectedRevision: 7,
    requestId: 'room_request_0001',
    roomId: 'room-1',
    ...extra,
  };
}

function resolve(action, extra = {}) {
  return resolveRoomCommand({
    actorMembership: ownerMembership,
    body: body(action, extra),
    decodedToken,
    profile,
    room,
    targetMembership: extra.targetUid ? memberMembership : undefined,
  });
}

describe('roomCommandCore v2', () => {
  it('normalizes replay and optimistic concurrency fields', () => {
    const command = normalizeRoomCommandBody({
      action: ' close-room ',
      expectedRevision: 7,
      reason: ` ${'x'.repeat(300)} `,
      requestId: ' room_request_0001 ',
      roomId: ' room-1 ',
    });
    expect(command).toMatchObject({
      action: 'close-room',
      expectedRevision: 7,
      requestId: 'room_request_0001',
      roomId: 'room-1',
    });
    expect(command.reason).toHaveLength(240);
    expect(buildRoomCommandFingerprint('owner-1', command)).not.toContain('room_request_0001');
  });

  it('strictly normalizes the owner room settings patch', () => {
    expect(normalizeRoomSettingsPatch({
      announcement: '  مساء الخير  ',
      chatMode: 'everyone',
      effectsPolicy: 'reduced',
      historyVisibility: 'after-join',
      keywordFilterMode: 'standard',
      slowModeSeconds: 10,
      themeId: 'royal',
      welcomeMessage: '  أهلاً بكم  ',
    })).toEqual({
      ok: true,
      value: {
        announcement: 'مساء الخير',
        chatMode: 'everyone',
        effectsPolicy: 'reduced',
        historyVisibility: 'after-join',
        keywordFilterMode: 'standard',
        slowModeSeconds: 10,
        themeId: 'royal',
        welcomeMessage: 'أهلاً بكم',
      },
    });
    expect(normalizeRoomSettingsPatch({ unknownSetting: true })).toMatchObject({ ok: false });
    expect(normalizeRoomSettingsPatch({ slowModeSeconds: 7 })).toMatchObject({ ok: false });
    expect(normalizeRoomSettingsPatch({ announcement: 'x'.repeat(161) })).toMatchObject({ ok: false });
  });

  it('allows owner authority and returns a deterministic next revision', () => {
    expect(resolve('promote-speaker', { targetUid: 'member-1' })).toMatchObject({
      ok: true,
      value: { actorAuthority: 'owner', currentRevision: 7, nextRevision: 8 },
    });
    expect(resolve('close-room')).toMatchObject({ ok: true, value: { nextRevision: 8 } });
    expect(resolve('report-member', { targetUid: 'member-1', expectedRevision: undefined })).toMatchObject({
      ok: true,
      value: { nextRevision: 7 },
    });
  });

  it('rejects missing and stale revisions with stable error codes', () => {
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('close-room', { expectedRevision: undefined }),
      decodedToken,
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'REVISION_REQUIRED', status: 409 });
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('close-room', { expectedRevision: 6 }),
      decodedToken,
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', details: { revision: 7 } });
  });

  it('does not trust a forged owner authority field', () => {
    const forged = { ...memberMembership, authorityRole: 'owner', uid: 'member-1' };
    expect(resolveMemberAuthority(forged, 'member-1', room)).toBe('member');
    expect(resolveRoomCommand({
      actorMembership: forged,
      body: body('close-room'),
      decodedToken: { email: 'dana@example.com', uid: 'member-1' },
      profile: { avatarLabel: 'D', displayName: 'Dana', email: 'dana@example.com', uid: 'member-1' },
      room,
    })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('enforces moderator hierarchy and the 20-moderator cap', () => {
    const moderator = { ...ownerMembership, authorityRole: 'moderator', role: 'listener', uid: 'mod-1' };
    const moderatorIdentity = { email: 'mod@example.com', uid: 'mod-1' };
    const moderatorProfile = { avatarLabel: 'M', displayName: 'Moderator', email: 'mod@example.com', uid: 'mod-1' };
    expect(resolveRoomCommand({
      actorMembership: moderator,
      body: body('mute-member', { targetUid: 'member-1' }),
      decodedToken: moderatorIdentity,
      profile: moderatorProfile,
      room,
      targetMembership: memberMembership,
    })).toMatchObject({ ok: true, value: { actorAuthority: 'moderator' } });
    expect(resolveRoomCommand({
      actorMembership: moderator,
      body: body('assign-moderator', { targetUid: 'member-1' }),
      decodedToken: moderatorIdentity,
      profile: moderatorProfile,
      room,
      targetMembership: memberMembership,
    })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('assign-moderator', { targetUid: 'member-1' }),
      decodedToken,
      profile,
      room: { ...room, moderatorCount: 20 },
      targetMembership: memberMembership,
    })).toMatchObject({ ok: false, code: 'MODERATOR_LIMIT_REACHED' });
  });

  it('allows only server-scoped regional Super Moderators', () => {
    const staffToken = { admin: true, adminRole: 'super-moderator', email: 'staff@example.com', uid: 'staff-1' };
    const staffProfile = { avatarLabel: 'R', displayName: 'Region Staff', email: 'staff@example.com', uid: 'staff-1' };
    const operatorProfile = { regionCodes: ['IQ'], role: 'super-moderator', status: 'active', uid: 'staff-1' };
    expect(resolveStaffRoomAuthority({ decodedToken: staffToken, operatorProfile, room })).toMatchObject({
      authority: 'super-moderator',
      regionCode: 'IQ',
    });
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      operatorProfile,
      profile: staffProfile,
      room,
    })).toMatchObject({ ok: true, value: { actorAuthority: 'super-moderator' } });
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      operatorProfile: { ...operatorProfile, regionCodes: ['SA'] },
      profile: staffProfile,
      room,
    })).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED' });
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      operatorProfile,
      profile: staffProfile,
      room: { ...room, countryCode: undefined },
    })).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED' });
  });

  it('builds authoritative Firestore and LiveKit mutation plans', () => {
    const promoted = resolve('promote-speaker', { targetUid: 'member-1' });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: promoted.value,
      room,
      targetMembership: memberMembership,
    })).toMatchObject({
      roomPatch: { revision: 8 },
      targetMemberPatch: { canPublishAudio: true, role: 'speaker' },
      liveKit: { type: 'update-permission', targetUid: 'member-1', canPublish: true },
    });

    const transferred = resolve('transfer-ownership', { targetUid: 'member-1' });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: transferred.value,
      room,
      targetMembership: memberMembership,
    })).toMatchObject({
      actorMemberPatch: { authorityRole: 'member', role: 'listener' },
      roomPatch: { hostId: 'member-1', ownerUid: 'member-1', revision: 8 },
      targetMemberPatch: { authorityRole: 'owner', role: 'host' },
    });
  });

  it('disables legacy speaker promotion after explicit seats activate', () => {
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('promote-speaker', { targetUid: 'member-1' }),
      decodedToken,
      profile,
      room: { ...room, seatEngineVersion: 1 },
      targetMembership: memberMembership,
    })).toMatchObject({ ok: false, code: 'SEAT_COMMAND_REQUIRED' });
  });

  it('gates owner settings and recoverable room removal behind the Command Center flag', () => {
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('update-room-settings', { settings: { themeId: 'royal' } }),
      decodedToken,
      featureFlags: { voice_room_command_center: false },
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });

    const settingsResolution = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('update-room-settings', {
        settings: { announcement: 'أهلاً', slowModeSeconds: 10, themeId: 'royal' },
      }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      profile,
      room,
    });
    expect(settingsResolution).toMatchObject({ ok: true, value: { actorAuthority: 'owner' } });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: settingsResolution.value,
      room,
    })).toMatchObject({
      roomPatch: { announcement: 'أهلاً', revision: 8, slowModeSeconds: 10, themeId: 'royal' },
      liveKit: { type: 'none' },
    });

    const removalResolution = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('remove-room', { reason: 'owner-request' }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      profile,
      room,
    });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: removalResolution.value,
      room,
    })).toMatchObject({
      roomPatch: {
        availability: 'removed',
        removalReason: 'owner-request',
        revision: 8,
        status: 'closed',
      },
      liveKit: { type: 'close-room' },
    });
  });

  it('allows authorized room authorities to revoke an active room ban', () => {
    const resolution = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('unban-member', { targetUid: 'member-1' }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      profile,
      room,
      targetBan: { status: 'active', targetUid: 'member-1' },
      targetMembership: { ...memberMembership, status: 'removed' },
    });
    expect(resolution).toMatchObject({ ok: true, value: { actorAuthority: 'owner' } });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: resolution.value,
      room,
      targetMembership: { ...memberMembership, status: 'removed' },
    })).toMatchObject({
      banPatch: { status: 'revoked', targetUid: 'member-1' },
      roomPatch: { revision: 8 },
      targetMemberDelete: true,
    });
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('unban-member', { targetUid: 'member-1' }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      profile,
      room,
      targetBan: { status: 'revoked', targetUid: 'member-1' },
    })).toMatchObject({ ok: false, code: 'ROOM_BAN_NOT_ACTIVE' });
  });
});
