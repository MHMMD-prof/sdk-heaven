import { validateTopicCompatibleDrawingGuessMessage } from './messageValidation';
import {
  DrawingGuessConnectOptions,
  DrawingGuessConnection,
  DrawingGuessInboundMessage,
  DrawingGuessOutboundMessage,
  DrawingGuessPresencePlayer,
  DrawingGuessTransport,
} from './types';

type MockRoom = {
  connections: Set<MockDrawingGuessConnection>;
};

export class MockDrawingGuessTransport implements DrawingGuessTransport {
  private rooms = new Map<string, MockRoom>();

  async connect(options: DrawingGuessConnectOptions): Promise<DrawingGuessConnection> {
    const room = this.getRoom(options.roomId);
    const connection = new MockDrawingGuessConnection(options, room);

    room.connections.add(connection);
    emitPresence(room);

    return connection;
  }

  private getRoom(roomId: string) {
    const existingRoom = this.rooms.get(roomId);

    if (existingRoom) {
      return existingRoom;
    }

    const room = {
      connections: new Set<MockDrawingGuessConnection>(),
    };
    this.rooms.set(roomId, room);

    return room;
  }
}

class MockDrawingGuessConnection implements DrawingGuessConnection {
  readonly localPlayerId: string;
  private readonly messageListeners = new Set<(message: DrawingGuessInboundMessage) => void>();
  private readonly presenceListeners = new Set<(players: DrawingGuessPresencePlayer[]) => void>();
  private isConnected = true;
  readonly presence: DrawingGuessPresencePlayer;

  constructor(
    options: DrawingGuessConnectOptions,
    private readonly room: MockRoom,
  ) {
    this.localPlayerId = options.playerId;
    this.presence = {
      id: options.playerId,
      displayName: options.displayName,
      joinedAt: Date.now(),
      isConnected: true,
    };
  }

  async publish(message: DrawingGuessOutboundMessage): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Drawing Guess mock connection is disconnected.');
    }

    const validMessage = validateTopicCompatibleDrawingGuessMessage(message);

    if (!validMessage) {
      return;
    }

    const inboundMessage = {
      ...validMessage,
      receivedAt: Date.now(),
    };

    this.room.connections.forEach((connection) => {
      if (connection.isConnected) {
        connection.emitMessage(inboundMessage);
      }
    });
  }

  onMessage(listener: (message: DrawingGuessInboundMessage) => void) {
    this.messageListeners.add(listener);

    return () => this.messageListeners.delete(listener);
  }

  onPresence(listener: (players: DrawingGuessPresencePlayer[]) => void) {
    this.presenceListeners.add(listener);
    listener(getPresence(this.room));

    return () => this.presenceListeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    this.isConnected = false;
    this.presence.isConnected = false;
    this.room.connections.delete(this);
    emitPresence(this.room);
  }

  emitMessage(message: DrawingGuessInboundMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitPresence(players: DrawingGuessPresencePlayer[]) {
    this.presenceListeners.forEach((listener) => listener(players));
  }
}

const getPresence = (room: MockRoom): DrawingGuessPresencePlayer[] =>
  Array.from(room.connections)
    .map((connection) => connection.presence)
    .sort((left, right) => left.joinedAt - right.joinedAt);

const emitPresence = (room: MockRoom) => {
  const players = getPresence(room);

  room.connections.forEach((connection) => connection.emitPresence(players));
};
