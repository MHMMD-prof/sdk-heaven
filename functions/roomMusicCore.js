/**
 * Wave 11 shared room music — lease authority and catalog (fail-closed).
 * Device-file → LiveKit MediaStreamTrack publish remains a native follow-up;
 * catalog sync is the shippable shared-hearing path without uploading user files.
 */

const { createHash } = require('node:crypto');

const ROOM_MUSIC_ACTIONS = Object.freeze([
  'list-room-music-catalog',
  'claim-dj-lease',
  'heartbeat-dj-lease',
  'update-now-playing',
  'stop-music',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const LEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;

const LEASE_TTL_MS = 45_000;
const MUSIC_COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const MUSIC_LEASE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_CLIENT_VERSION = '1.0.0';
const ROOM_MUSIC_PROTOCOL_VERSION = 2;

const PLAYBACK_STATES = Object.freeze(['playing', 'paused']);

/** Allowlisted shared catalog — HTTPS only; never local filesystem paths. */
const ROOM_MUSIC_CATALOG = Object.freeze({
  'helix-one': Object.freeze({
    artist: 'SoundHelix',
    durationMs: 372_000,
    playbackUri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    title: 'Helix One',
    trackId: 'helix-one',
  }),
  'helix-two': Object.freeze({
    artist: 'SoundHelix',
    durationMs: 322_000,
    playbackUri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    title: 'Helix Two',
    trackId: 'helix-two',
  }),
});

function roomMusicError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function normalizeRoomMusicBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    leaseId: typeof body.leaseId === 'string' ? body.leaseId.trim() : '',
    positionMs: Number.isFinite(body.positionMs) && body.positionMs >= 0
      ? Math.floor(body.positionMs)
      : 0,
    protocolVersion: Number.isInteger(body.protocolVersion) ? body.protocolVersion : 0,
    playbackState: typeof body.playbackState === 'string' ? body.playbackState.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    trackId: typeof body.trackId === 'string' ? body.trackId.trim() : '',
  };
}

