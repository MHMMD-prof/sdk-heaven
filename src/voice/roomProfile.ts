import { AuthUser } from '../auth/types';
import {
  RoomCountryCode,
  VoiceRoom,
  VoiceRoomMember,
  VoiceRoomMemberRole,
  VoiceRoomType,
  VoiceRoomVisibility,
} from '../types/voice';
import { getDefaultDraftRoomTitle } from './createMockVoiceRoomDraft';
import {
  isRoomAuthorityRole,
  isRoomAvailability,
  isRoomChatMode,
  isRoomEffectsPolicy,
  isRoomHistoryVisibility,
  isRoomImageReviewStatus,
  isRoomKeywordFilterMode,
  isRoomSeatMode,
  isRoomSlowModeSeconds,
  isRoomThemeId,
  isSupportedSeatCount,
  MAX_SUPPORTED_ROOM_SCHEMA_VERSION,
  ROOM_SCHEMA_VERSION,
  RoomAuthorityRole,
  RoomAvailability,
  RoomChatMode,
  RoomEffectsPolicy,
  RoomHistoryVisibility,
  RoomImageReviewStatus,
  RoomKeywordFilterMode,
  RoomMemberPrivileges,
  RoomSeatMode,
  RoomThemeId,
  SupportedRoomSchemaVersion,
} from './roomV2Contract';

export type RoomStatus = 'active' | 'closed';
export type RoomMemberStatus = 'active' | 'removed';
export type RoomsStatus = 'loading' | 'ready' | 'error';

export type RoomDocument = {
  schemaVersion: SupportedRoomSchemaVersion;
  id: string;
  title: string;
  type: VoiceRoomType;
  countryCode?: RoomCountryCode;
  hostId: string;
  ownerUid: string;
  ownerDisplayName: string;
  ownerAvatarLabel: string;
  hostDisplayName: string;
  hostAvatarLabel: string;
  status: RoomStatus;
  visibility: VoiceRoomVisibility;
  participantCount: number;
  speakerCount: number;
  revision: number;
  ownershipRevision: number;
  moderatorCount: number;
  audioLockdown: boolean;
  availability: RoomAvailability;
  seatTargetCount: 5 | 10 | 15 | 20;
  seatMode: RoomSeatMode;
  announcement: string;
  welcomeMessage: string;
  themeId: RoomThemeId;
  chatMode: RoomChatMode;
  slowModeSeconds: 0 | 5 | 10 | 30 | 60;
  historyVisibility: RoomHistoryVisibility;
  keywordFilterMode: RoomKeywordFilterMode;
  effectsPolicy: RoomEffectsPolicy;
  roomImageReviewStatus: RoomImageReviewStatus;
  roomCustomizationSuspended: boolean;
  activeRoomImageId?: string;
  activeRoomImagePath?: string;
  pendingRoomImageId?: string;
  pendingRoomImagePath?: string;
  inviteCode?: string;
  currentGameId?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
};

export type RoomMemberDocument = {
  schemaVersion: SupportedRoomSchemaVersion;
  uid: string;
  displayName: string;
  avatarLabel: string;
  role: VoiceRoomMemberRole;
  status: RoomMemberStatus;
  canPublishAudio: boolean;
  authorityRole: RoomAuthorityRole;
  seatId: string | null;
  privileges: RoomMemberPrivileges;
  inviteCodeUsed?: string;
};

export type CreateRoomInput = {
  type: VoiceRoomType;
  countryCode: RoomCountryCode;
  title?: string;
  visibility?: VoiceRoomVisibility;
  inviteCode?: string;
};

export type JoinPrivateRoomInput = {
  roomId: string;
  inviteCode: string;
};

export type RoomDocumentMapResult =
  | { status: 'ready'; room: RoomDocument }
  | { status: 'unsupported'; schemaVersion: number }
  | { status: 'invalid' };

export function normalizeRoomTitle(type: VoiceRoomType, title?: string) {
  const normalized = title?.trim() || getDefaultDraftRoomTitle(type);

  return normalized.slice(0, 48);
}

export function normalizeInviteCode(inviteCode?: string) {
  return inviteCode?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) ?? '';
}

export function isValidInviteCode(inviteCode: string) {
  return /^[A-Z0-9]{6,12}$/.test(inviteCode);
}

