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

const nowMs = 2_000_000_000_000;
const decodedToken = {
  auth_time: Math.floor((nowMs - 60_000) / 1000),
  email: 'salem@example.com',
  uid: 'owner-1',
};
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
    nowMs,
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
        welcomeMessage: 'أهلاً بكم',
      },
    });
    expect(normalizeRoomSettingsPatch({ unknownSetting: true })).toMatchObject({ ok: false });
    expect(normalizeRoomSettingsPatch({ themeId: 'royal-theater' })).toMatchObject({ ok: false });
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
      featureFlags: { voice_room_super_moderation: true },
      operatorProfile,
      profile: staffProfile,
      room,
    })).toMatchObject({ ok: true, value: { actorAuthority: 'super-moderator' } });
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      featureFlags: { voice_room_super_moderation: true },
      operatorProfile: { ...operatorProfile, regionCodes: ['SA'] },
      profile: staffProfile,
      room,
    })).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED' });
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      featureFlags: { voice_room_super_moderation: true },
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

    expect(resolve('transfer-ownership', { targetUid: 'member-1' }))
      .toMatchObject({ ok: false, code: 'OWNERSHIP_OFFER_REQUIRED' });
  });

  it('terminates the music lease when the DJ is removed or the room closes', () => {
    const musicRoom = {
      ...room,
      activeDjUid: 'member-1',
      activeMusicLeaseId: 'rml_lease_000000000001',
    };
    const removed = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('remove-member', { targetUid: 'member-1' }),
      decodedToken,
      profile,
      room: musicRoom,
      targetMembership: memberMembership,
    });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: removed.value,
      room: musicRoom,
      targetMembership: memberMembership,
    })).toMatchObject({
      clearActiveMusicLease: true,
      roomPatch: {
        activeDjUid: null,
        activeMusicLeaseId: null,
      },
    });

    const closed = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('close-room'),
      decodedToken,
      profile,
      room: musicRoom,
    });
    expect(buildRoomCommandMutationPlan({
      actorMembership: ownerMembership,
      command: closed.value,
      room: musicRoom,
    })).toMatchObject({
      clearActiveMusicLease: true,
      roomPatch: {
        activeDjUid: null,
        activeMusicLeaseId: null,
        status: 'closed',
      },
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
      body: body('update-room-settings', { settings: { announcement: 'مغلق' } }),
      decodedToken,
      featureFlags: { voice_room_command_center: false },
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });

    const settingsResolution = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('update-room-settings', {
        settings: { announcement: 'أهلاً', slowModeSeconds: 10 },
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
      roomPatch: { announcement: 'أهلاً', revision: 8, slowModeSeconds: 10 },
      liveKit: { type: 'none' },
    });

    const removalResolution = resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('remove-room', { reason: 'owner-request' }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      nowMs,
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

  it('applies atomic staff lockdown behind the fail-closed flag and blocks owner reversal', () => {
    const staffToken = {
      admin: true,
      adminRole: 'super-moderator',
      auth_time: Math.floor((nowMs - 30_000) / 1000),
      email: 'staff@example.com',
      uid: 'staff-1',
    };
    const staffProfile = { avatarLabel: 'R', displayName: 'Region Staff', email: 'staff@example.com', uid: 'staff-1' };
    const operatorProfile = { regionCodes: ['IQ'], role: 'super-moderator', status: 'active', uid: 'staff-1' };
    expect(resolveRoomCommand({
      body: body('staff-lockdown', { reason: 'abuse-report' }),
      decodedToken: staffToken,
      featureFlags: { voice_room_super_moderation: false },
      nowMs,
      operatorProfile,
      profile: staffProfile,
      room,
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });

    const lockdown = resolveRoomCommand({
      body: body('staff-lockdown', { reason: 'abuse-report', reportId: 'report-1' }),
      decodedToken: staffToken,
      featureFlags: { voice_room_super_moderation: true },
      nowMs,
      operatorProfile,
      profile: staffProfile,
      room,
    });
    expect(lockdown.ok).toBe(true);
    expect(buildRoomCommandMutationPlan({
      command: lockdown.value,
      room,
    })).toMatchObject({
      clearActiveGameSession: true,
      liveKit: { type: 'mute-all' },
      roomPatch: {
        audioLockdown: true,
        chatMode: 'off',
        effectsPolicy: 'off',
        gamesPaused: true,
        giftsPaused: true,
        seatRequestsPaused: true,
      },
    });

    const lockedRoom = {
      ...room,
      staffLockdown: {
        byUid: 'staff-1',
        reason: 'abuse-report',
        requestId: 'room_request_0001',
      },
    };
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('unlock-audio'),
      decodedToken,
      nowMs,
      profile,
      room: lockedRoom,
    })).toMatchObject({ ok: false, code: 'STAFF_LOCKDOWN_ACTIVE' });
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('update-room-settings', { settings: { chatMode: 'everyone' } }),
      decodedToken,
      featureFlags: { voice_room_command_center: true },
      nowMs,
      profile,
      room: lockedRoom,
    })).toMatchObject({ ok: false, code: 'STAFF_LOCKDOWN_ACTIVE' });
  });

  it('protects platform staff targets from room-owner actions and requires fresh auth', () => {
    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('mute-member', { targetUid: 'member-1' }),
      decodedToken,
      nowMs,
      profile,
      room,
      targetMembership: memberMembership,
      targetOperatorProfile: {
        role: 'super-moderator',
        status: 'active',
        uid: 'member-1',
      },
    })).toMatchObject({ ok: false, code: 'TARGET_PROTECTED' });

    expect(resolveRoomCommand({
      actorMembership: ownerMembership,
      body: body('remove-room', { reason: 'owner-request' }),
      decodedToken: { ...decodedToken, auth_time: Math.floor((nowMs - 20 * 60_000) / 1000) },
      featureFlags: { voice_room_command_center: true },
      nowMs,
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'FRESH_AUTH_REQUIRED' });
  });

  it('gates every Super Moderator command and protects equal or higher platform staff', () => {
    const staffToken = {
      admin: true,
      adminRole: 'super-moderator',
      auth_time: Math.floor((nowMs - 30_000) / 1000),
      email: 'staff@example.com',
      uid: 'staff-1',
    };
    const staffProfile = { avatarLabel: 'S', displayName: 'Staff', email: 'staff@example.com', uid: 'staff-1' };
    const operatorProfile = { regionCodes: ['IQ'], role: 'super-moderator', status: 'active', uid: 'staff-1' };
    expect(resolveRoomCommand({
      body: body('lock-audio'),
      decodedToken: staffToken,
      featureFlags: { voice_room_super_moderation: false },
      nowMs,
      operatorProfile,
      profile: staffProfile,
      room,
    })).toMatchObject({ code: 'FEATURE_DISABLED', ok: false });
    for (const role of ['owner', 'super-moderator']) {
      expect(resolveRoomCommand({
        body: body('mute-member', { targetUid: 'member-1' }),
        decodedToken: staffToken,
        featureFlags: { voice_room_super_moderation: true },
        nowMs,
        operatorProfile,
        profile: staffProfile,
        room,
        targetMembership: memberMembership,
        targetOperatorProfile: { role, status: 'active' },
      })).toMatchObject({ code: 'TARGET_PROTECTED', ok: false });
    }
  });

  it('restores the exact pre-lockdown controls and supports kick everyone', () => {
    const previousRoom = {
      ...room,
      audioLockdown: true,
      chatMode: 'followers',
      effectsPolicy: 'reduced',
      gamesPaused: true,
      giftsPaused: false,
      musicPaused: true,
      seatRequestsPaused: false,
    };
    const lockdownPlan = buildRoomCommandMutationPlan({
      command: {
        action: 'kick-everyone',
        actorAuthority: 'super-moderator',
        actorUid: 'staff-1',
        nextRevision: 8,
        reason: 'violent incident',
        reportId: 'case-1',
        requestId: 'room_request_0001',
      },
      room: previousRoom,
    });
    expect(lockdownPlan.liveKit).toEqual({ type: 'close-room' });
    expect(lockdownPlan.roomPatch.staffLockdown.previousState).toMatchObject({
      audioLockdown: true,
      chatMode: 'followers',
      effectsPolicy: 'reduced',
      gamesPaused: true,
      giftsPaused: false,
      musicPaused: true,
      seatRequestsPaused: false,
    });
    const clearPlan = buildRoomCommandMutationPlan({
      command: {
        action: 'clear-staff-lockdown',
        actorAuthority: 'super-moderator',
        actorUid: 'staff-1',
        nextRevision: 9,
        reason: 'incident resolved',
        requestId: 'room_request_0002',
      },
      room: { ...lockdownPlan.roomPatch, id: room.id },
    });
    expect(clearPlan.roomPatch).toMatchObject({
      audioLockdown: true,
      chatMode: 'followers',
      effectsPolicy: 'reduced',
      gamesPaused: true,
      giftsPaused: false,
      musicPaused: true,
      seatRequestsPaused: false,
    });
    expect(clearPlan.liveKit).toEqual({ type: 'mute-all' });
  });
});
