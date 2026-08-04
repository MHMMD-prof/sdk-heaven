import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  listRoomMusicCatalog,
  normalizeRoomMusicBody,
  resolveClaimDjLease,
  resolveHeartbeatDjLease,
  resolveStopMusic,
  resolveUpdateNowPlaying,
  validateRoomMusicRequest,
} = require('./roomMusicCore');

const nowMs = 2_000_000_000_000;
const requestId = 'roommusic_request_0001';
const roomId = 'room-1';
const leaseId = 'rml_lease_000000000001';

const baseMember = {
  authorityRole: 'owner',
  displayName: 'Owner',
  status: 'active',
  uid: 'owner-1',
};
const baseProfile = { displayName: 'Owner', uid: 'owner-1' };
const baseRoom = {
  availability: 'active',
  id: roomId,
  ownerUid: 'owner-1',
  status: 'active',
};

describe('roomMusicCore', () => {
  it('fails closed when shared music flag is off', () => {
    expect(listRoomMusicCatalog({ featureFlags: {} }).code).toBe('FEATURE_DISABLED');
    expect(resolveClaimDjLease({
      actorMembership: baseMember,
      command: { trackId: 'helix-one', roomId },
      featureFlags: { voice_room_shared_music: false },
      leaseId,
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'owner-1',
    }).code).toBe('FEATURE_DISABLED');
  });

  it('validates catalog claims and rejects unknown tracks', () => {
    expect(validateRoomMusicRequest(normalizeRoomMusicBody({
      action: 'claim-dj-lease',
      clientVersion: '1.0.0',
      protocolVersion: 2,
      requestId,
      roomId,
      trackId: 'helix-one',
    })).ok).toBe(true);
    expect(validateRoomMusicRequest(normalizeRoomMusicBody({
      action: 'claim-dj-lease',
      clientVersion: '1.0.0',
      protocolVersion: 2,
      requestId,
      roomId,
      trackId: 'not-real',
    })).code).toBe('TRACK_UNKNOWN');
  });

  it('requires a supported client version', () => {
    expect(validateRoomMusicRequest(normalizeRoomMusicBody({
      action: 'list-room-music-catalog',
      clientVersion: '0.9.9',
      protocolVersion: 2,
      requestId,
      roomId,
    }))).toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED', status: 426 });
  });

  it('rejects older clients that share the same app version but lack protocol v2', () => {
    expect(validateRoomMusicRequest(normalizeRoomMusicBody({
      action: 'list-room-music-catalog',
      clientVersion: '1.0.0',
      requestId,
      roomId,
    }))).toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED', status: 426 });
  });

  it('uses catalog metadata and server-clamps playback positions', () => {
    const lease = resolveClaimDjLease({
      actorMembership: baseMember,
      command: { trackId: 'helix-one', roomId },
      featureFlags: { voice_room_shared_music: true },
      leaseId,
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'owner-1',
    }).value.lease;
    const updated = resolveUpdateNowPlaying({
      actorMembership: baseMember,
      command: {
        artist: 'Spoofed',
        leaseId,
        playbackState: 'paused',
        positionMs: 999_999,
        roomId,
        title: 'Spoofed',
      },
      featureFlags: { voice_room_shared_music: true },
      lease,
      nowMs: nowMs + 1_000,
      room: baseRoom,
      senderUid: 'owner-1',
    });
    expect(updated.value.nowPlaying).toMatchObject({
      artist: 'SoundHelix',
      playbackState: 'paused',
      positionMs: 372_000,
      title: 'Helix One',
    });
  });

  it('rejects heartbeats after lease expiry and permits cleanup stop behind the kill switch', () => {
    const lease = {
      djUid: 'owner-1',
      expiresAtMs: nowMs - 1,
      leaseId,
      revision: 1,
      status: 'active',
    };
    expect(resolveHeartbeatDjLease({
      actorMembership: baseMember,
      command: { leaseId, roomId },
      featureFlags: { voice_room_shared_music: true },
      lease,
      nowMs,
      room: baseRoom,
      senderUid: 'owner-1',
    })).toMatchObject({ code: 'LEASE_EXPIRED' });
    expect(resolveStopMusic({
      actorMembership: baseMember,
      command: { leaseId, roomId },
      featureFlags: { voice_room_shared_music: false },
      lease,
      nowMs,
      room: baseRoom,
      senderUid: 'owner-1',
    }).ok).toBe(true);
  });

  it('claims a lease for room owner and exposes now-playing without filesystem paths', () => {
    const claimed = resolveClaimDjLease({
      actorMembership: baseMember,
      command: { trackId: 'helix-one', roomId },
      featureFlags: { voice_room_shared_music: true },
      leaseId,
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'owner-1',
    });
    expect(claimed.ok).toBe(true);
    expect(claimed.value.lease.nowPlaying).toMatchObject({
      playbackState: 'playing',
      title: 'Helix One',
      trackId: 'helix-one',
    });
    expect(claimed.value.lease.nowPlaying.playbackUri.startsWith('https://')).toBe(true);
  });

  it('allows super-moderator to stop an active lease', () => {
    const stopped = resolveStopMusic({
      actorMembership: undefined,
      command: { leaseId, roomId },
      featureFlags: { voice_room_shared_music: true },
      lease: {
        djUid: 'owner-1',
        leaseId,
        publishedTrackSid: 'TR_abc123',
        revision: 2,
        status: 'active',
      },
      nowMs,
      operatorProfile: { role: 'super-moderator', status: 'active', uid: 'staff-1' },
      room: baseRoom,
      senderUid: 'staff-1',
    });
    expect(stopped.ok).toBe(true);
    expect(stopped.value.liveKit).toMatchObject({
      type: 'mute-track',
      targetUid: 'owner-1',
      trackSid: 'TR_abc123',
    });
  });
});
