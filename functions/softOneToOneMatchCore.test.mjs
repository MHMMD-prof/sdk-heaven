import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  genderPreferenceAllows,
  isSoftMatchQueueWaiting,
  mapSoftMatchResult,
  normalizeSoftMatchEnqueueInput,
  pickSoftMatchPeer,
  buildSoftMatchRoomDocument,
} = require('./softOneToOneMatchCore');

describe('softOneToOneMatchCore', () => {
  it('normalizes optional gender preference', () => {
    expect(normalizeSoftMatchEnqueueInput({})).toEqual({ ok: true, value: { preferGender: '' } });
    expect(normalizeSoftMatchEnqueueInput({ preferGender: 'female' })).toEqual({
      ok: true,
      value: { preferGender: 'female' },
    });
    expect(normalizeSoftMatchEnqueueInput({ preferGender: 'other' }).ok).toBe(false);
    expect(normalizeSoftMatchEnqueueInput({ foo: 1 }).ok).toBe(false);
  });

  it('enforces mutual gender preferences without inventing gender', () => {
    expect(genderPreferenceAllows({
      actorGender: 'male',
      actorPreferGender: 'female',
      peerGender: 'female',
      peerPreferGender: '',
    })).toBe(true);
    expect(genderPreferenceAllows({
      actorGender: 'male',
      actorPreferGender: 'female',
      peerGender: '',
      peerPreferGender: '',
    })).toBe(false);
    expect(genderPreferenceAllows({
      actorGender: 'male',
      actorPreferGender: '',
      peerGender: 'female',
      peerPreferGender: 'female',
    })).toBe(false);
  });

  it('picks earliest waiting peer and skips blocked or expired', () => {
    const nowMs = 10_000;
    const peer = pickSoftMatchPeer([
      {
        enqueuedAtMs: 100,
        expiresAtMs: nowMs - 1,
        gender: 'female',
        preferGender: '',
        status: 'waiting',
        uid: 'expired',
      },
      {
        enqueuedAtMs: 200,
        expiresAtMs: nowMs + 1000,
        gender: 'female',
        preferGender: '',
        status: 'waiting',
        uid: 'blocked',
      },
      {
        enqueuedAtMs: 300,
        expiresAtMs: nowMs + 1000,
        gender: 'female',
        preferGender: '',
        status: 'waiting',
        uid: 'ok',
      },
    ], {
      actorGender: 'male',
      actorPreferGender: 'female',
      actorUid: 'me',
      blockedPeerUids: new Set(['blocked']),
      nowMs,
    });
    expect(peer?.uid).toBe('ok');
    expect(isSoftMatchQueueWaiting({
      expiresAtMs: nowMs + 1,
      status: 'waiting',
    }, nowMs)).toBe(true);
  });

  it('builds private soft-match rooms and maps results', () => {
    const room = buildSoftMatchRoomDocument({
      hostDisplayName: 'Host',
      hostUid: 'host-1',
      nowMs: 1,
      peerUid: 'peer-1',
      roomId: 'soft_room',
      sessionId: 'sm_host_req',
    });
    expect(room).toMatchObject({
      participantCount: 2,
      seatMode: 'locked',
      softMatch: true,
      themeId: 'majlis-default',
      title: 'محادثة صوتية سريعة',
      type: 'voice',
      visibility: 'private',
    });
    expect(mapSoftMatchResult({
      inviteCode: room.inviteCode,
      peerLabelAr: 'ضيف صوتي',
      roomId: 'soft_room',
      sessionExpiresAtMs: 99,
      sessionId: 'sm_host_req',
      status: 'matched',
    })).toMatchObject({
      roomId: 'soft_room',
      status: 'matched',
    });
  });
});
