import { isRoomCountryCode } from '../voice/roomProfile';
import { readAvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { readCoupleEffectProjection } from '../cosmetics/coupleEffects';
import { readEquipmentCosmetics } from '../cosmetics/equipmentCosmetics';
import { mapStatusPresentation } from '../status/statusPresentation';
import type {
  ProfileGender,
  PublicProfilePresentationInput,
  PublicUserProfile,
} from './types';

const PUBLIC_PROFILE_MODERATION_STATUSES = ['active', 'suspended', 'removed'] as const;
const AVATAR_MODERATION_STATUSES = ['clear', 'pending', 'removed'] as const;

export function mapPublicUserProfile(data: unknown, expectedUid?: string): PublicUserProfile | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const candidate = data as Record<string, unknown>;
  const uid = readBoundedString(candidate.uid, 128);
  const displayName = readBoundedString(candidate.displayName, 32);
  const normalizedName = readBoundedString(candidate.normalizedName, 64);
  const publicId = typeof candidate.publicId === 'string' && /^[1-9][0-9]{6}$/.test(candidate.publicId)
    ? candidate.publicId
    : '';
  const countryCode = isRoomCountryCode(candidate.countryCode) ? candidate.countryCode : undefined;
  const specialId = typeof candidate.specialId === 'string' && /^[0-9]{7}$/.test(candidate.specialId)
    ? candidate.specialId
    : undefined;
  const moderationStatus = PUBLIC_PROFILE_MODERATION_STATUSES.find(
    (status) => candidate.moderationStatus === status,
  );
  const avatarModerationStatus = AVATAR_MODERATION_STATUSES.find(
    (status) => candidate.avatarModerationStatus === status,
  );

  if (
    !uid
    || (expectedUid && uid !== expectedUid)
    || displayName.length < 2
    || normalizedName.length < 2
    || normalizedName !== normalizeSearchName(displayName)
    || !publicId
    || !countryCode
    || !moderationStatus
    || !avatarModerationStatus
  ) {
    return undefined;
  }

  const gender = readGender(candidate.gender);
  const equippedAvatarFrame = readAvatarFrameProjection(candidate);
  const equippedCosmetics = readEquipmentCosmetics(candidate);
  const coupleEffect = readCoupleEffectProjection(candidate.coupleEffect);
  const statusPresentation = mapStatusPresentation(candidate.statusPresentation);
  return {
    avatarModerationStatus,
    avatarUrl: readBoundedString(candidate.avatarUrl, 2048),
    bio: readBoundedString(candidate.bio, 160),
    countryCode,
    ...(coupleEffect ? { coupleEffect } : {}),
    coupleLevel: readNonNegativeInteger(candidate.coupleLevel),
    createdAt: candidate.createdAt,
    displayName,
    ...(equippedAvatarFrame ? { equippedAvatarFrame } : {}),
    ...(Object.keys(equippedCosmetics).length ? { equippedCosmetics } : {}),
    friendCount: readNonNegativeInteger(candidate.friendCount),
    followerCount: readNonNegativeInteger(candidate.followerCount),
    followingCount: readNonNegativeInteger(candidate.followingCount),
    ...(gender ? { gender } : {}),
    giftScore: readNonNegativeInteger(candidate.giftScore),
    moderationStatus,
    normalizedName,
    publicId,
    representativeBadgeActive: (
      candidate.representativeBadge !== null
      && typeof candidate.representativeBadge === 'object'
      && (candidate.representativeBadge as Record<string, unknown>).active === true
    ),
    ...(specialId ? { specialId } : {}),
    ...(statusPresentation ? { statusPresentation } : {}),
    uid,
    updatedAt: candidate.updatedAt,
    ...(readVipTierProjection(candidate.vipTier) ? { vipTier: readVipTierProjection(candidate.vipTier)! } : {}),
    ...(readFamilyProjection(candidate.family) ? { family: readFamilyProjection(candidate.family)! } : {}),
  };
}

