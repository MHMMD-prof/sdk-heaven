'use strict';

/**
 * Wave 9 watch-together — lease authority and allowlisted HTTPS catalog (fail-closed).
 * Mirrors shared-music server-clock sync; no device-file / pirate URI ingest.
 */

const { createHash } = require('node:crypto');

const ROOM_WATCH_ACTIONS = Object.freeze([
  'list-room-watch-catalog',
  'claim-watch-lease',
  'heartbeat-watch-lease',
  'update-watch-playback',
  'stop-watch',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const LEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;

const LEASE_TTL_MS = 45_000;
const WATCH_COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const WATCH_LEASE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_CLIENT_VERSION = '1.0.0';
const ROOM_WATCH_PROTOCOL_VERSION = 1;
const PLAYBACK_STATES = Object.freeze(['playing', 'paused']);

/** Allowlisted HTTPS streams only — Google sample bucket (public domain demos). */
const ROOM_WATCH_CATALOG = Object.freeze({
  'big-buck-bunny': Object.freeze({
    durationMs: 596_000,
    itemId: 'big-buck-bunny',
    playbackUri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    titleAr: 'Big Buck Bunny',
  }),
  'elephants-dream': Object.freeze({
    durationMs: 653_000,
    itemId: 'elephants-dream',
    playbackUri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    titleAr: 'Elephants Dream',
  }),
});

function roomWatchError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function normalizeRoomWatchBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    itemId: typeof body.itemId === 'string' ? body.itemId.trim() : '',
    leaseId: typeof body.leaseId === 'string' ? body.leaseId.trim() : '',
    playbackState: typeof body.playbackState === 'string' ? body.playbackState.trim() : '',
    positionMs: Number.isFinite(body.positionMs) && body.positionMs >= 0
      ? Math.floor(body.positionMs)
      : 0,
    protocolVersion: Number.isInteger(body.protocolVersion) ? body.protocolVersion : 0,
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
  };
}

