import { describe, expect, it } from 'vitest';

import {
  initialVoiceRoomSessionState,
  voiceRoomSessionReducer,
} from '../voiceRoomSessionReducer';
import { VoiceParticipant, VoiceRoomCommandResult } from '../types';

const participant: VoiceParticipant = {
  id: 'host-1',
  displayName: 'Host',
  role: 'host',
  isMuted: false,
  isSpeaking: false,
  avatarLabel: 'H',
};

describe('voiceRoomSessionReducer', () => {
  it('exposes stable initial defaults', () => {
    expect(initialVoiceRoomSessionState).toEqual({
      connectionState: 'idle',
      participants: [],
      speakingParticipantIds: [],
      canPublishAudio: true,
      isMicMuted: false,
      isSpeakerEnabled: true,
    });
  });

  it('updates connection state and room id', () => {
    const withRoom = voiceRoomSessionReducer(initialVoiceRoomSessionState, {
      type: 'roomIdChanged',
      roomId: 'room-1',
    });
    const connected = voiceRoomSessionReducer(withRoom, {
      type: 'connectionStateChanged',
      connectionState: 'connected',
    });

    expect(connected.roomId).toBe('room-1');
    expect(connected.connectionState).toBe('connected');
  });

  it('stores connection errors and clears them on the next room change', () => {
    const failed = voiceRoomSessionReducer(initialVoiceRoomSessionState, {
      type: 'connectionErrorChanged',
      errorMessage: 'Token request failed.',
    });
    const retried = voiceRoomSessionReducer(failed, {
      type: 'roomIdChanged',
      roomId: 'room-2',
    });

    expect(failed.connectionState).toBe('error');
    expect(failed.errorMessage).toBe('Token request failed.');
    expect(retried.errorMessage).toBeUndefined();
  });

  it('stores participants and speaking ids', () => {
    const withParticipants = voiceRoomSessionReducer(initialVoiceRoomSessionState, {
      type: 'participantsChanged',
      participants: [participant],
    });
    const withSpeaking = voiceRoomSessionReducer(withParticipants, {
      type: 'speakingChanged',
      participantIds: [participant.id],
    });

    expect(withSpeaking.participants).toEqual([participant]);
    expect(withSpeaking.speakingParticipantIds).toEqual([participant.id]);
  });

  it('updates mic and speaker state', () => {
    const muted = voiceRoomSessionReducer(initialVoiceRoomSessionState, {
      type: 'micMutedChanged',
      isMicMuted: true,
    });
    const speakerOff = voiceRoomSessionReducer(muted, {
      type: 'speakerEnabledChanged',
      isSpeakerEnabled: false,
    });

    expect(speakerOff.isMicMuted).toBe(true);
    expect(speakerOff.isSpeakerEnabled).toBe(false);
  });

  it('marks listener sessions as unable to publish audio and keeps the mic muted', () => {
    const next = voiceRoomSessionReducer(
      {
        ...initialVoiceRoomSessionState,
        isMicMuted: false,
      },
      {
        type: 'publishAudioChanged',
        canPublishAudio: false,
      },
    );

    expect(next.canPublishAudio).toBe(false);
    expect(next.isMicMuted).toBe(true);
  });

  it('stores command results', () => {
    const result: VoiceRoomCommandResult = {
      command: {
        type: 'report',
        participantId: participant.id,
      },
      status: 'recorded',
      createdAt: 1,
    };
    const next = voiceRoomSessionReducer(initialVoiceRoomSessionState, {
      type: 'commandCompleted',
      result,
    });

    expect(next.lastCommandResult).toBe(result);
  });

  it('resets connection data while preserving explicit audio preferences', () => {
    const dirtyState = {
      ...initialVoiceRoomSessionState,
      roomId: 'room-1',
      connectionState: 'connected' as const,
      participants: [participant],
      speakingParticipantIds: [participant.id],
      isMicMuted: true,
      isSpeakerEnabled: false,
    };
    const reset = voiceRoomSessionReducer(dirtyState, { type: 'reset' });

    expect(reset).toEqual({
      connectionState: 'disconnected',
      participants: [],
      speakingParticipantIds: [],
      canPublishAudio: true,
      isMicMuted: true,
      isSpeakerEnabled: false,
    });
  });
});
