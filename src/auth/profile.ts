import { SaveProfileInput, UserProfile } from './types';

export type ProfileValidationResult =
  | {
      ok: true;
      value: SaveProfileInput;
    }
  | {
      ok: false;
      message: string;
    };

export function validateProfileInput(input: SaveProfileInput): ProfileValidationResult {
  const displayName = input.displayName.trim();
  const avatarLabel = input.avatarLabel.trim();

  if (displayName.length < 2) {
    return { ok: false, message: 'اكتب اسما من حرفين على الأقل.' };
  }

  if (displayName.length > 32) {
    return { ok: false, message: 'الاسم يجب ألا يتجاوز 32 حرفا.' };
  }

  if (avatarLabel.length < 1) {
    return { ok: false, message: 'اختر رمزا واحدا للصورة.' };
  }

  if ([...avatarLabel].length > 1) {
    return { ok: false, message: 'رمز الصورة يجب أن يكون حرفا واحدا.' };
  }

  return {
    ok: true,
    value: {
      avatarLabel,
      displayName,
    },
  };
}

export function isCompleteProfile(profile: UserProfile | null): profile is UserProfile {
  if (!profile) {
    return false;
  }

  return validateProfileInput({
    avatarLabel: profile.avatarLabel,
    displayName: profile.displayName,
  }).ok;
}

export function createProfilePayload(
  uid: string,
  email: string,
  input: SaveProfileInput,
): UserProfile | null {
  const validation = validateProfileInput(input);

  if (!validation.ok) {
    return null;
  }

  return {
    avatarLabel: validation.value.avatarLabel,
    displayName: validation.value.displayName,
    email,
    uid,
  };
}

export function mapUserProfileDocument(data: unknown): UserProfile | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Partial<Record<keyof UserProfile, unknown>>;

  if (
    typeof candidate.uid !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.displayName !== 'string' ||
    typeof candidate.avatarLabel !== 'string'
  ) {
    return null;
  }

  return {
    avatarLabel: candidate.avatarLabel,
    displayName: candidate.displayName,
    email: candidate.email,
    uid: candidate.uid,
  };
}