function validateRoomWatchRequest(command) {
  if (!ROOM_WATCH_ACTIONS.includes(command.action) || !FIRESTORE_ID_PATTERN.test(command.roomId)) {
    return roomWatchError('INVALID_REQUEST', 400, 'A valid room watch command is required.');
  }
  if (!REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomWatchError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (
    !isSupportedClientVersion(command.clientVersion)
    || command.protocolVersion !== ROOM_WATCH_PROTOCOL_VERSION
  ) {
    return roomWatchError(
      'CLIENT_UPDATE_REQUIRED',
      426,
      `Room watch requires client version ${MINIMUM_CLIENT_VERSION} or newer.`,
    );
  }
  if (command.action === 'list-room-watch-catalog') {
    return { ok: true, value: command };
  }
  if (command.action === 'claim-watch-lease') {
    if (!ROOM_WATCH_CATALOG[command.itemId]) {
      return roomWatchError('ITEM_UNKNOWN', 404, 'The requested catalog item is not registered.');
    }
    return { ok: true, value: command };
  }
  if (!LEASE_ID_PATTERN.test(command.leaseId)) {
    return roomWatchError('INVALID_REQUEST', 400, 'A valid watch lease ID is required.');
  }
  if (command.action === 'update-watch-playback') {
    if (command.playbackState && !PLAYBACK_STATES.includes(command.playbackState)) {
      return roomWatchError('INVALID_REQUEST', 400, 'A valid playback state is required.');
    }
    if (command.itemId && !ROOM_WATCH_CATALOG[command.itemId]) {
      return roomWatchError('ITEM_UNKNOWN', 404, 'The requested catalog item is not registered.');
    }
  }
  return { ok: true, value: command };
}

function listRoomWatchCatalog({ growthFlags }) {
  if (growthFlags?.watchTogether !== true) {
    return roomWatchError('FEATURE_DISABLED', 503, 'Watch-together is not enabled.');
  }
  return {
    ok: true,
    value: {
      catalog: Object.values(ROOM_WATCH_CATALOG).map((item) => ({ ...item })),
      deviceFilesEnabled: false,
      leaseTtlMs: LEASE_TTL_MS,
      note: 'Approved HTTPS catalog only. Device-file / pirate sources are disabled.',
      syncMode: 'server-clock-catalog-v1',
    },
  };
}

function createRoomWatchLeaseId(roomId, requestId) {
  const digest = createHash('sha256')
    .update(`watch-lease:${roomId}:${requestId}`)
    .digest('hex')
    .slice(0, 24);
  return `rwl_${digest}`;
}

function buildRoomWatchFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.clientVersion,
      command.protocolVersion,
      command.roomId,
      command.leaseId || '',
      command.itemId || '',
      command.playbackState || '',
      String(command.positionMs || 0),
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function resolveWatchAuthority({ actorMembership, operatorProfile, room, senderUid }) {
  const ownerUid = typeof room?.ownerUid === 'string' ? room.ownerUid : room?.hostId;
  if (operatorProfile?.status === 'active' && ['owner', 'super-moderator'].includes(operatorProfile.role)) {
    return { ok: true, authority: operatorProfile.role === 'owner' ? 'platform-owner' : 'super-moderator' };
  }
  if (!actorMembership || actorMembership.status !== 'active') {
    return roomWatchError('NOT_A_MEMBER', 403, 'Active room membership is required.');
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
  return roomWatchError('FORBIDDEN', 403, 'Watch control requires owner, moderator, or DJ privilege.');
}

function canStopWatch(authority) {
  return ['platform-owner', 'super-moderator', 'owner', 'moderator', 'dj'].includes(authority);
}

function canDriveWatch(authority) {
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
    expiresAtMs: lease.expiresAtMs,
    hostDisplayName: lease.hostDisplayName || '',
    hostUid: lease.hostUid,
    leaseId: lease.leaseId,
    nowPlaying: lease.nowPlaying || null,
    revision: lease.revision || 1,
    roomId: lease.roomId,
    status: lease.status,
  };
}

function buildNowPlaying({ catalogItem, positionMs, playbackState }) {
  return {
    durationMs: catalogItem.durationMs,
    itemId: catalogItem.itemId,
    playbackState: playbackState || 'playing',
    playbackUri: catalogItem.playbackUri,
    positionMs: Math.max(0, Math.min(positionMs || 0, catalogItem.durationMs)),
    titleAr: catalogItem.titleAr,
    updatedAtMs: undefined,
  };
}

function resolveClaimWatchLease({
  actorMembership,
  activeLease,
  command,
  growthFlags,
  leaseId,
  nowMs,
  operatorProfile,
  publicProfile,
  room,
  senderUid,
}) {
  if (growthFlags?.watchTogether !== true) {
    return roomWatchError('FEATURE_DISABLED', 503, 'Watch-together is not enabled.');
  }
  if (room?.staffLockdown) {
    return roomWatchError('ROOM_LOCKED', 409, 'Room is under staff lockdown.');
  }
  if (room?.status !== 'active' || room?.availability === 'removed') {
    return roomWatchError('ROOM_UNAVAILABLE', 409, 'This room is not available for watch.');
  }
  const authority = resolveWatchAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canDriveWatch(authority.authority)) {
    return roomWatchError('FORBIDDEN', 403, 'Platform staff may stop watch but cannot claim the lease.');
  }
  if (activeLease && !isLeaseExpired(activeLease, nowMs) && activeLease.hostUid !== senderUid) {
    return roomWatchError('LEASE_HELD', 409, 'Another watch lease is already active in this room.');
  }
  const item = ROOM_WATCH_CATALOG[command.itemId];
  const nowPlaying = buildNowPlaying({
    catalogItem: item,
    playbackState: 'playing',
    positionMs: 0,
  });
  nowPlaying.updatedAtMs = nowMs;
  return {
    ok: true,
    value: {
      authority: authority.authority,
      lease: {
        expiresAtMs: nowMs + LEASE_TTL_MS,
        hostDisplayName: publicProfile?.displayName || actorMembership?.displayName || '',
        hostUid: senderUid,
        leaseId,
        nowPlaying,
        revision: 1,
        roomId: command.roomId,
        status: 'active',
      },
    },
  };
}