export function canJoinRoomWithInvite(room: RoomDocument, inviteCode?: string, hasExistingMember = false) {
  if (room.visibility === 'public' || hasExistingMember) {
    return true;
  }

  return !!room.inviteCode && normalizeInviteCode(inviteCode) === room.inviteCode;
}

export function createRoomDocument(
  id: string,
  input: CreateRoomInput,
  authUser: AuthUser,
): RoomDocument {
  const room: RoomDocument = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    id,
    title: normalizeRoomTitle(input.type, input.title),
    type: input.type,
    countryCode: input.countryCode,
    hostId: authUser.uid,
    ownerUid: authUser.uid,
    ownerDisplayName: authUser.displayName,
    ownerAvatarLabel: authUser.avatarLabel,
    hostDisplayName: authUser.displayName,
    hostAvatarLabel: authUser.avatarLabel,
    status: 'active',
    visibility: input.visibility ?? 'public',
    participantCount: 1,
    speakerCount: 0,
    revision: 1,
    ownershipRevision: 1,
    moderatorCount: 0,
    audioLockdown: false,
    availability: 'active',
    seatTargetCount: 10,
    seatMode: 'open',
    announcement: '',
    welcomeMessage: '',
    themeId: 'midnight',
    chatMode: 'everyone',
    slowModeSeconds: 0,
    historyVisibility: 'after-join',
    keywordFilterMode: 'standard',
    effectsPolicy: 'full',
    roomImageReviewStatus: 'none',
    roomCustomizationSuspended: false,
  };
  const inviteCode = normalizeInviteCode(input.inviteCode);

  if (room.visibility === 'private') {
    room.inviteCode = isValidInviteCode(inviteCode) ? inviteCode : createDefaultInviteCode(id);
  }

  if (input.type === 'game') {
    room.currentGameId = 'carrom-royal';
  }

  return room;
}

export function createRoomMemberDocument(
  authUser: AuthUser,
  role: VoiceRoomMemberRole,
  inviteCode?: string,
  existingData?: unknown,
): RoomMemberDocument {
  const member: RoomMemberDocument = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    uid: authUser.uid,
    displayName: authUser.displayName,
    avatarLabel: authUser.avatarLabel,
    role,
    status: 'active',
    canPublishAudio: role === 'host' || role === 'speaker',
    authorityRole: role === 'host' ? 'owner' : 'member',
    seatId: null,
    privileges: { canManageMusic: false },
  };
  const existingMember = mapRoomMemberDocument(existingData);
  if (existingMember) {
    member.schemaVersion = existingMember.schemaVersion;
    member.role = existingMember.role;
    member.canPublishAudio = existingMember.canPublishAudio;
    member.authorityRole = existingMember.authorityRole;
    member.seatId = existingMember.seatId;
    member.privileges = existingMember.privileges;
  }

  const normalizedInviteCode = normalizeInviteCode(inviteCode);

  if (role === 'listener' && normalizedInviteCode) {
    member.inviteCodeUsed = normalizedInviteCode;
  }

  return member;
}

export function mapRoomDocument(data: unknown, id?: string): RoomDocument | null {
  const result = mapRoomDocumentResult(data, id);
  return result.status === 'ready' ? result.room : null;
}

