import { isRoomCountryCode } from '../voice/roomProfile';
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
  return {
    avatarModerationStatus,
    avatarUrl: readBoundedString(candidate.avatarUrl, 2048),
    bio: readBoundedString(candidate.bio, 160),
    countryCode,
    coupleLevel: readNonNegativeInteger(candidate.coupleLevel),
    createdAt: candidate.createdAt,
    displayName,
    friendCount: readNonNegativeInteger(candidate.friendCount),
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
    uid,
    updatedAt: candidate.updatedAt,
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

  const [{ firebaseDb }, { deleteField, doc, serverTimestamp, updateDoc }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);

  await updateDoc(doc(firebaseDb, 'publicProfiles', uid), {
    bio: validation.value.bio,
    countryCode: validation.value.countryCode,
    gender: validation.value.gender ?? deleteField(),
    updatedAt: serverTimestamp(),
  });
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

function normalizeSearchName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .toLocaleLowerCase('ar');
}