function validateRoomMusicRequest(command) {
  if (!ROOM_MUSIC_ACTIONS.includes(command.action) || !FIRESTORE_ID_PATTERN.test(command.roomId)) {
    return roomMusicError('INVALID_REQUEST', 400, 'A valid room music command is required.');
  }
  if (!REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomMusicError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (
    !isSupportedClientVersion(command.clientVersion)
    || command.protocolVersion !== ROOM_MUSIC_PROTOCOL_VERSION
  ) {
    return roomMusicError(
      'CLIENT_UPDATE_REQUIRED',
      426,
      `Room music requires client version ${MINIMUM_CLIENT_VERSION} or newer.`,
    );
  }
  if (command.action === 'list-room-music-catalog') {
    return { ok: true, value: command };
  }
  if (command.action === 'claim-dj-lease') {
    if (!ROOM_MUSIC_CATALOG[command.trackId]) {
      return roomMusicError('TRACK_UNKNOWN', 404, 'The requested catalog track is not registered.');
    }
    return { ok: true, value: command };
  }
  if (!LEASE_ID_PATTERN.test(command.leaseId)) {
    return roomMusicError('INVALID_REQUEST', 400, 'A valid music lease ID is required.');
  }
  if (command.action === 'update-now-playing') {
    if (command.playbackState && !PLAYBACK_STATES.includes(command.playbackState)) {
      return roomMusicError('INVALID_REQUEST', 400, 'A valid playback state is required.');
    }
    if (command.trackId && !ROOM_MUSIC_CATALOG[command.trackId]) {
      return roomMusicError('TRACK_UNKNOWN', 404, 'The requested catalog track is not registered.');
    }
  }
  return { ok: true, value: command };
}

function listRoomMusicCatalog({ featureFlags }) {
  if (featureFlags?.voice_room_shared_music !== true) {
    return roomMusicError('FEATURE_DISABLED', 503, 'Shared room music is not enabled.');
  }
  return {
    ok: true,
    value: {
      catalog: Object.values(ROOM_MUSIC_CATALOG).map((track) => ({ ...track })),
      deviceFilesEnabled: false,
      leaseTtlMs: LEASE_TTL_MS,
      note: 'Foreground catalog sync uses the server clock. Device-file broadcast is unavailable.',
      syncMode: 'server-clock-catalog-v1',
    },
  };
}

function createRoomMusicLeaseId(roomId, requestId) {
  const digest = createHash('sha256')
    .update(`music-lease:${roomId}:${requestId}`)
    .digest('hex')
    .slice(0, 24);
  return `rml_${digest}`;
}

function buildRoomMusicFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.clientVersion,
      command.protocolVersion,
      command.roomId,
      command.leaseId || '',
      command.trackId || '',
      command.playbackState || '',
      String(command.positionMs || 0),
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function resolveMusicAuthority({ actorMembership, operatorProfile, room, senderUid }) {
  const ownerUid = typeof room?.ownerUid === 'string' ? room.ownerUid : room?.hostId;
  if (operatorProfile?.status === 'active' && ['owner', 'super-moderator'].includes(operatorProfile.role)) {
    return { ok: true, authority: operatorProfile.role === 'owner' ? 'platform-owner' : 'super-moderator' };
  }
  if (!actorMembership || actorMembership.status !== 'active') {
    return roomMusicError('NOT_A_MEMBER', 403, 'Active room membership is required.');
  }
  if (ownerUid && ownerUid === senderUid) {
    return { ok: true, authority: 'owner' };
  }
  if (actorMembership.authorityRole === 'moderator') {
    return { ok: true, authority: 'moderator' };
  }
  if (actorMembership.privileges?.canManageMusic === true) {
    return { ok: true, authority: 'dj' };
  }
  return roomMusicError('FORBIDDEN', 403, 'Music control requires owner, moderator, or DJ privilege.');
}

function canStopMusic(authority) {
  return ['platform-owner', 'super-moderator', 'owner', 'moderator', 'dj'].includes(authority);
}

function canDriveMusic(authority) {
  return ['owner', 'moderator', 'dj'].includes(authority);
}

function isLeaseExpired(lease, nowMs) {
  if (!lease) return true;
  if (lease.status !== 'active') return true;
  const expiresAtMs = Number(lease.expiresAtMs || 0);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

function mapLeasePublic(lease) {
  if (!lease) return null;
  return {
    djDisplayName: lease.djDisplayName || '',
    djUid: lease.djUid,
    expiresAtMs: lease.expiresAtMs,
    leaseId: lease.leaseId,
    nowPlaying: lease.nowPlaying || null,
    publishedTrackSid: lease.publishedTrackSid || '',
    revision: lease.revision || 1,
    roomId: lease.roomId,
    status: lease.status,
  };
}

function buildNowPlaying({ catalogTrack, positionMs, playbackState }) {
  const track = catalogTrack;
  return {
    artist: track.artist,
    durationMs: track.durationMs,
    playbackState: playbackState || 'playing',
    playbackUri: track.playbackUri,
    positionMs: Math.max(0, Math.min(positionMs || 0, track.durationMs)),
    title: track.title,
    trackId: track.trackId,
    updatedAtMs: undefined,
  };
}

function resolveClaimDjLease({
  actorMembership,
  command,
  featureFlags,
  nowMs,
  operatorProfile,
  publicProfile,
  room,
  senderUid,
  leaseId,
  activeLease,
}) {
  if (featureFlags?.voice_room_shared_music !== true) {
    return roomMusicError('FEATURE_DISABLED', 503, 'Shared room music is not enabled.');
  }
  if (room?.musicPaused === true || room?.staffLockdown) {
    return roomMusicError('MUSIC_PAUSED', 409, 'Room music is paused by staff lockdown.');
  }
  if (room?.status !== 'active' || room?.availability === 'removed') {
    return roomMusicError('ROOM_UNAVAILABLE', 409, 'This room is not available for music.');
  }
  const authority = resolveMusicAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canDriveMusic(authority.authority)) {
    return roomMusicError('FORBIDDEN', 403, 'Platform staff may stop music but cannot claim the DJ lease.');
  }
  if (activeLease && !isLeaseExpired(activeLease, nowMs) && activeLease.djUid !== senderUid) {
    return roomMusicError('LEASE_HELD', 409, 'Another DJ lease is already active in this room.');
  }
  const track = ROOM_MUSIC_CATALOG[command.trackId];
  const nowPlaying = buildNowPlaying({
    catalogTrack: track,
    playbackState: 'playing',
    positionMs: 0,
  });
  nowPlaying.updatedAtMs = nowMs;
  return {
    ok: true,
    value: {
      authority: authority.authority,
      lease: {
        djDisplayName: publicProfile?.displayName || actorMembership?.displayName || '',
        djUid: senderUid,
        expiresAtMs: nowMs + LEASE_TTL_MS,
        leaseId,
        nowPlaying,
        publishedTrackSid: '',
        revision: 1,
        roomId: command.roomId,
        status: 'active',
      },
      liveKit: { type: 'none' },
    },
  };
}

function resolveHeartbeatDjLease({
  actorMembership,
  command,
  featureFlags,
  lease,
  nowMs,
  operatorProfile,
  room,
  senderUid,
}) {
  if (featureFlags?.voice_room_shared_music !== true) {
    return roomMusicError('FEATURE_DISABLED', 503, 'Shared room music is not enabled.');
  }
  const authority = resolveMusicAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!lease || lease.leaseId !== command.leaseId) {
    return roomMusicError('LEASE_NOT_FOUND', 404, 'Music lease was not found.');
  }
  if (lease.djUid !== senderUid) {
    return roomMusicError('FORBIDDEN', 403, 'Only the active DJ may heartbeat this lease.');
  }
  if (isLeaseExpired(lease, nowMs)) {
    return roomMusicError('LEASE_EXPIRED', 409, 'The music lease expired.');
  }
  return {
    ok: true,
    value: {
      expiresAtMs: nowMs + LEASE_TTL_MS,
      liveKit: { type: 'none' },
      revision: Number(lease.revision || 1) + 1,
    },
  };
}

