import { VoiceRoom } from '../types/voice';
import { RoomSeatDocument, RoomSeatMode, roomSeatDocumentId } from './roomV2Contract';
import { VoiceConnectionState, VoiceParticipant } from './types';

export type RoomSeatAction = 'claim' | 'request' | null;

export type RoomSeatViewModel = {
  accessibilityLabel: string;
  action: RoomSeatAction;
  id: string;
  isLocal: boolean;
  isModerator: boolean;
  isOwner: boolean;
  isSpeaking: boolean;
  participant?: VoiceParticipant;
  seatNumber: number;
  state: RoomSeatDocument['state'];
};

export type RoomNotice = {
  kind: 'critical' | 'warning' | 'info';
  message: string;
} | null;

type BuildSeatModelsInput = {
  room: VoiceRoom;
  speakers: VoiceParticipant[];
  speakingParticipantIds: string[];
};

export function buildRoomSeatViewModels({
  room,
  speakers,
  speakingParticipantIds,
}: BuildSeatModelsInput): RoomSeatViewModel[] {
  const targetCount = resolveVisibleSeatCount(room);
  const seatDocuments = room.seats?.length
    ? room.seats
        .filter((seat) => seat.seatNumber <= targetCount || seat.state === 'retiring')
        .sort((left, right) => left.seatNumber - right.seatNumber)
    : createLegacySeatProjection(targetCount, speakers);
  const participantById = new Map(speakers.map((participant) => [participant.id, participant]));
  const ownerUid = room.ownerUid || room.hostId;
  const localUid = room.localMember?.id;
  const speaking = new Set(speakingParticipantIds);

  return seatDocuments.map((seat) => {
    const connectedParticipant = seat.occupantUid ? participantById.get(seat.occupantUid) : undefined;
    const member = seat.occupantUid
      ? [...room.speakers, ...room.listeners].find((candidate) => candidate.id === seat.occupantUid)
      : undefined;
    const participant = connectedParticipant || (member ? {
      avatarLabel: member.avatarLabel,
      displayName: member.displayName,
      id: member.id,
      isMuted: member.canPublishAudio === false,
      isSpeaking: false,
      representativeBadgeActive: member.representativeBadgeActive,
      role: member.role === 'listener' ? 'listener' as const : member.role === 'host' ? 'host' as const : 'speaker' as const,
    } : undefined);
    const displayName = participant?.displayName || member?.displayName;
    const isOwner = seat.occupantUid === ownerUid;
    const isModerator = member?.authorityRole === 'moderator';
    const action = resolveSeatAction({
      hasLocalSeat: !!room.localMember?.seatId,
      mode: room.seatMode || 'open',
      state: seat.state,
    });

    return {
      accessibilityLabel: describeSeat({
        displayName,
        isModerator,
        isOwner,
        seatNumber: seat.seatNumber,
        state: seat.state,
      }),
      action,
      id: roomSeatDocumentId(seat.seatNumber),
      isLocal: seat.occupantUid === localUid,
      isModerator,
      isOwner,
      isSpeaking: !!seat.occupantUid && speaking.has(seat.occupantUid),
      participant,
      seatNumber: seat.seatNumber,
      state: seat.state,
    };
  });
}

export function resolveVisibleSeatCount(room: VoiceRoom) {
  if (room.seatTargetCount) return room.seatTargetCount;
  const explicitMaximum = Math.max(0, ...(room.seats || []).map((seat) => seat.seatNumber));
  if (explicitMaximum > 0) return Math.min(20, explicitMaximum);
  const occupiedCount = Math.max(room.speakerCount || 0, room.speakers.length);
  if (occupiedCount > 15) return 20;
  if (occupiedCount > 10) return 15;
  if (occupiedCount > 5) return 10;
  return 5;
}

export function resolveRoomNotice({
  audioLockdown,
  connectionState,
  errorMessage,
  moderationErrorMessage,
  seatErrorMessage,
}: {
  audioLockdown?: boolean;
  connectionState: VoiceConnectionState;
  errorMessage?: string;
  moderationErrorMessage?: string;
  seatErrorMessage?: string;
}): RoomNotice {
  if (moderationErrorMessage || seatErrorMessage || (connectionState === 'error' && errorMessage)) {
    return {
      kind: 'critical',
      message: moderationErrorMessage || seatErrorMessage || errorMessage || 'تعذر تنفيذ الإجراء.',
    };
  }
  if (audioLockdown) {
    return { kind: 'warning', message: 'تم إيقاف الميكروفونات مؤقتاً بواسطة إدارة الغرفة.' };
  }
  if (connectionState === 'connecting') {
    return { kind: 'info', message: 'جارٍ الاتصال بالصوت…' };
  }
  if (connectionState === 'disconnected') {
    return { kind: 'warning', message: 'انقطع الاتصال. يمكنك المحاولة مجدداً.' };
  }
  return null;
}

export function seatModeLabel(mode: RoomSeatMode | undefined) {
  switch (mode) {
    case 'request':
      return 'المقاعد بالطلب';
    case 'invite':
      return 'المقاعد بالدعوة';
    case 'locked':
      return 'المقاعد مقفلة';
    default:
      return 'المقاعد مفتوحة';
  }
}

function createLegacySeatProjection(count: number, speakers: VoiceParticipant[]): RoomSeatDocument[] {
  return Array.from({ length: count }, (_, index) => {
    const participant = speakers[index];
    return {
      schemaVersion: 2,
      seatNumber: index + 1,
      state: participant ? 'occupied' : 'open',
      ...(participant ? { occupantUid: participant.id, occupancyState: 'occupied' as const } : {}),
      revision: 1,
    };
  });
}

function resolveSeatAction({
  hasLocalSeat,
  mode,
  state,
}: {
  hasLocalSeat: boolean;
  mode: RoomSeatMode;
  state: RoomSeatDocument['state'];
}): RoomSeatAction {
  if (hasLocalSeat || state !== 'open') return null;
  if (mode === 'open') return 'claim';
  if (mode === 'request') return 'request';
  return null;
}

function describeSeat({
  displayName,
  isModerator,
  isOwner,
  seatNumber,
  state,
}: {
  displayName?: string;
  isModerator: boolean;
  isOwner: boolean;
  seatNumber: number;
  state: RoomSeatDocument['state'];
}) {
  const role = isOwner ? '، مالك الغرفة' : isModerator ? '، مشرف الغرفة' : '';
  if (displayName) {
    const stateCopy = state === 'reconnecting' ? '، يعيد الاتصال' : state === 'retiring' ? '، مقعد قيد الإغلاق' : '';
    return `المقعد ${seatNumber}، ${displayName}${role}${stateCopy}`;
  }
  if (state === 'locked') return `المقعد ${seatNumber}، مقفل`;
  return `المقعد ${seatNumber}، فارغ`;
}