export function mapRoomDocumentResult(data: unknown, id?: string): RoomDocumentMapResult {
  if (!data || typeof data !== 'object') {
    return { status: 'invalid' };
  }

  const candidate = data as Partial<Record<keyof RoomDocument | 'createdAt' | 'updatedAt', unknown>>;
  const rawSchemaVersion = candidate.schemaVersion;
  if (
    typeof rawSchemaVersion === 'number' &&
    Number.isInteger(rawSchemaVersion) &&
    rawSchemaVersion > MAX_SUPPORTED_ROOM_SCHEMA_VERSION
  ) {
    return { status: 'unsupported', schemaVersion: rawSchemaVersion };
  }
  if (rawSchemaVersion !== undefined && rawSchemaVersion !== 1 && rawSchemaVersion !== ROOM_SCHEMA_VERSION) {
    return { status: 'invalid' };
  }
  const schemaVersion: SupportedRoomSchemaVersion = rawSchemaVersion === ROOM_SCHEMA_VERSION ? ROOM_SCHEMA_VERSION : 1;
  const roomId = typeof candidate.id === 'string' ? candidate.id : id;

  if (
    typeof roomId !== 'string' ||
    typeof candidate.title !== 'string' ||
    (candidate.type !== 'voice' && candidate.type !== 'game') ||
    typeof candidate.hostId !== 'string' ||
    typeof candidate.hostDisplayName !== 'string' ||
    typeof candidate.hostAvatarLabel !== 'string' ||
    (candidate.status !== 'active' && candidate.status !== 'closed') ||
    (candidate.visibility !== undefined && candidate.visibility !== 'public' && candidate.visibility !== 'private') ||
    typeof candidate.participantCount !== 'number' ||
    !Number.isInteger(candidate.participantCount) ||
    candidate.participantCount < 0
  ) {
    return { status: 'invalid' };
  }

  const ownerUid = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.ownerUid : candidate.hostId;
  const ownerDisplayName = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.ownerDisplayName : candidate.hostDisplayName;
  const ownerAvatarLabel = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.ownerAvatarLabel : candidate.hostAvatarLabel;
  const revision = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.revision : 1;
  const ownershipRevision = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.ownershipRevision ?? 1 : 1;
  const moderatorCount = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.moderatorCount ?? 0 : 0;
  const audioLockdown = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.audioLockdown ?? false : false;
  const availability = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.availability : 'active';
  const seatTargetCount = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.seatTargetCount : 10;
  const seatMode = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.seatMode : 'open';
  const speakerCount = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.speakerCount ?? 0 : 0;
  const announcement = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.announcement ?? '' : '';
  const welcomeMessage = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.welcomeMessage ?? '' : '';
  const themeId = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.themeId ?? 'midnight' : 'midnight';
  const chatMode = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.chatMode ?? 'everyone' : 'everyone';
  const slowModeSeconds = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.slowModeSeconds ?? 0 : 0;
  const historyVisibility = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.historyVisibility ?? 'after-join' : 'after-join';
  const keywordFilterMode = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.keywordFilterMode ?? 'standard' : 'standard';
  const effectsPolicy = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.effectsPolicy ?? 'full' : 'full';
  const roomImageReviewStatus = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.roomImageReviewStatus ?? 'none' : 'none';
  const roomCustomizationSuspended = schemaVersion === ROOM_SCHEMA_VERSION
    ? candidate.roomCustomizationSuspended ?? false
    : false;

  if (
    typeof ownerUid !== 'string' ||
    typeof ownerDisplayName !== 'string' ||
    typeof ownerAvatarLabel !== 'string' ||
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    typeof ownershipRevision !== 'number' ||
    !Number.isInteger(ownershipRevision) ||
    ownershipRevision < 1 ||
    typeof moderatorCount !== 'number' ||
    !Number.isInteger(moderatorCount) ||
    moderatorCount < 0 ||
    moderatorCount > 20 ||
    typeof audioLockdown !== 'boolean' ||
    !isRoomAvailability(availability) ||
    !isSupportedSeatCount(seatTargetCount) ||
    !isRoomSeatMode(seatMode) ||
    typeof announcement !== 'string' ||
    announcement.length > 160 ||
    typeof welcomeMessage !== 'string' ||
    welcomeMessage.length > 200 ||
    !isRoomThemeId(themeId) ||
    !isRoomChatMode(chatMode) ||
    !isRoomSlowModeSeconds(slowModeSeconds) ||
    !isRoomHistoryVisibility(historyVisibility) ||
    !isRoomKeywordFilterMode(keywordFilterMode) ||
    !isRoomEffectsPolicy(effectsPolicy) ||
    !isRoomImageReviewStatus(roomImageReviewStatus) ||
    typeof roomCustomizationSuspended !== 'boolean' ||
    typeof speakerCount !== 'number' ||
    !Number.isInteger(speakerCount) ||
    speakerCount < 0 ||
    (schemaVersion === ROOM_SCHEMA_VERSION && candidate.ownerUid !== candidate.hostId)
  ) {
    return { status: 'invalid' };
  }

  const visibility = candidate.visibility ?? 'public';
  const inviteCode = typeof candidate.inviteCode === 'string' ? normalizeInviteCode(candidate.inviteCode) : undefined;
  const createdAtMs = timestampToMillis(candidate.createdAtMs ?? candidate.createdAt);
  const updatedAtMs = timestampToMillis(candidate.updatedAtMs ?? candidate.updatedAt);

  if (visibility === 'private' && !inviteCode) {
    return { status: 'invalid' };
  }

  return { status: 'ready', room: {
    schemaVersion,
    id: roomId,
    title: candidate.title,
    type: candidate.type,
    countryCode: isRoomCountryCode(candidate.countryCode) ? candidate.countryCode : undefined,
    hostId: candidate.hostId,
    ownerUid,
    ownerDisplayName,
    ownerAvatarLabel,
    hostDisplayName: candidate.hostDisplayName,
    hostAvatarLabel: candidate.hostAvatarLabel,
    status: candidate.status,
    visibility,
    participantCount: candidate.participantCount,
    speakerCount,
    revision,
    ownershipRevision,
    moderatorCount,
    audioLockdown,
    availability,
    seatTargetCount,
    seatMode,
    announcement,
    welcomeMessage,
    themeId,
    chatMode,
    slowModeSeconds,
    historyVisibility,
    keywordFilterMode,
    effectsPolicy,
    roomImageReviewStatus,
    roomCustomizationSuspended,
    activeRoomImageId: typeof candidate.activeRoomImageId === 'string' ? candidate.activeRoomImageId : undefined,
    activeRoomImagePath: typeof candidate.activeRoomImagePath === 'string' ? candidate.activeRoomImagePath : undefined,
    pendingRoomImageId: typeof candidate.pendingRoomImageId === 'string' ? candidate.pendingRoomImageId : undefined,
    pendingRoomImagePath: typeof candidate.pendingRoomImagePath === 'string' ? candidate.pendingRoomImagePath : undefined,
    inviteCode,
    currentGameId: typeof candidate.currentGameId === 'string' ? candidate.currentGameId : undefined,
    createdAtMs,
    updatedAtMs,
  } };
}