function resolveUpdateNowPlaying({
  actorMembership,
  command,
  featureFlags,
  lease,
  nowMs,
  operatorProfile,
  room,
  senderUid,
}) {
  if (featureFlags?.voice_room_shared_music !== true) {
    return roomMusicError('FEATURE_DISABLED', 503, 'Shared room music is not enabled.');
  }
  if (room?.musicPaused === true || room?.staffLockdown) {
    return roomMusicError('MUSIC_PAUSED', 409, 'Room music is paused by staff lockdown.');
  }
  const authority = resolveMusicAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canDriveMusic(authority.authority)) {
    return roomMusicError('FORBIDDEN', 403, 'Only the DJ controller may update now-playing.');
  }
  if (!lease || lease.leaseId !== command.leaseId || isLeaseExpired(lease, nowMs)) {
    return roomMusicError('LEASE_EXPIRED', 409, 'The music lease is not active.');
  }
  if (lease.djUid !== senderUid && !['owner', 'moderator'].includes(authority.authority)) {
    return roomMusicError('FORBIDDEN', 403, 'Only the active DJ or room staff may update now-playing.');
  }
  const trackId = command.trackId || lease.nowPlaying?.trackId;
  const track = ROOM_MUSIC_CATALOG[trackId];
  if (!track) {
    return roomMusicError('TRACK_UNKNOWN', 404, 'The requested catalog track is not registered.');
  }
  const nowPlaying = buildNowPlaying({
    catalogTrack: track,
    playbackState: command.playbackState || lease.nowPlaying?.playbackState || 'playing',
    positionMs: command.positionMs,
  });
  nowPlaying.updatedAtMs = nowMs;
  return {
    ok: true,
    value: {
      expiresAtMs: nowMs + LEASE_TTL_MS,
      liveKit: { type: 'none' },
      nowPlaying,
      revision: Number(lease.revision || 1) + 1,
    },
  };
}

function resolveStopMusic({
  actorMembership,
  command,
  featureFlags,
  lease,
  nowMs,
  operatorProfile,
  room,
  senderUid,
}) {
  const authority = resolveMusicAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canStopMusic(authority.authority)) {
    return roomMusicError('FORBIDDEN', 403, 'Insufficient authority to stop room music.');
  }
  if (!lease || lease.leaseId !== command.leaseId) {
    return roomMusicError('LEASE_NOT_FOUND', 404, 'Music lease was not found.');
  }
  if (
    lease.djUid !== senderUid
    && !['platform-owner', 'super-moderator', 'owner', 'moderator'].includes(authority.authority)
  ) {
    return roomMusicError('FORBIDDEN', 403, 'Only the DJ or room/platform staff may stop this lease.');
  }
  const liveKit = lease.publishedTrackSid && lease.djUid
    ? {
      type: 'mute-track',
      targetUid: lease.djUid,
      trackSid: lease.publishedTrackSid,
    }
    : { type: 'none' };
  return {
    ok: true,
    value: {
      liveKit,
      nowMs,
      revision: Number(lease.revision || 1) + 1,
    },
  };
}

function isSupportedClientVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  if (!match) return false;
  const current = match.slice(1).map(Number);
  const minimum = MINIMUM_CLIENT_VERSION.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

module.exports = {
  LEASE_TTL_MS,
  MINIMUM_CLIENT_VERSION,
  MUSIC_COMMAND_RETENTION_MS,
  MUSIC_LEASE_RETENTION_MS,
  PLAYBACK_STATES,
  ROOM_MUSIC_PROTOCOL_VERSION,
  ROOM_MUSIC_ACTIONS,
  ROOM_MUSIC_CATALOG,
  buildRoomMusicFingerprint,
  createRoomMusicLeaseId,
  isLeaseExpired,
  listRoomMusicCatalog,
  mapLeasePublic,
  normalizeRoomMusicBody,
  resolveClaimDjLease,
  resolveHeartbeatDjLease,
  resolveMusicAuthority,
  resolveStopMusic,
  resolveUpdateNowPlaying,
  roomMusicError,
  validateRoomMusicRequest,
};
