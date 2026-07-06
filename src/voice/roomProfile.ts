import { AuthUser } from '../auth/types';
import { VoiceRoom, VoiceRoomMember, VoiceRoomMemberRole, VoiceRoomType } from '../types/voice';
import { getDefaultDraftRoomTitle } from './createMockVoiceRoomDraft';

export type RoomStatus = 'active' | 'closed';
export type RoomMemberStatus = 'active' | 'removed';
export type RoomsStatus = 'loading' | 'ready' | 'error';

export type RoomDocument = {
  id: string;
  title: string;
  type: VoiceRoomType;
  hostId: string;
  hostDisplayName: string;
  hostAvatarLabel: string;
  status: RoomStatus;
  participantCount: number;
  currentGameId?: string;
};

export type RoomMemberDocument = {
  uid: string;
  displayName: string;
  avatarLabel: string;
  role: VoiceRoomMemberRole;
  status: RoomMemberStatus;
  canPublishAudio: boolean;
};

export type CreateRoomInput = {
  type: VoiceRoomType;
  title?: string;
};

export function normalizeRoomTitle(type: VoiceRoomType, title?: string) {
  const normalized = title?.trim() || getDefaultDraftRoomTitle(type);

  return normalized.slice(0, 48);
}

export function createRoomDocument(
  id: string,
  input: CreateRoomInput,
  authUser: AuthUser,
): RoomDocument {
  const room: RoomDocument = {
    id,
    title: normalizeRoomTitle(input.type, input.title),
    type: input.type,
    hostId: authUser.uid,
    hostDisplayName: authUser.displayName,
    hostAvatarLabel: authUser.avatarLabel,
    status: 'active',
    participantCount: 1,
  };

  if (input.type === 'game') {
    room.currentGameId = 'carrom-royal';
  }

  return room;
}

export function createRoomMemberDocument(
  authUser: AuthUser,
  role: VoiceRoomMemberRole,
): RoomMemberDocument {
  return {
    uid: authUser.uid,
    displayName: authUser.displayName,
    avatarLabel: authUser.avatarLabel,
    role,
    status: 'active',
    canPublishAudio: role === 'host' || role === 'speaker',
  };
}

export function mapRoomDocument(data: unknown, id?: string): RoomDocument | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Partial<Record<keyof RoomDocument, unknown>>;
  const roomId = typeof candidate.id === 'string' ? candidate.id : id;

  if (
    typeof roomId !== 'string' ||
    typeof candidate.title !== 'string' ||
    (candidate.type !== 'voice' && candidate.type !== 'game') ||
    typeof candidate.hostId !== 'string' ||
    typeof candidate.hostDisplayName !== 'string' ||
    typeof candidate.hostAvatarLabel !== 'string' ||
    (candidate.status !== 'active' && candidate.status !== 'closed') ||
    typeof candidate.participantCount !== 'number'
  ) {
    return null;
  }

  return {
    id: roomId,
    title: candidate.title,
    type: candidate.type,
    hostId: candidate.hostId,
    hostDisplayName: candidate.hostDisplayName,
    hostAvatarLabel: candidate.hostAvatarLabel,
    status: candidate.status,
    participantCount: candidate.participantCount,
    currentGameId: typeof candidate.currentGameId === 'string' ? candidate.currentGameId : undefined,
  };
}

export function mapRoomMemberDocument(data: unknown): RoomMemberDocument | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Partial<Record<keyof RoomMemberDocument, unknown>>;

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

  return {
    uid: candidate.uid,
    displayName: candidate.displayName,
    avatarLabel: candidate.avatarLabel,
    role: candidate.role,
    status: candidate.status ?? 'active',
    canPublishAudio: candidate.canPublishAudio,
  };
}

export function mapRoomDocumentToVoiceRoom(room: RoomDocument, members: RoomMemberDocument[] = []): VoiceRoom {
  const host: VoiceRoomMember = {
    id: room.hostId,
    displayName: room.hostDisplayName,
    avatarLabel: room.hostAvatarLabel,
    role: 'host',
    canPublishAudio: true,
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
    type: room.type,
    status: room.status,
    participantCount: Math.max(room.participantCount, speakers.length + listeners.length),
    speakers,
    listeners,
    currentGameId: room.currentGameId,
  };
}

function mapMemberToVoiceRoomMember(member: RoomMemberDocument): VoiceRoomMember {
  return {
    id: member.uid,
    displayName: member.displayName,
    avatarLabel: member.avatarLabel,
    role: member.role,
    status: member.status,
    canPublishAudio: member.canPublishAudio,
  };
}