export function mapRoomMemberDocument(data: unknown): RoomMemberDocument | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Partial<Record<keyof RoomMemberDocument, unknown>>;
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 1 && candidate.schemaVersion !== ROOM_SCHEMA_VERSION) {
    return null;
  }
  const schemaVersion: SupportedRoomSchemaVersion = candidate.schemaVersion === ROOM_SCHEMA_VERSION ? ROOM_SCHEMA_VERSION : 1;

  if (
    typeof candidate.uid !== 'string' ||
    typeof candidate.displayName !== 'string' ||
    typeof candidate.avatarLabel !== 'string' ||
    (candidate.role !== 'host' && candidate.role !== 'speaker' && candidate.role !== 'listener') ||
    (candidate.status !== undefined && candidate.status !== 'active' && candidate.status !== 'removed') ||
    typeof candidate.canPublishAudio !== 'boolean'
  ) {
    return null;
  }

  const authorityRole = schemaVersion === ROOM_SCHEMA_VERSION
    ? candidate.authorityRole
    : candidate.role === 'host' ? 'owner' : 'member';
  const seatId = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.seatId : null;
  const privileges = schemaVersion === ROOM_SCHEMA_VERSION ? candidate.privileges : { canManageMusic: false };

  if (
    !isRoomAuthorityRole(authorityRole) ||
    (seatId !== null && typeof seatId !== 'string') ||
    !privileges ||
    typeof privileges !== 'object' ||
    typeof (privileges as RoomMemberPrivileges).canManageMusic !== 'boolean' ||
    (authorityRole === 'owner' && candidate.role !== 'host')
  ) {
    return null;
  }

  return {
    schemaVersion,
    uid: candidate.uid,
    displayName: candidate.displayName,
    avatarLabel: candidate.avatarLabel,
    role: candidate.role,
    status: candidate.status ?? 'active',
    canPublishAudio: candidate.canPublishAudio,
    authorityRole,
    seatId,
    privileges: { canManageMusic: (privileges as RoomMemberPrivileges).canManageMusic },
  };
}

