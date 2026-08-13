const {
  isSupportedCountryCode,
  isValidPublicId,
  normalizeSearchName,
} = require('./socialProfileCore');
const { readPublicAvatarFrameProjection } = require('./avatarFrameProjectionCore');

const DEFAULT_DISCOVERY_LIMIT = 12;
const MAX_DISCOVERY_LIMIT = 20;

function normalizeUserDiscoveryInput(input) {
  if (input === undefined || input === null) {
    input = {};
  }

  if (
    typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some((key) => !['countryCode', 'limit', 'query'].includes(key))
    || (input.query !== undefined && typeof input.query !== 'string')
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';

  if (rawQuery.length > 64) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const normalizedQuery = normalizeSearchName(rawQuery);
  const rawLimit = Number(input.limit);
  const hasLimit = input.limit !== undefined;

  if (
    hasLimit
    && (typeof input.limit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_DISCOVERY_LIMIT)
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const limit = hasLimit ? rawLimit : DEFAULT_DISCOVERY_LIMIT;
  const countryCode = input.countryCode === undefined || input.countryCode === ''
    ? undefined
    : isSupportedCountryCode(input.countryCode)
      ? input.countryCode
      : null;

  if (countryCode === null) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  if (rawQuery && !isValidPublicId(rawQuery) && normalizedQuery.length < 2) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return {
    ok: true,
    value: {
      countryCode,
      limit,
      mode: isValidPublicId(rawQuery) ? 'public-id' : normalizedQuery ? 'name' : 'featured',
      normalizedQuery,
      query: rawQuery,
    },
  };
}

function mapDiscoveryProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return undefined;
  }

  return {
    avatarModerationStatus: profile.avatarModerationStatus,
    avatarUrl: profile.avatarModerationStatus === 'clear' && typeof profile.avatarUrl === 'string'
      ? profile.avatarUrl
      : '',
    bio: typeof profile.bio === 'string' ? profile.bio : '',
    countryCode: profile.countryCode,
    coupleLevel: readCount(profile.coupleLevel),
    createdAt: profile.createdAt,
    displayName: profile.displayName,
    ...(readPublicAvatarFrameProjection(profile) ? { equippedAvatarFrame: readPublicAvatarFrameProjection(profile) } : {}),
    friendCount: readCount(profile.friendCount),
    followerCount: readCount(profile.followerCount),
    followingCount: readCount(profile.followingCount),
    ...(profile.gender === 'male' || profile.gender === 'female' ? { gender: profile.gender } : {}),
    giftScore: readCount(profile.giftScore),
    moderationStatus: profile.moderationStatus,
    normalizedName: profile.normalizedName,
    publicId: profile.publicId,
    representativeBadgeActive: profile.representativeBadge?.active === true,
    ...(typeof profile.specialId === 'string' ? { specialId: profile.specialId } : {}),
    uid: profile.uid,
    updatedAt: profile.updatedAt,
  };
}

function filterVisibleDiscoveryProfiles({
  blockedUids = new Set(),
  countryCode,
  limit = DEFAULT_DISCOVERY_LIMIT,
  profiles = [],
  requestingUid,
}) {
  return profiles
    .filter((profile) => profile?.uid !== requestingUid)
    .filter((profile) => !blockedUids.has(profile?.uid))
    .filter((profile) => !countryCode || profile?.countryCode === countryCode)
    .slice(0, limit);
}

function readCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  DEFAULT_DISCOVERY_LIMIT,
  MAX_DISCOVERY_LIMIT,
  filterVisibleDiscoveryProfiles,
  mapDiscoveryProfile,
  normalizeUserDiscoveryInput,
};
