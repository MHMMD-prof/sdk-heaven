import { Room, RoomEvent } from 'livekit-client';

import { encodeDrawingGuessLiveKitPayload, decodeDrawingGuessLiveKitPayload } from './liveKitDrawingGuessPayload';
import { DRAWING_GUESS_TOPICS } from '../model/constants';
import { requestDrawingGuessLiveKitConnectOptions } from './requestDrawingGuessLiveKitConnectOptions';
import {
  DrawingGuessConnectOptions,
  DrawingGuessConnection,
  DrawingGuessInboundMessage,
  DrawingGuessOutboundMessage,
  DrawingGuessPresencePlayer,
  DrawingGuessTransport,
} from './types';

type LiveKitParticipantLike = {
  identity: string;
  name?: string;
};

type LiveKitRoomLike = {
  localParticipant: {
    identity: string;
    name?: string;
    publishData(data: Uint8Array, options?: { reliable?: boolean; topic?: string }): Promise<void>;
  };
  remoteParticipants: Map<string, LiveKitParticipantLike>;
  connect(serverUrl: string, token: string): Promise<void>;
  disconnect(): void;
  on(event: string, listener: (...args: unknown[]) => void): LiveKitRoomLike;
  off(event: string, listener: (...args: unknown[]) => void): LiveKitRoomLike;
  removeAllListeners(): LiveKitRoomLike;
};

type LiveKitRoomFactory = () => LiveKitRoomLike;

export class LiveKitDrawingGuessTransport implements DrawingGuessTransport {
  constructor(
    private readonly roomFactory: LiveKitRoomFactory = () => new Room() as unknown as LiveKitRoomLike,
    private readonly requestConnectOptions = requestDrawingGuessLiveKitConnectOptions,
  ) {}

  async connect(options: DrawingGuessConnectOptions): Promise<DrawingGuessConnection> {
    const connectOptions = await this.requestConnectOptions(options);
    const room = this.roomFactory();
    const connection = new LiveKitDrawingGuessConnection(room, options.playerId);

    await connection.connect(connectOptions.serverUrl, connectOptions.token);

    return connection;
  }
}

class LiveKitDrawingGuessConnection implements DrawingGuessConnection {
  readonly localPlayerId: string;
  private readonly messageListeners = new Set<(message: DrawingGuessInboundMessage) => void>();
  private readonly presenceListeners = new Set<(players: DrawingGuessPresencePlayer[]) => void>();
  private readonly dataReceivedListener: (...args: unknown[]) => void;
  private readonly presenceChangedListener: (...args: unknown[]) => void;

  constructor(private readonly room: LiveKitRoomLike, localPlayerId: string) {
    this.localPlayerId = localPlayerId;
    this.dataReceivedListener = ((payload: Uint8Array, participant?: LiveKitParticipantLike) => {
      const message = decodeDrawingGuessLiveKitPayload(payload, Date.now());

      if (!message || (participant && message.senderId !== participant.identity)) {
        return;
      }

      this.emitMessage(message);
    }) as (...args: unknown[]) => void;
    this.presenceChangedListener = (() => this.emitPresence()) as (...args: unknown[]) => void;
  }

  async connect(serverUrl: string, token: string) {
    this.room
      .on(RoomEvent.DataReceived, this.dataReceivedListener)
      .on(RoomEvent.ParticipantConnected, this.presenceChangedListener)
      .on(RoomEvent.ParticipantDisconnected, this.presenceChangedListener)
      .on(RoomEvent.ParticipantNameChanged, this.presenceChangedListener)
      .on(RoomEvent.ParticipantMetadataChanged, this.presenceChangedListener);

    await this.room.connect(serverUrl, token);
    this.emitPresence();
  }

  async publish(message: DrawingGuessOutboundMessage): Promise<void> {
    await this.room.localParticipant.publishData(encodeDrawingGuessLiveKitPayload(message), {
      reliable: isReliableDrawingGuessTopic(message.topic),
      topic: message.topic,
    });
  }

  onMessage(listener: (message: DrawingGuessInboundMessage) => void) {
    this.messageListeners.add(listener);

    return () => this.messageListeners.delete(listener);
  }

  onPresence(listener: (players: DrawingGuessPresencePlayer[]) => void) {
    this.presenceListeners.add(listener);
    listener(this.getPresence());

    return () => this.presenceListeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    this.room
      .off(RoomEvent.DataReceived, this.dataReceivedListener)
      .off(RoomEvent.ParticipantConnected, this.presenceChangedListener)
      .off(RoomEvent.ParticipantDisconnected, this.presenceChangedListener)
      .off(RoomEvent.ParticipantNameChanged, this.presenceChangedListener)
      .off(RoomEvent.ParticipantMetadataChanged, this.presenceChangedListener);
    this.room.removeAllListeners();
    this.room.disconnect();
  }

  private emitMessage(message: DrawingGuessInboundMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  private emitPresence() {
    const players = this.getPresence();

    this.presenceListeners.forEach((listener) => listener(players));
  }

  private getPresence(): DrawingGuessPresencePlayer[] {
    return [
      mapLiveKitPresenceParticipant(this.room.localParticipant),
      ...Array.from(this.room.remoteParticipants.values()).map(mapLiveKitPresenceParticipant),
    ];
  }
}

function mapLiveKitPresenceParticipant(participant: LiveKitParticipantLike): DrawingGuessPresencePlayer {
  return {
    id: participant.identity,
    displayName: participant.name || participant.identity,
    joinedAt: Date.now(),
    isConnected: true,
  };
}

const isReliableDrawingGuessTopic = (topic: DrawingGuessOutboundMessage['topic']) =>
  topic !== DRAWING_GUESS_TOPICS.strokePreview;

export const __testing = {
  isReliableDrawingGuessTopic,
  mapLiveKitPresenceParticipant,
};