export function mapRoomDocumentToVoiceRoom(room: RoomDocument, members: RoomMemberDocument[] = []): VoiceRoom {
  const host: VoiceRoomMember = {
    id: room.hostId,
    displayName: room.hostDisplayName,
    avatarLabel: room.hostAvatarLabel,
    role: 'host',
    canPublishAudio: true,
    authorityRole: 'owner',
    seatId: null,
    privileges: { canManageMusic: false },
  };
  const mappedMembers = members.map(mapMemberToVoiceRoomMember);
  const activeMembers = mappedMembers.filter((member) => member.status !== 'removed');
  const speakers = [host, ...activeMembers.filter((member) => member.role === 'speaker')].filter(
    (member, index, allMembers) => allMembers.findIndex((candidate) => candidate.id === member.id) === index,
  );
  const listeners = activeMembers.filter((member) => member.role === 'listener');

  return {
    id: room.id,
    title: room.title,
    hostId: room.hostId,
    ownerUid: room.ownerUid,
    type: room.type,
    countryCode: room.countryCode,
    status: room.status,
    visibility: room.visibility,
    inviteCode: room.inviteCode,
    participantCount: Math.max(room.participantCount, speakers.length + listeners.length),
    speakerCount: room.speakerCount,
    speakers,
    listeners,
    currentGameId: room.currentGameId,
    schemaVersion: room.schemaVersion,
    revision: room.revision,
    ownershipRevision: room.ownershipRevision,
    moderatorCount: room.moderatorCount,
    audioLockdown: room.audioLockdown,
    seatTargetCount: room.seatTargetCount,
    seatMode: room.seatMode,
    announcement: room.announcement,
    welcomeMessage: room.welcomeMessage,
    themeId: room.themeId,
    chatMode: room.chatMode,
    slowModeSeconds: room.slowModeSeconds,
    historyVisibility: room.historyVisibility,
    keywordFilterMode: room.keywordFilterMode,
    effectsPolicy: room.effectsPolicy,
    roomImageReviewStatus: room.roomImageReviewStatus,
    roomCustomizationSuspended: room.roomCustomizationSuspended,
    activeRoomImageId: room.activeRoomImageId,
    activeRoomImagePath: room.activeRoomImagePath,
    pendingRoomImageId: room.pendingRoomImageId,
    pendingRoomImagePath: room.pendingRoomImagePath,
    createdAtMs: room.createdAtMs,
    updatedAtMs: room.updatedAtMs,
  };
}

export function isRoomCountryCode(value: unknown): value is RoomCountryCode {
  return [
    'IQ', 'SA', 'SY', 'LB', 'YE', 'DZ', 'EG', 'JO', 'PS', 'AE', 'KW',
    'QA', 'BH', 'OM', 'MA', 'TN', 'LY', 'SD', 'SO', 'DJ', 'MR', 'KM',
  ].includes(value as RoomCountryCode);
}

export function timestampToMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const timestamp = value as { toMillis?: unknown; seconds?: unknown; nanoseconds?: unknown };

  if (typeof timestamp.toMillis === 'function') {
    const millis = timestamp.toMillis.call(value);

    return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined;
  }

  if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
    const nanoseconds =
      typeof timestamp.nanoseconds === 'number' && Number.isFinite(timestamp.nanoseconds)
        ? timestamp.nanoseconds
        : 0;

    return timestamp.seconds * 1_000 + Math.floor(nanoseconds / 1_000_000);
  }

  return undefined;
}

export function selectMostRecentRoomDocument(rooms: readonly RoomDocument[]) {
  return rooms.reduce<RoomDocument | undefined>((mostRecent, room) => {
    if (!mostRecent) {
      return room;
    }

    const roomTime = room.createdAtMs ?? room.updatedAtMs ?? 0;
    const mostRecentTime = mostRecent.createdAtMs ?? mostRecent.updatedAtMs ?? 0;

    if (roomTime !== mostRecentTime) {
      return roomTime > mostRecentTime ? room : mostRecent;
    }

    return room.id.localeCompare(mostRecent.id) > 0 ? room : mostRecent;
  }, undefined);
}

function createDefaultInviteCode(roomId: string) {
  return normalizeInviteCode(roomId).padEnd(6, 'X').slice(0, 8);
}

function mapMemberToVoiceRoomMember(member: RoomMemberDocument): VoiceRoomMember {
  return {
    id: member.uid,
    displayName: member.displayName,
    avatarLabel: member.avatarLabel,
    role: member.role,
    status: member.status,
    canPublishAudio: member.canPublishAudio,
    authorityRole: member.authorityRole,
    seatId: member.seatId,
    privileges: member.privileges,
  };
}
