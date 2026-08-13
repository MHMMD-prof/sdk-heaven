import { AudioSession } from '@livekit/react-native';
import {
  ConnectionState,
  Participant,
  Room,
  RoomEvent,
} from 'livekit-client';

import { VoiceClient } from './VoiceClient';
import { debugError, debugLog } from '../utils/debugLog';
import { decodeRoomReactionEnvelope, ROOM_REACTION_TOPIC } from './roomAmbientReactions';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';
import {
  VoiceClientEvent,
  VoiceClientEventListener,
  VoiceConnectOptions,
  VoiceConnectionState,
  VoiceParticipant,
  VoiceRoomCommand,
  VoiceRoomCommandResult,
} from './types';

export class LiveKitVoiceClient implements VoiceClient {
  private room?: Room;
  private eventListeners = new Set<VoiceClientEventListener>();
  private participants: VoiceParticipant[] = [];
  private speakingParticipantIds: string[] = [];
  private connectionState: VoiceConnectionState = 'idle';
  private connectAttemptId = 0;
  private audioSessionActive = false;
  private attendanceCommandEndpoint = '';
  private connectedRoomId = '';
  private blockedParticipantIds = new Set<string>();

  async connect(options: VoiceConnectOptions): Promise<void> {
    if (!options.serverUrl) {
      throw new Error('LiveKit connect requires serverUrl.');
    }

    const attemptId = this.connectAttemptId + 1;
    debugLog('voice.livekit', 'connect:start', {
      roomId: options.roomId,
      hasServerUrl: Boolean(options.serverUrl),
      hasToken: Boolean(options.token),
      canPublishAudio: options.canPublishAudio,
      attemptId,
    });
    this.connectAttemptId = attemptId;
    this.attendanceCommandEndpoint = options.metadata?.attendanceCommandEndpoint ?? '';
    this.connectedRoomId = options.roomId;
    const previousRoom = this.room;
    this.teardownRoom();
    previousRoom?.disconnect();
    await this.stopAudioSession();
    this.setConnectionState('connecting');

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
    });
    this.room = room;
    this.bindRoomEvents(room);

    try {
      debugLog('voice.livekit', 'audioSession:start', { roomId: options.roomId, attemptId });
      await AudioSession.startAudioSession();
      this.audioSessionActive = true;
      debugLog('voice.livekit', 'roomConnect:start', { roomId: options.roomId, attemptId });
      await room.connect(options.serverUrl, options.token);
      debugLog('voice.livekit', 'roomConnect:success', { roomId: options.roomId, attemptId });

      if (attemptId !== this.connectAttemptId || this.room !== room) {
        room.disconnect();
        if (!this.room) {
          await this.stopAudioSession();
        }
        return;
      }

      if (options.canPublishAudio !== false && options.startMuted !== true) {
        debugLog('voice.livekit', 'microphoneEnable:start', { roomId: options.roomId, attemptId });
        await room.localParticipant.setMicrophoneEnabled(true);
        debugLog('voice.livekit', 'microphoneEnable:success', { roomId: options.roomId, attemptId });
      }
    } catch (error) {
      debugError('voice.livekit', 'connect:error', error, { roomId: options.roomId, attemptId });
      const ownsCurrentRoom = this.room === room;

      if (ownsCurrentRoom) {
        this.teardownRoom();
        this.participants = [];
        this.speakingParticipantIds = [];
        this.emitEvent({ type: 'participantsChanged', participants: this.participants });
        this.emitEvent({ type: 'speakingChanged', participantIds: this.speakingParticipantIds });
        this.setConnectionState('error');
      }

      room.disconnect();
      if (ownsCurrentRoom || !this.room) {
        await this.stopAudioSession();
      }
      throw error;
    }

    this.syncParticipants();
    this.syncSpeakingParticipants();
    debugLog('voice.livekit', 'connect:complete', {
      roomId: options.roomId,
      participantCount: this.participants.length,
      attemptId,
    });
    this.setConnectionState('connected');
  }

  async disconnect(): Promise<void> {
    this.connectAttemptId += 1;
    const room = this.room;

    this.teardownRoom();
    this.attendanceCommandEndpoint = '';
    this.connectedRoomId = '';

    if (room) {
      debugLog('voice.livekit', 'disconnect:room', {});
      room.disconnect();
    }

    this.participants = [];
    this.speakingParticipantIds = [];
    this.emitEvent({ type: 'participantsChanged', participants: this.participants });
    this.emitEvent({ type: 'speakingChanged', participantIds: this.speakingParticipantIds });
    this.setConnectionState('disconnected');
    await this.stopAudioSession();
  }

  async muteMic(): Promise<void> {
    this.assertConnectedRoom();
    await this.room?.localParticipant.setMicrophoneEnabled(false);
    this.syncParticipants();
    void this.signalAuthoritativeMicrophoneCheck('muted');
  }

  async unmuteMic(): Promise<void> {
    this.assertConnectedRoom();
    await this.room?.localParticipant.setMicrophoneEnabled(true);
    this.syncParticipants();
    void this.signalAuthoritativeMicrophoneCheck('unmuted');
  }

  async setSpeakerEnabled(enabled: boolean): Promise<void> {
    if (!this.audioSessionActive) {
      throw new Error('Voice audio session is not active.');
    }

    const outputs = await AudioSession.getAudioOutputs();
    const preferredOutput = enabled
      ? outputs.find((output) => output === 'speaker' || output === 'force_speaker')
      : outputs.find((output) => output === 'earpiece' || output === 'default');

    if (!preferredOutput) {
      throw new Error('Requested voice audio output is not available.');
    }

    await AudioSession.selectAudioOutput(preferredOutput);
  }

  setBlockedParticipantIds(participantIds: Iterable<string>): void {
    this.blockedParticipantIds = new Set(participantIds);
    this.applyParticipantAudioPolicy();
  }

  async executeRoomCommand(command: VoiceRoomCommand): Promise<VoiceRoomCommandResult> {
    return {
      command,
      createdAt: Date.now(),
      status: 'ignored',
    };
  }

  async getParticipants(): Promise<VoiceParticipant[]> {
    return this.participants;
  }

  onEvent(listener: VoiceClientEventListener): () => void {
    this.eventListeners.add(listener);
    listener({ type: 'connectionStateChanged', connectionState: this.connectionState });
    listener({ type: 'participantsChanged', participants: this.participants });
    listener({ type: 'speakingChanged', participantIds: this.speakingParticipantIds });

    return () => this.eventListeners.delete(listener);
  }

  private bindRoomEvents(room: Room) {
    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        this.setConnectionState(mapLiveKitConnectionState(state));
      })
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantNameChanged, () => this.syncParticipants())
      .on(RoomEvent.ParticipantMetadataChanged, () => this.syncParticipants())
      .on(RoomEvent.TrackMuted, () => this.syncParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.syncParticipants())
      .on(RoomEvent.TrackPublished, () => this.syncParticipants())
      .on(RoomEvent.TrackUnpublished, () => this.syncParticipants())
      .on(RoomEvent.TrackSubscribed, () => this.syncParticipants())
      .on(RoomEvent.TrackUnsubscribed, () => this.syncParticipants())
      .on(RoomEvent.ActiveSpeakersChanged, () => this.syncSpeakingParticipants())
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        // RoomServiceClient packets have no participant. Reject participant-authored
        // packets so room members cannot bypass server approval and rate limits.
        if (participant || topic !== ROOM_REACTION_TOPIC || !this.connectedRoomId) return;
        const envelope = decodeRoomReactionEnvelope(payload, this.connectedRoomId);
        if (envelope) this.emitEvent({ type: 'roomReactionReceived', envelope });
      })
      .on(RoomEvent.MediaDevicesError, (error) => {
        this.emitEvent({ type: 'error', message: getMediaDeviceErrorMessage(error) });
      })
      .on(RoomEvent.Disconnected, () => {
        void this.handleRoomDisconnected(room);
      });
  }

  private async handleRoomDisconnected(room: Room) {
    if (this.room !== room) {
      return;
    }

    this.teardownRoom();
    this.participants = [];
    this.speakingParticipantIds = [];
    this.emitEvent({ type: 'participantsChanged', participants: this.participants });
    this.emitEvent({ type: 'speakingChanged', participantIds: this.speakingParticipantIds });
    this.setConnectionState('disconnected');

    try {
      await this.stopAudioSession();
    } catch {
      this.emitEvent({ type: 'error', message: 'Voice audio cleanup failed.' });
    }
  }

  private syncParticipants() {
    const room = this.room;

    if (!room) {
      this.participants = [];
    } else {
      this.applyParticipantAudioPolicy();
      this.participants = [
        mapLiveKitParticipant(room.localParticipant, true),
        ...Array.from(room.remoteParticipants.values()).map((participant) =>
          mapLiveKitParticipant(participant, false),
        ),
      ];
    }

    this.emitEvent({ type: 'participantsChanged', participants: this.participants });
  }

  private applyParticipantAudioPolicy() {
    this.room?.remoteParticipants.forEach((participant) => {
      participant.setVolume(this.blockedParticipantIds.has(participant.identity) ? 0 : 1);
    });
  }

  private syncSpeakingParticipants() {
    const room = this.room;
    this.speakingParticipantIds = room
      ? room.activeSpeakers.map((participant) => participant.identity)
      : [];
    this.emitEvent({ type: 'speakingChanged', participantIds: this.speakingParticipantIds });
  }

  private setConnectionState(state: VoiceConnectionState) {
    debugLog('voice.livekit', 'state', { state });
    this.connectionState = state;
    this.emitEvent({ type: 'connectionStateChanged', connectionState: state });
  }

  private teardownRoom() {
    this.room?.removeAllListeners();
    this.room = undefined;
  }

  private async stopAudioSession() {
    if (!this.audioSessionActive) {
      return;
    }

    this.audioSessionActive = false;
    await AudioSession.stopAudioSession();
  }

  private assertConnectedRoom() {
    if (!this.room || this.connectionState !== 'connected') {
      throw new Error('Voice room is not connected.');
    }
  }

  private async signalAuthoritativeMicrophoneCheck(state: 'muted' | 'unmuted') {
    if (!this.attendanceCommandEndpoint || !this.connectedRoomId) return;
    try {
      const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');
      const idToken = await getCurrentFirebaseIdToken();
      const requestId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      const response = await fetch(this.attendanceCommandEndpoint, {
        body: JSON.stringify({
          action: 'verify-microphone-state',
          requestId,
          roomId: this.connectedRoomId,
          state,
        }),
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          ...(await getVoiceAppCheckHeader()),
        },
        method: 'POST',
      });
      if (!response.ok) {
        debugLog('voice.attendance', 'verification:deferred-to-poll', {
          roomId: this.connectedRoomId,
          status: response.status,
        });
      }
    } catch (error) {
      debugError('voice.attendance', 'verification:deferred-to-poll', error, {
        roomId: this.connectedRoomId,
      });
    }
  }

  private emitEvent(event: VoiceClientEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

function getMediaDeviceErrorMessage(error: Error) {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return 'Microphone permission is required for voice chat.';
  }

  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'No microphone is available for voice chat.';
  }

  return 'Microphone setup failed.';
}

