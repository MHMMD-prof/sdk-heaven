import { VoiceClient } from './VoiceClient';
import { mapVoiceRoomToMockParticipants } from './mapVoiceRoomToMockParticipants';
import {
  VoiceClientEvent,
  VoiceClientEventListener,
  VoiceConnectOptions,
  VoiceConnectionState,
  VoiceParticipant,
  VoiceRoomCommand,
  VoiceRoomCommandResult,
} from './types';

export class MockVoiceClient implements VoiceClient {
  private connectionState: VoiceConnectionState = 'idle';
  private participants: VoiceParticipant[] = [];
  private eventListeners = new Set<VoiceClientEventListener>();
  private commandHistory: VoiceRoomCommandResult[] = [];
  private speakingTimer?: ReturnType<typeof setInterval>;
  private connectAttemptId = 0;
  private speakerEnabled = true;

  async connect(options: VoiceConnectOptions): Promise<void> {
    void options;

    const attemptId = this.connectAttemptId + 1;
    this.connectAttemptId = attemptId;
    this.setConnectionState('connecting');

    await new Promise((resolve) => setTimeout(resolve, 350));

    if (attemptId !== this.connectAttemptId) {
      return;
    }

    this.participants = mapVoiceRoomToMockParticipants(options.mockRoom);
    if (options.canPublishAudio === false || options.startMuted === true) {
      this.updateLocalParticipant({ isMuted: true, isSpeaking: false });
    }
    this.setConnectionState('connected');
    this.emitParticipants();
    this.startSpeakingLoop();
  }

  async disconnect(): Promise<void> {
    this.connectAttemptId += 1;
    this.stopSpeakingLoop();
    this.participants = [];
    this.emitParticipants();
    this.emitSpeaking([]);
    this.setConnectionState('disconnected');
  }

  async muteMic(): Promise<void> {
    this.updateLocalParticipant({ isMuted: true, isSpeaking: false });
  }

  async unmuteMic(): Promise<void> {
    this.updateLocalParticipant({ isMuted: false });
  }

  async setSpeakerEnabled(enabled: boolean): Promise<void> {
    this.speakerEnabled = enabled;
  }

  setBlockedParticipantIds(_participantIds: Iterable<string>): void {}

  async executeRoomCommand(command: VoiceRoomCommand): Promise<VoiceRoomCommandResult> {
    const participantExists = this.participants.some(
      (participant) => participant.id === command.participantId,
    );
    let status: VoiceRoomCommandResult['status'] = participantExists ? 'applied' : 'ignored';

    if (command.type === 'mute') {
      this.participants = this.participants.map((participant) =>
        participant.id === command.participantId
          ? { ...participant, isMuted: true, isSpeaking: false }
          : participant,
      );
      this.emitParticipants();
      this.emitSpeaking(this.getSpeakingIds());
    }

    if (command.type === 'kick' || command.type === 'block') {
      this.participants = this.participants.filter(
        (participant) => participant.id !== command.participantId,
      );
      this.emitParticipants();
      this.emitSpeaking(this.getSpeakingIds());
    }

    if (command.type === 'report') {
      status = participantExists ? 'recorded' : 'ignored';
    }

    const result: VoiceRoomCommandResult = {
      command,
      createdAt: Date.now(),
      status,
    };
    this.commandHistory = [result, ...this.commandHistory];

    return result;
  }

  async getParticipants(): Promise<VoiceParticipant[]> {
    return this.participants;
  }

  onEvent(listener: VoiceClientEventListener): () => void {
    this.eventListeners.add(listener);
    listener({ type: 'connectionStateChanged', connectionState: this.connectionState });
    listener({ type: 'participantsChanged', participants: this.participants });
    listener({ type: 'speakingChanged', participantIds: this.getSpeakingIds() });

    return () => this.eventListeners.delete(listener);
  }

  private updateLocalParticipant(update: Partial<VoiceParticipant>) {
    this.participants = this.participants.map((participant) =>
      participant.id === 'local-user' ? { ...participant, ...update } : participant,
    );
    this.emitParticipants();
    this.emitSpeaking(this.getSpeakingIds());
  }

  private startSpeakingLoop() {
    this.stopSpeakingLoop();
    this.speakingTimer = setInterval(() => {
      if (!this.speakerEnabled || this.connectionState !== 'connected') {
        this.emitSpeaking([]);
        return;
      }

      const nextSpeakerIds = this.participants
        .filter((participant) => participant.role !== 'listener')
        .map((participant) => participant.id)
        .filter(() => Math.random() > 0.48);
      this.participants = this.participants.map((participant) => ({
        ...participant,
        isSpeaking: nextSpeakerIds.includes(participant.id) && !participant.isMuted,
      }));
      this.emitParticipants();
      this.emitSpeaking(this.getSpeakingIds());
    }, 1800);
  }

  private stopSpeakingLoop() {
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = undefined;
    }
  }

  private getSpeakingIds() {
    return this.participants
      .filter((participant) => participant.isSpeaking)
      .map((participant) => participant.id);
  }

  private setConnectionState(state: VoiceConnectionState) {
    this.connectionState = state;
    this.emitEvent({ type: 'connectionStateChanged', connectionState: state });
  }

  private emitParticipants() {
    this.emitEvent({ type: 'participantsChanged', participants: this.participants });
  }

  private emitSpeaking(participantIds: string[]) {
    this.emitEvent({ type: 'speakingChanged', participantIds });
  }

  private emitEvent(event: VoiceClientEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
