export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  avatarLabel: string;
};

export type AuthUser = UserProfile;

export type SaveProfileInput = {
  displayName: string;
  avatarLabel: string;
};

export type ProfileStatus = 'loading' | 'missing' | 'complete' | 'error';