function mapLiveKitParticipant(
  participant: Participant,
  isLocal: boolean,
): VoiceParticipant {
  const metadata = parseParticipantMetadata(participant.metadata);
  const displayName = metadata.displayName || participant.name || participant.identity;

  return {
    id: participant.identity,
    displayName,
    role: metadata.role ?? (isLocal ? 'speaker' : 'speaker'),
    isMuted: isParticipantMuted(participant),
    isSpeaking: participant.isSpeaking,
    avatarLabel: metadata.avatarLabel || getAvatarLabel(displayName),
  };
}

function parseParticipantMetadata(metadata?: string) {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as {
      role?: unknown;
      displayName?: unknown;
      avatarLabel?: unknown;
    };

    return {
      role: isVoiceParticipantRole(parsed.role) ? parsed.role : undefined,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      avatarLabel: typeof parsed.avatarLabel === 'string' ? parsed.avatarLabel : undefined,
    };
  } catch {
    return {};
  }
}

function isVoiceParticipantRole(role: unknown): role is VoiceParticipant['role'] {
  return role === 'host' || role === 'speaker' || role === 'listener';
}

function isParticipantMuted(participant: Participant) {
  const publications = participant.getTrackPublications();
  const audioPublications = publications.filter((publication) => publication.kind === 'audio');

  if (audioPublications.length === 0) {
    return true;
  }

  return audioPublications.every((publication) => publication.isMuted);
}

function getAvatarLabel(displayName: string) {
  return displayName.trim().charAt(0) || '?';
}

function mapLiveKitConnectionState(state: ConnectionState): VoiceConnectionState {
  if (state === ConnectionState.Connected) {
    return 'connected';
  }

  if (
    state === ConnectionState.Connecting ||
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting
  ) {
    return 'connecting';
  }

  return 'disconnected';
}
