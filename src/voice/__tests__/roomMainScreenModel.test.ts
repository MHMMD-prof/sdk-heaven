import { describe, expect, it } from 'vitest';

import { VoiceRoom } from '../../types/voice';
import {
  buildRoomSeatViewModels,
  resolveRoomNotice,
  resolveVisibleSeatCount,
  seatModeLabel,
} from '../roomMainScreenModel';

const baseRoom: VoiceRoom = {
  hostId: 'owner',
  id: 'room-1',
  listeners: [],
  participantCount: 2,
  seatMode: 'open',
  seatTargetCount: 5,
  speakers: [
    { avatarLabel: 'م', displayName: 'مالك', id: 'owner', authorityRole: 'owner' },
    { avatarLabel: 'ض', displayName: 'ضيف', id: 'guest', authorityRole: 'member' },
  ],
  title: 'ليلة بغداد',
  type: 'voice',
};

describe('roomMainScreenModel', () => {
  it('projects legacy speakers into a deterministic five-seat stage', () => {
    const seats = buildRoomSeatViewModels({
      room: baseRoom,
      speakers: [
        { avatarLabel: 'م', displayName: 'مالك', id: 'owner', isMuted: false, isSpeaking: true, role: 'host' },
        { avatarLabel: 'ض', displayName: 'ضيف', id: 'guest', isMuted: true, isSpeaking: false, role: 'speaker' },
      ],
      speakingParticipantIds: ['owner'],
    });

    expect(seats).toHaveLength(5);
    expect(seats[0]).toMatchObject({ id: '01', isOwner: true, isSpeaking: true, state: 'occupied' });
    expect(seats[2]).toMatchObject({ action: 'claim', id: '03', state: 'open' });
  });

  it('keeps occupied retiring seats visible after downsizing', () => {
    const seats = buildRoomSeatViewModels({
      room: {
        ...baseRoom,
        seats: [
          { revision: 1, schemaVersion: 2, seatNumber: 1, state: 'open' },
          { occupantUid: 'guest', revision: 2, schemaVersion: 2, seatNumber: 8, state: 'retiring' },
        ],
      },
      speakers: [
        { avatarLabel: 'ض', displayName: 'ضيف', id: 'guest', isMuted: false, isSpeaking: false, role: 'speaker' },
      ],
      speakingParticipantIds: [],
    });

    expect(seats.map((seat) => seat.id)).toEqual(['01', '08']);
    expect(seats[1].accessibilityLabel).toContain('قيد الإغلاق');
  });

  it('maps open and request modes to the correct self-service action', () => {
    const openSeat = buildRoomSeatViewModels({ room: baseRoom, speakers: [], speakingParticipantIds: [] })[0];
    const requestSeat = buildRoomSeatViewModels({
      room: { ...baseRoom, seatMode: 'request' },
      speakers: [],
      speakingParticipantIds: [],
    })[0];
    const lockedSeat = buildRoomSeatViewModels({
      room: { ...baseRoom, seatMode: 'locked' },
      speakers: [],
      speakingParticipantIds: [],
    })[0];

    expect(openSeat.action).toBe('claim');
    expect(requestSeat.action).toBe('request');
    expect(lockedSeat.action).toBeNull();
  });

  it('prioritizes command errors above lockdown and connection notices', () => {
    expect(resolveRoomNotice({
      audioLockdown: true,
      connectionState: 'error',
      errorMessage: 'network',
      seatErrorMessage: 'seat',
    })).toEqual({ kind: 'critical', message: 'seat' });
    expect(resolveRoomNotice({ audioLockdown: true, connectionState: 'connected' })?.kind).toBe('warning');
    expect(resolveRoomNotice({ connectionState: 'connecting' })?.kind).toBe('info');
  });

  it('uses supported seat presets and Arabic mode labels', () => {
    expect(resolveVisibleSeatCount({ ...baseRoom, seatTargetCount: undefined, speakerCount: 12 })).toBe(15);
    expect(seatModeLabel('invite')).toBe('المقاعد بالدعوة');
  });
});