function resolveHeartbeatWatchLease({
  actorMembership,
  command,
  growthFlags,
  lease,
  nowMs,
  operatorProfile,
  room,
  senderUid,
}) {
  if (growthFlags?.watchTogether !== true) {
    return roomWatchError('FEATURE_DISABLED', 503, 'Watch-together is not enabled.');
  }
  const authority = resolveWatchAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!lease || lease.leaseId !== command.leaseId) {
    return roomWatchError('LEASE_NOT_FOUND', 404, 'Watch lease was not found.');
  }
  if (lease.hostUid !== senderUid) {
    return roomWatchError('FORBIDDEN', 403, 'Only the active host may heartbeat this lease.');
  }
  if (isLeaseExpired(lease, nowMs)) {
    return roomWatchError('LEASE_EXPIRED', 409, 'The watch lease expired.');
  }
  return {
    ok: true,
    value: {
      expiresAtMs: nowMs + LEASE_TTL_MS,
      revision: Number(lease.revision || 1) + 1,
    },
  };
}

function resolveUpdateWatchPlayback({
  actorMembership,
  command,
  growthFlags,
  lease,
  nowMs,
  operatorProfile,
  room,
  senderUid,
}) {
  if (growthFlags?.watchTogether !== true) {
    return roomWatchError('FEATURE_DISABLED', 503, 'Watch-together is not enabled.');
  }
  if (room?.staffLockdown) {
    return roomWatchError('ROOM_LOCKED', 409, 'Room is under staff lockdown.');
  }
  const authority = resolveWatchAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canDriveWatch(authority.authority)) {
    return roomWatchError('FORBIDDEN', 403, 'Only the watch controller may update playback.');
  }
  if (!lease || lease.leaseId !== command.leaseId || isLeaseExpired(lease, nowMs)) {
    return roomWatchError('LEASE_EXPIRED', 409, 'The watch lease is not active.');
  }
  if (lease.hostUid !== senderUid && !['owner', 'moderator'].includes(authority.authority)) {
    return roomWatchError('FORBIDDEN', 403, 'Only the active host or room staff may update playback.');
  }
  const itemId = command.itemId || lease.nowPlaying?.itemId;
  const item = ROOM_WATCH_CATALOG[itemId];
  if (!item) {
    return roomWatchError('ITEM_UNKNOWN', 404, 'The requested catalog item is not registered.');
  }
  const nowPlaying = buildNowPlaying({
    catalogItem: item,
    playbackState: command.playbackState || lease.nowPlaying?.playbackState || 'playing',
    positionMs: command.positionMs,
  });
  nowPlaying.updatedAtMs = nowMs;
  return {
    ok: true,
    value: {
      expiresAtMs: nowMs + LEASE_TTL_MS,
      nowPlaying,
      revision: Number(lease.revision || 1) + 1,
    },
  };
}

function resolveStopWatch({
  actorMembership,
  command,
  lease,
  operatorProfile,
  room,
  senderUid,
}) {
  const authority = resolveWatchAuthority({
    actorMembership,
    operatorProfile,
    room,
    senderUid,
  });
  if (!authority.ok) return authority;
  if (!canStopWatch(authority.authority)) {
    return roomWatchError('FORBIDDEN', 403, 'Insufficient authority to stop watch.');
  }
  if (!lease || lease.leaseId !== command.leaseId) {
    return roomWatchError('LEASE_NOT_FOUND', 404, 'Watch lease was not found.');
  }
  if (
    lease.hostUid !== senderUid
    && !['platform-owner', 'super-moderator', 'owner', 'moderator'].includes(authority.authority)
  ) {
    return roomWatchError('FORBIDDEN', 403, 'Only the host or room/platform staff may stop this lease.');
  }
  return {
    ok: true,
    value: {
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
  ROOM_WATCH_ACTIONS,
  ROOM_WATCH_CATALOG,
  ROOM_WATCH_PROTOCOL_VERSION,
  WATCH_COMMAND_RETENTION_MS,
  WATCH_LEASE_RETENTION_MS,
  buildRoomWatchFingerprint,
  createRoomWatchLeaseId,
  isLeaseExpired,
  listRoomWatchCatalog,
  mapLeasePublic,
  normalizeRoomWatchBody,
  resolveClaimWatchLease,
  resolveHeartbeatWatchLease,
  resolveStopWatch,
  resolveUpdateWatchPlayback,
  resolveWatchAuthority,
  roomWatchError,
  validateRoomWatchRequest,
};
