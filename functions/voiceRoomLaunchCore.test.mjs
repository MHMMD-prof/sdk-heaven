import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  evaluateLaunchStage,
  evaluateVoiceRoomLaunchAccess,
  summarizeLaunchReadiness,
} = require('./voiceRoomLaunchCore');

const policy = {
  allowedUids: ['owner-uid'],
  audienceMode: 'allowlist',
  minimumClientVersion: '1.0.0',
  recordingDecision: 'rejected',
  stageId: 8,
  status: 'testing',
};

const stage8Features = {
  voice_room_v2_read: true,
  voice_room_v2_mutations: true,
  voice_room_seats: true,
  voice_room_command_center: true,
  voice_room_media: true,
  voice_room_super_moderation: true,
  voice_room_chat: true,
  voice_room_safety: true,
  voice_room_ownership_transfer: true,
  voice_room_gifts: true,
  voice_room_entry_effects: true,
  voice_room_games: true,
  voice_room_shared_music: true,
  voice_room_safety_recording: false,
  voice_room_new_joins: true,
};

describe('voiceRoomLaunchCore', () => {
  it('permanently rejects the rejected recording stage', () => {
    expect(evaluateLaunchStage({ voice_room_safety_recording: true }, 9, {
      policy: { ...policy, stageId: 9 },
    })).toMatchObject({
      code: 'STAGE_REJECTED',
      ready: false,
    });
  });

  it('requires every earlier capability before reporting music ready', () => {
    expect(evaluateLaunchStage({ voice_room_shared_music: true }, 8, { policy })).toMatchObject({
      ready: false,
    });
    expect(evaluateLaunchStage(stage8Features, 8, { policy })).toMatchObject({
      ready: true,
      missingTrue: [],
      leakingFalse: [],
    });
  });

  it('does not report a later stage from an unrelated enabled flag', () => {
    const summary = summarizeLaunchReadiness({ voice_room_games: true }, {
      policy: { ...policy, stageId: 7 },
    });
    expect(summary.highestReadyStageId).toBe(0);
  });

  it('requires an exact active audience policy and minimum client version', () => {
    expect(evaluateLaunchStage(stage8Features, 8, {
      policy: { ...policy, allowedUids: [], minimumClientVersion: '' },
    })).toMatchObject({
      ready: false,
      policyProblems: expect.arrayContaining(['audience-empty', 'minimum-client-version-missing']),
    });
  });

  it('treats the new-joins freeze as paused, not ready', () => {
    expect(evaluateLaunchStage({
      ...stage8Features,
      voice_room_new_joins: false,
    }, 8, { policy })).toMatchObject({
      ready: false,
      policyProblems: expect.arrayContaining(['new-joins-paused']),
    });
  });

  it('enforces allowlist and minimum-client access', () => {
    expect(evaluateVoiceRoomLaunchAccess({
      clientVersion: '1.0.0',
      decodedToken: { uid: 'owner-uid' },
      policy,
      requireClientVersion: true,
    })).toMatchObject({ ok: true });
    expect(evaluateVoiceRoomLaunchAccess({
      clientVersion: '1.0.0',
      decodedToken: { uid: 'outsider' },
      policy,
      requireClientVersion: true,
    })).toMatchObject({ ok: false, code: 'LAUNCH_AUDIENCE_DENIED' });
    expect(evaluateVoiceRoomLaunchAccess({
      clientVersion: '0.9.0',
      decodedToken: { uid: 'owner-uid' },
      policy,
      requireClientVersion: true,
    })).toMatchObject({ ok: false, code: 'CLIENT_UPGRADE_REQUIRED' });
  });

  it('keeps public access closed until the explicit broad-release gate is enabled', () => {
    const publicPolicy = {
      ...policy,
      allowedUids: ['owner-uid'],
      audienceMode: 'public',
      stageId: 10,
      status: 'active',
    };
    expect(evaluateVoiceRoomLaunchAccess({
      decodedToken: { uid: 'outsider' },
      policy: publicPolicy,
    })).toMatchObject({ ok: false, code: 'LAUNCH_AUDIENCE_DENIED' });
    expect(evaluateVoiceRoomLaunchAccess({
      decodedToken: { uid: 'outsider' },
      policy: { ...publicPolicy, broadReleaseReady: true },
    })).toMatchObject({ ok: true });
    expect(evaluateVoiceRoomLaunchAccess({
      decodedToken: { uid: 'owner-uid' },
      policy: publicPolicy,
    })).toMatchObject({ ok: true });
  });
});