function readFamilyProjection(value: unknown): PublicUserProfile['family'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const familyId = typeof candidate.familyId === 'string' ? candidate.familyId.trim() : '';
  const nameAr = typeof candidate.nameAr === 'string' ? candidate.nameAr.trim() : '';
  const role = candidate.role;
  if (!familyId || !nameAr || (role !== 'owner' && role !== 'elder' && role !== 'member')) {
    return undefined;
  }
  return {
    badgeColor: typeof candidate.badgeColor === 'string' && candidate.badgeColor.trim()
      ? candidate.badgeColor.trim().slice(0, 32)
      : '#5B8C5A',
    familyId: familyId.slice(0, 64),
    nameAr: nameAr.slice(0, 40),
    role: role as 'elder' | 'member' | 'owner',
  };
}

export function validatePublicProfilePresentation(input: PublicProfilePresentationInput):
  | { ok: true; value: PublicProfilePresentationInput }
  | { ok: false; messageAr: string } {
  const bio = typeof input.bio === 'string' ? input.bio.trim() : '';

  if (bio.length > 160) {
    return { ok: false, messageAr: 'النبذة يجب ألا تتجاوز 160 حرفاً.' };
  }

  if (!isRoomCountryCode(input.countryCode)) {
    return { ok: false, messageAr: 'اختر دولة مدعومة.' };
  }

  if (input.gender !== undefined && input.gender !== 'male' && input.gender !== 'female') {
    return { ok: false, messageAr: 'قيمة الجنس غير صالحة.' };
  }

  return {
    ok: true,
    value: {
      bio,
      countryCode: input.countryCode,
      ...(input.gender ? { gender: input.gender } : {}),
    },
  };
}

/** V1 coupleLevel is a coupled flag (0/1), not intimacy progression. */
export function formatCoupleRelationshipStatus(coupleLevel: number) {
  return Number.isSafeInteger(coupleLevel) && coupleLevel > 0 ? 'مرتبط' : 'غير مرتبط';
}

export function createSocialRequestId(prefix: string, now = Date.now(), random = Math.random()) {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'social';
  const randomPart = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(10, '0');
  return `${safePrefix}_${now.toString(36)}_${randomPart}`.slice(0, 80);
}

export async function subscribePublicProfile(
  uid: string,
  listener: (profile: PublicUserProfile | undefined) => void,
  onError: () => void,
) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);

  return onSnapshot(
    doc(firebaseDb, 'publicProfiles', uid),
    (snapshot) => listener(snapshot.exists() ? mapPublicUserProfile(snapshot.data(), uid) : undefined),
    onError,
  );
}

export async function updatePublicProfilePresentation(
  uid: string,
  input: PublicProfilePresentationInput,
) {
  const validation = validatePublicProfilePresentation(input);

  if (!validation.ok) {
    throw new Error(validation.messageAr);
  }

  const [{ firebaseAuth, firebaseDb }, { doc, getDoc }, { requestProfilePresentationUpdate }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
    import('./requestSocialCommand'),
  ]);
  if (firebaseAuth.currentUser?.uid !== uid) throw new Error('PERMISSION_DENIED');
  const [privateProfile, publicProfile] = await Promise.all([
    getDoc(doc(firebaseDb, 'users', uid)),
    getDoc(doc(firebaseDb, 'publicProfiles', uid)),
  ]);
  const displayName = readBoundedString(publicProfile.data()?.displayName, 32);
  const avatarLabel = readBoundedString(privateProfile.data()?.avatarLabel, 2);
  const result = await requestProfilePresentationUpdate({
    avatarLabel,
    bio: validation.value.bio,
    countryCode: validation.value.countryCode,
    displayName,
    gender: validation.value.gender,
  });
  if (!result.ok) throw new Error(result.error.messageAr);
}

function readBoundedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readGender(value: unknown): ProfileGender | undefined {
  return value === 'male' || value === 'female' ? value : undefined;
}

function readNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function readVipTierProjection(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = readBoundedString(candidate.id, 40);
  const nameAr = readBoundedString(candidate.nameAr, 40);
  const accentColor = readBoundedString(candidate.accentColor, 32);
  const rank = Number(candidate.rank);
  if (!id || !nameAr || !accentColor || !Number.isSafeInteger(rank) || rank < 1) return undefined;
  return { accentColor, id, nameAr, rank };
}

function normalizeSearchName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .toLocaleLowerCase('ar');
}
